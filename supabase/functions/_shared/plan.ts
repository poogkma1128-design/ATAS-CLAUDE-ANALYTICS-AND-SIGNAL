import type { BarInput, RuleSignal } from "./types.ts";
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
): TradePlan {
  const bufferTicks = Math.max(0, num(params, "bufferTicks", 2));
  const minRiskTicks = Math.max(1, num(params, "minRiskTicks", 4));
  const rewardRatio = Math.max(0.1, num(params, "rewardRatio", 2));
  const trailAfterR = Math.max(0, num(params, "trailAfterR", 1));
  const trailOffsetR = Math.max(0.1, num(params, "trailOffsetR", 0.5));

  const long = direction === "long";
  const entry = bar.close;

  // The far side of the signal bar, plus room for the wick that would take out
  // a stop sitting exactly on it.
  const anchor = long ? bar.low : bar.high;
  const anchorTicks = Math.abs(entry - anchor) / tickSize;

  // A bar that closes on its own extreme would otherwise leave no risk at all,
  // which would make the reward distance zero too.
  const riskTicks = Math.max(anchorTicks + bufferTicks, minRiskTicks);
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
