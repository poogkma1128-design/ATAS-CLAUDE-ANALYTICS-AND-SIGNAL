import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput, HistoryBar } from "./types.ts";
import { priceActionContext } from "./price_action.ts";

/** Builds history from (high, low) pairs, oldest first, as the rules see it. */
function hist(pairs: [number, number][]): HistoryBar[] {
  return pairs.map(([high, low], i) => ({
    openedAt: new Date(Date.UTC(2026, 7, 27, 10, i * 5)).toISOString(),
    open: (high + low) / 2,
    high,
    low,
    close: (high + low) / 2,
    volume: 1000,
    delta: 0,
    ticks: 200,
    pocPrice: (high + low) / 2,
  }));
}

function bar(overrides: Partial<BarInput> = {}): BarInput {
  return {
    openedAt: "2026-08-27T12:00:00.000Z",
    open: 100, high: 101, low: 99, close: 100,
    volume: 1000, askVolume: 0, bidVolume: 0,
    delta: 0, minDelta: 0, maxDelta: 0,
    ticks: 0, trades: 0, isClosed: true, levels: [],
    ...overrides,
  };
}

/**
 * Rising highs and rising lows. With a swing strength of two, the peaks at
 * index 2 (110) and index 6 (114) and the troughs at index 4 (102) and index 8
 * (106) are the confirmed swings.
 */
const UPTREND: [number, number][] = [
  [104, 100],
  [106, 101],
  [110, 103],
  [108, 103],
  [107, 102],
  [111, 104],
  [114, 107],
  [112, 107],
  [111, 106],
  [113, 108],
  [112, 109],
];

Deno.test("price action: higher highs with higher lows read as an uptrend", () => {
  const ctx = priceActionContext(bar({ high: 113, low: 109, close: 111 }), hist(UPTREND));

  assertEquals(ctx.structure, "up");
  assertEquals(ctx.swingHigh, 114);
  assertEquals(ctx.swingLow, 106);
});

Deno.test("price action: the mirror image reads as a downtrend", () => {
  const inverted = UPTREND.map(([high, low]) => [200 - low, 200 - high] as [number, number]);
  const ctx = priceActionContext(bar({ high: 91, low: 87, close: 89 }), hist(inverted));

  assertEquals(ctx.structure, "down");
});

Deno.test("price action: a close beyond the swing high is a break of structure", () => {
  const ctx = priceActionContext(bar({ high: 116, low: 112, close: 115 }), hist(UPTREND));

  // 115 closes above the 114 swing high.
  assertEquals(ctx.bos, "bullish");
  assertEquals(ctx.sweep, null);
  // A bullish break inside an uptrend is continuation, not a change.
  assertEquals(ctx.choch, false);
});

Deno.test("price action: a wick through that gives back is a sweep, not a break", () => {
  // High of 116 pierces the 114 swing; the close at 112 comes back under it.
  const ctx = priceActionContext(bar({ high: 116, low: 111, close: 112 }), hist(UPTREND));

  assertEquals(ctx.sweep, "high");
  assertEquals(ctx.bos, null);
});

Deno.test("price action: breaking the low of an uptrend is a change of character", () => {
  // 105 closes below the 106 swing low while structure is still up.
  const ctx = priceActionContext(bar({ high: 110, low: 104, close: 105 }), hist(UPTREND));

  assertEquals(ctx.structure, "up");
  assertEquals(ctx.bos, "bearish");
  assertEquals(ctx.choch, true);
});

Deno.test("price action: an outside bar is attributed to the deeper excursion", () => {
  // Takes 3 above the swing high and 1 below the swing low, closing between.
  const ctx = priceActionContext(bar({ high: 117, low: 105, close: 110 }), hist(UPTREND));

  assertEquals(ctx.sweep, "high");
});

Deno.test("price action: the close is placed within the recent range", () => {
  const flat = hist(Array.from({ length: 20 }, () => [110, 100] as [number, number]));

  assertEquals(priceActionContext(bar({ high: 110, low: 100, close: 109 }), flat).zone, "premium");
  assertEquals(priceActionContext(bar({ high: 110, low: 100, close: 101 }), flat).zone, "discount");

  const middle = priceActionContext(bar({ high: 110, low: 100, close: 105 }), flat);
  assertEquals(middle.zone, "equilibrium");
  assertEquals(middle.rangePosition, 0.5);
});

Deno.test("price action: the current bar can extend the range it is measured in", () => {
  const flat = hist(Array.from({ length: 20 }, () => [110, 100] as [number, number]));

  // A bar making a new high sits at the top of the range, not outside it.
  const ctx = priceActionContext(bar({ high: 120, low: 105, close: 120 }), flat);
  assertEquals(ctx.rangePosition, 1);
});

Deno.test("price action: too little history says nothing rather than guessing", () => {
  const ctx = priceActionContext(bar(), hist([[101, 99], [102, 100]]));

  assertEquals(ctx.structure, null);
  assertEquals(ctx.swingHigh, null);
  assertEquals(ctx.swingLow, null);
  assertEquals(ctx.bos, null);
  assertEquals(ctx.sweep, null);
  assertEquals(ctx.choch, false);
});

Deno.test("price action: a flat double top is not a swing", () => {
  // Two equal highs either side of the gap: neither qualifies, so structure
  // cannot be read from them and the result stays honest about that.
  const flatTop: [number, number][] = [
    [104, 100], [106, 101], [110, 103], [108, 102], [110, 103],
    [107, 101], [105, 100], [104, 99], [103, 98],
  ];
  const ctx = priceActionContext(bar({ high: 104, low: 100, close: 102 }), hist(flatTop));

  assertEquals(ctx.swingHigh, null);
});
