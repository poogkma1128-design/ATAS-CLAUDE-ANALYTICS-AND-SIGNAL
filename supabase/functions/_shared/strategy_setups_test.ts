import type { PullbackCarry, PullbackOpportunity } from "./strategy/pullback.ts";
import { persistStrategyCarry } from "./strategy_setups.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

interface Call {
  operation: string;
  args: unknown[];
}

class Builder implements PromiseLike<{ data: unknown[]; error: null }> {
  constructor(
    private calls: Call[],
    private updateRows: unknown[] = [],
    private operation = "",
  ) {}
  upsert(...args: unknown[]) {
    this.operation = "upsert";
    this.calls.push({ operation: this.operation, args });
    return this;
  }
  insert(...args: unknown[]) {
    this.operation = "insert";
    this.calls.push({ operation: this.operation, args });
    return this;
  }
  update(...args: unknown[]) {
    this.operation = "update";
    this.calls.push({ operation: this.operation, args });
    return this;
  }
  select() {
    return this;
  }
  eq() {
    return this;
  }
  in() {
    return this;
  }
  then<A, B>(
    onOk?: ((value: { data: unknown[]; error: null }) => A | PromiseLike<A>) | null,
    onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const data = this.operation === "update" ? this.updateRows : [];
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  }
}

function client(
  calls: Call[],
  updateRows: unknown[] = [],
): Parameters<typeof persistStrategyCarry>[0] {
  return { from: () => new Builder(calls, updateRows) } as unknown as Parameters<
    typeof persistStrategyCarry
  >[0];
}

const scope = { instrumentId: "00000000-0000-4000-8000-000000000001", timeframe: "5m" };
const empty: PullbackCarry = { open: [], lastDecisionAt: null };
const open = {
  anchorIdentity: "prev_day_high",
  anchorTouchId: "prev_day_high@2026-09-08T03:10:00.000Z",
  direction: "long" as const,
  openedAt: "2026-09-08T03:10:00.000Z",
  lastSeenAt: "2026-09-08T03:10:00.000Z",
  anchorPrice: 29684.25,
  touchBars: 1,
  ageBars: 1,
  sawEvaluableTrigger: false,
  sawOpposingTrigger: false,
  sawMissingBias: false,
  sawMissingVolatility: false,
};

Deno.test("strategy setup opens with an idempotent upsert", async () => {
  const calls: Call[] = [];

  await persistStrategyCarry(
    client(calls),
    scope,
    "mnq_pullback_v1",
    "contract-1",
    empty,
    { open: [open], lastDecisionAt: open.lastSeenAt },
    [],
  );

  assertEquals(calls.map((call) => call.operation), ["upsert"]);
  assertEquals(calls[0].args[1], {
    onConflict: "strategy_key,instrument_id,timeframe,anchor_touch_id",
    ignoreDuplicates: true,
  });
});

Deno.test("strategy setup resolution upserts the same touch instead of duplicating it", async () => {
  const calls: Call[] = [];
  const resolved: PullbackOpportunity = {
    strategyKey: "MNQ_PULLBACK_V1",
    contractVersion: "contract-1",
    anchorIdentity: open.anchorIdentity,
    anchorTouchId: open.anchorTouchId,
    direction: open.direction,
    openedAt: open.openedAt,
    anchorPrice: open.anchorPrice,
    touchBars: 1,
    ageBars: 2,
    score: null,
    outcome: {
      kind: "triggered",
      at: "2026-09-08T03:15:00.000Z",
      trigger: "stacked_imbalance",
    },
  };

  await persistStrategyCarry(
    client(calls),
    scope,
    "mnq_pullback_v1",
    "contract-1",
    empty,
    empty,
    [resolved],
  );

  assertEquals(calls.map((call) => call.operation), ["update", "upsert"]);
  assertEquals(calls[1].args[1], {
    onConflict: "strategy_key,instrument_id,timeframe,anchor_touch_id",
    ignoreDuplicates: true,
  });
  assertEquals((calls[1].args[0] as Record<string, unknown>).status, "triggered");
});

Deno.test("strategy setup resolution updates an existing open touch", async () => {
  const calls: Call[] = [];
  const resolved: PullbackOpportunity = {
    strategyKey: "MNQ_PULLBACK_V1",
    contractVersion: "contract-1",
    anchorIdentity: open.anchorIdentity,
    anchorTouchId: open.anchorTouchId,
    direction: open.direction,
    openedAt: open.openedAt,
    anchorPrice: open.anchorPrice,
    touchBars: 1,
    ageBars: 2,
    score: null,
    outcome: {
      kind: "triggered",
      at: "2026-09-08T03:15:00.000Z",
      trigger: "stacked_imbalance",
    },
  };

  await persistStrategyCarry(
    client(calls, [{ id: 1 }]),
    scope,
    "mnq_pullback_v1",
    "contract-1",
    empty,
    empty,
    [resolved],
  );

  assertEquals(calls.map((call) => call.operation), ["update"]);
});
