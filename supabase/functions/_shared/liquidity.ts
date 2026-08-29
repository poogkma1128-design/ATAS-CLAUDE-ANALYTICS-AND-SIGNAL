import type { RuleContext } from "./types.ts";
import { num } from "./util.ts";

/**
 * Whether a bar carried enough participation for the rules to mean anything.
 *
 * Every threshold in this system — stack volume, delta magnitude, absorption
 * multiples — was calibrated on bars that had real volume behind them. A thin
 * bar clears them for the wrong reason: not because something happened, but
 * because there was too little trade for anything to stand out against.
 *
 * Measured on the first session of recorded signals, split by the bar's volume
 * against the median of the 50 bars before it:
 *
 *     < 0.4x    10 trades   +2.58R
 *     0.4-0.7x  23 trades   -7.13R
 *     0.7-1.2x  35 trades   -1.83R
 *     1.2-2.0x  28 trades   +3.04R
 *     >= 2.0x   60 trades   +8.84R
 *
 * Cutting at 1.2x separates +11.88R over 88 trades from -6.38R over 68.
 *
 * This is a ratio rather than a clock on purpose. A trading-hours window scored
 * worse on the same data (+8.46R), needs a different setting per instrument,
 * moves with daylight saving, and says nothing at all about an instrument that
 * trades around the clock — which BTCUSDT, already in this database, does.
 */
export function hasEnoughLiquidity(ctx: RuleContext): boolean {
  const minRatio = num(ctx.params, "minVolumeRatio", 0);
  if (minRatio <= 0) return true;

  const minHistory = Math.max(1, Math.round(num(ctx.params, "minVolumeHistory", 10)));
  const volumes = ctx.history.map((bar) => bar.volume).filter((v) => v > 0);

  // Too little history to know what normal looks like. Judging the bar against
  // a median of three would be a worse filter than none, and blocking instead
  // would silently mute the opening of every freshly loaded chart.
  if (volumes.length < minHistory) return true;

  const median = medianOf(volumes);
  if (median <= 0) return true;

  return ctx.bar.volume >= median * minRatio;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
