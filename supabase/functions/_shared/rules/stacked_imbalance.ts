import type { RuleContext, RuleSignal } from "../types.ts";
import { clamp01, imbalanceRatio, isOneTickApart, num } from "../util.ts";

/**
 * Stacked diagonal imbalance.
 *
 * Buyers lifting the offer at price P are compared against sellers hitting the
 * bid one tick BELOW P, because those are the two sides that actually met.
 * Comparing ask and bid on the same row would compare trades that never
 * transacted with each other.
 *
 *   ask imbalance at P  <=>  levels[P].ask >= ratio * levels[P - tick].bid
 *   bid imbalance at P  <=>  levels[P].bid >= ratio * levels[P + tick].ask
 *
 * `stack` of them in a row, at consecutive ticks, is the signal. Runs are
 * broken by any price gap, so a bar with holes in its footprint cannot fake a
 * stack out of levels that are far apart.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const ratio = num(ctx.params, "ratio", 3);
  const minVolume = num(ctx.params, "minVolume", 10);
  const stack = Math.max(2, Math.round(num(ctx.params, "stack", 3)));

  const levels = ctx.levels;
  if (levels.length < stack + 1) return [];

  const askFlags: boolean[] = new Array(levels.length).fill(false);
  const bidFlags: boolean[] = new Array(levels.length).fill(false);
  const askRatios: number[] = new Array(levels.length).fill(0);
  const bidRatios: number[] = new Array(levels.length).fill(0);

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];

    const below = i > 0 ? levels[i - 1] : null;
    if (
      below && isOneTickApart(below.price, level.price, ctx.tickSize) &&
      level.ask >= minVolume
    ) {
      const r = imbalanceRatio(level.ask, below.bid);
      if (r >= ratio) {
        askFlags[i] = true;
        askRatios[i] = r;
      }
    }

    const above = i < levels.length - 1 ? levels[i + 1] : null;
    if (
      above && isOneTickApart(level.price, above.price, ctx.tickSize) &&
      level.bid >= minVolume
    ) {
      const r = imbalanceRatio(level.bid, above.ask);
      if (r >= ratio) {
        bidFlags[i] = true;
        bidRatios[i] = r;
      }
    }
  }

  const signals: RuleSignal[] = [];

  const askRun = longestRun(askFlags, levels.map((l) => l.price), ctx.tickSize);
  if (askRun && askRun.length >= stack) {
    // Buyers were the aggressor all the way up; the top of the stack is where
    // the last of them paid up.
    signals.push(
      build(ctx, "long", askRun, levels, askRatios, ratio, stack, "ask"),
    );
  }

  const bidRun = longestRun(bidFlags, levels.map((l) => l.price), ctx.tickSize);
  if (bidRun && bidRun.length >= stack) {
    signals.push(
      build(ctx, "short", bidRun, levels, bidRatios, ratio, stack, "bid"),
    );
  }

  return signals;
}

interface Run {
  start: number;
  end: number;
  length: number;
}

/** Longest run of flagged levels that are also consecutive ticks. */
function longestRun(
  flags: boolean[],
  prices: number[],
  tickSize: number,
): Run | null {
  let best: Run | null = null;
  let start = -1;

  for (let i = 0; i < flags.length; i++) {
    const continues = flags[i] &&
      (start === -1 || isOneTickApart(prices[i - 1], prices[i], tickSize));

    if (continues) {
      if (start === -1) start = i;
      const length = i - start + 1;
      if (best === null || length > best.length) best = { start, end: i, length };
    } else if (flags[i]) {
      // Flagged, but a price gap ended the previous run: start a fresh one.
      start = i;
      if (best === null || best.length < 1) best = { start: i, end: i, length: 1 };
    } else {
      start = -1;
    }
  }

  return best;
}

function build(
  ctx: RuleContext,
  direction: "long" | "short",
  run: Run,
  levels: RuleContext["levels"],
  ratios: number[],
  ratioThreshold: number,
  stack: number,
  side: "ask" | "bid",
): RuleSignal {
  const runLevels = levels.slice(run.start, run.end + 1);

  const finiteRatios = ratios
    .slice(run.start, run.end + 1)
    .filter((r) => Number.isFinite(r));
  const avgRatio = finiteRatios.length > 0
    ? finiteRatios.reduce((a, b) => a + b, 0) / finiteRatios.length
    : ratioThreshold * 3;

  // Deeper stacks and heavier lopsidedness both raise confidence, each capped
  // so one extreme cannot alone pin it at 1.
  const depthBonus = Math.min((run.length - stack) * 0.12, 0.35);
  const ratioBonus = Math.min((avgRatio / ratioThreshold - 1) * 0.2, 0.25);
  const confidence = clamp01(0.4 + depthBonus + ratioBonus);

  const price = direction === "long"
    ? runLevels[runLevels.length - 1].price
    : runLevels[0].price;

  return {
    direction,
    price,
    confidence,
    payload: {
      side,
      stackLength: run.length,
      requiredStack: stack,
      ratioThreshold,
      avgRatio: Number.isFinite(avgRatio) ? Number(avgRatio.toFixed(2)) : null,
      priceFrom: runLevels[0].price,
      priceTo: runLevels[runLevels.length - 1].price,
      levels: runLevels.map((l, idx) => ({
        price: l.price,
        ask: l.ask,
        bid: l.bid,
        ratio: Number.isFinite(ratios[run.start + idx])
          ? Number(ratios[run.start + idx].toFixed(2))
          : null,
      })),
    },
  };
}
