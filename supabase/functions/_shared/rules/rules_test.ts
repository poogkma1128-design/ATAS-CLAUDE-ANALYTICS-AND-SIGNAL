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
