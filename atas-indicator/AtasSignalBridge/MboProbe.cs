using System;
using System.Collections.Generic;
using System.Text.Json;
using ATAS.DataFeedsCore;
using ATAS.Indicators;

namespace AtasSignalBridge
{
    /// <summary>
    /// Bounded, log-only Gate 0 probe. It never creates a signal, writes a
    /// network payload or retains the order book. Histogram counters keep its
    /// memory constant even during an active COMEX session.
    /// </summary>
    internal sealed class MboProbe
    {
        private static readonly int[] LatencyUpperBoundsMs =
            { 10, 25, 50, 100, 250, 500, 1000, 2000, 5000 };

        private readonly object _gate = new object();
        private readonly Func<DateTime> _utcNow;
        private readonly long[] _mboLatencyBuckets = new long[LatencyUpperBoundsMs.Length + 1];
        private readonly long[] _tradeLatencyBuckets = new long[LatencyUpperBoundsMs.Length + 1];

        private DateTime _startedAtUtc;
        private DateTime _windowStartUtc;
        private DateTime _lastMboReceivedUtc;
        private DateTime _lastTradeReceivedUtc;
        private string _sessionId;
        private long _windowSequence;
        private DateTime _lastMboEventUtc;
        private long _callbacks;
        private long _maxCallbackBatch;
        private long _snapshotCallbacks;
        private long _initialSnapshotReads;
        private long _initialSnapshotOrders;
        private long _snapshot;
        private long _created;
        private long _changed;
        private long _deleted;
        private long _zeroOrderId;
        private long _clockRegressions;
        private long _futureMboEvents;
        private long _trades;
        private long _nullTradeOrderId;
        private long _nullAggressorOrderId;
        private long _futureTradeEvents;

        public MboProbe(Func<DateTime> utcNow = null)
        {
            _utcNow = utcNow ?? (() => DateTime.UtcNow);
        }

        public void Start()
        {
            lock (_gate)
            {
                _startedAtUtc = _utcNow();
                _windowStartUtc = _startedAtUtc;
                _sessionId = Guid.NewGuid().ToString("N");
                _windowSequence = 0;
                _lastMboEventUtc = _lastMboReceivedUtc = _lastTradeReceivedUtc = DateTime.MinValue;
                ResetWindow();
            }
        }

        public void ObserveMboBatch(IEnumerable<MarketByOrder> updates, DateTime receivedAtUtc)
        {
            if (updates == null) return;

            lock (_gate)
            {
                long batch = 0;
                var sawSnapshot = false;

                foreach (var update in updates)
                {
                    if (update == null) continue;
                    batch++;

                    switch (update.Type)
                    {
                        case MarketByOrderUpdateTypes.Snapshot:
                            _snapshot++;
                            sawSnapshot = true;
                            break;
                        case MarketByOrderUpdateTypes.New:
                            _created++;
                            break;
                        case MarketByOrderUpdateTypes.Change:
                            _changed++;
                            break;
                        case MarketByOrderUpdateTypes.Delete:
                            _deleted++;
                            break;
                    }

                    if (update.ExchangeOrderId == 0) _zeroOrderId++;

                    // ATAS defines Snapshot as cached data, not a live event.
                    // Its old order timestamps must not poison live latency.
                    if (update.Type == MarketByOrderUpdateTypes.Snapshot) continue;
                    _lastMboReceivedUtc = receivedAtUtc;

                    var eventUtc = AsUtc(update.Time);
                    if (_lastMboEventUtc != DateTime.MinValue && eventUtc < _lastMboEventUtc)
                        _clockRegressions++;
                    if (eventUtc > _lastMboEventUtc) _lastMboEventUtc = eventUtc;

                    ObserveLatency(_mboLatencyBuckets, receivedAtUtc, eventUtc,
                        ref _futureMboEvents);
                }

                _callbacks++;
                if (batch > _maxCallbackBatch) _maxCallbackBatch = batch;
                if (sawSnapshot) _snapshotCallbacks++;
            }
        }

        // SDK exposes the initial/current cache via MarketByOrders after the
        // subscription Task completes. Do not rely on a Snapshot callback.
        public void ObserveInitialSnapshot(IEnumerable<MarketByOrder> orders)
        {
            if (orders == null) return;
            lock (_gate)
            {
                _initialSnapshotReads++;
                foreach (var order in orders)
                    if (order != null) _initialSnapshotOrders++;
            }
        }

        public void ObserveTrade(MarketDataArg trade, DateTime receivedAtUtc)
        {
            if (trade == null) return;

            lock (_gate)
            {
                _trades++;
                _lastTradeReceivedUtc = receivedAtUtc;
                if (!trade.ExchangeOrderId.HasValue) _nullTradeOrderId++;
                if (!trade.AggressorExchangeOrderId.HasValue) _nullAggressorOrderId++;
                ObserveLatency(_tradeLatencyBuckets, receivedAtUtc, AsUtc(trade.Time),
                    ref _futureTradeEvents);
            }
        }

