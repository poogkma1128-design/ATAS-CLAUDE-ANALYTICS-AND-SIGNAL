using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace AtasSignalBridge
{
    // These shapes mirror supabase/functions/_shared/types.ts exactly. If a
    // property name changes on one side it must change on the other, or the
    // ingest function will reject the request.

    internal sealed class IngestPayload
    {
        [JsonPropertyName("symbol")] public string Symbol { get; set; }
        [JsonPropertyName("exchange")] public string Exchange { get; set; }
        [JsonPropertyName("tickSize")] public decimal TickSize { get; set; }
        [JsonPropertyName("timeframe")] public string Timeframe { get; set; }
        [JsonPropertyName("bars")] public List<BarSnapshot> Bars { get; set; } = new List<BarSnapshot>();
    }

    internal sealed class BarSnapshot
    {
        [JsonPropertyName("openedAt")] public string OpenedAt { get; set; }
        [JsonPropertyName("open")] public decimal Open { get; set; }
        [JsonPropertyName("high")] public decimal High { get; set; }
        [JsonPropertyName("low")] public decimal Low { get; set; }
        [JsonPropertyName("close")] public decimal Close { get; set; }
        [JsonPropertyName("volume")] public decimal Volume { get; set; }
        [JsonPropertyName("askVolume")] public decimal AskVolume { get; set; }
        [JsonPropertyName("bidVolume")] public decimal BidVolume { get; set; }
        [JsonPropertyName("delta")] public decimal Delta { get; set; }
        [JsonPropertyName("minDelta")] public decimal MinDelta { get; set; }
        [JsonPropertyName("maxDelta")] public decimal MaxDelta { get; set; }
        [JsonPropertyName("ticks")] public int Ticks { get; set; }
        [JsonPropertyName("trades")] public int Trades { get; set; }
        [JsonPropertyName("isClosed")] public bool IsClosed { get; set; }
        [JsonPropertyName("levels")] public List<ClusterLevelDto> Levels { get; set; } = new List<ClusterLevelDto>();
    }

    internal sealed class ClusterLevelDto
    {
        [JsonPropertyName("price")] public decimal Price { get; set; }
        [JsonPropertyName("ask")] public decimal Ask { get; set; }
        [JsonPropertyName("bid")] public decimal Bid { get; set; }
        [JsonPropertyName("between")] public decimal Between { get; set; }
        [JsonPropertyName("volume")] public decimal Volume { get; set; }
        [JsonPropertyName("ticks")] public int Ticks { get; set; }
    }
}
