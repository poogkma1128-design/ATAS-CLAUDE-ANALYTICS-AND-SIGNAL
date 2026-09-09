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
        private readonly long[] _mboLatencyBuckets = new long[LatencyUpperBoundsMs.Length + 1];
        private readonly long[] _tradeLatencyBuckets = new long[LatencyUpperBoundsMs.Length + 1];

        private DateTime _startedAtUtc;
        private DateTime _lastMboEventUtc;
        private long _callbacks;
        private long _maxCallbackBatch;
        private long _bookEpoch;
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

        public void Start()
        {
            lock (_gate)
            {
                _startedAtUtc = DateTime.UtcNow;
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

                    var eventUtc = AsUtc(update.Time);
                    if (_lastMboEventUtc != DateTime.MinValue && eventUtc < _lastMboEventUtc)
                        _clockRegressions++;
                    if (eventUtc > _lastMboEventUtc) _lastMboEventUtc = eventUtc;

                    ObserveLatency(_mboLatencyBuckets, receivedAtUtc, eventUtc,
                        ref _futureMboEvents);
                }

                _callbacks++;
                if (batch > _maxCallbackBatch) _maxCallbackBatch = batch;
                if (sawSnapshot) _bookEpoch++;
            }
        }

        public void ObserveTrade(MarketDataArg trade, DateTime receivedAtUtc)
        {
            if (trade == null) return;

            lock (_gate)
            {
                _trades++;
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
                return JsonSerializer.Serialize(new
                {
                    type = "mbo_probe",
                    version = "MBO_PROBE_V1",
                    reason,
                    symbol,
                    startedAtUtc = Iso(_startedAtUtc),
                    observedAtUtc = Iso(DateTime.UtcNow),
                    callbacks = _callbacks,
                    maxCallbackBatch = _maxCallbackBatch,
                    bookEpoch = _bookEpoch,
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
            }
        }

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
