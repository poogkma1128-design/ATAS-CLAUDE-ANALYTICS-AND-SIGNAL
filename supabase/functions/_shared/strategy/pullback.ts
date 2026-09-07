/**
 * `MNQ_PULLBACK_V1` — trend pullback to a named level, entered on a return in
 * the trend direction.
 *
 * Specification: `docs/STRATEGY_SPEC_V1.md` §3. Plan: `docs/STRATEGY_ENGINE_PLAN.md`
 * §5. Owner's revision: HANDOFF §0AB.
 *
 * Three properties this module exists to hold, each of which came from a
 * measurement rather than a preference:
 *
 * 1. **Boolean only.** `score` is `null` on every opportunity and there is no
 *    band, ranking or confidence. The §5 design review rejected numeric scoring
 *    as written, and Phase 2A records eligibility and direction alone.
 *
 * 2. **Distances are multiples of true range, never ticks.** `instruments.tick_size`
 *    is a live value that moves: three of four recorded ticks changed inside one
 *    day, and stored outcome rows were divided by two to four different values
 *    per instrument (HANDOFF §0AB.6). A tick-denominated distance is therefore
 *    uninterpretable today and not comparable across instruments. A true-range
 *    multiple is comparable on its own merits and stays correct after the tick is
 *    repaired.
 *
 * 3. **Missing data is not "no setup".** Each anchor declares what it needs. A
 *    path anchored on bar extremes keeps working on a bar whose footprint does
 *    not reconcile; a path anchored on the volume profile does not, and says so
 *    with `data_unavailable:` rather than silently substituting another input.
 *    On 2026-09-07 the profile was unusable on 30.5% of MNQU6 bars, so the
 *    difference is most of a third of the sample.
 *
 * Isolated by construction: this module imports nothing from the ingest, rule or
 * Telegram paths, and nothing imports it except its own test. It computes; it
 * does not decide a trade, write a row, or reach production.
 */

export type PullbackDirection = "long" | "short";

export type TriggerKind = "delta_flip" | "stacked_imbalance";

export type RejectionReason =
  | "no_setup"
  | "insufficient_history"
  | "direction_conflict"
  | "expired_unfired"
  | `data_unavailable:${string}`
  | `duplicate_of:${string}`
  | `invalidated:${string}`;

/**
 * What a detector reported for one bar.
 *
 * `available: false` means the detector could not be evaluated at all — an
 * unreconciled footprint, a missing history window — and is distinct from
 * `direction: null`, which means it was evaluated and did not fire.
 */
export interface TriggerEvidence {
  kind: TriggerKind;
  available: boolean;
  direction: PullbackDirection | null;
}

/**
 * One named level the setup can be built on, at one decision bar.
 *
 * `price: null` means the level could not be computed for this bar. `requires`
 * names the input that was missing, so the rejection says which path was closed
 * and by what.
 */
export interface PullbackAnchor {
  identity: string;
  price: number | null;
  requires: string;
}

/** A decision bar, with everything already computed causally from bars at or before its close. */
export interface PullbackDecisionBar {
  openedAt: string;
  closedAt: string;
  isClosed: boolean;
  high: number;
  low: number;
  close: number;
  /** From `computeMarketContext()`. `null` means it could not be established. */
  bias: "bullish" | "bearish" | "neutral" | null;
  /**
   * Median true range of the contiguous trailing window that closed BEFORE this
   * bar. `null` means `insufficient_history`: no distance can be measured.
   */
  medianTrueRange: number | null;
  anchors: PullbackAnchor[];
  triggers: TriggerEvidence[];
}

export interface PullbackContract {
  version: string;
  /** How close to the anchor the pullback extreme must come, in median true ranges. */
  zoneProximity: number;
  /** How far beyond the anchor a close must go, against the trend, to invalidate. */
  invalidationDistance: number;
  /** Bars an eligible setup may wait for its trigger before expiring. */
  setupMaxAgeBars: number;
  /** Maximum opened-at spacing between decision bars before an open setup is unavailable. */
  maxBarSpacingMs: number;
  /** Anchor identities this version uses. An anchor outside this list is ignored entirely. */
  anchorIdentities: string[];
  /** The frozen alternatives of the "or". Order is not precedence. */
  triggerKinds: TriggerKind[];
}

export type PullbackOutcome =
  | { kind: "triggered"; at: string; trigger: TriggerKind | "both" }
  | { kind: "rejected"; at: string; reason: RejectionReason }
  | { kind: "right_censored"; at: string; reason: "end_of_data" };

