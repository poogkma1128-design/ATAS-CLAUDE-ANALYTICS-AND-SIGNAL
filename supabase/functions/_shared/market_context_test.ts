// deno-lint-ignore-file no-import-prefix -- matches the repository's test import convention.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type CausalMarketBar, computeMarketContext } from "./market_context.ts";

function bar(
  index: number,
  range: number,
  overrides: Partial<CausalMarketBar> = {},
): CausalMarketBar {
  const openedAt = new Date(Date.UTC(2026, 8, 7, 12, index * 5));
  const mid = 100 + index;
  return {
    openedAt: openedAt.toISOString(),
    closedAt: new Date(openedAt.getTime() + 5 * 60_000).toISOString(),
    open: mid,
    high: mid + range / 2,
    low: mid - range / 2,
    close: mid,
    volume: 100,
    askVolume: 50,
    bidVolume: 50,
    delta: 0,
    minDelta: 0,
    maxDelta: 0,
    ticks: 10,
    trades: 10,
    isClosed: true,
    levels: [],
    ...overrides,
  };
}

const contract = {
  version: "test-vol-v1",
  lookbackBars: 4,
  minSamples: 4,
  maxBarSpacingMs: 5 * 60_000,
  lowPercentile: 0.25,
  highPercentile: 0.75,
  method: "nearest_rank" as const,
};

Deno.test("market context: volatility thresholds exclude the decision bar", () => {
  const history = [bar(0, 2), bar(1, 4), bar(2, 6), bar(3, 8)];
  const decision = bar(4, 20);
  const result = computeMarketContext(decision, history, contract);

  assertEquals(result.volatility.sampleCount, 4);
  assertEquals(result.volatility.lowThreshold, 2);
  assertEquals(result.volatility.highThreshold, 6);
  assertEquals(result.volatility.trueRange, 20);
  assertEquals(result.volatility.medianTrueRange, 5);
  assertEquals(result.volatility.regime, "high");
  assertEquals(result.volatility.contractVersion, "test-vol-v1");
});

Deno.test("market context: warm-up is explicit and emits no regime", () => {
  const result = computeMarketContext(bar(2, 5), [bar(0, 2), bar(1, 3)], contract);

  assertEquals(result.volatility.status, "insufficient_history");
  assertEquals(result.volatility.regime, null);
  assertEquals(result.volatility.lowThreshold, null);
  assertEquals(result.volatility.medianTrueRange, null);
});

Deno.test("market context: a gap before the decision bar fails closed", () => {
  const history = [bar(0, 0.5), bar(1, 0.5), bar(2, 0.5), bar(3, 0.5)];
  const decision = bar(4, 0.5, {
    openedAt: "2026-09-07T17:00:00.000Z",
    closedAt: "2026-09-07T17:05:00.000Z",
    open: 120,
    high: 120.25,
    low: 119.75,
    close: 120,
  });
  const result = computeMarketContext(decision, history, contract);

  assertEquals(result.volatility.status, "insufficient_history");
  assertEquals(result.volatility.sampleCount, 0);
  assertEquals(result.volatility.trueRange, 0.5);
  assertEquals(result.volatility.regime, null);
  assertEquals(result.volatility.lowThreshold, null);
  assertEquals(result.volatility.highThreshold, null);
});

Deno.test("market context: a gap inside the required lookback resets the sample", () => {
  const history = [
    bar(0, 2),
    bar(1, 3),
    bar(2, 4, {
      openedAt: "2026-09-07T15:00:00.000Z",
      closedAt: "2026-09-07T15:05:00.000Z",
    }),
    bar(3, 5, {
      openedAt: "2026-09-07T15:05:00.000Z",
      closedAt: "2026-09-07T15:10:00.000Z",
    }),
  ];
  const decision = bar(4, 6, {
    openedAt: "2026-09-07T15:10:00.000Z",
    closedAt: "2026-09-07T15:15:00.000Z",
  });
  const result = computeMarketContext(decision, history, contract);

  assertEquals(result.volatility.status, "insufficient_history");
  assertEquals(result.volatility.sampleCount, 2);
  assertEquals(result.volatility.regime, null);
});

Deno.test("market context: future history fails closed", () => {
  assertThrows(
    () => computeMarketContext(bar(1, 5), [bar(2, 2)], contract),
    Error,
    "future bar",
  );
});

Deno.test("market context: a duplicate decision close cannot enter the threshold sample", () => {
  const decision = bar(2, 5);
  assertThrows(
    () =>
      computeMarketContext(decision, [bar(0, 2), {
        ...bar(1, 3),
        closedAt: decision.closedAt,
      }], contract),
    Error,
    "future bar",
  );
});

Deno.test("market context: an in-progress decision bar fails closed", () => {
  assertThrows(
    () => computeMarketContext(bar(2, 5, { isClosed: false }), [bar(0, 2)], contract),
    Error,
    "must be closed",
  );
});
