import { assertEquals, assertGreater } from "jsr:@std/assert@1";
import type {
  BarInput,
  ClusterLevel,
  HistoryBar,
  RuleContext,
  RuleRow,
} from "../types.ts";
import { sortLevels } from "../util.ts";
import { evaluate as stackedImbalance } from "./stacked_imbalance.ts";
import { evaluate as deltaDivergence } from "./delta_divergence.ts";
import { evaluate as absorption } from "./absorption.ts";
import { evaluate as pocShift } from "./poc_shift.ts";
import { evaluate as deltaFlip } from "./delta_flip.ts";
import { evaluate as lvn } from "./lvn.ts";
import { evaluate as nakedPoc } from "./naked_poc.ts";
import { evaluators, runRules } from "./index.ts";

const TICK = 0.25;

function level(price: number, ask: number, bid: number): ClusterLevel {
  return { price, ask, bid, between: 0, volume: ask + bid, ticks: 1 };
}

function bar(overrides: Partial<BarInput> = {}): BarInput {
  return {
    openedAt: "2026-08-27T10:00:00Z",
    open: 100,
    high: 101,
    low: 100,
    close: 100.5,
    volume: 0,
    askVolume: 0,
    bidVolume: 0,
    delta: 0,
    minDelta: 0,
    maxDelta: 0,
    ticks: 0,
    trades: 0,
    isClosed: true,
    levels: [],
    ...overrides,
  };
}

function history(count: number, shape: (i: number) => Partial<HistoryBar>): HistoryBar[] {
  return Array.from({ length: count }, (_, i) => ({
    openedAt: `2026-08-27T09:${String(i).padStart(2, "0")}:00Z`,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 100,
    delta: 0,
    pocPrice: null,
    ...shape(i),
  }));
}

function ctx(
  levels: ClusterLevel[],
  params: Record<string, unknown>,
  overrides: Partial<RuleContext> = {},
): RuleContext {
  return {
    bar: bar({ levels }),
    levels: sortLevels(levels),
    history: [],
    tickSize: TICK,
    params,
    ...overrides,
  };
}

// ------------------------------------------------------- stacked imbalance

Deno.test("stacked imbalance: three stacked ask imbalances fire long at the top", () => {
  const levels = [
    level(100.00, 2, 5),
    level(100.25, 30, 4), // 30 vs bid 5 below  = 6.0
    level(100.50, 40, 3), // 40 vs bid 4 below  = 10.0
    level(100.75, 35, 2), // 35 vs bid 3 below  = 11.7
    level(101.00, 3, 2),
  ];

  const signals = stackedImbalance(
    ctx(levels, { ratio: 3, minVolume: 10, stack: 3 }),
  );

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].price, 100.75);
  assertEquals(signals[0].payload.stackLength, 3);
  assertGreater(signals[0].confidence, 0);
});

Deno.test("stacked imbalance: a price gap breaks the run", () => {
  // Same imbalanced levels, but 100.50 never traded, so 100.25 and 100.75 are
  // not consecutive ticks and cannot stack.
  const levels = [
    level(100.00, 2, 5),
    level(100.25, 30, 4),
    level(100.75, 35, 2),
    level(101.00, 3, 2),
  ];

  const signals = stackedImbalance(
    ctx(levels, { ratio: 3, minVolume: 10, stack: 3 }),
  );

  assertEquals(signals, []);
});

Deno.test("stacked imbalance: stacked bid imbalances fire short at the bottom", () => {
  const levels = [
    level(100.00, 2, 35), // 35 vs ask 3 above = 11.7
    level(100.25, 3, 40), // 40 vs ask 4 above = 10.0
    level(100.50, 4, 45), // 45 vs ask 5 above = 9.0
    level(100.75, 5, 2),
  ];

  const signals = stackedImbalance(
    ctx(levels, { ratio: 3, minVolume: 10, stack: 3 }),
  );

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals(signals[0].price, 100.00);
  assertEquals(signals[0].payload.stackLength, 3);
});

Deno.test("stacked imbalance: volume below minVolume is ignored", () => {
  const levels = [
    level(100.00, 1, 1),
    level(100.25, 6, 1), // ratio 6.0 but only 6 lots
    level(100.50, 6, 1),
    level(100.75, 6, 1),
  ];

  const signals = stackedImbalance(
    ctx(levels, { ratio: 3, minVolume: 10, stack: 3 }),
  );

  assertEquals(signals, []);
});

// --------------------------------------------------------- delta divergence

