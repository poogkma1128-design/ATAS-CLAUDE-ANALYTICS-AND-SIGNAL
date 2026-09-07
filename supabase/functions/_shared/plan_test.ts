import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput, HistoryBar } from "./types.ts";
import { buildPlan } from "./plan.ts";

function bar(overrides: Partial<BarInput> = {}): BarInput {
  return {
    openedAt: "2026-08-27T10:00:00.000Z",
    open: 100, high: 101, low: 99.5, close: 100.75,
    volume: 500, askVolume: 300, bidVolume: 200,
    delta: 100, minDelta: -20, maxDelta: 120,
    ticks: 40, trades: 30, isClosed: true, levels: [],
    ...overrides,
  };
}

const params = {
  bufferTicks: 2,
  minRiskTicks: 4,
  rewardRatio: 2,
  trailAfterR: 1,
  trailOffsetR: 0.5,
};

Deno.test("plan: a long risks the bar low plus a buffer", () => {
  // close 100.75, low 99.50 -> 5 ticks of bar, +2 buffer = 7 ticks of risk.
  const plan = buildPlan("long", bar(), 0.25, params, 10);

  assertEquals(plan.entry, 100.75);
  assertEquals(plan.riskTicks, 7);
  assertEquals(plan.stop, 99);
  assertEquals(plan.rewardTicks, 14);
  assertEquals(plan.target, 104.25);
  assertEquals(plan.holdBars, 10);
});

Deno.test("plan: a short mirrors it against the bar high", () => {
  // close 100.75, high 101.00 -> 1 tick of bar, +2 buffer = 3, floored at 4.
  const plan = buildPlan("short", bar(), 0.25, params, 10);

  assertEquals(plan.riskTicks, 4);
  assertEquals(plan.stop, 101.75);
  assertEquals(plan.target, 98.75);
});

Deno.test("plan: a bar closing on its extreme still gets real risk", () => {
  // Without the floor this would be a zero-risk, zero-reward trade.
  const plan = buildPlan("long", bar({ low: 100.75 }), 0.25, params, 10);

  assertEquals(plan.riskTicks, 4);
  assertEquals(plan.stop, 99.75);
  assertEquals(plan.target, 102.75);
});

Deno.test("plan: the trail is expressed against the trade's own risk", () => {
  const plan = buildPlan("long", bar(), 0.25, params, 10);

  // Starts following after 1R, then sits half an R behind the best price.
  assertEquals(plan.trailTriggerTicks, 7);
  assertEquals(plan.trailOffsetTicks, 3.5);
});

Deno.test("plan: every level lands on the tick grid", () => {
  const plan = buildPlan("long", bar({ close: 100.75, low: 99.6 }), 0.25, params, 10);

  for (const price of [plan.entry, plan.stop, plan.target]) {
    assertEquals(Math.round(price / 0.25) * 0.25, price);
  }
});

Deno.test("plan: params override every default", () => {
  const plan = buildPlan("long", bar(), 0.25, {
    bufferTicks: 0,
    minRiskTicks: 1,
    rewardRatio: 3,
    trailAfterR: 2,
    trailOffsetR: 1,
  }, 20);

  assertEquals(plan.riskTicks, 5);
  assertEquals(plan.rewardTicks, 15);
  assertEquals(plan.trailTriggerTicks, 10);
  assertEquals(plan.trailOffsetTicks, 5);
  assertEquals(plan.holdBars, 20);
});

function history(count: number, range: number): HistoryBar[] {
  return Array.from({ length: count }, (_, i) => ({
    openedAt: `2026-08-27T0${i % 10}:00:00.000Z`,
    open: 100, high: 100 + range, low: 100, close: 100,
    volume: 500, delta: 0, ticks: 100, pocPrice: null,
  }));
}

const floorParams = { ...params, minRiskRangeShare: 0.3, minRiskRangeBars: 20 };

Deno.test("plan: risk is floored at a share of what a bar normally covers", () => {
  // Median range 10.00 -> floor of 3.00, which is 12 ticks of 0.25. The bar's
  // own 7 ticks of risk is inside the instrument's noise, so it is widened.
  const plan = buildPlan("long", bar(), 0.25, floorParams, 10, history(20, 10));

  assertEquals(plan.riskTicks, 12);
  assertEquals(plan.stop, 97.75);
  assertEquals(plan.rewardTicks, 24);
  assertEquals(plan.target, 106.75);
});

Deno.test("plan: the floor never tightens a stop the bar itself earned", () => {
  // Median range 0.50 -> floor of 2 ticks, below the bar's own 7.
  const plan = buildPlan("long", bar(), 0.25, floorParams, 10, history(20, 0.5));

  assertEquals(plan.riskTicks, 7);
  assertEquals(plan.stop, 99);
});

Deno.test("plan: the trail follows the floored risk, not the bar's", () => {
  const plan = buildPlan("long", bar(), 0.25, floorParams, 10, history(20, 10));

  assertEquals(plan.trailTriggerTicks, 12);
  assertEquals(plan.trailOffsetTicks, 6);
});

Deno.test("plan: too little history falls back to the tick floor", () => {
  // 19 bars cannot say what normal is here, so flooring against them would be
  // flooring against a guess.
  const plan = buildPlan("long", bar(), 0.25, floorParams, 10, history(19, 10));

  assertEquals(plan.riskTicks, 7);
});

Deno.test("plan: no share configured leaves sizing exactly as it was", () => {
  const plan = buildPlan("long", bar(), 0.25, params, 10, history(20, 10));

  assertEquals(plan.riskTicks, 7);
});

Deno.test("plan: the same share adapts to each instrument's own scale", () => {
  // The whole point: one setting, two instruments whose rows mean different
  // amounts of market. MNQ rows are 0.75, BTCUSDT rows are 0.30.
  const mnq = buildPlan("long", bar(), 0.75, floorParams, 10, history(20, 15));
  const btc = buildPlan("long", bar(), 0.30, floorParams, 10, history(20, 22.2));

  // 30% of 15.00 = 4.50 -> 6 rows of 0.75.
  assertEquals(mnq.riskTicks, 6);
  // 30% of 22.20 = 6.66 -> 22.2 rows of 0.30, where minRiskTicks alone gave 4.
  assertEquals(btc.riskTicks, 22.2);
});