export interface PullbackOpportunity {
  strategyKey: "MNQ_PULLBACK_V1";
  contractVersion: string;
  anchorIdentity: string;
  /** Deterministic and stable: the same input produces the same id. */
  anchorTouchId: string;
  direction: PullbackDirection;
  openedAt: string;
  anchorPrice: number;
  /** Bars on which the eligibility condition held again while this setup was open. */
  touchBars: number;
  /** Bars the setup stayed open, including the bar that opened it. */
  ageBars: number;
  outcome: PullbackOutcome;
  /** Phase 2A is boolean-first. This is `null` by contract, not by omission. */
  score: null;
}

/** Why no setup opened on one (bar, anchor) pair. Feeds the pass-rate census of step 3. */
export interface PullbackBarOutcome {
  decisionAt: string;
  anchorIdentity: string;
  reason: RejectionReason;
}

/**
 * A setup that is still waiting, in a shape that survives storage.
 *
 * The live rule sees one bar per invocation and remembers nothing, so without
 * this a setup can only ever be confirmed by the bar that opened it. Measured on
 * MNQU6 over 2026-08-28 to 2026-09-07: the six-bar contract confirms five
 * opportunities and exactly one of them is confirmed on its own touch bar.
 * Everything this type carries is a field the evaluator already kept in memory
 * between bars; naming it is what lets a caller hold it somewhere durable.
 */
export interface PullbackOpenSetup {
  anchorIdentity: string;
  anchorTouchId: string;
  direction: PullbackDirection;
  openedAt: string;
  /** The last decision bar this setup was advanced over. */
  lastSeenAt: string;
  anchorPrice: number;
  touchBars: number;
  ageBars: number;
  /** True once any listed trigger has been evaluable while the setup was open. */
  sawEvaluableTrigger: boolean;
  /** True if a listed trigger fired against the setup direction. */
  sawOpposingTrigger: boolean;
  /** Missing bias prevents a trigger decision; it is not evidence that bias held. */
  sawMissingBias: boolean;
  /** Missing volatility prevents distance and invalidation checks. */
  sawMissingVolatility: boolean;
}

/** What a caller that stores setups between calls hands back in. */
export interface PullbackCarry {
  /** Setups that were open when the previous run ended. */
  open: PullbackOpenSetup[];
  /**
   * The last decision bar of the previous run. Feed-gap detection compares the
   * first new bar against it; without it a gap across the boundary would be
   * invisible, which is the one thing storage could quietly break.
   */
  lastDecisionAt: string | null;
}

export interface PullbackResult {
  contractVersion: string;
  opportunities: PullbackOpportunity[];
  barOutcomes: PullbackBarOutcome[];
  /**
   * Setups still waiting when the bars ran out. Empty unless a carry was passed:
   * a run that cannot be resumed censors them into `opportunities` instead,
   * because for that caller the data ending is the end of the story.
   */
  open: PullbackOpenSetup[];
  diagnostics: {
    decisionBars: number;
    /** Bars that could not be evaluated at all, before any anchor was considered. */
    barsWithoutVolatility: number;
    barsWithoutBias: number;
  };
}

type OpenSetup = PullbackOpenSetup;

function assertContract(contract: PullbackContract): void {
  if (!(contract.zoneProximity > 0)) {
    throw new Error("pullback contract: zoneProximity must be > 0");
  }
  if (!(contract.invalidationDistance > 0)) {
    throw new Error("pullback contract: invalidationDistance must be > 0");
  }
  if (!Number.isInteger(contract.setupMaxAgeBars) || contract.setupMaxAgeBars < 1) {
    throw new Error("pullback contract: setupMaxAgeBars must be a positive integer");
  }
  if (!Number.isSafeInteger(contract.maxBarSpacingMs) || contract.maxBarSpacingMs < 1) {
    throw new Error("pullback contract: maxBarSpacingMs must be a positive integer");
  }
  if (contract.anchorIdentities.length === 0) {
    throw new Error("pullback contract: at least one anchor identity is required");
  }
  if (contract.triggerKinds.length === 0) {
    throw new Error("pullback contract: at least one trigger kind is required");
  }
  if (new Set(contract.anchorIdentities).size !== contract.anchorIdentities.length) {
    throw new Error("pullback contract: anchor identities must be unique");
  }
  if (new Set(contract.triggerKinds).size !== contract.triggerKinds.length) {
    throw new Error("pullback contract: trigger kinds must be unique");
  }
}

