import { assertEquals, assertExists } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BarInput, ClusterLevel, IngestPayload, RuleRow } from "./types.ts";
import { conflictedActionableBars, ingest, validate } from "./ingest.ts";

// ---------------------------------------------------------------- stub client
//
// A minimal stand-in for the supabase-js query builder: every call is recorded
// and every terminal await returns a canned result queued by `table.operation`.

interface StubResult {
  data: unknown;
  error: { message: string } | null;
}

interface RecordedCall {
  table: string;
  ops: { name: string; args: unknown[] }[];
}

class StubBuilder implements PromiseLike<StubResult> {
  private ops: { name: string; args: unknown[] }[] = [];

  constructor(private table: string, private client: StubClient) {}

  private push(name: string, args: unknown[]): this {
    this.ops.push({ name, args });
    return this;
  }

  upsert(...a: unknown[]) {
    return this.push("upsert", a);
  }
  insert(...a: unknown[]) {
    return this.push("insert", a);
  }
  update(...a: unknown[]) {
    return this.push("update", a);
  }
  select(...a: unknown[]) {
    return this.push("select", a);
  }
  eq(...a: unknown[]) {
    return this.push("eq", a);
  }
  lt(...a: unknown[]) {
    return this.push("lt", a);
  }
  order(...a: unknown[]) {
    return this.push("order", a);
  }
  limit(...a: unknown[]) {
    return this.push("limit", a);
  }

  single(): Promise<StubResult> {
    return this.settle({ data: {}, error: null });
  }

  then<A, B>(
    onOk?: ((value: StubResult) => A | PromiseLike<A>) | null,
    onErr?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.settle({ data: [], error: null }).then(onOk, onErr);
  }

  private settle(fallback: StubResult): Promise<StubResult> {
    this.client.calls.push({ table: this.table, ops: this.ops });

    const key = `${this.table}.${this.ops[0]?.name ?? "?"}`;
    const queue = this.client.responses[key];
    const next = queue && queue.length > 0 ? queue.shift()! : fallback;

    return Promise.resolve(next);
  }
}

class StubClient {
  calls: RecordedCall[] = [];
  responses: Record<string, StubResult[]> = {};

  queue(key: string, ...results: StubResult[]): this {
    this.responses[key] = [...(this.responses[key] ?? []), ...results];
    return this;
  }

  from(table: string) {
    return new StubBuilder(table, this);
  }

  /** Every recorded call against `table` whose first operation is `op`. */
  callsFor(table: string, op: string): RecordedCall[] {
    return this.calls.filter((c) => c.table === table && c.ops[0]?.name === op);
  }

  /** The rows handed to the first matching write, which are always batched. */
  rowsFor(table: string, op: string, index = 0): Record<string, unknown>[] {
    const call = this.callsFor(table, op)[index];
    assertExists(call, `expected a ${op} on ${table}`);
    return call.ops[0].args[0] as Record<string, unknown>[];
  }

  asClient(): SupabaseClient {
    return this as unknown as SupabaseClient;
  }
}

// -------------------------------------------------------------------- helpers

const STACKED_RULE = {
  key: "stacked_imbalance",
  name: "Stacked Imbalance",
  enabled: true,
  telegram_enabled: true,
  // Existing ingest tests exercise the explicit owner-override path. The
  // evidence-first integration case below covers the default production mode.
  announcement_mode: "manual" as const,
  horizon_bars: 10,
  params: {
    ratio: 3,
    minVolume: 10,
    stack: 3,
    bufferTicks: 2,
    minRiskTicks: 4,
    rewardRatio: 2,
    trailAfterR: 1,
    trailOffsetR: 0.5,
  },
};

function level(price: number, ask: number, bid: number): ClusterLevel {
  return { price, ask, bid, between: 0, volume: ask + bid, ticks: 1 };
}

/** A footprint that trips the stacked imbalance rule long. */
function imbalancedLevels(): ClusterLevel[] {
  return [
    level(100.00, 2, 5),
    level(100.25, 30, 4),
    level(100.50, 40, 3),
    level(100.75, 35, 2),
    level(101.00, 3, 2),
  ];
}

function bar(overrides: Partial<BarInput> = {}): BarInput {
  return {
    openedAt: "2026-08-27T10:00:00.000Z",
    open: 100,
    high: 101,
    low: 100,
    close: 100.75,
    volume: 126,
    askVolume: 110,
    bidVolume: 16,
    delta: 94,
    minDelta: -5,
    maxDelta: 100,
    ticks: 40,
    trades: 30,
    isClosed: true,
    levels: imbalancedLevels(),
    ...overrides,
  };
}

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    symbol: "ES",
    exchange: "CME",
    tickSize: 0.25,
    timeframe: "5m",
    bars: [bar()],
    ...overrides,
  };
}

