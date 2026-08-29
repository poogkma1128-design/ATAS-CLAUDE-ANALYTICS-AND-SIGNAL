import type { RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num } from "../util.ts";

/**
 * Price makes a new extreme but delta disagrees.
 *
 * A bar that prints the highest high of the lookback window while aggressive
 * sellers dominated it means the move up was not bought — it was sold into.
 * That is a short. The mirror case is a long.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const lookback = Math.max(1, Math.round(num(ctx.params, "lookback", 5)));
  const minDeltaMagnitude = num(ctx.params, "minDeltaMagnitude", 100);

  const window = ctx.history.slice(-lookback);
  if (window.length < lookback) return [];

  const priorHigh = Math.max(...window.map((b) => b.high));
  const priorLow = Math.min(...window.map((b) => b.low));

  const { bar } = ctx;
  const signals: RuleSignal[] = [];

  if (bar.high > priorHigh && bar.delta <= -minDeltaMagnitude) {
    signals.push({
      direction: "short",
      price: bar.close,
      confidence: strength(bar.delta, minDeltaMagnitude),
      payload: {
        kind: "new_high_negative_delta",
        lookback,
        priorHigh,
        barHigh: bar.high,
        delta: bar.delta,
        minDelta: bar.minDelta,
        maxDelta: bar.maxDelta,
        minDeltaMagnitude,
      },
    });
  }

  if (bar.low < priorLow && bar.delta >= minDeltaMagnitude) {
    signals.push({
      direction: "long",
      price: bar.close,
      confidence: strength(bar.delta, minDeltaMagnitude),
      payload: {
        kind: "new_low_positive_delta",
        lookback,
        priorLow,
        barLow: bar.low,
        delta: bar.delta,
        minDelta: bar.minDelta,
        maxDelta: bar.maxDelta,
        minDeltaMagnitude,
      },
    });
  }

  return signals;
}

/** How far past the threshold the divergence ran, capped at 3x. */
function strength(delta: number, threshold: number): number {
  if (threshold <= 0) return 0.5;
  const excess = Math.abs(delta) / threshold - 1;
  return clamp01(0.4 + Math.min(excess, 2) * 0.25);
}
