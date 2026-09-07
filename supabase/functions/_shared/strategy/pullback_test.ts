// deno-lint-ignore-file no-import-prefix -- matches the repository's test import convention.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  evaluatePullback,
  type PullbackAnchor,
  type PullbackCarry,
  type PullbackContract,
  type PullbackDecisionBar,
  type TriggerEvidence,
} from "./pullback.ts";

const contract: PullbackContract = {
  version: "MNQ_PULLBACK_V1@test",
  zoneProximity: 0.5,
  invalidationDistance: 0.75,
  setupMaxAgeBars: 3,
  maxBarSpacingMs: 5 * 60_000,
  anchorIdentities: ["prev_day_low"],
  triggerKinds: ["delta_flip", "stacked_imbalance"],
};

/** With medianTrueRange 2: the zone is +/-1.00 and invalidation is 1.50 beyond. */
const MTR = 2;

function anchor(price: number | null, identity = "prev_day_low"): PullbackAnchor {
  return { identity, price, requires: identity === "vwap" ? "profile" : "trading_day" };
}

function triggers(
  flip: PullbackDirection | null | "unavailable",
  stacked: PullbackDirection | null | "unavailable" = "unavailable",
): TriggerEvidence[] {
  const one = (
    kind: "delta_flip" | "stacked_imbalance",
    value: typeof flip,
  ): TriggerEvidence =>
    value === "unavailable"
      ? { kind, available: false, direction: null }
      : { kind, available: true, direction: value };
  return [one("delta_flip", flip), one("stacked_imbalance", stacked)];
}

type PullbackDirection = "long" | "short";

function bar(
  index: number,
  overrides: Partial<PullbackDecisionBar> = {},
): PullbackDecisionBar {
  const openedAt = new Date(Date.UTC(2026, 8, 7, 14, index * 5));
  return {
    openedAt: openedAt.toISOString(),
    closedAt: new Date(openedAt.getTime() + 5 * 60_000).toISOString(),
    isClosed: true,
    high: 103,
    low: 102,
    close: 102.5,
    bias: "bullish",
    medianTrueRange: MTR,
    anchors: [anchor(100)],
    triggers: triggers("unavailable", "unavailable"),
    ...overrides,
  };
}

/** A bar that satisfies eligibility for a long setup against an anchor at 100. */
function touchBar(index: number, overrides: Partial<PullbackDecisionBar> = {}) {
  return bar(index, { low: 99.5, high: 101.5, close: 101, ...overrides });
}

Deno.test("a touch followed by a same-direction flip is one triggered opportunity", () => {
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  const opportunity = result.opportunities[0];
  assertEquals(opportunity.strategyKey, "MNQ_PULLBACK_V1");
  assertEquals(opportunity.direction, "long");
  assertEquals(opportunity.anchorTouchId, "prev_day_low@2026-09-07T14:00:00.000Z");
  assertEquals(opportunity.outcome, {
    kind: "triggered",
    at: "2026-09-07T14:05:00.000Z",
    trigger: "delta_flip",
  });
  // Phase 2A is boolean-first: the number is absent by contract, not by omission.
  assertEquals(opportunity.score, null);
});

Deno.test("the touch bar may carry its own trigger", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "triggered",
    at: "2026-09-07T14:00:00.000Z",
    trigger: "delta_flip",
  });
});

Deno.test("both alternatives on one bar is one opportunity recorded as both", () => {
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { triggers: triggers("long", "long") }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "triggered",
    at: "2026-09-07T14:05:00.000Z",
    trigger: "both",
  });
});

Deno.test("a setup that stays eligible for several bars is still one opportunity", () => {
  const result = evaluatePullback([
    touchBar(0),
    touchBar(1),
    touchBar(2, { triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].touchBars, 2);
  assertEquals(
    result.barOutcomes.filter((outcome) => outcome.reason.startsWith("duplicate_of:"))
      .length,
    1,
  );
});

Deno.test("closing far enough through the anchor invalidates the setup", () => {
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { low: 98, high: 100, close: 98.4 }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:05:00.000Z",
    reason: "invalidated:closed_through_anchor",
  });
});

Deno.test("invalidation is checked before the trigger on the same bar", () => {
  // The bar both closes through the anchor and shows a long flip. With bar data
  // alone the order inside the bar is unknown, so the unfavourable reading wins.
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { low: 98, high: 100, close: 98.4, triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities[0].outcome.kind, "rejected");
});

