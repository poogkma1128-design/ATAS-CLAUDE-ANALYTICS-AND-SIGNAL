import type { ClusterLevel, RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num, pointOfControl } from "../util.ts";

/**
 * A hole in the bar's own volume profile that price closed on the far side of.
 *
 * POC Shift reads the level that traded the most. This reads the same profile
 * for the level that traded the least: a price the market passed through
 * without doing business at it. On its own that is only a thin print, and every
 * bar has one.
 *
 * It becomes a signal when the bar's volume sits on one side of the hole and
 * the close sits on the other. The market left the price it had been accepting,
 * crossed a gap it did not want to trade in, and stopped somewhere else. The
 * hole is then the level with nothing underneath it -- price returning into it
 * has no volume to slow it down, which is what makes it worth marking.
 *
 * The outer edge of the profile is trimmed before looking, because the top and
 * bottom of any bar are thin by construction: price only visited them for a
 * moment. Without the trim the thinnest level of a bar is almost always its own
 * extreme, which is not a hole in anything.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const maxShare = num(ctx.params, "maxShare", 0.25);
  const interiorShare = clamp01(num(ctx.params, "interiorShare", 0.8));
  const minLevels = Math.max(3, Math.round(num(ctx.params, "minLevels", 8)));

  const levels = ctx.levels;
  if (levels.length < minLevels) return [];

  const total = levels.reduce((sum, l) => sum + l.volume, 0);
  if (total <= 0) return [];
  const avgVolume = total / levels.length;

  const poc = pointOfControl(levels);
  if (!poc) return [];

  const { bar } = ctx;
  const range = bar.high - bar.low;
  if (!(range > 0)) return [];

  const margin = range * (1 - interiorShare) / 2;
  const interior = levels.filter((l) =>
    l.price >= bar.low + margin - 1e-9 && l.price <= bar.high - margin + 1e-9
  );
  if (interior.length === 0) return [];

  const lvn = thinnest(interior);
  if (lvn.volume > avgVolume * maxShare + 1e-9) return [];

  // Volume on one side of the hole, the close on the other. Anything else --
  // the close still inside the hole, or on the same side as the volume -- is a
  // bar that never left, and there is nothing to say about it yet.
  let direction: "long" | "short";
  if (poc.price < lvn.price - 1e-9 && bar.close > lvn.price + 1e-9) {
    direction = "long";
  } else if (poc.price > lvn.price + 1e-9 && bar.close < lvn.price - 1e-9) {
    direction = "short";
  } else {
    return [];
  }

  const observedShare = lvn.volume / avgVolume;
  const emptiness = maxShare > 0 ? clamp01(1 - observedShare / maxShare) : 0;
  const distanceShare = clamp01(Math.abs(bar.close - lvn.price) / range);

  return [{
    direction,
    price: bar.close,
    confidence: clamp01(0.35 + emptiness * 0.25 + distanceShare * 0.25),
    payload: {
      kind: direction === "long" ? "lvn_break_up" : "lvn_break_down",
      level: summarise(lvn),
      poc: { price: poc.price, volume: poc.volume },
      avgLevelVolume: Number(avgVolume.toFixed(2)),
      observedShare: Number(observedShare.toFixed(4)),
      maxShare,
      interiorShare,
      levelsInProfile: levels.length,
      levelsConsidered: interior.length,
      closeDistanceShare: Number(distanceShare.toFixed(4)),
      barClose: bar.close,
    },
  }];
}

function thinnest(levels: ClusterLevel[]): ClusterLevel {
  let best = levels[0];
  for (const level of levels) {
    if (level.volume < best.volume) best = level;
  }
  return best;
}

function summarise(level: ClusterLevel) {
  return {
    price: level.price,
    ask: level.ask,
    bid: level.bid,
    volume: level.volume,
    delta: Number((level.ask - level.bid).toFixed(2)),
  };
}
