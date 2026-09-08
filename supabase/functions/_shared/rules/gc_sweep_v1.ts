import type { RuleContext, RuleSignal } from "../types.ts";
import { num } from "../util.ts";
import {
  evaluateFailedBreak,
  type FailedBreakCarry,
  type FailedBreakContract,
  type FailedBreakOpportunity,
} from "../strategy/failed_break.ts";
import {
  buildFailedBreakDecision,
  MAX_STRATEGY_SPACING_MS,
} from "./named_level_failed_break.ts";

export const RULE_KEY = "gc_sweep_v1";
export const CONTRACT_VERSION = "GC_SWEEP_V1@S-A-arm-2-live-preview-1";
export const GC_MARKET_TICK_SIZE = 0.1;

export type GcSweepContract = FailedBreakContract & { marketTickSize: number };

const BASE_CONTRACT: FailedBreakContract = {
  version: CONTRACT_VERSION,
  strategyKey: "GC_SWEEP_V1",
  setupMaxAgeBars: 6,
  maxBarSpacingMs: MAX_STRATEGY_SPACING_MS,
  anchorIdentities: ["prev_day_low", "prev_day_high"],
  triggerKinds: ["absorption", "stacked_imbalance"],
  confirmationMode: "order_flow",
  invalidationReason: "swept_again",
};

export const EMPTY_CARRY: FailedBreakCarry = { open: [], lastDecisionAt: null };

export function contractFor(params: Record<string, unknown>): GcSweepContract {
  const returnWindowBars = Math.max(1, Math.round(num(params, "returnWindowBars", 3)));
  const sweepDistance = num(params, "sweepDistance", 0.25);
  const setupMaxAgeBars = Math.max(1, Math.round(num(params, "setupMaxAgeBars", 6)));
  const confirmationMode = params.confirmationMode === "return_only"
    ? "return_only"
    : "order_flow";
  const marketTickSize = num(params, "marketTickSize", GC_MARKET_TICK_SIZE);
  if (!(sweepDistance > 0)) throw new Error("sweepDistance must be positive");
  if (!(marketTickSize > 0)) throw new Error("marketTickSize must be positive");
  const moved = [
    returnWindowBars === 3 ? null : `returnWindowBars=${returnWindowBars}`,
    sweepDistance === 0.25 ? null : `sweepDistance=${sweepDistance}`,
    setupMaxAgeBars === 6 ? null : `setupMaxAgeBars=${setupMaxAgeBars}`,
    confirmationMode === "order_flow" ? null : "confirmationMode=return_only",
    marketTickSize === GC_MARKET_TICK_SIZE ? null : `marketTickSize=${marketTickSize}`,
  ].filter(Boolean);
  return {
    ...BASE_CONTRACT,
    setupMaxAgeBars,
    confirmationMode,
    marketTickSize,
    version: moved.length ? `${CONTRACT_VERSION}+${moved.join(",")}` : CONTRACT_VERSION,
  };
}

export function evaluate(ctx: RuleContext): RuleSignal[] {
  if (!inScope(ctx)) return [];
  return step(ctx, undefined).signals;
}

export function advance(
  ctx: RuleContext,
  carry: FailedBreakCarry = EMPTY_CARRY,
): {
  signals: RuleSignal[];
  carry: FailedBreakCarry;
  resolved: FailedBreakOpportunity[];
} {
  if (!inScope(ctx)) return { signals: [], carry, resolved: [] };
  return step(ctx, carry);
}

function step(ctx: RuleContext, carry: FailedBreakCarry | undefined) {
  const contract = contractFor(ctx.params);
  const returnWindowBars = Math.max(
    1,
    Math.round(num(ctx.params, "returnWindowBars", 3)),
  );
  const sweepDistance = num(ctx.params, "sweepDistance", 0.25);
  const built = buildFailedBreakDecision(ctx, {
    attemptWindowBars: returnWindowBars,
    attemptDistance: sweepDistance,
    triggerKinds: contract.triggerKinds,
    // ATAS currently reports 0.40 for GC. The production param defaults to
    // CME's 0.10 contract tick, but remains explicit and versioned if curated.
    marketTickSize: contract.marketTickSize,
  });
  const result = evaluateFailedBreak([built.decision], contract, carry);
  return {
    signals: signalsFor(
      ctx,
      contract,
      built,
      result.opportunities,
      carry ? "carried_setup" : "touch_bar_only",
    ),
    carry: { open: result.open, lastDecisionAt: built.decision.openedAt },
    resolved: result.opportunities,
  };
}

function inScope(ctx: RuleContext): boolean {
  return ctx.symbol === "GC" && ctx.timeframe === "5m";
}

function signalsFor(
  ctx: RuleContext,
  contract: FailedBreakContract,
  built: ReturnType<typeof buildFailedBreakDecision>,
  opportunities: FailedBreakOpportunity[],
  executionScope: "carried_setup" | "touch_bar_only",
): RuleSignal[] {
  const chosen = opportunities
    .filter((candidate) => candidate.outcome.kind === "triggered")
    .sort((a, b) => a.anchorIdentity.localeCompare(b.anchorIdentity))[0];
  if (!chosen || chosen.outcome.kind !== "triggered") return [];
  return [{
    direction: chosen.direction,
    price: ctx.bar.close,
    confidence: 0,
    payload: {
      kind: "gc_sweep_previous_day_failed_break",
      strategyKey: contract.strategyKey,
      contractVersion: contract.version,
      executionScope,
      score: null,
      variant: "S-A",
      arm: contract.confirmationMode === "return_only" ? 1 : 2,
      anchor: {
        identity: chosen.anchorIdentity,
        price: chosen.anchorPrice,
        touchId: chosen.anchorTouchId,
      },
      setupAgeBars: chosen.ageBars,
      openedAt: chosen.openedAt,
      trigger: chosen.outcome.trigger,
      bias: built.bias,
      medianTrueRange: built.decision.medianTrueRange,
      marketTickSize: built.marketTickSize,
      tradingDay: built.tradingDay,
      sessionDefinitionVersion: built.sessionDefinitionVersion,
      riskNotice: "owner-approved live preview while backtest runs; unvalidated",
    },
  }];
}
