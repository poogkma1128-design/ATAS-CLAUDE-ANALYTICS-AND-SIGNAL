using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
using ATAS.Indicators;
using ATAS.Indicators.Drawing;
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
    /// ATAS. The optional overlay only renders plans and results returned by
    /// the server; it never evaluates a rule or manufactures a trade locally.
    /// </summary>
    [DisplayName("Signal Bridge")]
    [Category("Order Flow")]
    // ATAS renders a class-level Description in the About panel of the
    // Indicators dialog, which is the one place to check what is actually
    // loaded without rebuilding. BuildInfo is generated at compile time by the
    // GenerateBuildInfo target; see the csproj for why it cannot be read off
    // the assembly at runtime instead.
    [Description(BuildInfo.Summary)]
    public class SignalBridgeIndicator : Indicator
    {
        private readonly HttpSender _sender = new HttpSender();
        private readonly AnnotationClient _annotations = new AnnotationClient();

        private int _lastBar = -1;
        private bool _seeded;
        private DateTime _lastIntrabarSend = DateTime.MinValue;
        private bool _warnedAboutConfig;
        private int _renderedAnnotationVersion = -1;
        private int _renderedAtBar = -1;

        public SignalBridgeIndicator()
            : base(true)
        {
            // Nothing is plotted; the indicator exists purely to move data.
            var series = (ValueDataSeries)DataSeries[0];
            series.VisualType = VisualMode.Hide;
            DrawAbovePrice = true;
        }

        #region Settings

        // Read-only, and first in the list on purpose. The About panel carries
        // the same string, but a setting is rendered by the same mechanism as
        // every other field here, so it still shows if a future ATAS lays that
        // panel out differently.
        [Display(Name = "Revision", GroupName = "About", Order = 1,
            Description = "Which build of this indicator is loaded. Compare the commit with the one you just built.")]
        [ReadOnly(true)]
        public string Revision => BuildInfo.Summary;

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

        [Display(Name = "Show trade overlay", GroupName = "Overlay", Order = 80,
            Description = "Draw server-approved Entry, SL, TP and resolved exits on this chart. It never changes the signal logic.")]
        public bool ShowTradeOverlay { get; set; } = true;

        [Display(Name = "Overlay refresh (seconds)", GroupName = "Overlay", Order = 90,
            Description = "How often this indicator fetches the optional chart annotations in the background.")]
        [Range(10, 300)]
        public int OverlayRefreshSeconds { get; set; } = 30;

        [Display(Name = "Overlay lookback bars", GroupName = "Overlay", Order = 100,
            Description = "Maximum recent chart bars considered when drawing signal plans and results.")]
        [Range(20, 1000)]
        public int OverlayLookbackBars { get; set; } = 200;

        [Display(Name = "Show Entry / SL / TP lines", GroupName = "Overlay", Order = 110,
            Description = "Draw horizontal plan lines for each signal. Disabled by default to keep the chart uncluttered.")]
        public bool ShowOverlayPlanLines { get; set; }

        [Display(Name = "Overlay marker font size", GroupName = "Overlay", Order = 120,
            Description = "Fixed pixel size of compact Entry and Exit markers. It no longer shrinks when the chart is zoomed out.")]
        [Range(10, 24)]
        public int OverlayMarkerFontSize { get; set; } = 14;

        [Display(Name = "Show marker details", GroupName = "Overlay", Order = 130,
            Description = "Append signal ID and exact price to every marker. Leave off for the clean professional chart view; the marker is still anchored to the exact price.")]
        public bool ShowOverlayMarkerDetails { get; set; }

        #endregion

        protected override void OnInitialize()
        {
            _sender.Log = message => this.LogInfo(message);
            _annotations.Log = message => this.LogInfo(message);

            // Written on every load, so the ATAS log can still answer which
            // build was running during a session that has already ended.
            this.LogInfo("Signal Bridge " + BuildInfo.Summary);

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

            // Overlay settings (compact/details, font size, lines and lookback)
            // must take effect on the next live-edge calculation even when the
            // annotation payload and current bar have not changed.
            _renderedAnnotationVersion = -1;
            _renderedAtBar = -1;
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

                var instrument = InstrumentInfo;
                if (instrument != null)
                {
                    if (ShowTradeOverlay)
                    {
                        _annotations.Refresh(EndpointUrl.Trim(), IngestToken.Trim(), instrument.Instrument,
                            string.IsNullOrWhiteSpace(TimeframeLabel) ? "unknown" : TimeframeLabel.Trim(),
                            OverlayLookbackBars, OverlayRefreshSeconds);
                        RenderTradeOverlay(instrument.TickSize, liveBar);
                    }
                    else
                    {
                        ClearTradeOverlay();
                    }
                }

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
            _annotations.Dispose();
            ClearTradeOverlay();
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

        private void RenderTradeOverlay(decimal tickSize, int liveBar)
        {
            var version = _annotations.Version;
            if (version == _renderedAnnotationVersion && liveBar == _renderedAtBar) return;

            ClearTradeOverlay();
            _renderedAnnotationVersion = version;
            _renderedAtBar = liveBar;

            var firstBar = Math.Max(0, CurrentBar - OverlayLookbackBars);
            var indexByTime = new Dictionary<string, int>();
            var markerLanes = new Dictionary<string, int>();
            for (var i = firstBar; i < CurrentBar; i++)
            {
                var candle = GetCandle(i);
                if (candle == null) continue;
                indexByTime[ToUtcIso(candle.Time)] = i;
            }

            foreach (var item in _annotations.Snapshot())
            {
                if (item == null || string.IsNullOrWhiteSpace(item.Id) ||
                    !indexByTime.TryGetValue(NormalizeIso(item.EntryOpenedAt), out var entryBar)) continue;

                var exitBar = -1;
                var hasExit = !string.IsNullOrWhiteSpace(item.ExitOpenedAt) &&
                              indexByTime.TryGetValue(NormalizeIso(item.ExitOpenedAt), out exitBar);
                var endBar = hasExit ? exitBar : liveBar;
                var ray = !hasExit;
                var longTrade = string.Equals(item.Direction, "long", StringComparison.OrdinalIgnoreCase);
                var tag = string.IsNullOrWhiteSpace(item.Seq?.ToString()) ? item.Id : "S" + item.Seq;

                if (ShowOverlayPlanLines)
                {
                    AddPlanLine(entryBar, endBar, item.Entry, Color.DimGray, 1, ray);
                    AddPlanLine(entryBar, endBar, item.Stop, Color.IndianRed, 1, ray);
                    AddPlanLine(entryBar, endBar, item.Target, Color.SeaGreen, 1, ray);
                }

                var entryAbove = !longTrade;
                AddMarker("entry-" + item.Id, entryBar, item.Entry,
                    EntryMarkerText(longTrade, tag, item.Entry, ShowOverlayMarkerDetails),
                    longTrade ? LongMarkerColor() : ShortMarkerColor(), entryAbove, tickSize,
                    NextMarkerLane(markerLanes, entryBar, entryAbove));

                if (hasExit && item.ExitPrice.HasValue)
                {
                    var exitAbove = longTrade;
                    AddMarker("exit-" + item.Id, exitBar, item.ExitPrice.Value,
                        ExitMarkerText(item.ExitReason, tag, item.ExitPrice.Value, ShowOverlayMarkerDetails),
                        ExitColor(item.ExitReason), exitAbove, tickSize,
                        NextMarkerLane(markerLanes, exitBar, exitAbove));
                }
            }
        }

        private void AddPlanLine(int firstBar, int secondBar, decimal price, Color color, int width, bool ray)
        {
            var pen = new Pen(color, width);
            TrendLines.Add(new TrendLine(firstBar, price, secondBar, price, pen) { IsRay = ray });
        }

        private void AddMarker(string key, int bar, decimal price, string text, Color color, bool above,
            decimal tickSize, int lane)
        {
            // Keep markers visually stable at every chart scale. ATAS AutoSize
            // changes text size with zoom, which made the old audit-length labels
            // unreadable unless the owner zoomed in. Compact labels also follow
            // the event-marker convention used by professional chart platforms.
            var offset = 10 + lane * (OverlayMarkerFontSize + 6);
            Labels[key] = new DrawingText(tickSize)
            {
                Tag = key,
                Bar = bar,
                TextPrice = price,
                Text = text,
                IsAbovePrice = above,
                Textcolor = Color.White,
                Outlinecolor = Color.FromArgb(245, 16, 16, 16),
                FillColor = Color.FromArgb(235, color),
                FontSize = OverlayMarkerFontSize,
                AutoSize = false,
                Align = DrawingText.TextAlign.Center,
                YOffset = above ? -offset : offset
            };
        }

        private static int NextMarkerLane(IDictionary<string, int> lanes, int bar, bool above)
        {
            var key = bar + (above ? "-above" : "-below");
            if (!lanes.TryGetValue(key, out var lane)) lane = 0;
            lanes[key] = lane + 1;
            return lane;
        }

        private static string EntryMarkerText(bool longTrade, string tag, decimal price, bool showDetails)
        {
            var compact = longTrade ? "▲ L" : "▼ S";
            return showDetails ? compact + " #" + tag + " @ " + price : compact;
        }

        private static string ExitMarkerText(string reason, string tag, decimal price, bool showDetails)
        {
            var compact = ExitLabel(reason);
            return showDetails ? compact + " #" + tag + " @ " + price : compact;
        }

        private void ClearTradeOverlay()
        {
            foreach (var line in TrendLines)
            {
                try { line.Pen?.Dispose(); } catch { }
            }
            TrendLines.Clear();
            Labels.Clear();
            _renderedAnnotationVersion = -1;
            _renderedAtBar = -1;
        }

        private static string ToUtcIso(DateTime value)
        {
            return DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        }

        private static string NormalizeIso(string value)
        {
            if (!DateTime.TryParse(value, out var parsed)) return value ?? string.Empty;
            return parsed.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
        }

        private static string ExitLabel(string reason)
        {
            switch (reason)
            {
                case "target": return "TP";
                case "stop": return "SL";
                case "trail": return "TR";
                case "timeout": return "TIME";
                default: return "EXIT";
            }
        }

        private static Color LongMarkerColor()
        {
            return Color.FromArgb(24, 150, 88);
        }

        private static Color ShortMarkerColor()
        {
            return Color.FromArgb(211, 58, 67);
        }

        private static Color ExitColor(string reason)
        {
            switch (reason)
            {
                case "target": return Color.FromArgb(24, 150, 88);
                case "trail": return Color.FromArgb(35, 112, 196);
                case "timeout": return Color.FromArgb(211, 126, 20);
                default: return Color.FromArgb(211, 58, 67);
            }
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
