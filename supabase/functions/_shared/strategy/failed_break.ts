/**
 * Shared causal state machine for a failed break of a named price level.
 *
 * MNQ_REVERSAL_V1 and GC_SWEEP_V1 differ in scope and trigger set, but the
 * event is identical: price trades beyond a frozen anchor, closes back inside,
 * and may wait a bounded number of closed bars for confirmation. Keeping that
 * lifecycle here prevents live ingest and backtest from acquiring separate
 * interpretations of the same setup.
 */

export type FailedBreakDirection = "long" | "short";
export type FailedBreakTriggerKind =
  | "absorption"
  | "delta_divergence"
  | "stacked_imbalance"
  | "return_only";

export interface FailedBreakTriggerEvidence {
  kind: Exclude<FailedBreakTriggerKind, "return_only">;
  available: boolean;
  direction: FailedBreakDirection | null;
}

export interface FailedBreakAnchor {
  identity: string;
  price: number | null;
  requires: string;
  /** Direction implied by a completed beyond-and-return event on this bar. */
  eligibleDirection: FailedBreakDirection | null;
}

export interface FailedBreakDecisionBar {
  openedAt: string;
  isClosed: boolean;
  close: number;
  medianTrueRange: number | null;
  anchors: FailedBreakAnchor[];
  triggers: FailedBreakTriggerEvidence[];
}

export interface FailedBreakContract {
  version: string;
  strategyKey: "MNQ_REVERSAL_V1" | "GC_SWEEP_V1";
  setupMaxAgeBars: number;
  maxBarSpacingMs: number;
  anchorIdentities: string[];
  triggerKinds: Exclude<FailedBreakTriggerKind, "return_only">[];
  confirmationMode: "order_flow" | "return_only";
  invalidationReason: "attempt_resumed" | "swept_again";
}

export interface FailedBreakOpenSetup {
  anchorIdentity: string;
  anchorTouchId: string;
  direction: FailedBreakDirection;
  openedAt: string;
  lastSeenAt: string;
  anchorPrice: number;
  touchBars: number;
  ageBars: number;
  sawEvaluableTrigger: boolean;
  sawOpposingTrigger: boolean;
  sawMissingBias: boolean;
  sawMissingVolatility: boolean;
}

export interface FailedBreakCarry {
  open: FailedBreakOpenSetup[];
  lastDecisionAt: string | null;
}

export type FailedBreakOutcome =
  | { kind: "triggered"; at: string; trigger: FailedBreakTriggerKind | "both" }
  | { kind: "rejected"; at: string; reason: string }
  | { kind: "right_censored"; at: string; reason: "end_of_data" };

export interface FailedBreakOpportunity {
  strategyKey: FailedBreakContract["strategyKey"];
  contractVersion: string;
  anchorIdentity: string;
  anchorTouchId: string;
  direction: FailedBreakDirection;
  openedAt: string;
  anchorPrice: number;
  touchBars: number;
  ageBars: number;
  outcome: FailedBreakOutcome;
  score: null;
}

export interface FailedBreakResult {
  opportunities: FailedBreakOpportunity[];
  open: FailedBreakOpenSetup[];
  barOutcomes: { decisionAt: string; anchorIdentity: string; reason: string }[];
}

function assertContract(contract: FailedBreakContract): void {
  if (!contract.version.trim()) {
    throw new Error("failed break contract version is required");
  }
  if (!Number.isInteger(contract.setupMaxAgeBars) || contract.setupMaxAgeBars < 1) {
    throw new Error("setupMaxAgeBars must be a positive integer");
  }
  if (!Number.isSafeInteger(contract.maxBarSpacingMs) || contract.maxBarSpacingMs < 1) {
    throw new Error("maxBarSpacingMs must be a positive integer");
  }
  if (contract.anchorIdentities.length === 0) {
    throw new Error("anchor identity is required");
  }
  if (new Set(contract.anchorIdentities).size !== contract.anchorIdentities.length) {
    throw new Error("anchor identities must be unique");
  }
  if (contract.confirmationMode === "order_flow" && contract.triggerKinds.length === 0) {
    throw new Error("order-flow confirmation requires a trigger kind");
  }
}

function assertInput(
  bars: FailedBreakDecisionBar[],
  carry: FailedBreakCarry | undefined,
  contract: FailedBreakContract,
): void {
  let prior = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    if (!bar.isClosed) throw new Error("failed break decision bar is not closed");
    const at = Date.parse(bar.openedAt);
    if (!Number.isFinite(at) || at <= prior) {
      throw new Error("failed break decision bars must be strictly ascending");
    }
    prior = at;
  }
  if (!carry) return;
  const anchors = new Set<string>();
  for (const setup of carry.open) {
    if (!contract.anchorIdentities.includes(setup.anchorIdentity)) {
      throw new Error("carried setup uses an anchor this contract does not use");
    }
    if (anchors.has(setup.anchorIdentity)) throw new Error("carried setups share anchor");
    anchors.add(setup.anchorIdentity);
    if (setup.ageBars >= contract.setupMaxAgeBars) {
      throw new Error("carried setup is older than the contract allows");
    }
    if (bars.length > 0 && Date.parse(setup.lastSeenAt) >= Date.parse(bars[0].openedAt)) {
      throw new Error("carried setup already saw the first bar");
    }
  }
  if (
    carry.lastDecisionAt && bars.length > 0 &&
    Date.parse(carry.lastDecisionAt) >= Date.parse(bars[0].openedAt)
  ) throw new Error("carried decision boundary is not before the first bar");
}