Deno.test("a close just short of the invalidation distance leaves the setup open", () => {
  // Anchor 100, distance 0.75 * 2 = 1.50, so 98.5 is not yet through.
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { low: 98.4, high: 100, close: 98.5 }),
    bar(2, { low: 99.6, high: 101, close: 100.5, triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome.kind, "triggered");
});

Deno.test("the bias flipping invalidates a setup that has not triggered", () => {
  const result = evaluatePullback([
    touchBar(0),
    bar(1, { bias: "bearish" }),
  ], contract);

  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:05:00.000Z",
    reason: "invalidated:bias_flipped",
  });
});

Deno.test("an evaluable trigger that never fires expires unfired", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers(null, null) }),
    bar(1, { triggers: triggers(null, null) }),
    bar(2, { triggers: triggers(null, null) }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:10:00.000Z",
    reason: "expired_unfired",
  });
});

Deno.test("a setup whose triggers were never evaluable is unavailable, not unfired", () => {
  // This is the distinction the spec turns into a rule: a strategy that could
  // not look is not a strategy that looked and declined.
  const result = evaluatePullback([
    touchBar(0),
    bar(1),
    bar(2),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:10:00.000Z",
    reason: "data_unavailable:footprint",
  });
});

Deno.test("only an opposing trigger, then expiry, is a direction conflict", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers("short") }),
    bar(1, { triggers: triggers(null) }),
    bar(2, { triggers: triggers(null) }),
  ], contract);

  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:10:00.000Z",
    reason: "direction_conflict",
  });
});

Deno.test("no volatility window means insufficient_history, not no_setup", () => {
  const result = evaluatePullback([
    touchBar(0, { medianTrueRange: null }),
  ], contract);

  assertEquals(result.opportunities.length, 0);
  assertEquals(result.barOutcomes, [{
    decisionAt: "2026-09-07T14:00:00.000Z",
    anchorIdentity: "prev_day_low",
    reason: "insufficient_history",
  }]);
  assertEquals(result.diagnostics.barsWithoutVolatility, 1);
});

Deno.test("a missing anchor names the input that was missing", () => {
  const result = evaluatePullback([
    touchBar(0, { anchors: [anchor(null)] }),
  ], contract);

  assertEquals(result.barOutcomes[0].reason, "data_unavailable:trading_day");
});

Deno.test("a broken profile closes only the path that needs the profile", () => {
  // The owner's fourth objection as an executable rule: on 2026-09-07 the
  // profile was unusable on 30.5% of MNQU6 bars, and a bar-extreme anchor is
  // untouched by that.
  const twoPaths: PullbackContract = {
    ...contract,
    anchorIdentities: ["prev_day_low", "vwap"],
  };
  const result = evaluatePullback([
    touchBar(0, {
      anchors: [anchor(100), anchor(null, "vwap")],
      triggers: triggers("long"),
    }),
  ], twoPaths);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].anchorIdentity, "prev_day_low");
  assertEquals(result.barOutcomes, [{
    decisionAt: "2026-09-07T14:00:00.000Z",
    anchorIdentity: "vwap",
    reason: "data_unavailable:profile",
  }]);
});

Deno.test("the zone is measured in true ranges, so the same prices decide differently", () => {
  // Identical geometry: low 99.0 against an anchor at 100, i.e. 1.00 away.
  const wide = evaluatePullback([
    touchBar(0, { low: 99, medianTrueRange: 4, triggers: triggers("long") }),
  ], contract);
  const narrow = evaluatePullback([
    touchBar(0, { low: 99, medianTrueRange: 1, triggers: triggers("long") }),
  ], contract);

  assertEquals(wide.opportunities.length, 1); // zone +/-2.00, inside
  assertEquals(narrow.opportunities.length, 0); // zone +/-0.50, outside
  assertEquals(narrow.barOutcomes[0].reason, "no_setup");
});

Deno.test("a bar closing on the wrong side of the anchor is a break, not a pullback", () => {
  const result = evaluatePullback([
    touchBar(0, { low: 99.5, high: 100.2, close: 99.8 }),
  ], contract);

  assertEquals(result.opportunities.length, 0);
  assertEquals(result.barOutcomes[0].reason, "no_setup");
});

