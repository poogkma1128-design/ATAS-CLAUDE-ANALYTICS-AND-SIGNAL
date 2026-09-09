using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using ATAS.DataFeedsCore;
using ATAS.Indicators;
using AtasSignalBridge;

internal static class Program
{
    private static int _checks;
    private static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        _checks++;
    }

    private static JsonElement Snapshot(MboProbe probe) =>
        JsonDocument.Parse(probe.SnapshotJson("GCZ6@COMEX", "test")).RootElement.Clone();

    private static async Task Main()
    {
        var now = new DateTime(2026, 9, 9, 12, 0, 0, DateTimeKind.Utc);
        var probe = new MboProbe(() => now);
        probe.Start();
        probe.ObserveInitialSnapshot(new[] { new MarketByOrder { ExchangeOrderId = 100 } });
        for (var i = 0; i < 20; i++)
            probe.ObserveMboBatch(new[] { new MarketByOrder {
                Type = MarketByOrderUpdateTypes.Snapshot, Time = now.AddHours(-1), ExchangeOrderId = i + 1
            } }, now);
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.New, Time = now.AddMilliseconds(-20), ExchangeOrderId = 99
        } }, now);
        probe.ObserveTrade(new MarketDataArg { Time = now.AddMilliseconds(-40) }, now);
        now = now.AddSeconds(60);
        var active = Snapshot(probe);
        var session = active.GetProperty("sessionId").GetString();
        Check(active.GetProperty("version").GetString() == "MBO_PROBE_V3", "timestamp contract version");
        Check(active.GetProperty("callbacks").GetInt64() == 21, "active callbacks");
        Check(active.GetProperty("initialSnapshotReads").GetInt64() == 1 &&
            active.GetProperty("initialSnapshotOrders").GetInt64() == 1, "initial cache separate from callbacks");
        Check(active.GetProperty("snapshotCallbacks").GetInt64() == 20, "snapshot chunks counted as callbacks");
        Check(active.GetProperty("bookEpoch").ValueKind == JsonValueKind.Null, "do not invent book epochs");
        Check(active.GetProperty("mboLatencyP95UpperMs").GetString() == "25", "exclude cached snapshot timestamps");
        Check(active.GetProperty("tradeLatencyP95UpperMs").GetString() == "50", "live trade latency");
        Check(active.GetProperty("nullTradeOrderId").GetInt64() == 1, "missing trade ID");
        now = now.AddSeconds(60);
        var quiet = Snapshot(probe);
        Check(quiet.GetProperty("callbacks").GetInt64() == 0, "counters reset per window");
        Check(quiet.GetProperty("initialSnapshotReads").GetInt64() == 0, "initial snapshot counters reset too");
        Check(quiet.GetProperty("maxCallbackBatch").GetInt64() == 0, "peak resets per window");
        Check(quiet.GetProperty("mboLatencyP95UpperMs").GetString() == "unavailable", "quiet histogram is not stale active p95");
        Check(quiet.GetProperty("liveMboAgeMs").GetDouble() == 120000, "silence ages across windows");
        Check(quiet.GetProperty("windowDurationMs").GetDouble() == 60000, "explicit interval duration");
        Check(quiet.GetProperty("windowSequence").GetInt64() == 2, "window sequence");
        Check(quiet.GetProperty("sessionId").GetString() == session, "same collection session");
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.Change, Time = now.AddMinutes(-3), ExchangeOrderId = 99
        } }, now);
        Check(Snapshot(probe).GetProperty("clockRegressions").GetInt64() == 1, "regression across window boundary");
        probe.Start();
        var restarted = Snapshot(probe);
        Check(restarted.GetProperty("sessionId").GetString() != session, "restart changes collector session");
        Check(restarted.GetProperty("liveMboAgeMs").ValueKind == JsonValueKind.Null, "restart clears old age");

        var unresolvedRaw = DateTime.SpecifyKind(now.AddMilliseconds(750), DateTimeKind.Unspecified);
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.New, Time = unresolvedRaw, ExchangeOrderId = 101
        } }, now);
        probe.ObserveTrade(new MarketDataArg { Time = unresolvedRaw }, now);
        var unresolved = Snapshot(probe);
        Check(unresolved.GetProperty("futureMboEvents").GetInt64() == 0 &&
            unresolved.GetProperty("futureTradeEvents").GetInt64() == 0, "unresolved timestamps are not invented as future");
        Check(unresolved.GetProperty("unresolvedMboTimeEvents").GetInt64() == 1 &&
            unresolved.GetProperty("unresolvedTradeTimeEvents").GetInt64() == 1, "unresolved counters preserved");
        Check(unresolved.GetProperty("mboLatencyP95UpperMs").GetString() == "unavailable" &&
            unresolved.GetProperty("tradeLatencyP95UpperMs").GetString() == "unavailable", "unresolved p95 suppressed");
        Check(unresolved.GetProperty("mboLatencyStatus").GetString() == "invalid:unresolved_event_time_basis" &&
            unresolved.GetProperty("tradeLatencyStatus").GetString() == "invalid:unresolved_event_time_basis", "unresolved validity explicit");
        var timeSample = unresolved.GetProperty("mboTimeSample");
        Check(timeSample.GetProperty("rawTime").GetString() == unresolvedRaw.ToString("O") &&
            timeSample.GetProperty("kind").GetString() == "Unspecified", "raw timestamp kind preserved");
        Check(timeSample.GetProperty("timeBasis").GetString() == "unresolved" &&
            timeSample.GetProperty("interpretedUtc").ValueKind == JsonValueKind.Null &&
            timeSample.GetProperty("signedLatencyMs").ValueKind == JsonValueKind.Null &&
            unresolved.GetProperty("tradeTimeSample").GetProperty("signedLatencyMs").ValueKind == JsonValueKind.Null,
            "unresolved timestamps never gain an implied UTC or latency");
        var emptyAfterUnresolved = Snapshot(probe);
        Check(emptyAfterUnresolved.GetProperty("mboTimeSample").ValueKind == JsonValueKind.Null &&
            emptyAfterUnresolved.GetProperty("tradeTimeSample").ValueKind == JsonValueKind.Null, "window samples reset");
        Check(emptyAfterUnresolved.GetProperty("mboLatencyStatus").GetString() == "unavailable:no_live_events",
            "invalid window does not poison empty successor");
        probe.ObserveMboBatch(new[] {
            new MarketByOrder { Type = MarketByOrderUpdateTypes.Change, Time = now.AddMilliseconds(-40) },
            new MarketByOrder { Type = MarketByOrderUpdateTypes.New, Time = unresolvedRaw }
        }, now);
        probe.ObserveTrade(new MarketDataArg { Time = now.AddMilliseconds(-40) }, now);
        probe.ObserveTrade(new MarketDataArg { Time = unresolvedRaw }, now);
        var mixed = Snapshot(probe);
        Check(mixed.GetProperty("mboLatencyP95UpperMs").GetString() == "unavailable" &&
            mixed.GetProperty("tradeLatencyP95UpperMs").GetString() == "unavailable" &&
            mixed.GetProperty("mboLatencyStatus").GetString() == "invalid:unresolved_event_time_basis" &&
            mixed.GetProperty("tradeLatencyStatus").GetString() == "invalid:unresolved_event_time_basis",
            "mixed window remains unresolved");
        var explicitFutureUtc = now.AddMilliseconds(750);
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.New, Time = explicitFutureUtc, ExchangeOrderId = 102
        } }, now);
        probe.ObserveTrade(new MarketDataArg { Time = explicitFutureUtc }, now);
        var future = Snapshot(probe);
        Check(future.GetProperty("futureMboEvents").GetInt64() == 1 &&
            future.GetProperty("futureTradeEvents").GetInt64() == 1, "declared UTC future counters preserved");
        Check(future.GetProperty("unresolvedMboTimeEvents").GetInt64() == 0 &&
            future.GetProperty("unresolvedTradeTimeEvents").GetInt64() == 0, "declared UTC is not unresolved");
        Check(future.GetProperty("mboLatencyStatus").GetString() == "invalid:future_events" &&
            future.GetProperty("tradeLatencyStatus").GetString() == "invalid:future_events", "future validity explicit");
        Check(future.GetProperty("mboTimeSample").GetProperty("timeBasis").GetString() == "declared_utc" &&
            future.GetProperty("mboTimeSample").GetProperty("signedLatencyMs").GetDouble() == -750,
            "declared UTC retains signed latency evidence");
        probe.ObserveMboBatch(new[] {
            new MarketByOrder { Type = MarketByOrderUpdateTypes.Change, Time = explicitFutureUtc },
            new MarketByOrder { Type = MarketByOrderUpdateTypes.New, Time = unresolvedRaw }
        }, now);
        probe.ObserveTrade(new MarketDataArg { Time = explicitFutureUtc }, now);
        probe.ObserveTrade(new MarketDataArg { Time = unresolvedRaw }, now);
        var combined = Snapshot(probe);
        Check(combined.GetProperty("mboLatencyStatus").GetString() ==
            "invalid:unresolved_event_time_basis_and_future_events" &&
            combined.GetProperty("tradeLatencyStatus").GetString() ==
            "invalid:unresolved_event_time_basis_and_future_events", "both invalid causes remain visible");
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.New, Time = now.AddMilliseconds(-20)
        } }, now);
        var recovered = Snapshot(probe);
        Check(recovered.GetProperty("mboLatencyP95UpperMs").GetString() == "25" &&
            recovered.GetProperty("mboLatencyStatus").GetString() == "provisional:timestamp_basis_unverified",
            "new positive window recovers provisional percentile");
        Check(recovered.GetProperty("mboTimeSample").GetProperty("kind").GetString() == "Utc",
            "UTC source kind observable");
        probe.ObserveTrade(new MarketDataArg { Time = now.ToLocalTime().AddMilliseconds(-30) }, now);
        var localSample = Snapshot(probe).GetProperty("tradeTimeSample");
        Check(localSample.GetProperty("kind").GetString() == "Local" &&
            localSample.GetProperty("interpretedUtc").GetString() == now.AddMilliseconds(-30).ToString("O"),
            "local source kind and existing conversion observable");
        probe.ObserveMboBatch(new[] { new MarketByOrder {
            Type = MarketByOrderUpdateTypes.Snapshot, Time = unresolvedRaw
        } }, now);
        var cacheOnly = Snapshot(probe);
        Check(cacheOnly.GetProperty("mboTimeSample").ValueKind == JsonValueKind.Null &&
            cacheOnly.GetProperty("futureMboEvents").GetInt64() == 0 &&
            cacheOnly.GetProperty("unresolvedMboTimeEvents").GetInt64() == 0,
            "cached timestamp excluded from live diagnostics");
        probe.Start();

        var logs = new List<string>();
        var timers = new Dictionary<Action, TimeSpan>();
        var subscription = new TaskCompletionSource();
        var subscriptions = 0;
        var lifecycle = new MboProbeLifecycle(probe,
            () => { subscriptions++; return subscription.Task; },
            (interval, action) => timers.Add(action, interval),
            (interval, action) => Check(timers.Remove(action), "timer removed exactly once"),
            logs.Add, () => "GCZ6@COMEX");
        lifecycle.ApplySettings(true, 60);
        Check(timers.Count == 0, "pre-initialize recalculation does not subscribe");
        lifecycle.Initialize(false, 60);
        Check(subscriptions == 0, "default disabled");
        lifecycle.ApplySettings(true, 60); // exact add-indicator then enable flow
        Check(subscriptions == 1 && timers.Count == 1, "enable after initialize works");
        Check(logs[0].Contains("\"reason\":\"enabled\""), "immediate enable evidence");
        lifecycle.ApplySettings(true, 60);
        Check(subscriptions == 1 && timers.Count == 1, "repeat recalculation idempotent");
        lifecycle.ApplySettings(true, 15);
        Check(timers.Count == 1 && timers.ContainsValue(TimeSpan.FromSeconds(15)), "replace interval");
        lifecycle.ApplySettings(false, 15);
        var before = logs.Count;
        lifecycle.Observe(p => throw new Exception("disabled callback accepted"));
        Check(timers.Count == 0, "disable stops timer and collection");
        lifecycle.ApplySettings(true, 15);
        Check(subscriptions == 1 && timers.Count == 1, "reenable reuses pending SDK subscription");
        Action queuedTick = null;
        foreach (var timer in timers) queuedTick = timer.Key;
        lifecycle.Dispose();
        lifecycle.Dispose();
        before = logs.Count;
        queuedTick();
        subscription.SetResult();
        await Task.Delay(30);
        lifecycle.ApplySettings(true, 60);
        lifecycle.Observe(p => throw new Exception("disposed callback accepted"));
        Check(timers.Count == 0 && logs.Count == before, "late timer/task cannot revive disposed probe");

        var attempts = 0;
        var snapshotReads = 0;
        var retry = new MboProbeLifecycle(new MboProbe(),
            () => ++attempts == 1 ? Task.FromException(new Exception("test rejection")) : Task.CompletedTask,
            (_, _) => { }, (_, _) => { }, logs.Add, () => "GC", _ => snapshotReads++);
        retry.Initialize(true, 60);
        retry.ApplySettings(true, 60);
        Check(attempts == 2 && logs.Exists(x => x.Contains("subscription failed")), "failure visible and retryable");
        Check(snapshotReads == 1, "read initial cache only after subscription completes");
        retry.ApplySettings(false, 60);
        retry.ApplySettings(true, 60);
        Check(snapshotReads == 2 && attempts == 2, "reenable reads cache without duplicate subscription");
        retry.Dispose();
        Console.WriteLine($"PASS: {_checks} probe/lifecycle assertions (actual ATAS SDK types; no live feed)");
    }
}
