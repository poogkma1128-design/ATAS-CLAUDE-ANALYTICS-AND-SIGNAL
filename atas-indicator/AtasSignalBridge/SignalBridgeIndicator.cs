using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using ATAS.Indicators;
using Utils.Common.Logging;

namespace AtasSignalBridge
{
    /// <summary>
    /// Streams cluster, delta and footprint numbers out of ATAS to the ingest
    /// endpoint.
    ///
    /// This indicator deliberately makes no trading decisions. It reads the
    /// footprint and posts it; every rule is evaluated server side, so
    /// thresholds can be changed without rebuilding this assembly or restarting
    /// ATAS. It draws nothing on the chart.
    /// </summary>
    [DisplayName("Signal Bridge")]
    [Category("Order Flow")]
    public class SignalBridgeIndicator : Indicator
    {
        private readonly HttpSender _sender = new HttpSender();

        private int _lastBar = -1;
        private bool _seeded;
        private DateTime _lastIntrabarSend = DateTime.MinValue;
        private bool _warnedAboutConfig;

        public SignalBridgeIndicator()
            : base(true)
        {
            // Nothing is plotted; the indicator exists purely to move data.
            var series = (ValueDataSeries)DataSeries[0];
            series.VisualType = VisualMode.Hide;
        }

        #region Settings

        [Display(Name = "Endpoint URL", GroupName = "Connection", Order = 10,
            Description = "Full URL of the ingest function, e.g. https://<project>.supabase.co/functions/v1/ingest")]
        public string EndpointUrl { get; set; } = string.Empty;

        [Display(Name = "Ingest token", GroupName = "Connection", Order = 20,
            Description = "Must match the INGEST_TOKEN secret set on the Supabase project.")]
        public string IngestToken { get; set; } = string.Empty;

        [Display(Name = "Timeframe label", GroupName = "Connection", Order = 30,
            Description = "How this chart is identified in the database, e.g. 5m, 1h, 2000t. Use a different label per chart.")]
        public string TimeframeLabel { get; set; } = "5m";

        [Display(Name = "Backfill bars on start", GroupName = "Streaming", Order = 40,
            Description = "Closed bars sent once when the indicator loads, so the rules have history to work with immediately.")]
        [Range(0, 200)]
        public int BackfillBars { get; set; } = 100;

        [Display(Name = "Send live bar updates", GroupName = "Streaming", Order = 50,
            Description = "Also stream the in-progress bar. Rules never evaluate an unfinished bar; this only keeps the dashboard current.")]
        public bool SendIntrabar { get; set; }

        [Display(Name = "Live update interval (ms)", GroupName = "Streaming", Order = 60)]
        [Range(250, 60000)]
        public int IntrabarThrottleMs { get; set; } = 2000;

        [Display(Name = "Max price levels per bar", GroupName = "Streaming", Order = 70,
            Description = "Safety cap for unusually wide bars.")]
        [Range(10, 2000)]
        public int MaxLevels { get; set; } = 1000;

        #endregion

        protected override void OnInitialize()
        {
            _sender.Log = message => this.LogInfo(message);
            _sender.Start();
        }

        protected override void OnRecalculate()
        {
            // A settings change or chart reload replays history from the start,
            // so forget where the live edge was.
            //
            // _seeded is deliberately left alone. ATAS recalculates far more
            // often than the chart actually reloads, and re-seeding here posted
            // the whole backfill again on every one of those passes: the same
            // hundred bars and several thousand footprint rows, four times over
            // in one session. Switching instrument or timeframe builds a new
            // indicator instance, which starts with _seeded false anyway, so
            // the backfill still happens exactly when it should.
            _lastBar = -1;
            _lastIntrabarSend = DateTime.MinValue;
        }

        protected override void OnCalculate(int bar, decimal value)
        {
            try
            {
                if (!IsConfigured()) return;

                // ATAS indexes bars 0..CurrentBar-1, so CurrentBar is a count and
                // the bar still forming is CurrentBar - 1. Comparing against
                // CurrentBar itself never matches and silently sends nothing.
                var liveBar = CurrentBar - 1;
                if (liveBar < 0) return;

                // OnCalculate walks every historical bar on load. Only the live
                // edge drives sending; the backfill below handles history.
                if (bar != liveBar) return;

                if (!_seeded)
                {
                    _seeded = true;
                    SendBackfill();
                    _lastBar = liveBar;
                    return;
                }

                if (_lastBar != liveBar)
                {
                    // The bar index moved on, so the previous one is final.
                    if (_lastBar >= 0 && _lastBar < liveBar)
                        Send(new[] { _lastBar }, isClosed: true);

                    _lastBar = liveBar;
                }

                if (!SendIntrabar) return;

                var now = DateTime.UtcNow;
                if ((now - _lastIntrabarSend).TotalMilliseconds < IntrabarThrottleMs) return;

                _lastIntrabarSend = now;
                Send(new[] { liveBar }, isClosed: false);
            }
            catch (Exception ex)
            {
                // An exception escaping into ATAS would take the chart down.
                this.LogError("Signal Bridge: " + ex.Message, ex);
            }
        }

