import type { PriceActionContext } from "./price_action.ts";
import type { RuleContext, RuleSignal } from "./types.ts";

/**
 * Confidence v2 deliberately starts as a data product, not a second guessed
 * percentage. The old `signals.confidence` is a hand-written measure of how
 * far a setup exceeded its rule threshold; HANDOFF 5.19 established that it
 * does not predict realised R. Re-labelling another hand-written formula as a
 * probability would repeat that error.
 *
 * Every newly fired signal therefore gets a frozen, signal-time feature record
 * under `signals.payload.confidenceV2`. It is sufficient to train and audit a
 * later calibrated model, but contains neither an outcome nor any future bar.
 * The dashboard calls this "Shadow" and never uses it to filter or announce.
 */
export const CONFIDENCE_V2_MODEL_VERSION = "v2-shadow-1";
export const CONFIDENCE_V2_TARGET = "positive_r_after_horizon";

type FeatureValue = number | string | boolean | null;

export interface ConfidenceV2Snapshot {
  modelVersion: typeof CONFIDENCE_V2_MODEL_VERSION;
  mode: "shadow";
  target: typeof CONFIDENCE_V2_TARGET;
  score: null;
  scoreReason: "no_calibrated_model";
  features: {
    shared: Record<string, FeatureValue>;
    rule: Record<string, FeatureValue>;
  };
}

/**
 * The rule payload already records the evidence used to fire. This explicit,
 * whitelisted subset is the stable feature contract for v2; a later model
 * cannot silently begin training on prose, a new payload field, or an outcome.
 */
const RULE_FEATURE_PATHS: Record<string, string[]> = {
  absorption: ["observedMultiple", "rejectionTicks", "level.delta"],
  stacked_imbalance: ["stackLength", "avgRatio"],
  delta_divergence: ["delta", "minDelta", "maxDelta"],
  poc_shift: ["totalShiftTicks", "pocVolumeShare", "isHvn"],
  delta_flip: ["delta", "minDelta", "maxDelta", "level.ageBars", "levelDistanceShare"],
  lvn: ["observedShare", "closeDistanceShare", "levelsInProfile"],
  naked_poc: ["level.ageBars", "closedBackShare", "nakedInWindow", "reachedThisBar"],
  speed_of_tape: ["observedRatio", "closeShare", "tradeSizeRatio", "trades"],
};

/**
 * Captures only what was knowable when the signal fired. `history` excludes
 * the signal bar by construction, which prevents accidental look-ahead.
 */
export function collectConfidenceV2(
  ruleKey: string,
  ctx: Pick<RuleContext, "bar" | "history">,
  signal: Pick<RuleSignal, "confidence" | "payload">,
  priceAction: PriceActionContext,
): ConfidenceV2Snapshot {
  const range = ctx.bar.high - ctx.bar.low;
  const volumeMedian = median(ctx.history.map((bar) => bar.volume));
  const tickMedian = median(ctx.history.map((bar) => bar.ticks));
  const rangeMedian = median(ctx.history.map((bar) => bar.high - bar.low));

  const shared: Record<string, FeatureValue> = {
    // Kept as a named legacy feature so v2 can prove independently whether
    // the previous score adds anything. It is not presented as a v2 score.
    legacyScore: finite(signal.confidence),
    barRange: finite(range),
    bodyShare: range > 0 ? rounded((ctx.bar.close - ctx.bar.open) / range) : null,
    closeLocation: range > 0 ? rounded((ctx.bar.close - ctx.bar.low) / range) : null,
    volume: finite(ctx.bar.volume),
    volumeRatioToHistoryMedian: ratio(ctx.bar.volume, volumeMedian),
    ticks: finite(ctx.bar.ticks),
    tickRatioToHistoryMedian: ratio(ctx.bar.ticks, tickMedian),
    rangeRatioToHistoryMedian: ratio(range, rangeMedian),
    delta: finite(ctx.bar.delta),
    absoluteDelta: finite(Math.abs(ctx.bar.delta)),
    historyBars: ctx.history.length,
    priceActionSweep: stringOrNull(priceAction.sweep),
    priceActionZone: stringOrNull(priceAction.zone),
    priceActionStructure: stringOrNull(priceAction.structure),
  };

  const rule: Record<string, FeatureValue> = {};
  for (const path of RULE_FEATURE_PATHS[ruleKey] ?? []) {
    rule[path] = featureValue(atPath(signal.payload, path));
  }

  return {
    modelVersion: CONFIDENCE_V2_MODEL_VERSION,
    mode: "shadow",
    target: CONFIDENCE_V2_TARGET,
    score: null,
    scoreReason: "no_calibrated_model",
    features: { shared, rule },
  };
}

function atPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function featureValue(value: unknown): FeatureValue {
  if (typeof value === "number") return finite(value);
  if (typeof value === "string" || typeof value === "boolean") return value;
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finite(value: number): number | null {
  return Number.isFinite(value) ? rounded(value) : null;
}

function ratio(numerator: number, denominator: number | null): number | null {
  return denominator && denominator > 0 ? rounded(numerator / denominator) : null;
}

function median(values: number[]): number | null {
  const finiteValues = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finiteValues.length === 0) return null;
  const middle = finiteValues.length >> 1;
  return finiteValues.length % 2 === 0
    ? (finiteValues[middle - 1] + finiteValues[middle]) / 2
    : finiteValues[middle];
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}