Deno.test("a neutral bias is no_setup but an absent bias is unavailable", () => {
  const neutral = evaluatePullback([touchBar(0, { bias: "neutral" })], contract);
  const absent = evaluatePullback([touchBar(0, { bias: null })], contract);

  assertEquals(neutral.barOutcomes[0].reason, "no_setup");
  assertEquals(absent.barOutcomes[0].reason, "data_unavailable:bias");
  assertEquals(neutral.diagnostics.barsWithoutBias, 1);
});

Deno.test("a short setup mirrors the long one", () => {
  const result = evaluatePullback([
    bar(0, {
      bias: "bearish",
      anchors: [anchor(100)],
      low: 98.5,
      high: 100.5,
      close: 99,
      triggers: triggers("short"),
    }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].direction, "short");
  assertEquals(result.opportunities[0].outcome.kind, "triggered");
});

Deno.test("a setup still open when the data ends is right-censored, never mislabeled", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers(null) }),
    bar(1, { triggers: triggers(null) }),
  ], contract);

  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "right_censored",
    at: "2026-09-07T14:05:00.000Z",
    reason: "end_of_data",
  });
});

Deno.test("missing bias cannot authorize a trigger on an open setup", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers(null) }),
    bar(1, { bias: null, triggers: triggers("long") }),
    bar(2, { bias: null, triggers: triggers("long") }),
  ], contract);

  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:10:00.000Z",
    reason: "data_unavailable:bias",
  });
});

Deno.test("missing volatility at expiry is unavailable, not expired unfired", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers(null) }),
    bar(1, { medianTrueRange: null, triggers: triggers(null) }),
    bar(2, { medianTrueRange: null, triggers: triggers(null) }),
  ], contract);

  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T14:10:00.000Z",
    reason: "data_unavailable:volatility",
  });
});

Deno.test("a feed gap closes an open setup instead of treating distant bars as adjacent", () => {
  const result = evaluatePullback([
    touchBar(0, { triggers: triggers(null) }),
    bar(1, {
      openedAt: "2026-09-07T19:00:00.000Z",
      closedAt: "2026-09-07T19:05:00.000Z",
      triggers: triggers("long"),
    }),
  ], contract);

  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: "2026-09-07T19:00:00.000Z",
    reason: "data_unavailable:feed_gap",
  });
});

Deno.test("a live bar cannot decide", () => {
  assertThrows(
    () => evaluatePullback([touchBar(0, { isClosed: false })], contract),
    Error,
    "is not closed",
  );
});

Deno.test("decision bars must be strictly ascending", () => {
  assertThrows(
    () => evaluatePullback([touchBar(1), touchBar(0)], contract),
    Error,
    "strictly ascending",
  );
  assertThrows(
    () => evaluatePullback([touchBar(0), touchBar(0)], contract),
    Error,
    "strictly ascending",
  );
});

Deno.test("the contract refuses values that would make the spec meaningless", () => {
  assertThrows(
    () => evaluatePullback([], { ...contract, zoneProximity: 0 }),
    Error,
    "zoneProximity",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, invalidationDistance: -1 }),
    Error,
    "invalidationDistance",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, setupMaxAgeBars: 0 }),
    Error,
    "setupMaxAgeBars",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, maxBarSpacingMs: 0 }),
    Error,
    "maxBarSpacingMs",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, anchorIdentities: [] }),
    Error,
    "anchor identity",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, triggerKinds: [] }),
    Error,
    "trigger kind",
  );
  assertThrows(
    () => evaluatePullback([], { ...contract, anchorIdentities: ["a", "a"] }),
    Error,
    "unique",
  );
});

// ------------------------------------------------------- setups that survive
//
// The live rule sees one bar per invocation. These cover the seam that creates:
// a setup opened on one call and confirmed on another must be one opportunity,
// and must be indistinguishable from the same bars evaluated in one pass.

Deno.test("an unresolved setup is handed back instead of censored, when it can be resumed", () => {
  const result = evaluatePullback([touchBar(0)], contract, {
    open: [],
    lastDecisionAt: null,
  });

  assertEquals(result.opportunities.length, 0);
  assertEquals(result.open.length, 1);
  assertEquals(result.open[0].anchorTouchId, "prev_day_low@2026-09-07T14:00:00.000Z");
  assertEquals(result.open[0].ageBars, 1);
  assertEquals(result.open[0].lastSeenAt, "2026-09-07T14:00:00.000Z");
});

Deno.test("a run that cannot be resumed still right-censors what is open", () => {
  const result = evaluatePullback([touchBar(0)], contract);

  assertEquals(result.open.length, 0);
  assertEquals(result.opportunities.length, 1);
  assertEquals(result.opportunities[0].outcome.kind, "right_censored");
});

