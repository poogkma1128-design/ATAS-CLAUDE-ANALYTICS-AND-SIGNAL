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
import { type SessionDefinition, stampSession } from "../market_sessions.ts";
import {
  evaluatePullback,
  type PullbackContract,
  type PullbackDecisionBar,
  type PullbackDirection,
  type TriggerEvidence,
  type TriggerKind,
} from "../strategy/pullback.ts";
import { evaluate as deltaFlip } from "./delta_flip.ts";
import { evaluate as stackedImbalance } from "./stacked_imbalance.ts";

/**
 * First production-capable slice of MNQ_PULLBACK_V1.
 *
 * It deliberately emits only when the named-level touch and the order-flow
 * trigger occur on the same closed bar. Multi-bar setup state needs durable
 * decision rows; pretending an edge-function process can remember them would
 * lose state on every cold start. The full six-bar evaluator remains the
 * canonical contract and this adapter labels the narrower execution scope in
 * every payload.
 */

export const RULE_KEY = "mnq_pullback_v1";
export const CONTRACT_VERSION = "MNQ_PULLBACK_V1@live-preview-1";

const FIVE_MINUTES_MS = 5 * 60_000;
const MAX_SPACING_MS = 6 * 60_000;
const MIN_PREVIOUS_DAY_BARS = 70;

/** Provisional owner-risk override: CME equity futures roll at 17:00 Chicago. */
export const SESSION_DEFINITION: SessionDefinition = {
  version: "cme-equity-globex-provisional-2026-09-07",
  tradingDayTimeZone: "America/Chicago",
  tradingDayRolloverMinute: 17 * 60,
  windows: [],
};

const VOLATILITY_CONTRACT: VolatilityContract = {
  version: "mnq-pullback-volatility-1",
  lookbackBars: 50,
  minSamples: 20,
  maxBarSpacingMs: MAX_SPACING_MS,
  lowPercentile: 0.25,
  highPercentile: 0.75,
  method: "nearest_rank",
};

const PULLBACK_CONTRACT: PullbackContract = {
  version: CONTRACT_VERSION,
  zoneProximity: 0.5,
  invalidationDistance: 0.75,
  setupMaxAgeBars: 6,
  maxBarSpacingMs: MAX_SPACING_MS,
  anchorIdentities: ["prev_day_low", "prev_day_high"],
  triggerKinds: ["delta_flip", "stacked_imbalance"],
};

export function evaluate(ctx: RuleContext): RuleSignal[] {
  if (ctx.symbol !== "MNQU6" || ctx.timeframe !== "5m") return [];

  const history = ctx.strategyHistory ?? ctx.history;
  const decision = buildDecision(ctx, history);
  const result = evaluatePullback([decision], PULLBACK_CONTRACT);
  const triggered = result.opportunities.filter((opportunity) =>
    opportunity.outcome.kind === "triggered"
  );
  if (triggered.length === 0) return [];

  // Both prior-day levels may be touched by a very wide bar. One rule and one
  // direction may create only one signal per bar, so the closest anchor wins;
  // ties use the lexical identity for deterministic replay.
  const extreme = decision.bias === "bullish" ? decision.low : decision.high;
  const chosen = [...triggered].sort((left, right) => {
    const distance = Math.abs(left.anchorPrice - extreme) -
      Math.abs(right.anchorPrice - extreme);
    return Math.abs(distance) > 1e-9
      ? distance
      : left.anchorIdentity.localeCompare(right.anchorIdentity);
  })[0];
  const outcome = chosen.outcome;
  if (outcome.kind !== "triggered") return [];

  const session = stampSession(ctx.bar.openedAt, SESSION_DEFINITION);
  return [{
    direction: chosen.direction,
    price: ctx.bar.close,
    // Boolean-first: the storage column is non-nullable, but this value is not
    // a probability or ranking. The payload carries the canonical null score.
    confidence: 0,
    payload: {
      kind: "mnq_pullback_named_level",
      strategyKey: "MNQ_PULLBACK_V1",
      contractVersion: CONTRACT_VERSION,
      executionScope: "touch_bar_only",
      score: null,
      anchor: {
        identity: chosen.anchorIdentity,
        price: chosen.anchorPrice,
        touchId: chosen.anchorTouchId,
      },
      trigger: outcome.trigger,
      bias: decision.bias,
      medianTrueRange: decision.medianTrueRange,
      sessionDefinitionVersion: session.definitionVersion,
      tradingDay: session.tradingDay,
      sessionTags: session.sessionTags,
      riskNotice: "owner-approved live preview while backtest runs; unvalidated",
    },
  }];
}

