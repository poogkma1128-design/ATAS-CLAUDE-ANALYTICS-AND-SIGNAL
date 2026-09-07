import type {
  BarInput,
  ClusterLevel,
  HistoryBar,
  RuleContext,
  RuleSignal,
} from "../types.ts";
import {
  type CausalMarketBar,
  computeMarketContext,
  type VolatilityContract,
} from "../market_context.ts";
import { type CausalLevelBar, computeKeyLevels } from "../key_levels.ts";
import { stampSession } from "../market_sessions.ts";
import { num } from "../util.ts";
import type {
  FailedBreakAnchor,
  FailedBreakDecisionBar,
  FailedBreakDirection,
  FailedBreakTriggerEvidence,
  FailedBreakTriggerKind,
} from "../strategy/failed_break.ts";
import { SESSION_DEFINITION } from "./mnq_pullback_v1.ts";
import { evaluate as absorption } from "./absorption.ts";
import { evaluate as deltaDivergence } from "./delta_divergence.ts";
import { evaluate as stackedImbalance } from "./stacked_imbalance.ts";

const FIVE_MINUTES_MS = 5 * 60_000;
export const MAX_STRATEGY_SPACING_MS = 6 * 60_000;
const MIN_PREVIOUS_DAY_BARS = 70;

const VOLATILITY_CONTRACT: VolatilityContract = {
  version: "named-level-failed-break-volatility-1",
  lookbackBars: 50,
  minSamples: 20,
  maxBarSpacingMs: MAX_STRATEGY_SPACING_MS,
  lowPercentile: 0.25,
  highPercentile: 0.75,
  method: "nearest_rank",
};

export interface FailedBreakDecisionOptions {
  attemptWindowBars: number;
  attemptDistance: number;
  triggerKinds: Exclude<FailedBreakTriggerKind, "return_only">[];
  marketTickSize?: number;
}

export interface FailedBreakDecisionContext {
  decision: FailedBreakDecisionBar;
  bias: "bullish" | "bearish" | "neutral" | null;
  tradingDay: string;
  sessionDefinitionVersion: string;
  marketTickSize: number;
}

/** Build the P-A/S-A previous-day failed-break decision using only causal bars. */
export function buildFailedBreakDecision(
  ctx: RuleContext,
  options: FailedBreakDecisionOptions,
): FailedBreakDecisionContext {
  const history = ctx.strategyHistory ?? ctx.history;
  const causalHistory = contiguousTail(history, ctx.bar.openedAt, 50).map(toMarketBar);
  const market = computeMarketContext(
    toMarketBar(ctx.bar),
    causalHistory,
    VOLATILITY_CONTRACT,
  );
  const session = stampSession(ctx.bar.openedAt, SESSION_DEFINITION);
  const levelBars = [...history.map(toLevelBar), toLevelBar(ctx.bar)];
  const levels = computeKeyLevels(
    levelBars,
    closeTime(ctx.bar.openedAt),
    session.tradingDay,
    {
      profileSessionTag: "__not_used_in_prev_day_path__",
      initialBalanceTag: "__not_used_in_prev_day_path__",
    },
  );
  const priorBars = levels.diagnostics.previousTradingDay === null
    ? 0
    : levelBars.filter((bar) => bar.tradingDay === levels.diagnostics.previousTradingDay)
      .length;
  const complete = priorBars >= MIN_PREVIOUS_DAY_BARS;
  const mtr = market.volatility.medianTrueRange;
  const attemptBars = [...history, asHistory(ctx.bar)]
    .filter((bar) =>
      stampSession(bar.openedAt, SESSION_DEFINITION).tradingDay === session.tradingDay
    )
    .slice(-options.attemptWindowBars);

  const anchors: FailedBreakAnchor[] = [
    attemptAnchor(
      "prev_day_low",
      complete ? levels.previousDayLow : null,
      "previous_day_completeness",
      "long",
      ctx.bar.close,
      attemptBars,
      mtr,
      options.attemptDistance,
    ),
    attemptAnchor(
      "prev_day_high",
      complete ? levels.previousDayHigh : null,
      "previous_day_completeness",
      "short",
      ctx.bar.close,
      attemptBars,
      mtr,
      options.attemptDistance,
    ),
  ];

  const marketTickSize = options.marketTickSize ?? ctx.tickSize;
  const triggerCtx = { ...ctx, tickSize: marketTickSize };
  const footprintAvailable = reconcilesFootprint(ctx.bar, ctx.levels);
  const detector = new Map<
    FailedBreakTriggerKind,
    { available: boolean; signals: RuleSignal[] }
  >([
    ["absorption", {
      available: footprintAvailable,
      signals: footprintAvailable ? absorption(triggerCtx) : [],
    }],
    ["stacked_imbalance", {
      available: footprintAvailable,
      signals: footprintAvailable ? stackedImbalance(triggerCtx) : [],
    }],
    [
      "delta_divergence",
      {
        available:
          ctx.history.length >= Math.max(1, Math.round(num(ctx.params, "lookback", 5))),
        signals: deltaDivergence(triggerCtx),
      },
    ],
  ]);
  const triggers: FailedBreakTriggerEvidence[] = options.triggerKinds.map((kind) => {
    const value = detector.get(kind)!;
    return {
      kind,
      available: value.available,
      direction: oneDirection(value.signals),
    };
  });

  return {
    decision: {
      openedAt: ctx.bar.openedAt,
      isClosed: ctx.bar.isClosed,
      close: ctx.bar.close,
      medianTrueRange: mtr,
      anchors,
      triggers,
    },
    bias: market.bias,
    tradingDay: session.tradingDay,
    sessionDefinitionVersion: session.definitionVersion,
    marketTickSize,
  };
}

