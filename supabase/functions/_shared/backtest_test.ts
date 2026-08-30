import { assertEquals } from "jsr:@std/assert@1";
import { scorePlan } from "./backtest.ts";
import { SCORER_CASES } from "./testdata/scorer_cases.ts";
import type { TradePlan } from "./plan.ts";

function planOf(c: typeof SCORER_CASES[number]): TradePlan {
  return {
    entry: c.entry,
    stop: c.stop,
    target: c.target,
    riskTicks: c.risk,
    rewardTicks: c.risk * 2,
    trailTriggerTicks: c.trailTrigger,
    trailOffsetTicks: c.trailOffset,
    holdBars: c.hold,
  };
}

/**
 * The whole backtest rests on this. An experiment is only comparable with live
 * results if it settles trades the way the database settles them, and the two
 * scorers are separate implementations in separate languages. So they are held
 * together by real outcomes rather than by intent.
 */
Deno.test("backtest: the scorer reproduces what the database recorded", () => {
  const wrong: string[] = [];

  for (const c of SCORER_CASES) {
    const got = scorePlan(
      planOf(c),
      c.direction,
      c.fwd.map(([high, low, close]) => ({ high, low, close })),
      c.tick,
    );

    if (
      got.exitReason !== c.want.reason ||
      got.barsUsed !== c.want.bars ||
      Math.abs(got.pnlTicks - c.want.pnl) > 0.01
    ) {
      wrong.push(
        `${c.direction} @${c.entry}: want ${c.want.reason}/${c.want.bars}bars/${c.want.pnl} ` +
          `got ${got.exitReason}/${got.barsUsed}bars/${got.pnlTicks}`,
      );
    }
  }

  assertEquals(wrong, [], `scorer drifted from the database on ${wrong.length} case(s)`);
});

Deno.test("backtest: every exit reason is actually covered by the cases", () => {
  // A green suite would mean nothing if the cases only exercised one path.
  const reasons = new Set(SCORER_CASES.map((c) => c.want.reason));

  assertEquals([...reasons].sort(), ["stop", "target", "timeout", "trail"]);
});

Deno.test("backtest: a bar holding both stop and target is scored as the stop", () => {
  // Deliberate pessimism, matching evaluate_pending_outcomes: a bar reports
  // only its range, so which came first is unknowable, and assuming the good
  // fill would inflate every statistic the system exists to produce.
  const plan: TradePlan = {
    entry: 100, stop: 99, target: 102, riskTicks: 4, rewardTicks: 8,
    trailTriggerTicks: 4, trailOffsetTicks: 2, holdBars: 5,
  };

  const got = scorePlan(plan, "long", [{ high: 103, low: 98, close: 101 }], 0.25);

  assertEquals(got.exitReason, "stop");
  assertEquals(got.pnlTicks, -4);
});

Deno.test("backtest: the trail cannot use the same bar it was raised on", () => {
  // Raising the stop from a bar's own high and then testing that bar against
  // it would exit at a level that never existed while the bar was forming.
  const plan: TradePlan = {
    entry: 100, stop: 99, target: 110, riskTicks: 4, rewardTicks: 40,
    trailTriggerTicks: 4, trailOffsetTicks: 2, holdBars: 5,
  };

  // First bar runs up 8 ticks and closes back near the entry: enough to arm
  // the trail, but the trail must not take it out on this same bar.
  const got = scorePlan(plan, "long", [
    { high: 102, low: 99.5, close: 100 },
    { high: 100.2, low: 99.8, close: 100 },
  ], 0.25);

  assertEquals(got.barsUsed, 2);
  assertEquals(got.exitReason, "trail");
  // Trail sits 2 ticks under the 102 high, so 101.5 — a gain, not the -4 the
  // original stop would have given.
  assertEquals(got.exitPrice, 101.5);
  assertEquals(got.pnlTicks, 6);
});
