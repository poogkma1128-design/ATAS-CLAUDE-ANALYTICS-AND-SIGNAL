import { priceActionContext } from "./price_action.ts";
import type { PriceActionContext } from "./price_action.ts";
import type { BarInput, HistoryBar } from "./types.ts";

export interface CausalMarketBar extends BarInput {
  closedAt: string;
}

export interface VolatilityContract {
  version: string;
  lookbackBars: number;
  minSamples: number;
  /** Maximum close-to-close spacing allowed inside the trailing sample. */
  maxBarSpacingMs: number;
  lowPercentile: number;
  highPercentile: number;
  method: "nearest_rank";
}

export type VolatilityRegime = "low" | "normal" | "high";

export interface MarketContextResult {
  version: string;
  decisionAt: string;
  bias: "bullish" | "bearish" | "neutral" | null;
  priceAction: PriceActionContext;
  volatility: {
    regime: VolatilityRegime | null;
    trueRange: number;
    /** Median of the contiguous trailing true-range sample, excluding the decision bar. */
    medianTrueRange: number | null;
    lowThreshold: number | null;
    highThreshold: number | null;
    sampleCount: number;
    status: "complete" | "insufficient_history";
    contractVersion: string;
  };
}

function trueRange(bar: BarInput, previousClose: number | null): number {
  if (previousClose === null) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose),
  );
}

function nearestRank(sorted: number[], percentile: number): number {
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1];
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function toHistory(bar: CausalMarketBar): HistoryBar {
  return {
    openedAt: bar.openedAt,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    delta: bar.delta,
    ticks: bar.ticks,
    pocPrice: null,
  };
}

function validateContract(contract: VolatilityContract): void {
  if (!contract.version.trim()) {
    throw new Error("volatility contract version is required");
  }
  if (!Number.isInteger(contract.lookbackBars) || contract.lookbackBars < 1) {
    throw new Error("lookbackBars must be a positive integer");
  }
  if (
    !Number.isInteger(contract.minSamples) || contract.minSamples < 1 ||
    contract.minSamples > contract.lookbackBars
  ) {
    throw new Error("minSamples must be in [1, lookbackBars]");
  }
  if (!Number.isSafeInteger(contract.maxBarSpacingMs) || contract.maxBarSpacingMs < 1) {
    throw new Error("maxBarSpacingMs must be a positive integer");
  }
  if (
    !(contract.lowPercentile > 0 && contract.lowPercentile < contract.highPercentile &&
      contract.highPercentile < 1)
  ) {
    throw new Error("volatility percentiles must satisfy 0 < low < high < 1");
  }
  if (contract.method !== "nearest_rank") {
    throw new Error("unsupported percentile method");
  }
}

/**
 * Builds structural bias and a volatility regime without seeing a bar that
 * closes after the decision bar. Threshold samples exclude the decision bar.
 */
export function computeMarketContext(
  decisionBar: CausalMarketBar,
  history: CausalMarketBar[],
  contract: VolatilityContract,
): MarketContextResult {
  validateContract(contract);
  const decisionOpenedMs = Date.parse(decisionBar.openedAt);
  const decisionMs = Date.parse(decisionBar.closedAt);
  if (
    !Number.isFinite(decisionOpenedMs) || !Number.isFinite(decisionMs) ||
    decisionMs <= decisionOpenedMs
  ) {
    throw new Error("decision bar timestamps must describe a positive closed interval");
  }
  if (!decisionBar.isClosed) throw new Error("decision bar must be closed");

  const ordered = [...history].sort((a, b) =>
    Date.parse(a.closedAt) - Date.parse(b.closedAt)
  );
  for (const bar of ordered) {
    const openedMs = Date.parse(bar.openedAt);
    const closedMs = Date.parse(bar.closedAt);
    if (
      !Number.isFinite(openedMs) || !Number.isFinite(closedMs) || closedMs <= openedMs
    ) {
      throw new Error("history timestamps must describe a positive closed interval");
    }
    if (!bar.isClosed) {
      throw new Error("unclosed history supplied to causal market-context engine");
    }
    if (closedMs >= decisionMs) {
      throw new Error("future bar supplied to causal market-context engine");
    }
  }

  const priceAction = priceActionContext(decisionBar, ordered.map(toHistory));
  const bias = priceAction.bos === "bullish"
    ? "bullish"
    : priceAction.bos === "bearish"
    ? "bearish"
    : priceAction.structure === "up"
    ? "bullish"
    : priceAction.structure === "down"
    ? "bearish"
    : priceAction.structure === "range"
    ? "neutral"
    : null;

  // Walk backward from the decision bar so a feed gap resets the usable tail.
  // The first range in a tail uses its own high-low because no adjacent prior
  // close exists inside that causal sample.
  const contiguousTail: CausalMarketBar[] = [];
  let nextCloseMs = decisionMs;
  for (let index = ordered.length - 1; index >= 0; index--) {
    const bar = ordered[index];
    const closeMs = Date.parse(bar.closedAt);
    const spacingMs = nextCloseMs - closeMs;
    if (spacingMs <= 0 || spacingMs > contract.maxBarSpacingMs) break;
    contiguousTail.unshift(bar);
    nextCloseMs = closeMs;
    if (contiguousTail.length === contract.lookbackBars) break;
  }

  const samples = contiguousTail.map((bar, index) =>
    trueRange(bar, index > 0 ? contiguousTail[index - 1].close : null)
  ).sort((a, b) => a - b);
  const currentRange = trueRange(
    decisionBar,
    contiguousTail.at(-1)?.close ?? null,
  );
  const enough = samples.length >= contract.minSamples;
  const lowThreshold = enough ? nearestRank(samples, contract.lowPercentile) : null;
  const highThreshold = enough ? nearestRank(samples, contract.highPercentile) : null;
  // Equality remains normal, avoiding an arbitrary extreme regime on tied bars.
  const regime = !enough || lowThreshold === null || highThreshold === null
    ? null
    : currentRange < lowThreshold
    ? "low"
    : currentRange > highThreshold
    ? "high"
    : "normal";

  return {
    version: `market_context@2+${contract.version}`,
    decisionAt: decisionBar.closedAt,
    bias,
    priceAction,
    volatility: {
      regime,
      trueRange: currentRange,
      medianTrueRange: enough ? median(samples) : null,
      lowThreshold,
      highThreshold,
      sampleCount: samples.length,
      status: enough ? "complete" : "insufficient_history",
      contractVersion: contract.version,
    },
  };
}