function assertCausalOrder(bars: PullbackDecisionBar[]): void {
  let previous = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    if (!bar.isClosed) {
      throw new Error(
        `pullback: bar ${bar.openedAt} is not closed; a live bar cannot decide`,
      );
    }
    const at = Date.parse(bar.openedAt);
    if (!Number.isFinite(at)) {
      throw new Error(`pullback: bar has an unparseable openedAt: ${bar.openedAt}`);
    }
    if (at <= previous) {
      throw new Error("pullback: decision bars must be strictly ascending by openedAt");
    }
    previous = at;
  }
}

/**
 * Rejects carried state that cannot belong to this run.
 *
 * Storage is the one place a causality bug can enter without a bar being wrong:
 * a setup restored from a row could name an anchor the contract no longer has,
 * or claim to have started after the bar about to be judged. Both are caught
 * here rather than producing an opportunity nobody can explain later.
 */
function assertCarry(
  carry: PullbackCarry,
  bars: PullbackDecisionBar[],
  contract: PullbackContract,
): void {
  const known = new Set(contract.anchorIdentities);
  const seen = new Set<string>();
  const firstBarMs = bars.length > 0
    ? Date.parse(bars[0].openedAt)
    : Number.POSITIVE_INFINITY;

  for (const setup of carry.open) {
    if (!known.has(setup.anchorIdentity)) {
      throw new Error(
        `pullback: carried setup names anchor ${setup.anchorIdentity}, ` +
          "which this contract does not use",
      );
    }
    // One anchor holds at most one setup; two would double-count a single event.
    if (seen.has(setup.anchorIdentity)) {
      throw new Error(
        `pullback: two carried setups share anchor ${setup.anchorIdentity}`,
      );
    }
    seen.add(setup.anchorIdentity);

    const openedMs = Date.parse(setup.openedAt);
    const lastSeenMs = Date.parse(setup.lastSeenAt);
    if (!Number.isFinite(openedMs) || !Number.isFinite(lastSeenMs)) {
      throw new Error(
        `pullback: carried setup ${setup.anchorTouchId} has an unparseable time`,
      );
    }
    if (lastSeenMs < openedMs) {
      throw new Error(
        `pullback: carried setup ${setup.anchorTouchId} was last seen before it opened`,
      );
    }
    if (lastSeenMs >= firstBarMs) {
      throw new Error(
        `pullback: carried setup ${setup.anchorTouchId} already saw the first bar`,
      );
    }
    if (!Number.isInteger(setup.ageBars) || setup.ageBars < 1) {
      throw new Error(
        `pullback: carried setup ${setup.anchorTouchId} has a non-positive age`,
      );
    }
    // Already at the age limit means the previous run should have closed it.
    if (setup.ageBars >= contract.setupMaxAgeBars) {
      throw new Error(
        `pullback: carried setup ${setup.anchorTouchId} is older than the contract allows`,
      );
    }
  }

  if (carry.lastDecisionAt !== null) {
    const lastMs = Date.parse(carry.lastDecisionAt);
    if (!Number.isFinite(lastMs)) {
      throw new Error("pullback: carry.lastDecisionAt is unparseable");
    }
    if (lastMs >= firstBarMs) {
      throw new Error("pullback: carry.lastDecisionAt is not before the first bar");
    }
  }
}

function biasDirection(bar: PullbackDecisionBar): PullbackDirection | null {
  if (bar.bias === "bullish") return "long";
  if (bar.bias === "bearish") return "short";
  return null;
}

/**
 * The pullback extreme is the low in an uptrend and the high in a downtrend: a
 * pullback is measured where the market gave ground, not where it closed.
 */
function pullbackExtreme(bar: PullbackDecisionBar, direction: PullbackDirection): number {
  return direction === "long" ? bar.low : bar.high;
}

function closesOnTrendSide(
  bar: PullbackDecisionBar,
  direction: PullbackDirection,
  anchorPrice: number,
): boolean {
  return direction === "long" ? bar.close > anchorPrice : bar.close < anchorPrice;
}

function isInvalidated(
  bar: PullbackDecisionBar,
  setup: OpenSetup,
  distance: number,
): boolean {
  return setup.direction === "long"
    ? bar.close < setup.anchorPrice - distance
    : bar.close > setup.anchorPrice + distance;
}

