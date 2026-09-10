using System;
using System.Threading.Tasks;

namespace AtasSignalBridge
{
    // Serializes settings, callbacks and disposal. SDK has no unsubscribe API:
    // disabling stops collection/timer, but re-enabling reuses the subscription.
    internal sealed class MboProbeLifecycle : IDisposable
    {
        private readonly object _gate = new object();
        private readonly MboProbe _probe;
        private readonly Func<Task> _subscribe;
        private readonly Action<TimeSpan, Action> _addTimer;
        private readonly Action<TimeSpan, Action> _removeTimer;
        private readonly Action<string> _log;
        private readonly Func<string> _symbol;
        private readonly Action<MboProbe> _readSnapshot;
        private bool _initialized, _disposed, _enabled, _subscriptionRequested, _subscriptionActive;
        private TimeSpan _interval;

        public MboProbeLifecycle(MboProbe probe, Func<Task> subscribe,
            Action<TimeSpan, Action> addTimer, Action<TimeSpan, Action> removeTimer,
            Action<string> log, Func<string> symbol, Action<MboProbe> readSnapshot = null)
        {
            _probe = probe;
            _subscribe = subscribe;
            _addTimer = addTimer;
            _removeTimer = removeTimer;
            _log = log;
            _symbol = symbol;
            _readSnapshot = readSnapshot;
        }

        public void Initialize(bool enabled, int seconds)
        {
            lock (_gate)
            {
                if (_disposed) return;
                _initialized = true;
                ApplySettings(enabled, seconds);
            }
        }

        public void ApplySettings(bool enabled, int seconds)
        {
            lock (_gate)
            {
                if (!_initialized || _disposed) return;
                var interval = TimeSpan.FromSeconds(Math.Clamp(seconds, 15, 300));
                if (_enabled && (!enabled || interval != _interval))
                {
                    _removeTimer(_interval, Tick);
                    Emit(enabled ? "interval_changed" : "disabled");
                }
                if (enabled && !_enabled)
                {
                    _probe.Start();
                    if (_subscriptionActive) ReadSnapshot();
                    Emit("enabled"); // Immediate evidence; do not wait 30 minutes.
                }
                if (enabled && (!_enabled || interval != _interval))
                {
                    _interval = interval;
                    _addTimer(_interval, Tick);
                }
                _enabled = enabled;
                if (_enabled && !_subscriptionRequested)
                {
                    _subscriptionRequested = true;
                    _ = SubscribeAsync();
                }
            }
        }

        private async Task SubscribeAsync()
        {
            try
            {
                await _subscribe();
                lock (_gate)
                {
                    _subscriptionActive = true;
                    if (!_disposed)
                    {
                        if (_enabled)
                        {
                            ReadSnapshot();
                            Emit("subscription_active");
                        }
                        _log("subscription active; collection=" + _enabled + "; not a book-completeness verdict");
                    }
                }
            }
            catch (Exception ex)
            {
                lock (_gate)
                {
                    _subscriptionRequested = false;
                    if (!_disposed) _log("subscription failed: " + ex.Message + "; reapply settings to retry");
                }
            }
        }

        private void ReadSnapshot()
        {
            try { _readSnapshot?.Invoke(_probe); }
            catch (Exception ex) { _log("initial snapshot read failed: " + ex.Message); }
        }

        public void Observe(Action<MboProbe> observe)
        {
            lock (_gate)
            {
                if (_enabled && !_disposed) observe(_probe);
            }
        }

        private void Tick()
        {
            lock (_gate)
            {
                if (_enabled && !_disposed) Emit("interval");
            }
        }

        private void Emit(string reason) => _log(_probe.SnapshotJson(_symbol(), reason));

        public void Dispose()
        {
            lock (_gate)
            {
                if (_disposed) return;
                _disposed = true;
                if (_enabled)
                {
                    _removeTimer(_interval, Tick);
                    Emit("dispose");
                }
                _enabled = false;
            }
        }
    }
}