Deno.test("a setup carried across calls triggers exactly as it would in one pass", () => {
  const bars = [touchBar(0), bar(1, { triggers: triggers("long") })];

  const whole = evaluatePullback(bars, contract);

  const first = evaluatePullback([bars[0]], contract, { open: [], lastDecisionAt: null });
  const second = evaluatePullback([bars[1]], contract, {
    open: first.open,
    lastDecisionAt: bars[0].openedAt,
  });

  assertEquals(second.opportunities.length, 1);
  assertEquals(second.open.length, 0);
  // The whole-run pass is the reference: same touch id, same outcome, one event.
  assertEquals(
    second.opportunities[0].anchorTouchId,
    whole.opportunities[0].anchorTouchId,
  );
  assertEquals(second.opportunities[0].outcome, whole.opportunities[0].outcome);
  assertEquals(second.opportunities[0].ageBars, whole.opportunities[0].ageBars);
});

Deno.test("a gap across the resume boundary closes the carried setup", () => {
  const first = evaluatePullback([touchBar(0)], contract, {
    open: [],
    lastDecisionAt: null,
  });
  // Five hours later: the contract's spacing tolerance is five minutes.
  const later = bar(0, {
    openedAt: "2026-09-07T19:00:00.000Z",
    closedAt: "2026-09-07T19:05:00.000Z",
    triggers: triggers("long"),
  });

  const second = evaluatePullback([later], contract, {
    open: first.open,
    lastDecisionAt: "2026-09-07T14:00:00.000Z",
  });

  assertEquals(second.opportunities.length, 1);
  assertEquals(second.opportunities[0].outcome, {
    kind: "rejected",
    at: later.openedAt,
    reason: "data_unavailable:feed_gap",
  });
});

Deno.test("carried state that cannot belong to this run is refused", () => {
  const open = evaluatePullback([touchBar(0)], contract, {
    open: [],
    lastDecisionAt: null,
  }).open;
  const carried = open[0];

  // An anchor this contract does not use.
  assertThrows(
    () =>
      evaluatePullback([bar(1)], contract, {
        open: [{ ...carried, anchorIdentity: "vwap" }],
        lastDecisionAt: null,
      }),
    Error,
    "which this contract does not use",
  );

  // Two setups on one anchor would count one event twice.
  assertThrows(
    () =>
      evaluatePullback([bar(1)], contract, {
        open: [carried, { ...carried }],
        lastDecisionAt: null,
      }),
    Error,
    "share anchor",
  );

  // A setup that has already seen the bar about to be judged.
  assertThrows(
    () =>
      evaluatePullback([bar(1)], contract, {
        open: [{ ...carried, lastSeenAt: "2026-09-07T14:05:00.000Z" }],
        lastDecisionAt: null,
      }),
    Error,
    "already saw the first bar",
  );

  // Older than the contract allows: the previous run owed it a close.
  assertThrows(
    () =>
      evaluatePullback([bar(1)], contract, {
        open: [{ ...carried, ageBars: contract.setupMaxAgeBars }],
        lastDecisionAt: null,
      }),
    Error,
    "older than the contract allows",
  );

  // A boundary that is not before the first bar hides a gap.
  assertThrows(
    () =>
      evaluatePullback([bar(1)], contract, {
        open: [],
        lastDecisionAt: "2026-09-07T14:05:00.000Z",
      } as PullbackCarry),
    Error,
    "not before the first bar",
  );
});

Deno.test("a carried setup expires on the bar that reaches the age limit", () => {
  // setupMaxAgeBars is 3 in this contract: touch, then two bars, then expiry.
  let carry: PullbackCarry = { open: [], lastDecisionAt: null };
  const bars = [
    touchBar(0),
    bar(1, { triggers: triggers(null) }),
    bar(2, {
      triggers: triggers(null),
    }),
  ];

  const outcomes = [];
  for (const [index, decision] of bars.entries()) {
    const step = evaluatePullback([decision], contract, carry);
    outcomes.push(...step.opportunities);
    carry = {
      open: step.open,
      lastDecisionAt: bars[index].openedAt,
    };
  }

  assertEquals(carry.open.length, 0);
  assertEquals(outcomes.length, 1);
  assertEquals(outcomes[0].ageBars, 3);
  assertEquals(outcomes[0].outcome, {
    kind: "rejected",
    at: bars[2].openedAt,
    reason: "expired_unfired",
  });
});