function readyClient(rules: RuleRow[] = [STACKED_RULE]): StubClient {
  return new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: rules, error: null })
    .queue("bars.upsert", {
      data: [{ id: 101, opened_at: "2026-08-27T10:00:00.000Z" }],
      error: null,
    })
    .queue("bars.select", { data: [], error: null });
}

// ------------------------------------------------------------------ validation

Deno.test("validate: accepts a well formed payload", () => {
  assertEquals(validate(payload()), null);
});

Deno.test("validate: rejects missing or nonsensical fields", () => {
  assertEquals(validate({ ...payload(), symbol: "" }), "symbol is required");
  assertEquals(validate({ ...payload(), timeframe: "" }), "timeframe is required");
  assertEquals(
    validate({ ...payload(), tickSize: 0 }),
    "tickSize must be a positive number",
  );
  assertEquals(validate({ ...payload(), bars: [] }), "bars must not be empty");
});

Deno.test("validate: rejects an unparseable bar timestamp", () => {
  const bad = payload({ bars: [bar({ openedAt: "not-a-date" })] });
  assertEquals(validate(bad), "bars[0].openedAt must be an ISO timestamp");
});

Deno.test("validate: rejects a non-finite price", () => {
  const bad = payload({ bars: [bar({ high: Number.NaN })] });
  assertEquals(validate(bad), "bars[0].high must be a finite number");
});

Deno.test("validate: caps how much can arrive in one request", () => {
  const many = payload({ bars: Array.from({ length: 201 }, () => bar()) });
  assertEquals(validate(many), "too many bars in one request (max 200)");

  const wide = payload({
    bars: [bar({ levels: Array.from({ length: 2001 }, (_, i) => level(i, 1, 1)) })],
  });
  assertEquals(validate(wide), "bars[0] has too many levels (max 2000)");
});

// --------------------------------------------------------------------- ingest

Deno.test("ingest: stores the bar, its footprint, and the signal it triggers", async () => {
  const client = readyClient().queue("signals.upsert", {
    data: [{
      id: "sig-1",
      rule_key: "stacked_imbalance",
      direction: "long",
      price: 100.75,
      confidence: 0.4,
      payload: {},
      fired_at: "2026-08-27T10:05:00.000Z",
    }],
    error: null,
  });

  const result = await ingest(client.asClient(), payload());

  assertEquals(result, { barsWritten: 1, levelsWritten: 5, signalsCreated: 1 });
});

Deno.test("ingest: records the point of control on the bar", async () => {
  const client = readyClient().queue("signals.upsert", { data: [], error: null });

  await ingest(client.asClient(), payload());

  // 100.50 carries ask 40 + bid 3 = 43, the heaviest level in the footprint.
  assertEquals(client.rowsFor("bars", "upsert")[0].poc_price, 100.5);
});

Deno.test("ingest: an unfinished bar is stored but never judged", async () => {
  const client = readyClient();

  const result = await ingest(
    client.asClient(),
    payload({ bars: [bar({ isClosed: false })] }),
  );

  assertEquals(result.barsWritten, 1);
  assertEquals(result.levelsWritten, 5);
  assertEquals(result.signalsCreated, 0);
  assertEquals(client.callsFor("signals", "upsert").length, 0);
  // No history lookup either, since no rule ran.
  assertEquals(client.callsFor("bars", "select").length, 0);
});

Deno.test("ingest: deduplication is delegated to the unique constraint", async () => {
  const client = readyClient().queue("signals.upsert", { data: [], error: null });

  const result = await ingest(client.asClient(), payload());

  const call = client.callsFor("signals", "upsert")[0];
  assertEquals(call.ops[0].args[1], {
    onConflict: "bar_id,rule_key,direction",
    ignoreDuplicates: true,
  });
  // Empty result means the row already existed: nothing new to announce.
  assertEquals(result.signalsCreated, 0);
});