Deno.test("delta divergence: new high on negative delta fires short", () => {
  const past = history(5, (i) => ({ high: 100 + i, low: 99 + i }));

  const signals = deltaDivergence({
    ...ctx([], { lookback: 5, minDeltaMagnitude: 100 }),
    bar: bar({ high: 105, low: 103, close: 103.5, delta: -150 }),
    history: past,
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals(signals[0].price, 103.5);
  assertEquals(signals[0].payload.kind, "new_high_negative_delta");
});

Deno.test("delta divergence: new low on positive delta fires long", () => {
  const past = history(5, (i) => ({ high: 105 - i, low: 104 - i }));

  const signals = deltaDivergence({
    ...ctx([], { lookback: 5, minDeltaMagnitude: 100 }),
    bar: bar({ high: 101, low: 99, close: 100.5, delta: 200 }),
    history: past,
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
});

Deno.test("delta divergence: a new high with confirming delta is not a signal", () => {
  const past = history(5, (i) => ({ high: 100 + i, low: 99 + i }));

  const signals = deltaDivergence({
    ...ctx([], { lookback: 5, minDeltaMagnitude: 100 }),
    bar: bar({ high: 105, low: 103, close: 104.5, delta: 400 }),
    history: past,
  });

  assertEquals(signals, []);
});

Deno.test("delta divergence: too little history is not enough to judge", () => {
  const past = history(2, (i) => ({ high: 100 + i, low: 99 + i }));

  const signals = deltaDivergence({
    ...ctx([], { lookback: 5, minDeltaMagnitude: 100 }),
    bar: bar({ high: 105, low: 103, close: 103.5, delta: -150 }),
    history: past,
  });

  assertEquals(signals, []);
});

// ---------------------------------------------------------------- absorption

const absorptionParams = { volumeMultiple: 3, edgeTicks: 2, rejectionTicks: 2 };

Deno.test("absorption: heavy ask-dominated level at the high fires short", () => {
  const levels = [
    level(100.00, 10, 10),
    level(100.25, 10, 10),
    level(100.50, 10, 10),
    level(100.75, 10, 10),
    level(101.00, 300, 50), // buyers paid up here and got filled
  ];

  const signals = absorption({
    ...ctx(levels, absorptionParams),
    bar: bar({ high: 101, low: 100, close: 100.25, levels }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals(signals[0].payload.kind, "absorption_at_high");
});

Deno.test("absorption: heavy bid-dominated level at the low fires long", () => {
  const levels = [
    level(100.00, 50, 300), // sellers hit the bid here and got filled
    level(100.25, 10, 10),
    level(100.50, 10, 10),
    level(100.75, 10, 10),
    level(101.00, 10, 10),
  ];

  const signals = absorption({
    ...ctx(levels, absorptionParams),
    bar: bar({ high: 101, low: 100, close: 100.75, levels }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].payload.kind, "absorption_at_low");
});

Deno.test("absorption: a heavy level at the high that is bid-dominated is not a trap", () => {
  const levels = [
    level(100.00, 10, 10),
    level(100.25, 10, 10),
    level(100.50, 10, 10),
    level(100.75, 10, 10),
    level(101.00, 50, 300), // sellers, not trapped buyers
  ];

  const signals = absorption({
    ...ctx(levels, absorptionParams),
    bar: bar({ high: 101, low: 100, close: 100.25, levels }),
  });

  assertEquals(signals, []);
});

Deno.test("absorption: without a close back off the high there is no rejection", () => {
  const levels = [
    level(100.00, 10, 10),
    level(100.25, 10, 10),
    level(100.50, 10, 10),
    level(100.75, 10, 10),
    level(101.00, 300, 50),
  ];

  const signals = absorption({
    ...ctx(levels, absorptionParams),
    // Closes right at the high: the buyers were not trapped.
    bar: bar({ high: 101, low: 100, close: 101, levels }),
  });

  assertEquals(signals, []);
});

// ----------------------------------------------------------------- poc shift

const pocParams = { minTicks: 3, consecutive: 2, hvnShare: 0.25 };

Deno.test("poc shift: two consecutive upward steps fire long", () => {
  const levels = [
    level(100.75, 10, 10),
    level(101.00, 200, 150), // POC
    level(101.25, 10, 10),
  ];

  const signals = pocShift({
    ...ctx(levels, pocParams),
    bar: bar({ close: 101.25, volume: 400, levels }),
    history: history(2, (i) => ({ pocPrice: [100.00, 100.50][i] })),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].payload.totalShiftTicks, 4);
  assertEquals(signals[0].payload.isHvn, true);
});

Deno.test("poc shift: a step that reverses cancels the run", () => {
  const levels = [level(100.25, 200, 150)];

  const signals = pocShift({
    ...ctx(levels, pocParams),
    bar: bar({ close: 100.25, volume: 400, levels }),
    // up then back down
    history: history(2, (i) => ({ pocPrice: [100.00, 100.50][i] })),
  });

  assertEquals(signals, []);
});

Deno.test("poc shift: a shift smaller than minTicks is noise", () => {
  const levels = [level(100.50, 200, 150)];

  const signals = pocShift({
    ...ctx(levels, pocParams),
    bar: bar({ close: 100.50, volume: 400, levels }),
    history: history(2, (i) => ({ pocPrice: [100.00, 100.25][i] })),
  });

  assertEquals(signals, []);
});

Deno.test("poc shift: a longer run length demands more agreeing steps", () => {
  // The shipped default is three steps. Two steps that agree are exactly the
  // chop that made the rule fire on half of every bar, so they must not pass.
  const levels = [level(101.00, 200, 150)];
  const strict = { ...pocParams, consecutive: 3 };

  const twoSteps = pocShift({
    ...ctx(levels, strict),
    bar: bar({ close: 101, volume: 400, levels }),
    history: history(2, (i) => ({ pocPrice: [100.00, 100.50][i] })),
  });
  assertEquals(twoSteps, []);

  const threeSteps = pocShift({
    ...ctx(levels, strict),
    bar: bar({ close: 101, volume: 400, levels }),
    history: history(3, (i) => ({ pocPrice: [100.00, 100.25, 100.50][i] })),
  });
  assertEquals(threeSteps.length, 1);
  assertEquals(threeSteps[0].direction, "long");
});

Deno.test("poc shift: missing historical POCs are not guessed at", () => {
  const levels = [level(101.00, 200, 150)];

  const signals = pocShift({
    ...ctx(levels, pocParams),
    bar: bar({ close: 101, volume: 400, levels }),
    history: history(2, () => ({ pocPrice: null })),
  });

  assertEquals(signals, []);
});

// ------------------------------------------------------------------ delta flip

const flipParams = {
  runBars: 3,
  minDeltaMagnitude: 200,
  minRunDelta: 0,
  levelShare: 0.25,
  levelLookback: 20,
};

/** Five bars, the last three pressing `runDelta`, one of them holding a POC. */
function flipHistory(runDelta: number, pocPrice: number | null): HistoryBar[] {
  return history(5, (i) => ({
    delta: i >= 2 ? runDelta : 0,
    pocPrice: i === 2 ? pocPrice : null,
  }));
}

/** A bar whose low is 99.5 and high 100.5, so the level tolerance is 0.25. */
function flipBar(delta: number, close: number): BarInput {
  return bar({ high: 100.5, low: 99.5, close, delta });
}

Deno.test("delta flip: sellers press, buyers take it back on an old POC", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    history: flipHistory(-300, 99.6),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].payload.kind, "delta_flip_up");
  assertEquals((signals[0].payload.level as { price: number }).price, 99.6);
  assertEquals((signals[0].payload.level as { ageBars: number }).ageBars, 3);
});

Deno.test("delta flip: the mirror case is a short off the high", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(-250, 99.6),
    history: flipHistory(300, 100.4),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals(signals[0].payload.kind, "delta_flip_down");
});

Deno.test("delta flip: a flip away from every old POC is not a signal", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    // 1.5 away from the low, where the tolerance is a quarter of the bar's range.
    history: flipHistory(-300, 98.0),
  });

  assertEquals(signals, []);
});

Deno.test("delta flip: history with no POC on record cannot place the flip", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    history: flipHistory(-300, null),
  });

  assertEquals(signals, []);
});