function attemptAnchor(
  identity: string,
  price: number | null,
  requires: string,
  direction: FailedBreakDirection,
  close: number,
  bars: HistoryBar[],
  mtr: number | null,
  distance: number,
): FailedBreakAnchor {
  if (price === null || mtr === null) {
    return { identity, price, requires, eligibleDirection: null };
  }
  const threshold = distance * mtr;
  const attempted = direction === "long"
    ? bars.some((bar) => bar.low <= price - threshold)
    : bars.some((bar) => bar.high >= price + threshold);
  const returned = direction === "long" ? close > price : close < price;
  return {
    identity,
    price,
    requires,
    eligibleDirection: attempted && returned ? direction : null,
  };
}

function oneDirection(signals: RuleSignal[]): FailedBreakDirection | null {
  const directions = [...new Set(signals.map((signal) => signal.direction))];
  return directions.length === 1 ? directions[0] : null;
}

function closeTime(openedAt: string): string {
  const openedMs = Date.parse(openedAt);
  if (!Number.isFinite(openedMs)) throw new Error("failed break: invalid openedAt");
  return new Date(openedMs + FIVE_MINUTES_MS).toISOString();
}

function contiguousTail(
  history: HistoryBar[],
  decisionOpenedAt: string,
  limit: number,
): HistoryBar[] {
  const tail: HistoryBar[] = [];
  let nextOpenedMs = Date.parse(decisionOpenedAt);
  for (let index = history.length - 1; index >= 0 && tail.length < limit; index--) {
    const openedMs = Date.parse(history[index].openedAt);
    const spacing = nextOpenedMs - openedMs;
    if (spacing <= 0 || spacing > MAX_STRATEGY_SPACING_MS) break;
    tail.unshift(history[index]);
    nextOpenedMs = openedMs;
  }
  return tail;
}

function toMarketBar(bar: HistoryBar | BarInput): CausalMarketBar {
  const current = "levels" in bar;
  return {
    openedAt: bar.openedAt,
    closedAt: closeTime(bar.openedAt),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    askVolume: current ? bar.askVolume : 0,
    bidVolume: current ? bar.bidVolume : 0,
    delta: bar.delta,
    minDelta: current ? bar.minDelta : 0,
    maxDelta: current ? bar.maxDelta : 0,
    ticks: bar.ticks,
    trades: current ? bar.trades : 0,
    isClosed: current ? bar.isClosed : true,
    levels: current ? bar.levels : [],
  };
}

function toLevelBar(bar: HistoryBar | BarInput): CausalLevelBar {
  const current = "levels" in bar;
  const session = stampSession(bar.openedAt, SESSION_DEFINITION);
  return {
    openedAt: bar.openedAt,
    closedAt: closeTime(bar.openedAt),
    isClosed: current ? bar.isClosed : true,
    high: bar.high,
    low: bar.low,
    ticks: bar.ticks,
    tradingDay: session.tradingDay,
    sessionTags: session.sessionTags,
    levels: current ? bar.levels : null,
  };
}

function asHistory(bar: BarInput): HistoryBar {
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

function reconcilesFootprint(bar: BarInput, levels: ClusterLevel[]): boolean {
  if (levels.length === 0) return false;
  if (
    levels.some((level) =>
      !Number.isFinite(level.price) || level.price < bar.low || level.price > bar.high ||
      !Number.isFinite(level.ask) || level.ask < 0 ||
      !Number.isFinite(level.bid) || level.bid < 0 ||
      !Number.isSafeInteger(level.ticks) || level.ticks < 0
    )
  ) return false;
  return Number.isSafeInteger(bar.ticks) && bar.ticks >= 0 &&
    levels.reduce((sum, level) => sum + level.ticks, 0) === bar.ticks;
}
