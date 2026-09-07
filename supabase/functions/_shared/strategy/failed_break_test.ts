import { assertEquals } from "jsr:@std/assert@1";
import {
  evaluateFailedBreak,
  type FailedBreakCarry,
  type FailedBreakContract,
  type FailedBreakDecisionBar,
} from "./failed_break.ts";

const contract: FailedBreakContract = {
  version: "TEST@1",
  strategyKey: "MNQ_REVERSAL_V1",
  setupMaxAgeBars: 3,
  maxBarSpacingMs: 6 * 60_000,
  anchorIdentities: ["prev_day_low"],
  triggerKinds: ["absorption", "delta_divergence"],
  confirmationMode: "order_flow",
  invalidationReason: "attempt_resumed",
};

function bar(
  index: number,
  overrides: Partial<FailedBreakDecisionBar> = {},
): FailedBreakDecisionBar {
  return {
    openedAt: new Date(Date.UTC(2026, 8, 7, 14, index * 5)).toISOString(),
    isClosed: true,
    close: 101,
    medianTrueRange: 2,
    anchors: [{
      identity: "prev_day_low",
      price: 100,
      requires: "previous_day_completeness",
      eligibleDirection: null,
    }],
    triggers: [
      { kind: "absorption", available: true, direction: null },
      { kind: "delta_divergence", available: true, direction: null },
    ],
    ...overrides,
  };
}

function eligible(index: number, direction: "long" | "short" = "long") {
  return bar(index, {
    close: direction === "long" ? 101 : 99,
    anchors: [{
      identity: "prev_day_low",
      price: 100,
      requires: "previous_day_completeness",
      eligibleDirection: direction,
    }],
  });
}

Deno.test("failed break: a return may wait for a later order-flow trigger", () => {
  const first = evaluateFailedBreak([eligible(0)], contract, {
    open: [],
    lastDecisionAt: null,
  });
  assertEquals(first.open.length, 1);
  const second = evaluateFailedBreak(
    [
      bar(1, { triggers: [{ kind: "absorption", available: true, direction: "long" }] }),
    ],
    contract,
    { open: first.open, lastDecisionAt: eligible(0).openedAt },
  );
  assertEquals(second.opportunities[0].outcome, {
    kind: "triggered",
    at: bar(1).openedAt,
    trigger: "absorption",
  });
});

Deno.test("failed break: invalidation wins over a trigger on the same bar", () => {
  const first = evaluateFailedBreak([eligible(0)], contract, {
    open: [],
    lastDecisionAt: null,
  });
  const second = evaluateFailedBreak(
    [
      bar(1, {
        close: 99,
        triggers: [{ kind: "absorption", available: true, direction: "long" }],
      }),
    ],
    contract,
    { open: first.open, lastDecisionAt: eligible(0).openedAt },
  );
  assertEquals(second.opportunities[0].outcome, {
    kind: "rejected",
    at: bar(1).openedAt,
    reason: "invalidated:attempt_resumed",
  });
});

Deno.test("failed break: GC Arm 1 enters on the return without order flow", () => {
  const arm1: FailedBreakContract = {
    ...contract,
    strategyKey: "GC_SWEEP_V1",
    confirmationMode: "return_only",
    invalidationReason: "swept_again",
  };
  const result = evaluateFailedBreak([eligible(0)], arm1);
  assertEquals(result.opportunities[0].outcome, {
    kind: "triggered",
    at: eligible(0).openedAt,
    trigger: "return_only",
  });
});

Deno.test("failed break: a gap closes carried state instead of joining distant bars", () => {
  const first = evaluateFailedBreak([eligible(0)], contract, {
    open: [],
    lastDecisionAt: null,
  });
  const later = bar(1, { openedAt: "2026-09-07T19:00:00.000Z" });
  const result = evaluateFailedBreak([later], contract, {
    open: first.open,
    lastDecisionAt: eligible(0).openedAt,
  });
  assertEquals(result.opportunities[0].outcome, {
    kind: "rejected",
    at: later.openedAt,
    reason: "data_unavailable:feed_gap",
  });
});

Deno.test("failed break: one eligible event stays one setup across repeated returns", () => {
  let carry: FailedBreakCarry = { open: [], lastDecisionAt: null };
  const resolved = [];
  for (const decision of [eligible(0), eligible(1), eligible(2)]) {
    const result = evaluateFailedBreak([decision], contract, carry);
    resolved.push(...result.opportunities);
    carry = { open: result.open, lastDecisionAt: decision.openedAt };
  }
  assertEquals(carry.open.length, 0);
  assertEquals(resolved.length, 1);
  assertEquals(resolved[0].touchBars, 3);
  assertEquals(resolved[0].outcome, {
    kind: "rejected",
    at: eligible(2).openedAt,
    reason: "expired_unfired",
  });
});