        public string SnapshotJson(string symbol, string reason)
        {
            lock (_gate)
            {
                var now = _utcNow();
                var result = JsonSerializer.Serialize(new
                {
                    type = "mbo_probe",
                    version = "MBO_PROBE_V2",
                    reason,
                    symbol,
                    startedAtUtc = Iso(_startedAtUtc),
                    sessionId = _sessionId,
                    windowSequence = ++_windowSequence,
                    windowStartUtc = Iso(_windowStartUtc),
                    observedAtUtc = Iso(now),
                    windowDurationMs = (now - _windowStartUtc).TotalMilliseconds,
                    counterScope = "window",
                    callbacks = _callbacks,
                    maxCallbackBatch = _maxCallbackBatch,
                    snapshotCallbacks = _snapshotCallbacks,
                    initialSnapshotReads = _initialSnapshotReads,
                    initialSnapshotOrders = _initialSnapshotOrders,
                    bookEpoch = (long?)null,
                    bookEpochStatus = "unavailable:no_snapshot_boundary_in_callback",
                    lastLiveMboReceivedAtUtc = Iso(_lastMboReceivedUtc),
                    lastTradeReceivedAtUtc = Iso(_lastTradeReceivedUtc),
                    liveMboAgeMs = AgeMs(now, _lastMboReceivedUtc),
                    tradeAgeMs = AgeMs(now, _lastTradeReceivedUtc),
                    latencyScope = "window_live_events_only;unspecified_time_assumed_utc",
                    updates = new
                    {
                        snapshot = _snapshot,
                        created = _created,
                        changed = _changed,
                        deleted = _deleted
                    },
                    zeroOrderId = _zeroOrderId,
                    clockRegressions = _clockRegressions,
                    futureMboEvents = _futureMboEvents,
                    mboLatencyP95UpperMs = P95Upper(_mboLatencyBuckets),
                    trades = _trades,
                    nullTradeOrderId = _nullTradeOrderId,
                    nullAggressorOrderId = _nullAggressorOrderId,
                    futureTradeEvents = _futureTradeEvents,
                    tradeLatencyP95UpperMs = P95Upper(_tradeLatencyBuckets)
                });
                ResetWindow();
                _windowStartUtc = now;
                return result;
            }
        }

        private void ResetWindow()
        {
            Array.Clear(_mboLatencyBuckets);
            Array.Clear(_tradeLatencyBuckets);
            _callbacks = _maxCallbackBatch = _snapshotCallbacks = 0;
            _initialSnapshotReads = _initialSnapshotOrders = 0;
            _snapshot = _created = _changed = _deleted = _zeroOrderId = 0;
            _clockRegressions = _futureMboEvents = 0;
            _trades = _nullTradeOrderId = _nullAggressorOrderId = _futureTradeEvents = 0;
            // Preserve last receive/event time across windows: a silent feed
            // must age, and a regression across the boundary must be visible.
        }

        private static double? AgeMs(DateTime now, DateTime last) =>
            last == DateTime.MinValue ? null : (now - last).TotalMilliseconds;

        private static void ObserveLatency(long[] buckets, DateTime receivedAtUtc,
            DateTime eventUtc, ref long futureEvents)
        {
            var latency = (receivedAtUtc - eventUtc).TotalMilliseconds;
            if (latency < 0)
            {
                futureEvents++;
                latency = 0;
            }

            var bucket = LatencyUpperBoundsMs.Length;
            for (var i = 0; i < LatencyUpperBoundsMs.Length; i++)
            {
                if (latency <= LatencyUpperBoundsMs[i])
                {
                    bucket = i;
                    break;
                }
            }
            buckets[bucket]++;
        }

        private static string P95Upper(long[] buckets)
        {
            long total = 0;
            foreach (var count in buckets) total += count;
            if (total == 0) return "unavailable";

            var threshold = (long)Math.Ceiling(total * 0.95);
            long cumulative = 0;
            for (var i = 0; i < buckets.Length; i++)
            {
                cumulative += buckets[i];
                if (cumulative < threshold) continue;
                return i < LatencyUpperBoundsMs.Length
                    ? LatencyUpperBoundsMs[i].ToString()
                    : ">5000";
            }
            return "unavailable";
        }

        private static DateTime AsUtc(DateTime value)
        {
            if (value.Kind == DateTimeKind.Utc) return value;
            if (value.Kind == DateTimeKind.Local) return value.ToUniversalTime();
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        }

        private static string Iso(DateTime value)
        {
            return value == DateTime.MinValue ? null : value.ToString("O");
        }
    }
}
