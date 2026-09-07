using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Drawing;
using System.Globalization;
using System.Text.RegularExpressions;
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
            Description = "Fixed pixel size of Entry, SL, TP and Exit price labels. It does not shrink when the chart is zoomed out.")]
        [Range(8, 32)]
        public int OverlayMarkerFontSize { get; set; } = 14;

        [Display(Name = "Show signal IDs", GroupName = "Overlay", Order = 130,
            Description = "Append #S signal IDs to price labels. Leave off for the clean chart view.")]
        public bool ShowOverlayMarkerDetails { get; set; }

        [Display(Name = "Show SL / TP price labels", GroupName = "Overlay", Order = 140,
            Description = "Show the planned Stop Loss and Take Profit price next to each Entry. Entry and resolved Exit prices are always shown.")]
        public bool ShowOverlayPlanPriceLabels { get; set; } = true;

        [Display(Name = "Marker opacity", GroupName = "Overlay", Order = 150,
            Description = "Background opacity for every price label: 80 is transparent, 255 is solid.")]
        [Range(80, 255)]
        public int OverlayMarkerOpacity { get; set; } = 235;

        [Display(Name = "Long entry", GroupName = "Overlay Colors", Order = 200)]
        public Color OverlayLongColor { get; set; } = Color.FromArgb(24, 150, 88);

        [Display(Name = "Short entry", GroupName = "Overlay Colors", Order = 210)]
        public Color OverlayShortColor { get; set; } = Color.FromArgb(211, 58, 67);

        [Display(Name = "Stop Loss", GroupName = "Overlay Colors", Order = 220)]
        public Color OverlayStopColor { get; set; } = Color.FromArgb(211, 58, 67);

        [Display(Name = "Take Profit", GroupName = "Overlay Colors", Order = 230)]
        public Color OverlayTargetColor { get; set; } = Color.FromArgb(24, 150, 88);

        [Display(Name = "Trailing stop", GroupName = "Overlay Colors", Order = 240)]
        public Color OverlayTrailColor { get; set; } = Color.FromArgb(35, 112, 196);

        [Display(Name = "Timeout", GroupName = "Overlay Colors", Order = 250)]
        public Color OverlayTimeoutColor { get; set; } = Color.FromArgb(211, 126, 20);

        [Display(Name = "Other exit", GroupName = "Overlay Colors", Order = 260)]
        public Color OverlayExitColor { get; set; } = Color.FromArgb(105, 105, 105);

        [Display(Name = "Text", GroupName = "Overlay Colors", Order = 270)]
        public Color OverlayTextColor { get; set; } = Color.White;

        [Display(Name = "Border", GroupName = "Overlay Colors", Order = 280)]
        public Color OverlayBorderColor { get; set; } = Color.FromArgb(16, 16, 16);

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

            var mismatch = SpacingMismatch(payload);
            if (mismatch != null)
            {
                // Refuse rather than post. The server rejects this too, but a
                // rejection there is a line in a log nobody is reading; here it
                // lands in the ATAS log with the chart still in front of you.
                this.LogError("Signal Bridge: " + mismatch, new InvalidOperationException(mismatch));
                return;
            }

            _sender.Enqueue(payload);
        }

        /// <summary>
        /// Describes the disagreement when the bars about to be sent are coarser
        /// than <see cref="TimeframeLabel"/> claims, or null when they agree.
        ///
        /// The label is typed by hand and defaults to "5m" - it is not read from
        /// the chart - so attaching this indicator to a daily chart posts daily
        /// bars into the 5m partition. That happened on 2026-09-03: 255 daily and
        /// H4 bars went in as "5m" and the server evaluated rules against them,
        /// leaving 177 signals in the database that were never 5m signals.
        ///
        /// The test is whether ANY pair of consecutive closed bars is exactly one
        /// period apart. Checking that gaps divide evenly by the period would not
        /// catch it, because a day is a whole multiple of five minutes; but a chart
        /// genuinely on a period yields at least one gap of exactly that period in
        /// any three bars, and a coarser or finer chart yields none.
        ///
        /// Deliberately not the smallest gap: the database holds closed bars a
        /// millisecond apart from the tick-chart version of this bug, and keying on
        /// the minimum would discard a whole payload over one odd bar. Mirrors
        /// spacingError() in supabase/functions/_shared/ingest.ts.
        /// </summary>
        private string SpacingMismatch(IngestPayload payload)
        {
            var expected = TimeframeSpan(payload.Timeframe);
            // Tick and range charts close on volume, not the clock: no spacing is
            // wrong for them, so there is nothing to check.
            if (expected == TimeSpan.Zero) return null;

            var times = new List<DateTime>();
            foreach (var snapshot in payload.Bars)
            {
                if (!snapshot.IsClosed) continue;
                if (DateTime.TryParse(snapshot.OpenedAt,
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal,
                        out var parsed))
                {
                    times.Add(parsed);
                }
            }

            // Two bars either side of a weekend are legitimately far apart, and a
            // lone live bar has no gap at all. Neither is evidence of anything.
            if (times.Count < 3) return null;
            times.Sort();

            var smallest = TimeSpan.MaxValue;
            for (var i = 1; i < times.Count; i++)
            {
                var gap = times[i] - times[i - 1];
                if (gap == expected) return null;
                if (gap > TimeSpan.Zero && gap < smallest) smallest = gap;
            }
            if (smallest == TimeSpan.MaxValue) return null;

            return "no two bars on this chart are " + Describe(expected) + " apart (closest is "
                + Describe(smallest) + "), but the timeframe label says \""
                + payload.Timeframe + "\". Nothing was sent. Set the label to match this "
                + "chart's period, or move the indicator to a " + payload.Timeframe + " chart.";
        }

        private static string Describe(TimeSpan span)
        {
            if (span.TotalMinutes % 60 == 0) return span.TotalHours + "h";
            if (span.TotalSeconds % 60 == 0) return span.TotalMinutes + "m";
            return span.TotalSeconds + "s";
        }

        /// <summary>
        /// A time-based timeframe label as a span, or <see cref="TimeSpan.Zero"/>
        /// for labels that do not describe a fixed period ("2000t", "50r").
        /// Mirrors timeframeMinutes() in supabase/functions/_shared/ingest.ts;
        /// the two must agree or the client refuses what the server accepts.
        /// </summary>
        private static TimeSpan TimeframeSpan(string label)
        {
            if (string.IsNullOrWhiteSpace(label)) return TimeSpan.Zero;

            var match = Regex.Match(label.Trim(), @"^(\d+)\s*(m|min|mins|h|hr|hrs|d)$",
                RegexOptions.IgnoreCase);
            if (!match.Success) return TimeSpan.Zero;
            if (!int.TryParse(match.Groups[1].Value, out var count) || count <= 0)
            {
                return TimeSpan.Zero;
            }

            var unit = match.Groups[2].Value.ToLowerInvariant();
            if (unit.StartsWith("d")) return TimeSpan.FromDays(count);
            if (unit.StartsWith("h")) return TimeSpan.FromHours(count);
            return TimeSpan.FromMinutes(count);
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
                    AddPlanLine(entryBar, endBar, item.Entry,
                        longTrade ? OverlayLongColor : OverlayShortColor, 1, ray);
                    AddPlanLine(entryBar, endBar, item.Stop, OverlayStopColor, 1, ray);
                    AddPlanLine(entryBar, endBar, item.Target, OverlayTargetColor, 1, ray);
                }

                var entryAbove = !longTrade;
                AddMarker("entry-" + item.Id, entryBar, item.Entry,
                    EntryMarkerText(longTrade, tag, item.Entry, tickSize, ShowOverlayMarkerDetails),
                    longTrade ? OverlayLongColor : OverlayShortColor, entryAbove, tickSize,
                    NextMarkerLane(markerLanes, entryBar, entryAbove));

                if (ShowOverlayPlanPriceLabels)
                {
                    var stopAbove = !longTrade;
                    AddMarker("stop-" + item.Id, entryBar, item.Stop,
                        PlanMarkerText("SL", tag, item.Stop, tickSize, ShowOverlayMarkerDetails),
                        OverlayStopColor, stopAbove, tickSize,
                        NextMarkerLane(markerLanes, entryBar, stopAbove));

                    var targetAbove = longTrade;
                    AddMarker("target-" + item.Id, entryBar, item.Target,
                        PlanMarkerText("TP", tag, item.Target, tickSize, ShowOverlayMarkerDetails),
                        OverlayTargetColor, targetAbove, tickSize,
                        NextMarkerLane(markerLanes, entryBar, targetAbove));
                }

                if (hasExit && item.ExitPrice.HasValue)
                {
                    var exitAbove = longTrade;
                    AddMarker("exit-" + item.Id, exitBar, item.ExitPrice.Value,
                        ExitMarkerText(item.ExitReason, tag, item.ExitPrice.Value, tickSize,
                            ShowOverlayMarkerDetails),
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
                Textcolor = OverlayTextColor,
                Outlinecolor = Color.FromArgb(255, OverlayBorderColor),
                FillColor = Color.FromArgb(OverlayMarkerOpacity, color),
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

        private static string EntryMarkerText(bool longTrade, string tag, decimal price, decimal tickSize,
            bool showDetails)
        {
            var label = (longTrade ? "▲ L " : "▼ S ") + FormatPrice(price, tickSize);
            return showDetails ? label + " #" + tag : label;
        }

        private static string PlanMarkerText(string level, string tag, decimal price, decimal tickSize,
            bool showDetails)
        {
            var label = level + " " + FormatPrice(price, tickSize);
            return showDetails ? label + " #" + tag : label;
        }

        private static string ExitMarkerText(string reason, string tag, decimal price, decimal tickSize,
            bool showDetails)
        {
            var label = ExitLabel(reason) + " " + FormatPrice(price, tickSize);
            return showDetails ? label + " #" + tag : label;
        }

        private static string FormatPrice(decimal price, decimal tickSize)
        {
            var step = Math.Abs(tickSize);
            var decimals = 0;
            while (step != decimal.Truncate(step) && decimals < 8)
            {
                step *= 10;
                decimals++;
            }

            return price.ToString("F" + decimals, CultureInfo.InvariantCulture);
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

        private Color ExitColor(string reason)
        {
            switch (reason)
            {
                case "target": return OverlayTargetColor;
                case "stop": return OverlayStopColor;
                case "trail": return OverlayTrailColor;
                case "timeout": return OverlayTimeoutColor;
                default: return OverlayExitColor;
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
