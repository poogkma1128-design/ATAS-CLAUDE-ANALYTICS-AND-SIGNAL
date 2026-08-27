import type { RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num, pointOfControl } from "../util.ts";

/**
 * The point of control migrating in one direction, bar after bar.
 *
 * The POC is where the market spent the most volume, so a POC that keeps
 * stepping up is the zone of accepted price moving up with it. Every step must
 * agree in direction — one bar that pulls the POC back the other way cancels
 * the run, which is what keeps chop from registering as a trend.
 *
 * hvnShare marks the case where a single level took a large share of the whole
 * bar's volume. That is a high volume node, and it raises confidence.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const minTicks = num(ctx.params, "minTicks", 3);
  const consecutive = Math.max(1, Math.round(num(ctx.params, "consecutive", 2)));
  const hvnShare = num(ctx.params, "hvnShare", 0.25);

  const poc = pointOfControl(ctx.levels);
  if (!poc) return [];

  // Need `consecutive` prior POCs to measure `consecutive` steps.
  const priorPocs = ctx.history
    .slice(-consecutive)
    .map((b) => b.pocPrice);
  if (priorPocs.length < consecutive || priorPocs.some((p) => p === null)) {
    return [];
  }

  const chain = [...(priorPocs as number[]), poc.price];

  let direction: "long" | "short" | null = null;
  for (let i = 1; i < chain.length; i++) {
    const step = chain[i] - chain[i - 1];
    if (step > 0) {
      if (direction === "short") return [];
      direction = "long";
    } else if (step < 0) {
      if (direction === "long") return [];
      direction = "short";
    } else {
      // A flat step is not a shift.
      return [];
    }
  }
  if (!direction) return [];

  const totalShiftTicks = Math.abs(chain[chain.length - 1] - chain[0]) /
    ctx.tickSize;
  if (totalShiftTicks < minTicks - 1e-9) return [];

  const share = ctx.bar.volume > 0 ? poc.volume / ctx.bar.volume : 0;
  const isHvn = share >= hvnShare;

  const shiftBonus = minTicks > 0
    ? Math.min(totalShiftTicks / minTicks - 1, 2) * 0.2
    : 0;
  const confidence = clamp01(0.35 + shiftBonus + (isHvn ? 0.15 : 0));

  return [{
    direction,
    price: ctx.bar.close,
    confidence,
    payload: {
      kind: "poc_shift",
      pocChain: chain,
      totalShiftTicks: Number(totalShiftTicks.toFixed(2)),
      minTicks,
      consecutive,
      poc: { price: poc.price, volume: poc.volume },
      pocVolumeShare: Number(share.toFixed(4)),
      hvnShare,
      isHvn,
    },
  }];
}
