import { assertEquals } from "jsr:@std/assert@1";
import { drawdown, fillIndex, scorePlan } from "./backtest.ts";
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

// ------------------------------------------------------- drawdown and fills

Deno.test("drawdown: measures the deepest hole, not the final result", () => {
  // Ends at +1R, but only after giving back 3R from a peak of +3R.
  const trades = [
    { openedAt: "2026-08-30T00:00:00Z", r: 2 },
    { openedAt: "2026-08-30T00:05:00Z", r: 1 },
    { openedAt: "2026-08-30T00:10:00Z", r: -1 },
    { openedAt: "2026-08-30T00:15:00Z", r: -1 },
    { openedAt: "2026-08-30T00:20:00Z", r: -1 },
    { openedAt: "2026-08-30T00:25:00Z", r: 1 },
  ] as unknown as Parameters<typeof drawdown>[0];

  assertEquals(drawdown(trades), { maxDrawdownR: 3, worstLosingStreak: 3 });
});

Deno.test("drawdown: reads trades in time order, not the order given", () => {
  // The simulator groups by instrument, so the list can arrive out of order.
  // Sorted, this is -2 then +2: a 2R hole. Unsorted it would look like none.
  const trades = [
    { openedAt: "2026-08-30T00:05:00Z", r: 2 },
    { openedAt: "2026-08-30T00:00:00Z", r: -2 },
  ] as unknown as Parameters<typeof drawdown>[0];

  assertEquals(drawdown(trades).maxDrawdownR, 2);
});

Deno.test("drawdown: an equity curve that never falls has none", () => {
  const trades = [
    { openedAt: "2026-08-30T00:00:00Z", r: 1 },
    { openedAt: "2026-08-30T00:05:00Z", r: 2 },
  ] as unknown as Parameters<typeof drawdown>[0];

  assertEquals(drawdown(trades), { maxDrawdownR: 0, worstLosingStreak: 0 });
});

Deno.test("fill: entry at the close fills on the next bar either way", () => {
  const forward = [{ high: 110, low: 90 }] as unknown as Parameters<typeof fillIndex>[2];
  assertEquals(fillIndex(100, "long", forward, 1), 0);
  assertEquals(fillIndex(100, "short", forward, 1), 0);
});

Deno.test("fill: a long fills only where price traded down to the entry", () => {
  // Runs away upward and never comes back — the trade never happens, which is
  // exactly the case that would flatter a pullback if it were dropped quietly.
  const ranAway = [
    { high: 120, low: 105 },
    { high: 130, low: 118 },
  ] as unknown as Parameters<typeof fillIndex>[2];
  assertEquals(fillIndex(100, "long", ranAway, 2), null);

  const cameBack = [
    { high: 120, low: 105 },
    { high: 118, low: 99 },
  ] as unknown as Parameters<typeof fillIndex>[2];
  assertEquals(fillIndex(100, "long", cameBack, 2), 1);
});

Deno.test("fill: reach is limited to the window, not the whole horizon", () => {
  const late = [
    { high: 120, low: 105 },
    { high: 118, low: 99 },
  ] as unknown as Parameters<typeof fillIndex>[2];

  assertEquals(fillIndex(100, "long", late, 1), null);
  assertEquals(fillIndex(100, "long", late, 2), 1);
});