Deno.test("ingest: bars in one request go up as one ordered batch", async () => {
  const client = new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: [STACKED_RULE], error: null })
    .queue("bars.upsert", {
      data: [
        // Deliberately out of order: ids are matched on the timestamp, not on
        // the position PostgREST happens to return them in.
        { id: 103, opened_at: "2026-08-27T10:10:00.000Z" },
        { id: 101, opened_at: "2026-08-27T10:00:00.000Z" },
        { id: 102, opened_at: "2026-08-27T10:05:00.000Z" },
      ],
      error: null,
    })
    .queue("bars.select", { data: [], error: null })
    .queue("signals.upsert", { data: [], error: null });

  await ingest(
    client.asClient(),
    payload({
      bars: [
        bar({ openedAt: "2026-08-27T10:10:00.000Z" }),
        bar({ openedAt: "2026-08-27T10:00:00.000Z" }),
        bar({ openedAt: "2026-08-27T10:05:00.000Z" }),
      ],
    }),
  );

  // One request for all three bars, oldest first.
  assertEquals(client.callsFor("bars", "upsert").length, 1);
  assertEquals(
    client.rowsFor("bars", "upsert").map((row) => row.opened_at),
    [
      "2026-08-27T10:00:00.000Z",
      "2026-08-27T10:05:00.000Z",
      "2026-08-27T10:10:00.000Z",
    ],
  );

  // Every footprint in one request too, each row carrying the id its own bar
  // came back with.
  assertEquals(client.callsFor("cluster_levels", "upsert").length, 1);
  const levelBarIds = client.rowsFor("cluster_levels", "upsert").map((r) => r.bar_id);
  assertEquals(levelBarIds.slice(0, 5), [101, 101, 101, 101, 101]);
  assertEquals(levelBarIds.slice(-5), [103, 103, 103, 103, 103]);

  // And history is read once for the batch, not once per bar.
  assertEquals(client.callsFor("bars", "select").length, 1);
});

Deno.test("ingest: a bar repeated in one request is collapsed, not sent twice", async () => {
  // Postgres rejects an ON CONFLICT batch that hits the same key twice, so a
  // duplicated timestamp has to be folded before the batch is sent.
  const client = readyClient().queue("signals.upsert", { data: [], error: null });

  const result = await ingest(
    client.asClient(),
    payload({ bars: [bar({ close: 100.5 }), bar({ close: 100.75 })] }),
  );

  const rows = client.rowsFor("bars", "upsert");
  assertEquals(rows.length, 1);
  // The later copy wins: within one request it is the more complete one.
  assertEquals(rows[0].close, 100.75);
  assertEquals(result.barsWritten, 1);
});

Deno.test("ingest: a footprint batch is chunked rather than sent whole", async () => {
  const wide = Array.from({ length: 1200 }, (_, i) => level(i * 0.25, 1, 1));
  const client = readyClient();

  const result = await ingest(
    client.asClient(),
    payload({ bars: [bar({ levels: wide, isClosed: false })] }),
  );

  assertEquals(result.levelsWritten, 1200);
  const chunks = client.callsFor("cluster_levels", "upsert");
  assertEquals(chunks.length, 2);
  assertEquals(client.rowsFor("cluster_levels", "upsert", 0).length, 1000);
  assertEquals(client.rowsFor("cluster_levels", "upsert", 1).length, 200);
});

Deno.test("ingest: history is scoped to the same instrument, timeframe and past", async () => {
  const client = readyClient().queue("signals.upsert", { data: [], error: null });

  await ingest(client.asClient(), payload());

  const call = client.callsFor("bars", "select")[0];
  const names = call.ops.map((o) => o.name);
  assertEquals(names, ["select", "eq", "eq", "eq", "lt", "order", "limit"]);

  assertEquals(call.ops[1].args, ["instrument_id", "inst-1"]);
  assertEquals(call.ops[2].args, ["timeframe", "5m"]);
  assertEquals(call.ops[3].args, ["is_closed", true]);
  assertEquals(call.ops[4].args, ["opened_at", "2026-08-27T10:00:00.000Z"]);
});

Deno.test("ingest: a disabled rule produces nothing", async () => {
  const client = new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: [], error: null })
    .queue("bars.upsert", {
      data: [{ id: 101, opened_at: "2026-08-27T10:00:00.000Z" }],
      error: null,
    });

  const result = await ingest(client.asClient(), payload());

  assertEquals(result.signalsCreated, 0);
  assertEquals(client.callsFor("signals", "upsert").length, 0);
  // Nothing to judge, so history is never read either.
  assertEquals(client.callsFor("bars", "select").length, 0);
});

Deno.test("ingest: a database error is surfaced, not swallowed", async () => {
  const client = new StubClient().queue("instruments.upsert", {
    data: null,
    error: { message: "permission denied" },
  });

  let message = "";
  try {
    await ingest(client.asClient(), payload());
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assertEquals(message, "instrument upsert failed: permission denied");
});

Deno.test("ingest: a multi-bar batch is stored but not announced", async () => {
  // Startup backfill arrives as one request carrying the whole visible history.
  // Those bars closed long ago, so their signals belong in the database and the
  // statistics but must not reach anyone's phone.
  const client = new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: [STACKED_RULE], error: null })
    .queue("bars.upsert", {
      data: [
        { id: 101, opened_at: "2026-08-27T10:00:00.000Z" },
        { id: 102, opened_at: "2026-08-27T10:05:00.000Z" },
      ],
      error: null,
    })
    .queue("bars.select", { data: [], error: null })
    .queue("signals.upsert", {
      data: [
        {
          id: "sig-1",
          rule_key: "stacked_imbalance",
          direction: "long",
          price: 100.75,
          confidence: 0.4,
          payload: {},
          fired_at: "2026-08-27T10:05:00.000Z",
        },
        {
          id: "sig-2",
          rule_key: "stacked_imbalance",
          direction: "long",
          price: 100.75,
          confidence: 0.4,
          payload: {},
          fired_at: "2026-08-27T10:10:00.000Z",
        },
      ],
      error: null,
    });

  const result = await ingest(
    client.asClient(),
    payload({
      bars: [
        bar({ openedAt: "2026-08-27T10:00:00.000Z" }),
        bar({ openedAt: "2026-08-27T10:05:00.000Z" }),
      ],
    }),
  );

  // Both signals are persisted and counted.
  assertEquals(result.signalsCreated, 2);

  // Announcing writes the telegram id back onto the signal row. No update means
  // nothing was sent.
  assertEquals(client.callsFor("signals", "update").length, 0);
});

