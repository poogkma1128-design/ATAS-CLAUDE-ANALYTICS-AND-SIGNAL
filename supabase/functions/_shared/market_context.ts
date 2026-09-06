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

  const ranges = ordered.map((bar, index) =>
    trueRange(bar, index > 0 ? ordered[index - 1].close : null)
  );
  const samples = ranges.slice(-contract.lookbackBars).sort((a, b) => a - b);
  const currentRange = trueRange(decisionBar, ordered.at(-1)?.close ?? null);
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
    version: `market_context@1+${contract.version}`,
    decisionAt: decisionBar.closedAt,
    bias,
    priceAction,
    volatility: {
      regime,
      trueRange: currentRange,
      lowThreshold,
      highThreshold,
      sampleCount: samples.length,
      status: enough ? "complete" : "insufficient_history",
      contractVersion: contract.version,
    },
  };
}
