import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput, HistoryBar, RuleContext } from "../types.ts";
import { buildFailedBreakDecision } from "./named_level_failed_break.ts";

function at(start: string, index: number): string {
  return new Date(Date.parse(start) + index * 5 * 60_000).toISOString();
}

function stored(openedAt: string, low: number, high: number): HistoryBar {
  return {
    openedAt,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 100,
    delta: 0,
    ticks: 10,
    pocPrice: null,
  };
}

function context(symbol = "MNQU6"): RuleContext {
  const prior = Array.from(
    { length: 70 },
    (_, index) => stored(at("2026-09-05T22:00:00.000Z", index), 98, 100),
  );
  const current = Array.from(
    { length: 25 },
    (_, index) => stored(at("2026-09-06T22:00:00.000Z", index), 98.2, 99.5),
  );
  const bar: BarInput = {
    openedAt: "2026-09-07T00:05:00.000Z",
    open: 98.2,
    high: 99,
    low: 97.5,
    close: 98.5,
    volume: 100,
    askVolume: 60,
    bidVolume: 40,
    delta: 250,
    minDelta: -20,
    maxDelta: 260,
    ticks: 0,
    trades: 0,
    isClosed: true,
    levels: [],
  };
  return {
    bar,
    levels: [],
    history: current.slice(-50),
    strategyHistory: [...prior, ...current],
    symbol,
    timeframe: "5m",
    tickSize: symbol === "GC" ? 0.4 : 0.25,
    params: { lookback: 5, minDeltaMagnitude: 200 },
  };
}

Deno.test("named-level failed break uses the last three causal bars and returns through prior low", () => {
  const built = buildFailedBreakDecision(context(), {
    attemptWindowBars: 3,
    attemptDistance: 0.25,
    triggerKinds: ["delta_divergence"],
  });
  const low = built.decision.anchors.find((anchor) => anchor.identity === "prev_day_low");
  assertEquals(low?.price, 98);
  assertEquals(low?.eligibleDirection, "long");
  assertEquals(built.decision.triggers, [{
    kind: "delta_divergence",
    available: true,
    direction: "long",
  }]);
});

Deno.test("GC adapter input uses the frozen exchange tick instead of the chart step", () => {
  const built = buildFailedBreakDecision(context("GC"), {
    attemptWindowBars: 3,
    attemptDistance: 0.25,
    triggerKinds: ["absorption", "stacked_imbalance"],
    marketTickSize: 0.1,
  });
  assertEquals(built.marketTickSize, 0.1);
});
