using System;
using System.Collections.Concurrent;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AtasSignalBridge
{
    /// <summary>
    /// Ships payloads to the ingest endpoint on a background worker.
    ///
    /// Nothing here may block the caller: OnCalculate runs on the chart thread
    /// and is called extremely often, so a synchronous HTTP post would freeze
    /// the chart. Enqueue returns immediately and the worker drains the queue.
    /// </summary>
    internal sealed class HttpSender : IDisposable
    {
        /// <summary>
        /// Bound on unsent payloads. If the endpoint is down we would rather
        /// lose the oldest snapshots than grow memory without limit.
        /// </summary>
        private const int MaxQueueDepth = 200;

        private const int MaxAttempts = 4;

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };

        private readonly ConcurrentQueue<IngestPayload> _queue = new ConcurrentQueue<IngestPayload>();
        private readonly SemaphoreSlim _signal = new SemaphoreSlim(0);
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };

        private Task _worker;
        private int _depth;
        private int _dropped;

        /// <summary>Where log lines go. Wired to the indicator's logger.</summary>
        public Action<string> Log { get; set; }

        public string EndpointUrl { get; set; }
        public string Token { get; set; }

        public void Start()
        {
            if (_worker != null) return;
            _worker = Task.Run(() => WorkerLoopAsync(_cts.Token));
        }

        public void Enqueue(IngestPayload payload)
        {
            if (payload == null || payload.Bars.Count == 0) return;

            _queue.Enqueue(payload);
            Interlocked.Increment(ref _depth);

            while (Volatile.Read(ref _depth) > MaxQueueDepth && _queue.TryDequeue(out _))
            {
                Interlocked.Decrement(ref _depth);

                // Only mention the backlog occasionally; the chart log is not a
                // place for one line per dropped snapshot.
                if (Interlocked.Increment(ref _dropped) % 50 == 1)
                    Log?.Invoke("Signal Bridge: endpoint is not keeping up, dropping oldest snapshots.");
            }

            _signal.Release();
        }

        private async Task WorkerLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await _signal.WaitAsync(token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                // The semaphore can run ahead of the queue when a payload was
                // dropped to keep the depth in bounds.
                if (!_queue.TryDequeue(out var payload)) continue;
                Interlocked.Decrement(ref _depth);

                try
                {
                    await PostWithRetryAsync(payload, token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception ex)
                {
                    // A send failure must never take the worker down; the next
                    // payload should still get its chance.
                    Log?.Invoke("Signal Bridge: send failed - " + ex.Message);
                }
            }
        }

        private async Task PostWithRetryAsync(IngestPayload payload, CancellationToken token)
        {
            var json = JsonSerializer.Serialize(payload, JsonOptions);

            for (var attempt = 1; attempt <= MaxAttempts; attempt++)
            {
                try
                {
                    using (var request = new HttpRequestMessage(HttpMethod.Post, EndpointUrl))
                    {
                        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);

                        using (var response = await _http.SendAsync(request, token).ConfigureAwait(false))
                        {
                            if (response.IsSuccessStatusCode) return;

                            var status = (int)response.StatusCode;

                            // A rejected payload will be rejected identically
                            // however many times it is resent. Only throttling
                            // and server faults are worth retrying.
                            if (status >= 400 && status < 500 && status != 429)
                            {
                                var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                                Log?.Invoke($"Signal Bridge: endpoint rejected the payload ({status}) {Trim(body)}");
                                return;
                            }

                            if (attempt == MaxAttempts)
                            {
                                Log?.Invoke($"Signal Bridge: giving up after {MaxAttempts} attempts ({status}).");
                                return;
                            }
                        }
                    }
                }
                catch (OperationCanceledException) when (token.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception ex)
                {
                    if (attempt == MaxAttempts)
                    {
                        Log?.Invoke("Signal Bridge: giving up - " + ex.Message);
                        return;
                    }
                }

                // 1s, 2s, 4s
                var delayMs = (int)Math.Pow(2, attempt - 1) * 1000;
                await Task.Delay(delayMs, token).ConfigureAwait(false);
            }
        }

        private static string Trim(string value)
        {
            if (string.IsNullOrEmpty(value)) return string.Empty;
            return value.Length <= 200 ? value : value.Substring(0, 200) + "...";
        }

        public void Dispose()
        {
            try
            {
                _cts.Cancel();
                _http.Dispose();
                _cts.Dispose();
                _signal.Dispose();
            }
            catch
            {
                // Teardown races are not worth surfacing to the user.
            }
        }
    }
}
