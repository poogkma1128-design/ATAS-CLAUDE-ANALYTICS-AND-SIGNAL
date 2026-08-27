import { assertEquals, assertExists } from "jsr:@std/assert@1";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { BarInput, ClusterLevel, IngestPayload } from "./types.ts";
import { ingest, validate } from "./ingest.ts";

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

  upsert(...a: unknown[]) { return this.push("upsert", a); }
  insert(...a: unknown[]) { return this.push("insert", a); }
  update(...a: unknown[]) { return this.push("update", a); }
  select(...a: unknown[]) { return this.push("select", a); }
  eq(...a: unknown[]) { return this.push("eq", a); }
  lt(...a: unknown[]) { return this.push("lt", a); }
  order(...a: unknown[]) { return this.push("order", a); }
  limit(...a: unknown[]) { return this.push("limit", a); }

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

  /** The payload handed to the first matching write. */
  argsFor(table: string, op: string, index = 0): Record<string, unknown> {
    const call = this.callsFor(table, op)[index];
    assertExists(call, `expected a ${op} on ${table}`);
    return call.ops[0].args[0] as Record<string, unknown>;
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
  horizon_bars: 10,
  params: { ratio: 3, minVolume: 10, stack: 3 },
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

function readyClient(): StubClient {
  return new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: [STACKED_RULE], error: null })
    .queue("bars.upsert", { data: { id: 101 }, error: null })
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
  assertEquals(client.argsFor("bars", "upsert").poc_price, 100.5);
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

Deno.test("ingest: bars in one request are written oldest first", async () => {
  const client = new StubClient()
    .queue("instruments.upsert", { data: { id: "inst-1" }, error: null })
    .queue("rules.select", { data: [STACKED_RULE], error: null })
    .queue(
      "bars.upsert",
      { data: { id: 101 }, error: null },
      { data: { id: 102 }, error: null },
      { data: { id: 103 }, error: null },
    )
    .queue("bars.select", { data: [], error: null }, { data: [], error: null }, {
      data: [],
      error: null,
    })
    .queue("signals.upsert", { data: [], error: null }, { data: [], error: null }, {
      data: [],
      error: null,
    });

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

  const written = client
    .callsFor("bars", "upsert")
    .map((c) => (c.ops[0].args[0] as Record<string, unknown>).opened_at);

  assertEquals(written, [
    "2026-08-27T10:00:00.000Z",
    "2026-08-27T10:05:00.000Z",
    "2026-08-27T10:10:00.000Z",
  ]);
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
    .queue("bars.upsert", { data: { id: 101 }, error: null })
    .queue("bars.select", { data: [], error: null });

  const result = await ingest(client.asClient(), payload());

  assertEquals(result.signalsCreated, 0);
  assertEquals(client.callsFor("signals", "upsert").length, 0);
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

Deno.test("ingest: a bar with no footprint still stores cleanly", async () => {
  const client = readyClient();

  const result = await ingest(
    client.asClient(),
    payload({ bars: [bar({ levels: [], isClosed: false })] }),
  );

  assertEquals(result.barsWritten, 1);
  assertEquals(result.levelsWritten, 0);
  assertEquals(client.callsFor("cluster_levels", "upsert").length, 0);
  assertEquals(client.argsFor("bars", "upsert").poc_price, null);
});
