import type { RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num } from "../util.ts";

/**
 * A burst of trades, going somewhere.
 *
 * `bar.ticks` is the number of trades in the bar -- ATAS reports it per
 * footprint level as `Ticks` and the indicator sums it. (`bar.trades` looks
 * like the field for this and is not: the indicator never assigns it, so it is
 * 0 on every bar ever stored. See HANDOFF 5.16.)
 *
 * Every chart here is 5m, so a count per bar is a rate per bar, and dividing by
 * a duration the context does not carry would add nothing. That stops being
 * true the day a tick or range timeframe is added, and this comment is the
 * warning; it is not worth a parameter until then.
 *
 * A burst on its own is only noise -- the tape speeds up at every number, every
 * open, every stop run in either direction. What makes it a direction is where
 * the bar closed in its own range: urgency that ended at the high is buyers who
 * ran out of patience, urgency that ended mid-range is a fight nobody won, and
 * that last case deliberately produces nothing.
 *
 * Direction is read from the range rather than from delta on purpose. Delta
 * already has two rules on it, and pointing a third at the same quantity would
 * mostly re-fire what Delta Divergence and Delta Flip already say.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const minRateRatio = num(ctx.params, "minRateRatio", 2);
  const edgeShare = clamp01(num(ctx.params, "edgeShare", 0.3));
  const rateHistory = Math.max(
    1,
    Math.round(num(ctx.params, "rateHistory", 10)),
  );

  const window = ctx.history.slice(-rateHistory);
  if (window.length < rateHistory) return [];

  const rates = window.map((b) => b.ticks).filter((t) => t > 0);
  // Too little of a baseline to call anything a spike. Judging a bar against a
  // median of three would be worse than not judging it, the same reasoning the
  // volume gate uses.
  if (rates.length < rateHistory) return [];

  const medianRate = medianOf(rates);
  if (medianRate <= 0) return [];

  const { bar } = ctx;
  const observedRatio = bar.ticks / medianRate;
  if (observedRatio < minRateRatio) return [];

  const range = bar.high - bar.low;
  if (!(range > 0)) return [];

  const closeShare = (bar.close - bar.low) / range;
  let direction: "long" | "short";
  if (closeShare >= 1 - edgeShare) direction = "long";
  else if (closeShare <= edgeShare) direction = "short";
  else return [];

  // Recorded, never filtered on. Volume divided by trades is the average size
  // of a trade in the bar, which is the closest this system can currently get
  // to "were those big trades or small ones?" -- item 4 on the prop-trading
  // list, which otherwise needs per-trade size the indicator does not send.
  // Whether a burst of large trades behaves differently from a burst of small
  // ones is a question for signal_outcomes, the way the volume gate was
  // decided, not a threshold to invent now.
  const avgTradeSize = bar.ticks > 0 ? bar.volume / bar.ticks : 0;
  const sizes = window
    .map((b) => (b.ticks > 0 ? b.volume / b.ticks : 0))
    .filter((v) => v > 0);
  const medianTradeSize = sizes.length > 0 ? medianOf(sizes) : 0;

  const rateBonus = minRateRatio > 0
    ? Math.min(observedRatio / minRateRatio - 1, 2) * 0.2
    : 0;

  // How decisively the close sat at the end of the range: 0 at the edge of what
  // still counts as an end, 1 at the extreme itself.
  const towardEnd = direction === "long" ? closeShare : 1 - closeShare;
  const decisiveness = edgeShare > 0
    ? clamp01((towardEnd - (1 - edgeShare)) / edgeShare)
    : 1;

  return [{
    direction,
    price: bar.close,
    confidence: clamp01(0.35 + rateBonus + decisiveness * 0.15),
    payload: {
      kind: direction === "long" ? "tape_burst_up" : "tape_burst_down",
      trades: bar.ticks,
      medianTrades: Number(medianRate.toFixed(2)),
      observedRatio: Number(observedRatio.toFixed(3)),
      minRateRatio,
      rateHistory,
      closeShare: Number(closeShare.toFixed(4)),
      edgeShare,
      avgTradeSize: Number(avgTradeSize.toFixed(4)),
      medianTradeSize: Number(medianTradeSize.toFixed(4)),
      tradeSizeRatio: medianTradeSize > 0
        ? Number((avgTradeSize / medianTradeSize).toFixed(3))
        : null,
      barHigh: bar.high,
      barLow: bar.low,
      barClose: bar.close,
    },
  }];
}

/** Same median the volume gate uses, on a different column. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