function firedTriggers(
  bar: PullbackDecisionBar,
  contract: PullbackContract,
  direction: PullbackDirection,
): { fired: TriggerKind[]; opposing: boolean; evaluable: boolean } {
  const fired: TriggerKind[] = [];
  let opposing = false;
  let evaluable = false;

  for (const kind of contract.triggerKinds) {
    const evidence = bar.triggers.find((candidate) => candidate.kind === kind);
    if (!evidence || !evidence.available) continue;
    evaluable = true;
    if (evidence.direction === direction) fired.push(kind);
    else if (evidence.direction !== null) opposing = true;
  }

  return { fired, opposing, evaluable };
}

/**
 * Both alternatives firing on the same bar is one opportunity, recorded as
 * `both`. §1.4 of the spec: which alternative fired is recorded so the split can
 * be examined later, and is never chosen retrospectively from what won.
 */
function triggerLabel(fired: TriggerKind[]): TriggerKind | "both" {
  return fired.length > 1 ? "both" : fired[0];
}

/**
 * Evaluate `MNQ_PULLBACK_V1` over a causal sequence of decision bars.
 *
 * Bars must be closed and strictly ascending. Each bar carries only what could
 * be computed at or before its own close, so iterating forward cannot look
 * ahead: a future bar is an error rather than a row to discard quietly.
 *
 * Precedence within a bar is deliberately pessimistic and matches the convention
 * the outcome evaluator already uses: invalidation is checked before the
 * trigger, so a bar that both closes through the anchor and shows a return is
 * recorded as invalidated. With bar data alone the order inside the bar is
 * unknown, and the unfavourable reading is the honest one.
 */
