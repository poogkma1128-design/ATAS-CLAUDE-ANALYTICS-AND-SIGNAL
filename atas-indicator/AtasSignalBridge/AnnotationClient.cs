using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace AtasSignalBridge
{
    /// <summary>
    /// Reads optional chart annotations without ever blocking ATAS's chart
    /// thread. It is intentionally separate from HttpSender: losing the
    /// overlay must not delay or drop raw market-data ingest.
    /// </summary>
    internal sealed class AnnotationClient : IDisposable
    {
        private readonly object _sync = new object();
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private readonly JsonSerializerOptions _json = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        private List<ChartAnnotationDto> _annotations = new List<ChartAnnotationDto>();
        private DateTime _lastRequestUtc = DateTime.MinValue;
        private int _requestInFlight;
        private int _version;

        public Action<string> Log { get; set; }
        public int Version => Volatile.Read(ref _version);

        public IReadOnlyList<ChartAnnotationDto> Snapshot()
        {
            lock (_sync) return _annotations.ToArray();
        }

        public void Refresh(string ingestUrl, string token, string symbol, string timeframe, int limit, int intervalSeconds)
        {
            if (string.IsNullOrWhiteSpace(ingestUrl) || string.IsNullOrWhiteSpace(token) ||
                string.IsNullOrWhiteSpace(symbol) || string.IsNullOrWhiteSpace(timeframe)) return;

            var now = DateTime.UtcNow;
            if ((now - _lastRequestUtc).TotalSeconds < intervalSeconds) return;
            if (Interlocked.CompareExchange(ref _requestInFlight, 1, 0) != 0) return;

            _lastRequestUtc = now;
            _ = Task.Run(async () =>
            {
                try
                {
                    await FetchAsync(ingestUrl, token, symbol, timeframe, limit, _cts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (_cts.IsCancellationRequested)
                {
                    // Indicator is closing.
                }
                catch (Exception ex)
                {
                    Log?.Invoke("Signal Bridge overlay: refresh failed - " + ex.Message);
                }
                finally
                {
                    Interlocked.Exchange(ref _requestInFlight, 0);
                }
            });
        }

        private async Task FetchAsync(string ingestUrl, string token, string symbol, string timeframe, int limit, CancellationToken cancellationToken)
        {
            var endpoint = AnnotationUrl(ingestUrl);
            if (endpoint == null)
            {
                Log?.Invoke("Signal Bridge overlay: cannot derive chart-annotations URL from Endpoint URL.");
                return;
            }

            var separator = endpoint.Contains("?") ? "&" : "?";
            var url = endpoint + separator + "symbol=" + Uri.EscapeDataString(symbol) +
                      "&timeframe=" + Uri.EscapeDataString(timeframe) +
                      "&limit=" + Math.Max(1, Math.Min(200, limit));

            using (var request = new HttpRequestMessage(HttpMethod.Get, url))
            {
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using (var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false))
                {
                    if (!response.IsSuccessStatusCode)
                    {
                        Log?.Invoke("Signal Bridge overlay: endpoint returned " + (int)response.StatusCode + ".");
                        return;
                    }

                    var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                    var envelope = JsonSerializer.Deserialize<ChartAnnotationEnvelope>(body, _json);
                    if (envelope == null || !envelope.Ok) return;

                    lock (_sync) _annotations = envelope.Annotations ?? new List<ChartAnnotationDto>();
                    Interlocked.Increment(ref _version);
                }
            }
        }

        private static string AnnotationUrl(string ingestUrl)
        {
            if (!Uri.TryCreate(ingestUrl, UriKind.Absolute, out var uri)) return null;
            var path = uri.AbsolutePath.TrimEnd('/');
            if (!path.EndsWith("/ingest", StringComparison.OrdinalIgnoreCase)) return null;

            var builder = new UriBuilder(uri) { Path = path.Substring(0, path.Length - "ingest".Length) + "chart-annotations", Query = string.Empty };
            return builder.Uri.ToString();
        }

        public void Dispose()
        {
            _cts.Cancel();
            _http.Dispose();
            _cts.Dispose();
        }
    }
}
