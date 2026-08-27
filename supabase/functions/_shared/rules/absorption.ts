import type { ClusterLevel, RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num } from "../util.ts";

/**
 * Aggression at the extreme that went nowhere.
 *
 * At the high of a bar: an unusually heavy level, traded mostly at the ask
 * (buyers paying up), yet the bar closes back down off that high. Those buyers
 * were filled by someone willing to sell everything they wanted — the move
 * failed at the point of maximum effort. That is a short.
 *
 * The requirement that the heavy level be ask-dominated is what separates
 * absorption from an ordinary high-volume node sitting near the extreme.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const volumeMultiple = num(ctx.params, "volumeMultiple", 3);
  const edgeTicks = Math.max(0, Math.round(num(ctx.params, "edgeTicks", 2)));
  const rejectionTicks = num(ctx.params, "rejectionTicks", 2);

  const levels = ctx.levels;
  if (levels.length === 0) return [];

  const avgVolume = levels.reduce((sum, l) => sum + l.volume, 0) / levels.length;
  if (avgVolume <= 0) return [];

  const { bar, tickSize } = ctx;
  const edge = edgeTicks * tickSize;
  const rejection = rejectionTicks * tickSize;
  const signals: RuleSignal[] = [];

  // Buyers absorbed at the high.
  const topLevels = levels.filter((l) => l.price >= bar.high - edge - 1e-9);
  const absorbedHigh = heaviestQualifying(
    topLevels,
    avgVolume,
    volumeMultiple,
    (l) => l.ask > l.bid,
  );
  if (absorbedHigh && bar.high - bar.close >= rejection - 1e-9) {
    signals.push({
      direction: "short",
      price: bar.close,
      confidence: confidence(
        absorbedHigh.volume / avgVolume,
        volumeMultiple,
        (bar.high - bar.close) / tickSize,
        rejectionTicks,
      ),
      payload: {
        kind: "absorption_at_high",
        level: summarise(absorbedHigh),
        avgLevelVolume: Number(avgVolume.toFixed(2)),
        volumeMultiple,
        observedMultiple: Number((absorbedHigh.volume / avgVolume).toFixed(2)),
        rejectionTicks: Number(((bar.high - bar.close) / tickSize).toFixed(2)),
        requiredRejectionTicks: rejectionTicks,
        barHigh: bar.high,
        barClose: bar.close,
      },
    });
  }

  // Sellers absorbed at the low.
  const bottomLevels = levels.filter((l) => l.price <= bar.low + edge + 1e-9);
  const absorbedLow = heaviestQualifying(
    bottomLevels,
    avgVolume,
    volumeMultiple,
    (l) => l.bid > l.ask,
  );
  if (absorbedLow && bar.close - bar.low >= rejection - 1e-9) {
    signals.push({
      direction: "long",
      price: bar.close,
      confidence: confidence(
        absorbedLow.volume / avgVolume,
        volumeMultiple,
        (bar.close - bar.low) / tickSize,
        rejectionTicks,
      ),
      payload: {
        kind: "absorption_at_low",
        level: summarise(absorbedLow),
        avgLevelVolume: Number(avgVolume.toFixed(2)),
        volumeMultiple,
        observedMultiple: Number((absorbedLow.volume / avgVolume).toFixed(2)),
        rejectionTicks: Number(((bar.close - bar.low) / tickSize).toFixed(2)),
        requiredRejectionTicks: rejectionTicks,
        barLow: bar.low,
        barClose: bar.close,
      },
    });
  }

  return signals;
}

function heaviestQualifying(
  levels: ClusterLevel[],
  avgVolume: number,
  volumeMultiple: number,
  sideCheck: (l: ClusterLevel) => boolean,
): ClusterLevel | null {
  let best: ClusterLevel | null = null;
  for (const level of levels) {
    if (level.volume < avgVolume * volumeMultiple) continue;
    if (!sideCheck(level)) continue;
    if (best === null || level.volume > best.volume) best = level;
  }
  return best;
}

function confidence(
  observedMultiple: number,
  requiredMultiple: number,
  observedRejection: number,
  requiredRejection: number,
): number {
  const volumeBonus = requiredMultiple > 0
    ? Math.min(observedMultiple / requiredMultiple - 1, 2) * 0.2
    : 0;
  const rejectionBonus = requiredRejection > 0
    ? Math.min(observedRejection / requiredRejection - 1, 2) * 0.15
    : 0;
  return clamp01(0.4 + volumeBonus + rejectionBonus);
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