Deno.test("delta flip: one bar the other way breaks the run", () => {
  const broken = history(5, (i) => ({
    delta: [0, 0, -300, 50, -300][i],
    pocPrice: i === 2 ? 99.6 : null,
  }));

  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    history: broken,
  });

  assertEquals(signals, []);
});

Deno.test("delta flip: a bar with no delta at all breaks the run too", () => {
  const flat = history(5, (i) => ({
    delta: [0, 0, -300, 0, -300][i],
    pocPrice: i === 2 ? 99.6 : null,
  }));

  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    history: flat,
  });

  assertEquals(signals, []);
});

Deno.test("delta flip: a flip under the delta threshold is not one", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(150, 100.4),
    history: flipHistory(-300, 99.6),
  });

  assertEquals(signals, []);
});

Deno.test("delta flip: too little history to see a run means no signal", () => {
  const signals = deltaFlip({
    ...ctx([], flipParams),
    bar: flipBar(250, 100.4),
    history: history(2, () => ({ delta: -300, pocPrice: 99.6 })),
  });

  assertEquals(signals, []);
});

// ------------------------------------------------------------------------ lvn

const lvnParams = { maxShare: 0.25, interiorShare: 0.8, minLevels: 8 };

/** A level of a given total volume, split evenly, since lvn reads volume only. */
function vol(price: number, volume: number): ClusterLevel {
  return level(price, volume / 2, volume / 2);
}

