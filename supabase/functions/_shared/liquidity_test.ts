import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput, HistoryBar, RuleContext } from "./types.ts";
import { hasEnoughLiquidity } from "./liquidity.ts";

function history(volumes: number[]): HistoryBar[] {
  return volumes.map((volume, i) => ({
    openedAt: new Date(Date.UTC(2026, 7, 27, 10, i * 5)).toISOString(),
    open: 100, high: 101, low: 99, close: 100,
    volume, delta: 0, pocPrice: 100,
  }));
}

function ctx(barVolume: number, prior: number[], params: Record<string, unknown>): RuleContext {
  const bar: BarInput = {
    openedAt: "2026-08-27T11:00:00.000Z",
    open: 100, high: 101, low: 99, close: 100,
    volume: barVolume, askVolume: 0, bidVolume: 0,
    delta: 0, minDelta: 0, maxDelta: 0,
    ticks: 0, trades: 0, isClosed: true, levels: [],
  };
  return { bar, levels: [], history: history(prior), tickSize: 0.25, params };
}

const ten = Array.from({ length: 20 }, () => 1000);

Deno.test("liquidity: a bar at the median passes a 1.2x gate only above it", () => {
  const params = { minVolumeRatio: 1.2 };

  assertEquals(hasEnoughLiquidity(ctx(1199, ten, params)), false);
  assertEquals(hasEnoughLiquidity(ctx(1200, ten, params)), true);
  assertEquals(hasEnoughLiquidity(ctx(5000, ten, params)), true);
});

Deno.test("liquidity: the thin overnight case is what this rejects", () => {
  // The measured losing bucket: a bar carrying a fraction of normal volume.
  assertEquals(
    hasEnoughLiquidity(ctx(2666, Array.from({ length: 50 }, () => 26436), {
      minVolumeRatio: 1.2,
    })),
    false,
  );
});

Deno.test("liquidity: the median ignores an outlier the mean would follow", () => {
  // One 100k print among ordinary bars would drag a mean far enough to mute
  // every normal bar after it.
  const withSpike = [...Array.from({ length: 19 }, () => 1000), 100_000];

  assertEquals(hasEnoughLiquidity(ctx(1300, withSpike, { minVolumeRatio: 1.2 })), true);
});

Deno.test("liquidity: too little history to judge lets the bar through", () => {
  // Blocking here would mute the start of every freshly loaded chart.
  assertEquals(
    hasEnoughLiquidity(ctx(1, [1000, 1000, 1000], { minVolumeRatio: 1.2 })),
    true,
  );
});

Deno.test("liquidity: the gate is off unless a ratio is configured", () => {
  assertEquals(hasEnoughLiquidity(ctx(1, ten, {})), true);
  assertEquals(hasEnoughLiquidity(ctx(1, ten, { minVolumeRatio: 0 })), true);
});

Deno.test("liquidity: bars with no volume recorded cannot gate anything", () => {
  const noVolume = Array.from({ length: 20 }, () => 0);
  assertEquals(hasEnoughLiquidity(ctx(500, noVolume, { minVolumeRatio: 1.2 })), true);
});