Deno.test("ingest: a single closed bar is the live case and may be announced", async () => {
  const client = readyClient().queue("signals.upsert", {
    data: [{
      id: "sig-1",
      rule_key: "stacked_imbalance",
      direction: "long",
      price: 100.75,
      confidence: 0.4,
      payload: {},
      fired_at: "2026-08-27T10:05:00.000Z",
    }],
    error: null,
  });

  const result = await ingest(client.asClient(), payload());

  assertEquals(result.signalsCreated, 1);
  // Telegram is unconfigured in tests, so announce returns before sending; the
  // point here is that the single-bar path is not short-circuited as history.
  assertEquals(client.callsFor("signals", "upsert").length, 1);
});

Deno.test("ingest: evidence-first snapshots an unproven signal as muted", async () => {
  const evidenceFirst = { ...STACKED_RULE, announcement_mode: "evidence_first" as const };
  const client = readyClient([evidenceFirst])
    .queue("setup_stability.select", { data: [], error: null })
    .queue("signals.upsert", { data: [], error: null });

  await ingest(client.asClient(), payload());

  const gate = client.callsFor("setup_stability", "select")[0];
  assertEquals(gate.ops.map((op) => op.args), [
    ["rule_key, direction"],
    ["symbol", "ES"],
    ["timeframe", "5m"],
    ["verdict", "proposable"],
    ["proposal", "keep"],
  ]);
  assertEquals(client.rowsFor("signals", "upsert")[0].muted, true);
});

Deno.test("ingest: a shadow instrument remains measured but cannot announce", async () => {
  const client = readyClient()
    .queue("instrument_signal_policies.select", {
      data: [{ role: "shadow" }],
      error: null,
    })
    .queue("signals.upsert", { data: [], error: null });

  await ingest(client.asClient(), payload({ symbol: "NQU6" }));

  const row = client.rowsFor("signals", "upsert")[0];
  assertEquals(row.muted, true);
  assertEquals(row.suppression_reason, "shadow_instrument");
});

Deno.test("ingest: identifies opposite actionable directions on one bar", () => {
  const conflicted = conflictedActionableBars([
    { bar_id: 101, direction: "long", muted: false },
    { bar_id: 101, direction: "short", muted: false },
    { bar_id: 102, direction: "long", muted: false },
    { bar_id: 102, direction: "short", muted: true },
  ]);

  assertEquals([...conflicted], [101]);
});

Deno.test("ingest: the signal carries the whole trade, not just a direction", async () => {
  const client = readyClient().queue("signals.upsert", { data: [], error: null });

  await ingest(client.asClient(), payload());

  const row = client.rowsFor("signals", "upsert")[0];

  // Bar closes 100.75 with a low of 100.00: 3 ticks of bar plus the 2 tick
  // buffer is 5 ticks of risk, and the default 2R target is 10 ticks out.
  assertEquals(row.entry_price, 100.75);
  assertEquals(row.risk_ticks, 5);
  assertEquals(row.stop_price, 99.5);
  assertEquals(row.reward_ticks, 10);
  assertEquals(row.target_price, 103.25);

  // The trail and the horizon travel with the signal so that retuning the rule
  // later cannot rewrite trades already taken.
  assertEquals(row.trail_trigger_ticks, 5);
  assertEquals(row.trail_offset_ticks, 2.5);
  assertEquals(row.hold_bars, 10);
});

Deno.test("ingest: a bar with no footprint still stores cleanly", async () => {
  const client = readyClient();

  const result = await ingest(
    client.asClient(),
    payload({ bars: [bar({ levels: [], isClosed: false })] }),
  );

  assertEquals(result.barsWritten, 1);
  assertEquals(result.levelsWritten, 0);
  assertEquals(client.callsFor("cluster_levels", "upsert").length, 0);
  assertEquals(client.rowsFor("bars", "upsert")[0].poc_price, null);
});