export function buildDecision(
  ctx: RuleContext,
  history: HistoryBar[],
): PullbackDecisionBar {
  const closedAt = closeTime(ctx.bar.openedAt);
  const causalHistory = contiguousTail(history, ctx.bar.openedAt, 50).map(toMarketBar);
  const market = computeMarketContext(
    toMarketBar(ctx.bar),
    causalHistory,
    VOLATILITY_CONTRACT,
  );

  const levelBars = [...history.map(toLevelBar), toLevelBar(ctx.bar)];
  const session = stampSession(ctx.bar.openedAt, SESSION_DEFINITION);
  const levels = computeKeyLevels(levelBars, closedAt, session.tradingDay, {
    // P-A uses bar extrema only. A deliberately absent tag keeps profile data
    // out of this version rather than silently binding it to a session guess.
    profileSessionTag: "__not_used_in_p_a__",
    initialBalanceTag: "__not_used_in_p_a__",
  });
  const priorBars = levels.diagnostics.previousTradingDay === null
    ? 0
    : levelBars.filter((bar) => bar.tradingDay === levels.diagnostics.previousTradingDay)
      .length;
  const priorDayComplete = priorBars >= MIN_PREVIOUS_DAY_BARS;

  const expectedDirection = market.bias === "bullish"
    ? "long"
    : market.bias === "bearish"
    ? "short"
    : null;
  const footprintAvailable = reconcilesFootprint(ctx.bar, ctx.levels);
  const deltaAvailable = ctx.history.length >= 3 &&
    ctx.history.slice(-20).some((bar) => bar.pocPrice !== null);
  const flipSignals = deltaAvailable ? deltaFlip(ctx) : [];
  const stackSignals = footprintAvailable ? stackedImbalance(ctx) : [];

  return {
    openedAt: ctx.bar.openedAt,
    closedAt,
    isClosed: ctx.bar.isClosed,
    high: ctx.bar.high,
    low: ctx.bar.low,
    close: ctx.bar.close,
    bias: market.bias,
    medianTrueRange: market.volatility.medianTrueRange,
    anchors: [
      {
        identity: "prev_day_low",
        price: priorDayComplete ? levels.previousDayLow : null,
        requires: "previous_day_completeness",
      },
      {
        identity: "prev_day_high",
        price: priorDayComplete ? levels.previousDayHigh : null,
        requires: "previous_day_completeness",
      },
    ],
    triggers: [
      triggerEvidence("delta_flip", deltaAvailable, flipSignals, expectedDirection),
      triggerEvidence(
        "stacked_imbalance",
        footprintAvailable,
        stackSignals,
        expectedDirection,
      ),
    ],
  };
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
    if (spacing <= 0 || spacing > MAX_SPACING_MS) break;
    tail.unshift(history[index]);
    nextOpenedMs = openedMs;
  }
  return tail;
}

function triggerEvidence(
  kind: TriggerKind,
  available: boolean,
  signals: RuleSignal[],
  expected: PullbackDirection | null,
): TriggerEvidence {
  if (!available) return { kind, available: false, direction: null };
  const directions = [...new Set(signals.map((signal) => signal.direction))];
  const direction = expected && directions.includes(expected)
    ? expected
    : directions.length === 1
    ? directions[0]
    : null;
  return { kind, available: true, direction };
}

function closeTime(openedAt: string): string {
  const openedMs = Date.parse(openedAt);
  if (!Number.isFinite(openedMs)) throw new Error("MNQ pullback: invalid openedAt");
  return new Date(openedMs + FIVE_MINUTES_MS).toISOString();
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
    // P-A does not use a profile. Avoid claiming historical footprint that the
    // live history query intentionally does not fetch.
    levels: current ? bar.levels : null,
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