function triggerState(
  bar: FailedBreakDecisionBar,
  contract: FailedBreakContract,
  direction: FailedBreakDirection,
): { fired: FailedBreakTriggerKind[]; opposing: boolean; evaluable: boolean } {
  if (contract.confirmationMode === "return_only") {
    return { fired: ["return_only"], opposing: false, evaluable: true };
  }
  const fired: FailedBreakTriggerKind[] = [];
  let opposing = false;
  let evaluable = false;
  for (const kind of contract.triggerKinds) {
    const evidence = bar.triggers.find((candidate) => candidate.kind === kind);
    if (!evidence?.available) continue;
    evaluable = true;
    if (evidence.direction === direction) fired.push(kind);
    else if (evidence.direction !== null) opposing = true;
  }
  return { fired, opposing, evaluable };
}

function isInvalidated(
  bar: FailedBreakDecisionBar,
  setup: FailedBreakOpenSetup,
): boolean {
  return setup.direction === "long"
    ? bar.close < setup.anchorPrice
    : bar.close > setup.anchorPrice;
}

export function evaluateFailedBreak(
  bars: FailedBreakDecisionBar[],
  contract: FailedBreakContract,
  carry?: FailedBreakCarry,
): FailedBreakResult {
  assertContract(contract);
  assertInput(bars, carry, contract);

  const opportunities: FailedBreakOpportunity[] = [];
  const barOutcomes: FailedBreakResult["barOutcomes"] = [];
  const open = new Map(
    (carry?.open ?? []).map((setup) => [setup.anchorIdentity, { ...setup }]),
  );
  let previousOpenedMs = carry?.lastDecisionAt ? Date.parse(carry.lastDecisionAt) : null;

  const close = (setup: FailedBreakOpenSetup, outcome: FailedBreakOutcome): void => {
    opportunities.push({
      strategyKey: contract.strategyKey,
      contractVersion: contract.version,
      anchorIdentity: setup.anchorIdentity,
      anchorTouchId: setup.anchorTouchId,
      direction: setup.direction,
      openedAt: setup.openedAt,
      anchorPrice: setup.anchorPrice,
      touchBars: setup.touchBars,
      ageBars: setup.ageBars,
      outcome,
      score: null,
    });
    open.delete(setup.anchorIdentity);
  };

  for (const bar of bars) {
    const resolvedThisBar = new Set<string>();
    const openedMs = Date.parse(bar.openedAt);
    if (
      previousOpenedMs !== null &&
      openedMs - previousOpenedMs > contract.maxBarSpacingMs
    ) {
      for (const setup of [...open.values()]) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: "data_unavailable:feed_gap",
        });
        resolvedThisBar.add(setup.anchorIdentity);
      }
    }
    previousOpenedMs = openedMs;

    for (const setup of [...open.values()]) {
      setup.ageBars += 1;
      setup.lastSeenAt = bar.openedAt;
      if (isInvalidated(bar, setup)) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: `invalidated:${contract.invalidationReason}`,
        });
        resolvedThisBar.add(setup.anchorIdentity);
        continue;
      }
      const state = triggerState(bar, contract, setup.direction);
      setup.sawEvaluableTrigger ||= state.evaluable;
      setup.sawOpposingTrigger ||= state.opposing;
      if (state.fired.length > 0) {
        close(setup, {
          kind: "triggered",
          at: bar.openedAt,
          trigger: state.fired.length > 1 ? "both" : state.fired[0],
        });
        resolvedThisBar.add(setup.anchorIdentity);
        continue;
      }
      const anchor = bar.anchors.find((candidate) =>
        candidate.identity === setup.anchorIdentity
      );
      if (anchor?.eligibleDirection === setup.direction) {
        setup.touchBars += 1;
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: setup.anchorIdentity,
          reason: `duplicate_of:${setup.anchorTouchId}`,
        });
      }
      if (setup.ageBars >= contract.setupMaxAgeBars) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: setup.sawEvaluableTrigger
            ? (setup.sawOpposingTrigger ? "direction_conflict" : "expired_unfired")
            : "data_unavailable:footprint",
        });
        resolvedThisBar.add(setup.anchorIdentity);
      }
    }

    for (const identity of contract.anchorIdentities) {
      if (open.has(identity) || resolvedThisBar.has(identity)) continue;
      const anchor = bar.anchors.find((candidate) => candidate.identity === identity);
      if (!anchor || anchor.price === null || !Number.isFinite(anchor.price)) {
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: `data_unavailable:${anchor?.requires ?? identity}`,
        });
        continue;
      }
      if (bar.medianTrueRange === null) {
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: "insufficient_history",
        });
        continue;
      }
      if (!anchor.eligibleDirection) {
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: "no_setup",
        });
        continue;
      }
      const setup: FailedBreakOpenSetup = {
        anchorIdentity: identity,
        anchorTouchId: `${identity}@${bar.openedAt}`,
        direction: anchor.eligibleDirection,
        openedAt: bar.openedAt,
        lastSeenAt: bar.openedAt,
        anchorPrice: anchor.price,
        touchBars: 1,
        ageBars: 1,
        sawEvaluableTrigger: false,
        sawOpposingTrigger: false,
        sawMissingBias: false,
        sawMissingVolatility: false,
      };
      open.set(identity, setup);
      const state = triggerState(bar, contract, setup.direction);
      setup.sawEvaluableTrigger = state.evaluable;
      setup.sawOpposingTrigger = state.opposing;
      if (state.fired.length > 0) {
        close(setup, {
          kind: "triggered",
          at: bar.openedAt,
          trigger: state.fired.length > 1 ? "both" : state.fired[0],
        });
      }
    }
  }

  if (!carry && bars.length > 0) {
    for (const setup of [...open.values()]) {
      close(setup, {
        kind: "right_censored",
        at: bars.at(-1)!.openedAt,
        reason: "end_of_data",
      });
    }
  }

  return { opportunities, open: [...open.values()], barOutcomes };
}