Deno.test("lvn: volume below the hole, close above it, is a long", () => {
  const levels = [
    vol(100.00, 20),
    vol(100.25, 100),
    vol(100.50, 200), // POC
    vol(100.75, 120),
    vol(101.00, 4), // the hole
    vol(101.25, 60),
    vol(101.50, 50),
    vol(101.75, 10),
  ];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 101.75, low: 100.00, close: 101.50, levels }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].payload.kind, "lvn_break_up");
  assertEquals((signals[0].payload.level as { price: number }).price, 101.00);
  assertEquals((signals[0].payload.poc as { price: number }).price, 100.50);
});

Deno.test("lvn: volume above the hole, close below it, is a short", () => {
  const levels = [
    vol(100.00, 15),
    vol(100.25, 50),
    vol(100.50, 60),
    vol(100.75, 5), // the hole
    vol(101.00, 130),
    vol(101.25, 200), // POC
    vol(101.50, 100),
    vol(101.75, 20),
  ];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 101.75, low: 100.00, close: 100.25, levels }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals((signals[0].payload.level as { price: number }).price, 100.75);
});

Deno.test("lvn: a close still on the volume's side of the hole says nothing", () => {
  const levels = [
    vol(100.00, 20),
    vol(100.25, 100),
    vol(100.50, 200),
    vol(100.75, 120),
    vol(101.00, 4),
    vol(101.25, 60),
    vol(101.50, 50),
    vol(101.75, 10),
  ];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 101.75, low: 100.00, close: 100.75, levels }),
  });

  assertEquals(signals, []);
});

Deno.test("lvn: the thin ends of a bar are not holes in its profile", () => {
  const levels = [
    vol(100.00, 2), // thinnest of the whole bar, and its own extreme
    vol(100.25, 100),
    vol(100.50, 200),
    vol(100.75, 120),
    vol(101.00, 90),
    vol(101.25, 60),
    vol(101.50, 80),
    vol(101.75, 8),
  ];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 101.75, low: 100.00, close: 101.50, levels }),
  });

  assertEquals(signals, []);
});

Deno.test("lvn: a hole that is not empty enough is left alone", () => {
  const levels = [
    vol(100.00, 20),
    vol(100.25, 100),
    vol(100.50, 200),
    vol(100.75, 120),
    vol(101.00, 40), // above a quarter of the average level
    vol(101.25, 60),
    vol(101.50, 50),
    vol(101.75, 10),
  ];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 101.75, low: 100.00, close: 101.50, levels }),
  });

  assertEquals(signals, []);
});

Deno.test("lvn: a profile too small to have a shape is skipped", () => {
  const levels = [vol(100.00, 20), vol(100.25, 100), vol(100.50, 2), vol(100.75, 90)];

  const signals = lvn({
    ...ctx(levels, lvnParams),
    bar: bar({ high: 100.75, low: 100.00, close: 100.75, levels }),
  });

  assertEquals(signals, []);
});

// ------------------------------------------------------------------ naked poc

const nakedParams = { lookbackBars: 40, minAgeBars: 5 };

/** Ten bars that all traded 99.5-100.5 and closed at 100. */
function nakedHistory(pocs: Record<number, number>): HistoryBar[] {
  return history(10, (i) => ({
    high: 100.5,
    low: 99.5,
    close: 100,
    pocPrice: pocs[i] ?? null,
  }));
}

Deno.test("naked poc: the first trade up into an untested POC is a short", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    bar: bar({ high: 102.2, low: 100.0, close: 101.8 }),
    history: nakedHistory({ 0: 102 }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "short");
  assertEquals(signals[0].payload.kind, "naked_poc_from_below");
  assertEquals((signals[0].payload.level as { price: number }).price, 102);
  assertEquals((signals[0].payload.level as { ageBars: number }).ageBars, 10);
});

Deno.test("naked poc: reached from above, the same level is support", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    bar: bar({ high: 100.2, low: 97.9, close: 98.3 }),
    history: nakedHistory({ 0: 98 }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].direction, "long");
  assertEquals(signals[0].payload.kind, "naked_poc_from_above");
});

