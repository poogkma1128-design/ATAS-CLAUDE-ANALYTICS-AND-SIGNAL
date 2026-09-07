// deno-lint-ignore-file no-import-prefix -- repository test convention.
import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput, ClusterLevel, HistoryBar, RuleContext } from "../types.ts";
import { buildDecision, evaluate } from "./mnq_pullback_v1.ts";

function historyBar(openedAt: string, index: number, highCap = 100): HistoryBar {
  const mid = 98.5 + (index % 5) * 0.25;
  return {
    openedAt,
    open: mid,
    high: Math.min(highCap, mid + 0.5),
    low: mid - 0.5,
    close: mid + (index % 2 === 0 ? 0.2 : -0.2),
    volume: 100,
    delta: index % 2 === 0 ? 20 : -20,
    ticks: 10,
    pocPrice: 99.5,
  };
}

function at(start: string, index: number): string {
  return new Date(Date.parse(start) + index * 5 * 60_000).toISOString();
}

function history(): HistoryBar[] {
  const prior = Array.from(
    { length: 70 },
    (_, index) => historyBar(at("2026-09-05T22:00:00.000Z", index), index, 100),
  );
  const current = Array.from({ length: 25 }, (_, index) => {
    const bar = historyBar(at("2026-09-06T22:00:00.000Z", index), index, 100.5);
    // Confirmed local swings exist, and the decision close will break the last high.
    if (index === 15) return { ...bar, high: 100.5, close: 100 };
    if (index === 16 || index === 14) return { ...bar, high: 99.75, close: 99.25 };
    return bar;
  });
  return [...prior, ...current];
}

function stackedLevels(): ClusterLevel[] {
  return [
    { price: 99.75, ask: 1, bid: 1, between: 0, volume: 2, ticks: 1 },
    { price: 100, ask: 1, bid: 1, between: 0, volume: 2, ticks: 1 },
    { price: 100.25, ask: 20, bid: 1, between: 0, volume: 21, ticks: 1 },
    { price: 100.5, ask: 20, bid: 1, between: 0, volume: 21, ticks: 1 },
    { price: 100.75, ask: 20, bid: 1, between: 0, volume: 21, ticks: 1 },
  ];
}

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  const levels = stackedLevels();
  const bar: BarInput = {
    openedAt: "2026-09-07T00:05:00.000Z",
    open: 100,
    high: 101.25,
    low: 99.75,
    close: 101,
    volume: 300,
    askVolume: 250,
    bidVolume: 50,
    delta: 200,
    minDelta: -20,
    maxDelta: 220,
    ticks: levels.reduce((sum, level) => sum + level.ticks, 0),
    trades: 0,
    isClosed: true,
    levels,
  };
  const longHistory = history();
  return {
    bar,
    levels,
    history: longHistory.slice(-50),
    strategyHistory: longHistory,
    symbol: "MNQU6",
    timeframe: "5m",
    tickSize: 0.25,
    params: {
      minVolumeRatio: 0,
      ratio: 3,
      minVolume: 10,
      stack: 3,
      runBars: 3,
      minDeltaMagnitude: 200,
      minRunDelta: 0,
      levelShare: 0.25,
      levelLookback: 20,
    },
    ...overrides,
  };
}

Deno.test("MNQ pullback live adapter emits a boolean same-bar signal", () => {
  const ctx = context();
  const decision = buildDecision(ctx, ctx.strategyHistory!);
  const signals = evaluate(ctx);

  assertEquals(decision.bias, "bullish");
  assertEquals(decision.medianTrueRange !== null, true);
  assertEquals(
    decision.anchors.find((anchor) => anchor.identity === "prev_day_high")?.price,
    100,
  );
  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].confidence, 0);
  assertEquals(signals[0].payload.score, null);
  assertEquals(signals[0].payload.executionScope, "touch_bar_only");
  assertEquals(signals[0].payload.trigger, "stacked_imbalance");
});

Deno.test("MNQ pullback live adapter is hard-scoped to MNQU6 5m", () => {
  assertEquals(evaluate(context({ symbol: "NQU6" })), []);
  assertEquals(evaluate(context({ timeframe: "1m" })), []);
});

Deno.test("MNQ pullback live adapter fails closed without a usable prior day", () => {
  const ctx = context({ strategyHistory: history().slice(-25) });
  assertEquals(evaluate(ctx), []);
});
