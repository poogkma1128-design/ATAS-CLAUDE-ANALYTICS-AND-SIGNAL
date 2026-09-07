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

export const RULE_KEY = "mnq_reversal_v1";
export const CONTRACT_VERSION = "MNQ_REVERSAL_V1@live-preview-1";

const BASE_CONTRACT: FailedBreakContract = {
  version: CONTRACT_VERSION,
  strategyKey: "MNQ_REVERSAL_V1",
  setupMaxAgeBars: 6,
  maxBarSpacingMs: MAX_STRATEGY_SPACING_MS,
  anchorIdentities: ["prev_day_low", "prev_day_high"],
  triggerKinds: ["absorption", "delta_divergence"],
  confirmationMode: "order_flow",
  invalidationReason: "attempt_resumed",
};

export const EMPTY_CARRY: FailedBreakCarry = { open: [], lastDecisionAt: null };

export function contractFor(params: Record<string, unknown>): FailedBreakContract {
  const attemptWindowBars = Math.max(1, Math.round(num(params, "attemptWindowBars", 3)));
  const attemptDistance = num(params, "attemptDistance", 0.25);
  const setupMaxAgeBars = Math.max(1, Math.round(num(params, "setupMaxAgeBars", 6)));
  if (!(attemptDistance > 0)) throw new Error("attemptDistance must be positive");
  const moved = [
    attemptWindowBars === 3 ? null : `attemptWindowBars=${attemptWindowBars}`,
    attemptDistance === 0.25 ? null : `attemptDistance=${attemptDistance}`,
    setupMaxAgeBars === 6 ? null : `setupMaxAgeBars=${setupMaxAgeBars}`,
  ].filter(Boolean);
  return {
    ...BASE_CONTRACT,
    setupMaxAgeBars,
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
  const attemptWindowBars = Math.max(
    1,
    Math.round(num(ctx.params, "attemptWindowBars", 3)),
  );
  const attemptDistance = num(ctx.params, "attemptDistance", 0.25);
  const built = buildFailedBreakDecision(ctx, {
    attemptWindowBars,
    attemptDistance,
    triggerKinds: contract.triggerKinds,
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
  return ctx.symbol === "MNQU6" && ctx.timeframe === "5m";
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
      kind: "mnq_reversal_previous_day_failed_break",
      strategyKey: contract.strategyKey,
      contractVersion: contract.version,
      executionScope,
      score: null,
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
      tradingDay: built.tradingDay,
      sessionDefinitionVersion: built.sessionDefinitionVersion,
      riskNotice: "owner-approved live preview while backtest runs; unvalidated",
    },
  }];
}