Deno.test("naked poc: a POC later bars traded through is not naked", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    // 100.2 sits inside every later bar's 99.5-100.5 range.
    bar: bar({ high: 100.6, low: 99.8, close: 100.5 }),
    history: nakedHistory({ 0: 100.2 }),
  });

  assertEquals(signals, []);
});

Deno.test("naked poc: a POC from two bars ago has not been left alone yet", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    bar: bar({ high: 102.2, low: 100.0, close: 101.8 }),
    history: nakedHistory({ 8: 102 }),
  });

  assertEquals(signals, []);
});

Deno.test("naked poc: reaching several at once, the deepest is the test", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    bar: bar({ high: 102.2, low: 100.0, close: 101.0 }),
    history: nakedHistory({ 0: 102, 2: 101 }),
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].payload.reachedThisBar, 2);
  assertEquals((signals[0].payload.level as { price: number }).price, 102);
});

Deno.test("naked poc: a bar that reaches none of them is not a signal", () => {
  const signals = nakedPoc({
    ...ctx([], nakedParams),
    bar: bar({ high: 100.6, low: 99.4, close: 100.1 }),
    history: nakedHistory({ 0: 102 }),
  });

  assertEquals(signals, []);
});

// ------------------------------------------------------------------ registry

function ruleRow(key: string, overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    key,
    name: key,
    enabled: true,
    telegram_enabled: true,
    horizon_bars: 10,
    params: {},
    ...overrides,
  };
}

Deno.test("runRules: a disabled rule never runs", () => {
  const levels = [
    level(100.00, 2, 5),
    level(100.25, 30, 4),
    level(100.50, 40, 3),
    level(100.75, 35, 2),
  ];

  const signals = runRules(
    [ruleRow("stacked_imbalance", {
      enabled: false,
      params: { ratio: 3, minVolume: 10, stack: 3 },
    })],
    {
      bar: bar({ levels }),
      levels,
      history: [],
      tickSize: TICK,
    },
  );

  assertEquals(signals, []);
});

Deno.test("runRules: a rule with no evaluator deployed is skipped, not fatal", () => {
  const signals = runRules([ruleRow("not_deployed_yet")], {
    bar: bar(),
    levels: [],
    history: [],
    tickSize: TICK,
  });

  assertEquals(signals, []);
});

Deno.test("runRules: one throwing rule cannot take down the others", () => {
  evaluators.boom = () => {
    throw new Error("intentional");
  };

  try {
    const levels = [
      level(100.00, 2, 5),
      level(100.25, 30, 4),
      level(100.50, 40, 3),
      level(100.75, 35, 2),
    ];

    const signals = runRules(
      [
        ruleRow("boom"),
        ruleRow("stacked_imbalance", {
          params: { ratio: 3, minVolume: 10, stack: 3 },
        }),
      ],
      { bar: bar({ levels }), levels, history: [], tickSize: TICK },
    );

    assertEquals(signals.length, 1);
    assertEquals(signals[0].ruleKey, "stacked_imbalance");
  } finally {
    delete evaluators.boom;
  }
});

Deno.test("runRules: the rules added for prop trading are registered", () => {
  for (const key of ["delta_flip", "lvn", "naked_poc"]) {
    assertEquals(typeof evaluators[key], "function", `${key} has no evaluator`);
  }

  // End to end through the registry rather than by calling the evaluator, so a
  // rule that exists but was never wired into the table fails here.
  const signals = runRules([ruleRow("naked_poc", { params: nakedParams })], {
    bar: bar({ high: 102.2, low: 100.0, close: 101.8 }),
    levels: [],
    history: nakedHistory({ 0: 102 }),
    tickSize: TICK,
  });

  assertEquals(signals.length, 1);
  assertEquals(signals[0].ruleKey, "naked_poc");
  assertEquals(signals[0].direction, "short");
});

Deno.test("runRules: tags each signal with the rule that produced it", () => {
  const levels = [
    level(100.00, 2, 5),
    level(100.25, 30, 4),
    level(100.50, 40, 3),
    level(100.75, 35, 2),
  ];

  const signals = runRules(
    [ruleRow("stacked_imbalance", {
      params: { ratio: 3, minVolume: 10, stack: 3 },
    })],
    { bar: bar({ levels }), levels, history: [], tickSize: TICK },
  );

  assertEquals(signals.length, 1);
  assertEquals(signals[0].ruleKey, "stacked_imbalance");
});
