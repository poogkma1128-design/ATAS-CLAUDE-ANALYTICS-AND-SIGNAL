import type { HistoryBar, RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num } from "../util.ts";

/**
 * Aggression changing sides at a price the market already cared about.
 *
 * Delta Divergence reads one bar against the extreme of a window. This reads
 * the sequence instead: several bars where one side pressed, then a bar of real
 * size pressing back the other way. That much on its own is not evidence --
 * delta changes sign all day long, and a rule that fired on every sign change
 * would fire on chop. What makes a flip mean something is where it happens.
 *
 * So the flip has to land on a price that already held volume: the point of
 * control of an earlier bar, which is stored on every bar and is the same
 * number POC Shift already reads. The side that was pressing ran into the price
 * where business had been done before, and stopped there.
 *
 * The turn is measured at the bar's extreme rather than at its close. A long
 * flip is the market refusing to go lower, and the refusal happens at the low.
 *
 * `levelShare` is a fraction of the signal bar's own range rather than a count
 * of ticks, for the reason in HANDOFF 5.4 and forbidden item 8: a footprint row
 * is a different size on every chart, so a tick count quietly means something
 * different per instrument. A share travels.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const runBars = Math.max(1, Math.round(num(ctx.params, "runBars", 3)));
  const minDeltaMagnitude = num(ctx.params, "minDeltaMagnitude", 200);
  const minRunDelta = num(ctx.params, "minRunDelta", 0);
  const levelShare = num(ctx.params, "levelShare", 0.25);
  const levelLookback = Math.max(
    1,
    Math.round(num(ctx.params, "levelLookback", 20)),
  );

  const run = ctx.history.slice(-runBars);
  if (run.length < runBars) return [];

  const { bar } = ctx;
  const direction = flipDirection(run, bar.delta, minDeltaMagnitude, minRunDelta);
  if (direction === null) return [];

  // A zero-range bar carries no scale of its own to measure a level against, so
  // it is left alone rather than measured against a guess.
  const range = bar.high - bar.low;
  if (!(range > 0)) return [];

  const pivot = direction === "long" ? bar.low : bar.high;
  const tolerance = range * levelShare;
  const level = nearestPriorPoc(ctx.history, pivot, tolerance, levelLookback);
  if (level === null) return [];

  const excess = minDeltaMagnitude > 0 ? Math.abs(bar.delta) / minDeltaMagnitude - 1 : 0;
  const magnitudeBonus = Math.min(Math.max(excess, 0), 2) * 0.2;
  const proximityBonus = tolerance > 0
    ? clamp01(1 - Math.abs(level.price - pivot) / tolerance) * 0.15
    : 0.15;

  return [{
    direction,
    price: bar.close,
    confidence: clamp01(0.35 + magnitudeBonus + proximityBonus),
    payload: {
      kind: direction === "long" ? "delta_flip_up" : "delta_flip_down",
      runBars,
      runDeltas: run.map((b) => b.delta),
      delta: bar.delta,
      minDelta: bar.minDelta,
      maxDelta: bar.maxDelta,
      minDeltaMagnitude,
      minRunDelta,
      pivot,
      level: { price: level.price, ageBars: level.ageBars },
      levelShare,
      levelLookback,
      levelDistanceShare: Number(
        (Math.abs(level.price - pivot) / range).toFixed(4),
      ),
    },
  }];
}

/**
 * The direction of a flip, or null when there is not one.
 *
 * Every bar of the run must have pressed the same way and pressed hard enough,
 * and the signal bar must have pressed back at least `minDeltaMagnitude`. A
 * zero-delta bar breaks a run rather than extending it: it is the absence of a
 * side, not a side.
 */
function flipDirection(
  run: HistoryBar[],
  delta: number,
  minDeltaMagnitude: number,
  minRunDelta: number,
): "long" | "short" | null {
  const pressed = (sign: -1 | 1) =>
    run.every((b) => Math.sign(b.delta) === sign && Math.abs(b.delta) >= minRunDelta);

  if (delta >= minDeltaMagnitude && pressed(-1)) return "long";
  if (delta <= -minDeltaMagnitude && pressed(1)) return "short";
  return null;
}

/**
 * The stored point of control closest to `pivot`, within `tolerance`.
 *
 * Distance decides, and a tie is left with the older level: a price that has
 * been on the chart longer is the one more people are looking at.
 */
function nearestPriorPoc(
  history: HistoryBar[],
  pivot: number,
  tolerance: number,
  lookback: number,
): { price: number; ageBars: number } | null {
  const window = history.slice(-lookback);
  let best: { price: number; ageBars: number } | null = null;

  for (const [index, bar] of window.entries()) {
    if (bar.pocPrice === null) continue;

    const distance = Math.abs(bar.pocPrice - pivot);
    if (distance > tolerance + 1e-9) continue;

    if (best === null || distance < Math.abs(best.price - pivot) - 1e-9) {
      best = { price: bar.pocPrice, ageBars: window.length - index };
    }
  }

  return best;
}