export function evaluatePullback(
  bars: PullbackDecisionBar[],
  contract: PullbackContract,
  carry?: PullbackCarry,
): PullbackResult {
  assertContract(contract);
  assertCausalOrder(bars);
  if (carry) assertCarry(carry, bars, contract);

  const opportunities: PullbackOpportunity[] = [];
  const barOutcomes: PullbackBarOutcome[] = [];
  const open = new Map<string, OpenSetup>(
    (carry?.open ?? []).map((setup) => [setup.anchorIdentity, { ...setup }]),
  );

  let barsWithoutVolatility = 0;
  let barsWithoutBias = 0;
  let previousOpenedMs = carry?.lastDecisionAt ? Date.parse(carry.lastDecisionAt) : null;

  /**
   * Anchors whose setup was resolved on the bar being evaluated. §1.5 of the
   * spec issues a new touch id only after the previous setup has closed, so an
   * anchor that closed on this bar cannot also open on it — otherwise one
   * trigger would be counted as two opportunities.
   */
  let resolvedThisBar = new Set<string>();

  const close = (setup: OpenSetup, outcome: PullbackOutcome): void => {
    opportunities.push({
      strategyKey: "MNQ_PULLBACK_V1",
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
    resolvedThisBar.add(setup.anchorIdentity);
  };

  for (const bar of bars) {
    resolvedThisBar = new Set<string>();
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
      }
    }
    previousOpenedMs = openedMs;

    const direction = biasDirection(bar);
    const mtr = bar.medianTrueRange;

    // --------------------------------------------------- advance open setups
    // An open setup is resolved on the information of this bar before any new
    // setup is considered, so one anchor never holds two setups at once.
    for (const setup of [...open.values()]) {
      setup.ageBars += 1;
      setup.lastSeenAt = bar.openedAt;

      if (mtr === null) {
        // No distance can be measured, so neither invalidation nor the zone can
        // be judged. The setup survives the bar; the bar is recorded as unusable.
        setup.sawMissingVolatility = true;
        if (setup.ageBars >= contract.setupMaxAgeBars) {
          close(setup, {
            kind: "rejected",
            at: bar.openedAt,
            reason: "data_unavailable:volatility",
          });
        }
        continue;
      }

      if (isInvalidated(bar, setup, contract.invalidationDistance * mtr)) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: "invalidated:closed_through_anchor",
        });
        continue;
      }

      const flippedBias = direction !== null && direction !== setup.direction;
      if (flippedBias) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: "invalidated:bias_flipped",
        });
        continue;
      }

      if (bar.bias === null) {
        setup.sawMissingBias = true;
        if (setup.ageBars >= contract.setupMaxAgeBars) {
          close(setup, {
            kind: "rejected",
            at: bar.openedAt,
            reason: "data_unavailable:bias",
          });
        }
        continue;
      }

      const { fired, opposing, evaluable } = firedTriggers(
        bar,
        contract,
        setup.direction,
      );
      if (evaluable) setup.sawEvaluableTrigger = true;
      if (opposing) setup.sawOpposingTrigger = true;

      if (fired.length > 0) {
        close(setup, {
          kind: "triggered",
          at: bar.openedAt,
          trigger: triggerLabel(fired),
        });
        continue;
      }

      // The eligibility condition holding again extends the same opportunity
      // rather than creating a new one.
      if (direction === setup.direction) {
        const withinZone =
          Math.abs(pullbackExtreme(bar, setup.direction) - setup.anchorPrice) <=
            contract.zoneProximity * mtr;
        if (withinZone && closesOnTrendSide(bar, setup.direction, setup.anchorPrice)) {
          setup.touchBars += 1;
          barOutcomes.push({
            decisionAt: bar.openedAt,
            anchorIdentity: setup.anchorIdentity,
            reason: `duplicate_of:${setup.anchorTouchId}`,
          });
        }
      }

      if (setup.ageBars >= contract.setupMaxAgeBars) {
        // A setup that never had an evaluable trigger was closed by missing data,
        // not by the market declining to confirm. Reporting those as the same
        // thing is what §1.8 of the spec forbids.
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: setup.sawEvaluableTrigger
            ? (setup.sawOpposingTrigger
              ? "direction_conflict"
              : setup.sawMissingBias
              ? "data_unavailable:bias"
              : setup.sawMissingVolatility
              ? "data_unavailable:volatility"
              : "expired_unfired")
            : "data_unavailable:footprint",
        });
      }
    }

    // ------------------------------------------------------ open new setups
    if (mtr === null) {
      barsWithoutVolatility += 1;
      for (const identity of contract.anchorIdentities) {
        if (open.has(identity) || resolvedThisBar.has(identity)) continue;
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: "insufficient_history",
        });
      }
      continue;
    }

    if (direction === null) {
      barsWithoutBias += 1;
      for (const identity of contract.anchorIdentities) {
        if (open.has(identity) || resolvedThisBar.has(identity)) continue;
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: bar.bias === null ? "data_unavailable:bias" : "no_setup",
        });
      }
      continue;
    }

    for (const identity of contract.anchorIdentities) {
      if (open.has(identity) || resolvedThisBar.has(identity)) continue;

      const anchor = bar.anchors.find((candidate) => candidate.identity === identity);
      if (!anchor || anchor.price === null || !Number.isFinite(anchor.price)) {
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: `data_unavailable:${anchor ? anchor.requires : identity}`,
        });
        continue;
      }

      const withinZone = Math.abs(pullbackExtreme(bar, direction) - anchor.price) <=
        contract.zoneProximity * mtr;
      if (!withinZone || !closesOnTrendSide(bar, direction, anchor.price)) {
        barOutcomes.push({
          decisionAt: bar.openedAt,
          anchorIdentity: identity,
          reason: "no_setup",
        });
        continue;
      }

      const setup: OpenSetup = {
        anchorIdentity: identity,
        anchorTouchId: `${identity}@${bar.openedAt}`,
        direction,
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

      // The touch bar may carry its own trigger: §3.2 of the spec allows the
      // entry on a bar at or after the touch, and the same bar's evidence was
      // already computed causally from its own close.
      const { fired, opposing, evaluable } = firedTriggers(bar, contract, direction);
      if (evaluable) setup.sawEvaluableTrigger = true;
      if (opposing) setup.sawOpposingTrigger = true;
      if (fired.length > 0) {
        close(setup, {
          kind: "triggered",
          at: bar.openedAt,
          trigger: triggerLabel(fired),
        });
      } else if (setup.ageBars >= contract.setupMaxAgeBars) {
        close(setup, {
          kind: "rejected",
          at: bar.openedAt,
          reason: evaluable ? "expired_unfired" : "data_unavailable:footprint",
        });
      }
    }
  }

  // A setup still open when the data ends has not expired and has not been
  // rejected by the market. A caller that stores setups will bring it back on
  // the next bar, so ending it here would invent a rejection out of a pause;
  // a caller that cannot resume keeps it in the census as right-censored rather
  // than manufacturing a negative label from a truncated dataset.
  if (!carry && bars.length > 0) {
    for (const setup of [...open.values()]) {
      close(setup, {
        kind: "right_censored",
        at: bars[bars.length - 1].openedAt,
        reason: "end_of_data",
      });
    }
  }

  return {
    contractVersion: contract.version,
    opportunities,
    barOutcomes,
    open: [...open.values()],
    diagnostics: {
      decisionBars: bars.length,
      barsWithoutVolatility,
      barsWithoutBias,
    },
  };
}
