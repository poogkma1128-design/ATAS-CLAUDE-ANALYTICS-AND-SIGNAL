using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Threading.Tasks;

// Exercise the actual compiled indicator property setters without connecting
// to ATAS or starting HttpSender. Only the injected lifecycle SDK hooks are fake.
internal static class Program
{
    private static int _checks;
    private static void Check(bool ok, string label)
    {
        if (!ok) throw new Exception(label);
        _checks++;
    }

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length != 1) throw new ArgumentException("Pass the indicator DLL path to test.");
        var sdk = Environment.GetEnvironmentVariable("ATAS_PATH") ?? @"C:\Program Files (x86)\ATAS Platform";
        AssemblyLoadContext.Default.Resolving += (context, name) =>
        {
            var path = Path.Combine(sdk, name.Name + ".dll");
            return File.Exists(path) ? context.LoadFromAssemblyPath(path) : null;
        };
        var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.GetFullPath(args[0]));
        var indicatorType = assembly.GetType("AtasSignalBridge.SignalBridgeIndicator", true);
        var probeType = assembly.GetType("AtasSignalBridge.MboProbe", true);
        var lifecycleType = assembly.GetType("AtasSignalBridge.MboProbeLifecycle", true);
        var indicator = Activator.CreateInstance(indicatorType);
        var probe = Activator.CreateInstance(probeType, new object[] { null });
        var logs = new List<string>();
        var timers = new Dictionary<Action, TimeSpan>();
        var subscriptions = 0;
        var lifecycle = Activator.CreateInstance(lifecycleType, new object[] {
            probe, new Func<Task>(() => { subscriptions++; return Task.CompletedTask; }),
            new Action<TimeSpan, Action>((span, tick) => timers.Add(tick, span)),
            new Action<TimeSpan, Action>((span, tick) => Check(timers.Remove(tick), "remove existing timer")),
            new Action<string>(logs.Add), new Func<string>(() => "GC"), null
        });
        indicatorType.GetField("_mboProbeLifecycle", BindingFlags.Instance | BindingFlags.NonPublic)
            .SetValue(indicator, lifecycle);
        var enabled = indicatorType.GetProperty("EnableMboProbe");
        var interval = indicatorType.GetProperty("MboProbeLogIntervalSeconds");
        Check(!(bool)enabled.GetValue(indicator) && (int)interval.GetValue(indicator) == 60, "property defaults");
        enabled.SetValue(indicator, true);
        interval.SetValue(indicator, 30);
        Check(subscriptions == 0 && timers.Count == 0 && logs.Count == 0, "pre-init properties do not subscribe");
        lifecycleType.GetMethod("Initialize").Invoke(lifecycle, new object[] { true, 30 });
        Check(subscriptions == 1 && timers.Count == 1 && timers.ContainsValue(TimeSpan.FromSeconds(30)), "initialize stored values");
        string LastSession() => logs.Where(x => x.StartsWith("{")).Select(x => JsonDocument.Parse(x).RootElement)
            .Last(x => x.GetProperty("reason").GetString() == "enabled").GetProperty("sessionId").GetString();
        var firstSession = LastSession();
        enabled.SetValue(indicator, false);
        Check(timers.Count == 0 && logs.Any(x => x.Contains("\"reason\":\"disabled\"")), "actual property disables lifecycle");
        var count = logs.Count;
        enabled.SetValue(indicator, false);
        Check(logs.Count == count && timers.Count == 0, "repeated false is idempotent");
        enabled.SetValue(indicator, true);
        Check(timers.Count == 1 && subscriptions == 1 && LastSession() != firstSession, "actual property reenable starts fresh session without duplicate subscription");
        interval.SetValue(indicator, 15);
        Check(timers.Count == 1 && timers.ContainsValue(TimeSpan.FromSeconds(15)) && logs.Any(x => x.Contains("\"reason\":\"interval_changed\"")), "actual interval property replaces timer");
        count = logs.Count;
        interval.SetValue(indicator, 15);
        enabled.SetValue(indicator, true);
        Check(logs.Count == count && timers.Count == 1, "repeat current properties is idempotent");
        ((IDisposable)lifecycle).Dispose();
        count = logs.Count;
        enabled.SetValue(indicator, false);
        enabled.SetValue(indicator, true);
        interval.SetValue(indicator, 60);
        Check(timers.Count == 0 && logs.Count == count, "properties cannot revive disposed lifecycle");
        Console.WriteLine($"PASS: {_checks} actual indicator property/lifecycle assertions; no live feed or sender startup");
    }
}
