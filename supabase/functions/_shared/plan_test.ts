import { assertEquals } from "jsr:@std/assert@1";
import type { BarInput } from "./types.ts";
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