        protected override void OnDispose()
        {
            _sender.Dispose();
        }

        private bool IsConfigured()
        {
            var ready = !string.IsNullOrWhiteSpace(EndpointUrl) &&
                        !string.IsNullOrWhiteSpace(IngestToken);

            if (!ready)
            {
                if (!_warnedAboutConfig)
                {
                    _warnedAboutConfig = true;
                    this.LogInfo("Signal Bridge: set the endpoint URL and ingest token in the indicator settings.");
                }
                return false;
            }

            _sender.EndpointUrl = EndpointUrl.Trim();
            _sender.Token = IngestToken.Trim();
            return true;
        }

        /// <summary>
        /// Sends the closed bars already on the chart in one request, so rules
        /// with a lookback have history from the first live bar rather than
        /// after another hour of trading.
        /// </summary>
        private void SendBackfill()
        {
            if (BackfillBars <= 0) return;

            // CurrentBar - 1 is still forming, so the newest finished bar is the
            // one before it.
            var last = CurrentBar - 2;
            if (last < 0) return;

            var first = Math.Max(0, last - BackfillBars + 1);

            var bars = new List<int>(last - first + 1);
            for (var i = first; i <= last; i++) bars.Add(i);

            Send(bars, isClosed: true);
        }

        private void Send(IReadOnlyList<int> barIndexes, bool isClosed)
        {
            var instrument = InstrumentInfo;
            if (instrument == null) return;

            var tickSize = instrument.TickSize;
            if (tickSize <= 0) return;

            var payload = new IngestPayload
            {
                Symbol = instrument.Instrument,
                Exchange = string.Empty,
                TickSize = tickSize,
                Timeframe = string.IsNullOrWhiteSpace(TimeframeLabel) ? "unknown" : TimeframeLabel.Trim()
            };

            foreach (var index in barIndexes)
            {
                var snapshot = BuildSnapshot(index, tickSize, isClosed);
                if (snapshot != null) payload.Bars.Add(snapshot);
            }

            _sender.Enqueue(payload);
        }

        private BarSnapshot BuildSnapshot(int bar, decimal tickSize, bool isClosed)
        {
            if (bar < 0 || bar >= CurrentBar) return null;

            var candle = GetCandle(bar);
            if (candle == null) return null;

            var snapshot = new BarSnapshot
            {
                // ATAS keeps candle times in UTC.
                OpenedAt = DateTime.SpecifyKind(candle.Time, DateTimeKind.Utc)
                    .ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
                Open = candle.Open,
                High = candle.High,
                Low = candle.Low,
                Close = candle.Close,
                Volume = candle.Volume,
                Delta = candle.Delta,
                MinDelta = candle.MinDelta,
                MaxDelta = candle.MaxDelta,
                IsClosed = isClosed
            };

            AppendFootprint(snapshot, bar, tickSize);
            return snapshot;
        }

        /// <summary>
        /// Walks the bar's price range a tick at a time and copies out every
        /// level that actually traded. Ask and bid volumes for the bar are
        /// summed from the levels rather than read separately, so they always
        /// agree with the footprint that is stored alongside them.
        /// </summary>
        private void AppendFootprint(BarSnapshot snapshot, int bar, decimal tickSize)
        {
            var candle = GetCandle(bar);
            var span = candle.High - candle.Low;
            if (span < 0) return;

            var levelCount = (int)(span / tickSize) + 1;
            if (levelCount > MaxLevels) levelCount = MaxLevels;

            decimal askTotal = 0;
            decimal bidTotal = 0;
            var tickTotal = 0;

            var price = candle.Low;
            for (var i = 0; i < levelCount; i++, price += tickSize)
            {
                var info = candle.GetPriceVolumeInfo(price);
                if (info == null) continue;
                if (info.Volume <= 0) continue;

                snapshot.Levels.Add(new ClusterLevelDto
                {
                    Price = price,
                    Ask = info.Ask,
                    Bid = info.Bid,
                    Between = info.Between,
                    Volume = info.Volume,
                    Ticks = (int)info.Ticks
                });

                askTotal += info.Ask;
                bidTotal += info.Bid;
                tickTotal += (int)info.Ticks;
            }

            snapshot.AskVolume = askTotal;
            snapshot.BidVolume = bidTotal;
            snapshot.Ticks = tickTotal;
        }
    }
}
