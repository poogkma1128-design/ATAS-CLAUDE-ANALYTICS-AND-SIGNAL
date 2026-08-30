import type { BarInput, HistoryBar, RuleSignal } from "./types.ts";
import { num } from "./util.ts";

/**
 * A signal that only says "long here" is not actionable and, worse, is not
 * scoreable: two people acting on it would exit at different places and get
 * different answers about whether the setup works. Every signal therefore
 * carries the whole trade with it — where to get in, where it is wrong, where
 * it is done, when the stop starts following, and how long to give it.
 *
 * Every level is derived from the signal bar itself rather than from a fixed
 * tick distance, because the bar is where the setup's invalidation actually
 * lives: the trade is wrong exactly when price trades back through the bar
 * that produced it.
 */
export interface TradePlan {
  /** Bar close, which is the first price actually obtainable after the bar
   *  closes and the rule can be evaluated. */
  entry: number;
  stop: number;
  target: number;
  riskTicks: number;
  rewardTicks: number;
  /** Favourable ticks before the stop starts following price. */
  trailTriggerTicks: number;
  /** How far behind the best price the trail then sits. */
  trailOffsetTicks: number;
  /** Bars to give the trade before it is closed at the market. */
  holdBars: number;
}

export function buildPlan(
  direction: RuleSignal["direction"],
  bar: BarInput,
  tickSize: number,
  params: Record<string, unknown>,
  holdBars: number,
  /** Preceding closed bars, oldest first. Sets the volatility floor below. */
  history: HistoryBar[] = [],
): TradePlan {
  const bufferTicks = Math.max(0, num(params, "bufferTicks", 2));
  const minRiskTicks = Math.max(1, num(params, "minRiskTicks", 4));
  const rewardRatio = Math.max(0.1, num(params, "rewardRatio", 2));
  const trailAfterR = Math.max(0, num(params, "trailAfterR", 1));
  const trailOffsetR = Math.max(0.1, num(params, "trailOffsetR", 0.5));

  const long = direction === "long";

  // The far side of the signal bar, plus room for the wick that would take out
  // a stop sitting exactly on it.
  const anchor = long ? bar.low : bar.high;

  // Entering on a retracement rather than at the close.
  //
  // Expressed as a share of the distance from the close back to that anchor, so
  // it scales with the bar that produced the signal instead of being a fixed
  // number of ticks that means something different on every instrument — the
  // mistake minRiskTicks already made once (see volatilityFloorTicks below).
  //
  // 0 is off and is the default, deliberately: this changes where a trade is
  // entered, so it cannot be turned on from /rules alone. The live scorer,
  // evaluate_pending_outcomes(), assumes every plan is filled on its signal
  // bar; a pullback that never traded back would be scored as though it had.
  // Measuring it needs the backtest, which models the fill and counts the
  // trades that never happen.
  const pullbackShare = Math.min(0.9, Math.max(0, num(params, "pullbackShare", 0)));
  const entry = bar.close - (bar.close - anchor) * pullbackShare;

  const anchorTicks = Math.abs(entry - anchor) / tickSize;

  // A bar that closes on its own extreme would otherwise leave no risk at all,
  // which would make the reward distance zero too.
  const riskTicks = Math.max(
    anchorTicks + bufferTicks,
    minRiskTicks,
    volatilityFloorTicks(history, tickSize, params),
  );
  const rewardTicks = riskTicks * rewardRatio;

  const sign = long ? 1 : -1;

  return {
    entry: toTick(entry, tickSize),
    stop: toTick(entry - sign * riskTicks * tickSize, tickSize),
    target: toTick(entry + sign * rewardTicks * tickSize, tickSize),
    riskTicks: round2(riskTicks),
    rewardTicks: round2(rewardTicks),
    trailTriggerTicks: round2(riskTicks * trailAfterR),
    trailOffsetTicks: round2(riskTicks * trailOffsetR),
    holdBars,
  };
}

/** Prices only exist on the tick grid; an off-grid stop cannot be worked. */
function toTick(price: number, tickSize: number): number {
  const steps = Math.round(price / tickSize);
  // Multiplying back reintroduces binary float error (100.75000000000001), so
  // the result is trimmed to the precision the tick size itself implies.
  return Number((steps * tickSize).toFixed(decimalsOf(tickSize)));
}

function decimalsOf(tickSize: number): number {
  const text = String(tickSize);
  if (text.includes("e") || text.includes("E")) return 8;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(8, text.length - dot - 1);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The smallest risk that still means anything on this instrument, expressed as
 * a share of what a bar here normally covers.
 *
 * `minRiskTicks` alone cannot do this job. It counts footprint rows, and a row
 * is not a fixed amount of market: one MNQ row is 0.75, one BTCUSDT row is
 * 0.30, and the same floor of 4 rows is 20% of a typical MNQ bar but 5% of a
 * typical BTCUSDT one. That produced real signals like
 * `entry 77576.40 · stop 77575.20 · target 77578.80` — a trade risking 0.0015%
 * of price, which ends on the spread rather than on the setup being wrong.
 *
 * A stop inside the noise is not a tighter trade, it is a coin flip, and the
 * recorded outcomes say so. Grouping every resolved signal by the risk its plan
 * took against the median range of the 20 bars before it:
 *
 *                    MNQU6                    BTCUSDT
 *     < 0.30x    12 trades  17% win  -6.00R   17 trades  29% win  -2.00R
 *     0.30-0.60x 30 trades  37% win  -3.08R   15 trades  53% win  +4.75R
 *     0.60-1.00x 28 trades  46% win  -0.02R   20 trades  45% win  -0.67R
 *     >= 1.00x   58 trades  55% win +10.86R   36 trades  61% win +13.15R
 *
 * The worst bucket on both instruments is the same one, and it is the bucket
 * this floor removes — by widening those trades, not by dropping them: the
 * setup was found, only the room it was given was wrong.
 *
 * Re-walking all 216 resolved signals bar by bar under a floored plan, the
 * settings either side of 0.30 agree, which is what says the number is a real
 * effect and not a fit:
 *
 *     share   lifted   total R   MNQU6    BTCUSDT
 *     0.00     0       +13.17    +1.77    +11.41   (today)
 *     0.20    18       +19.24    +4.82    +14.41
 *     0.25    24       +19.22    +4.88    +14.34
 *     0.30    29       +19.27    +4.81    +14.46
 *     0.40    47       +16.56    +3.68    +12.88
 *     0.60    74       +24.28   +13.57    +10.71
 *
 * 0.30 sits mid-plateau, improves both instruments, and touches 29 of 216
 * trades — it is a floor for the degenerate cases, not a new sizing rule.
 * The 0.55-0.65 region scores higher but does so almost entirely on MNQU6
 * while resizing a third of all trades, on one session of it. That is worth
 * re-measuring on more data, not adopting from this much.
 */
function volatilityFloorTicks(
  history: HistoryBar[],
  tickSize: number,
  params: Record<string, unknown>,
): number {
  const share = num(params, "minRiskRangeShare", 0);
  if (share <= 0 || tickSize <= 0) return 0;

  const window = Math.max(1, Math.round(num(params, "minRiskRangeBars", 20)));
  const ranges = history
    .slice(-window)
    .map((bar) => bar.high - bar.low)
    .filter((range) => range > 0);

  // A median of three bars does not describe what normal looks like here, so
  // the plan falls back to `minRiskTicks` rather than floor against a guess.
  // The signal bar itself is never in `history`, and should not be: it is
  // often an outsized bar, and it would raise the floor on its own account.
  if (ranges.length < window) return 0;

  return (medianOf(ranges) * share) / tickSize;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
