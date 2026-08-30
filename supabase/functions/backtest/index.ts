import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { ClusterLevel, RuleRow } from "../_shared/types.ts";
import {
  simulate,
  type SimulatedTrade,
  type StoredBar,
  summarise,
} from "../_shared/backtest.ts";

/**
 * Tries a settings change over bars that already happened, and tells nobody.
 *
 * The SQL sweep in docs/queries/risk_floor_sweep.sql can re-price trades the
 * rules already found, which is enough to judge a stop or a trail. It cannot
 * judge a rule's own thresholds, because those change which signals exist at
 * all. Answering that needed a runner, and a runner is only worth having if a
 * bad idea costs nothing: this one writes to experiments and experiment_results
 * and never to public.signals, so there is no path from anything here to
 * Telegram. That is a property of what it writes rather than a flag someone has
 * to remember to set.
 *
 * POST body:
 *   {
 *     "name":    "stacked imbalance ratio",
 *     "note":    "optional prose",
 *     "variants": [
 *       { "label": "ratio 3.5", "ruleKey": "stacked_imbalance",
 *         "params": { "imbalanceRatio": 3.5 } }
 *     ],
 *     "symbols": ["BTCUSDT"],     // optional; default every instrument
 *     "maxBars": 400              // optional; most recent N bars per feed
 *   }
 *
 * Every run also scores a `baseline` variant from the live settings, because a
 * variant's numbers mean nothing on their own: the same bars scored under the
 * settings actually in force are the only thing they can be read against.
 */

/** Cheap enough to be worth running, small enough to finish inside the
 *  function's CPU budget. Both are per request; a wider sweep is several runs. */
const MAX_VARIANTS = 8;
const DEFAULT_MAX_BARS = 400;
const HARD_MAX_BARS = 1000;

/** Below this a feed cannot warm up the rules' lookback and still leave trades
 *  with room to be scored, so it is skipped rather than reported thinly. */
const MIN_BARS_PER_FEED = 70;

/** Bars are fetched with their footprints attached, which is a lot of rows per
 *  bar, so they come back in pages instead of one enormous response. */
const BARS_PER_PAGE = 100;

interface VariantSpec {
  label: string;
  /** Which rule the params belong to. Omitted means "every rule", which is
   *  what a change to plan sizing (bufferTicks, trailAfterR, ...) needs. */
  ruleKey?: string;
  params: Record<string, unknown>;
}

interface RunRequest {
  name: string;
  note?: string;
  variants: VariantSpec[];
  symbols?: string[];
  maxBars?: number;
}

/** One instrument's bars at one timeframe: the unit a simulation runs over. */
interface Feed {
  symbol: string;
  timeframe: string;
  tickSize: number;
  bars: StoredBar[];
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: RunRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }

  const problem = validate(body);
  if (problem) return json({ error: problem }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // After the body, because checking a runner key costs a query and a malformed
  // request can be rejected without one.
  if (!await authorized(req, supabase)) return json({ error: "unauthorized" }, 401);

  const startedAt = Date.now();
  let experimentId: string | null = null;

  try {
    const rules = await loadRules(supabase);
    if (rules.length === 0) return json({ error: "no enabled rules" }, 400);

    const feeds = await loadFeeds(
      supabase,
      body.symbols,
      Math.min(body.maxBars ?? DEFAULT_MAX_BARS, HARD_MAX_BARS),
    );
    const usable = feeds.filter((feed) => feed.bars.length >= MIN_BARS_PER_FEED);
    if (usable.length === 0) return json({ error: "no feed has enough bars" }, 400);

    experimentId = await createExperiment(supabase, body, rules, usable);

    const rows: ResultRow[] = [];
    const summaries: Record<string, unknown>[] = [];

    for (const variant of [BASELINE, ...body.variants]) {
      const effective = applyVariant(rules, variant);

      // Signals whose entry never traded back are kept, not dropped. With a
      // pullback entry they are the trades that ran away without retracing,
      // which skew toward the winners — counting only the fills would make a
      // worse entry look like a better one. Zero unless pullbackShare is set.
      let missed = 0;
      const trades = usable.flatMap((feed) => {
        const run = simulate(feed.bars, effective, feed.tickSize);
        missed += run.missed;
        return run.trades.map((trade) => ({ ...trade, symbol: feed.symbol }));
      });

      rows.push(...resultRows(variant.label, effective, trades, missed));
      summaries.push({ variant: variant.label, missed, ...summarise(trades) });
    }

    await writeResults(supabase, experimentId, rows);
    await finishExperiment(supabase, experimentId, "done");

    return json({
      ok: true,
      experimentId,
      feeds: usable.map((f) => `${f.symbol} ${f.timeframe} (${f.bars.length} bars)`),
      results: summaries,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("backtest failed:", message);

    if (experimentId) {
      await finishExperiment(supabase, experimentId, "failed", message);
    }
    return json({ error: message, experimentId }, 500);
  }
});

// ------------------------------------------------------------------- input

function validate(body: RunRequest): string | null {
  if (!body || typeof body !== "object") return "body must be an object";
  if (typeof body.name !== "string" || body.name.trim() === "") {
    return "name is required";
  }
  if (!Array.isArray(body.variants) || body.variants.length === 0) {
    return "variants must be a non-empty array";
  }
  if (body.variants.length > MAX_VARIANTS) {
    return `too many variants in one run (max ${MAX_VARIANTS})`;
  }

  const seen = new Set<string>();
  for (const [index, variant] of body.variants.entries()) {
    if (!variant || typeof variant !== "object") {
      return `variants[${index}] must be an object`;
    }
    const label = variant.label;
    if (typeof label !== "string" || label.trim() === "") {
      return `variants[${index}].label is required`;
    }
    // The baseline is scored by the runner itself; letting a variant claim the
    // name would put two different things in the same row.
    if (label.trim() === "baseline") return `variants[${index}].label is reserved`;
    if (seen.has(label.trim())) return `duplicate variant label: ${label}`;
    seen.add(label.trim());

    if (!variant.params || typeof variant.params !== "object") {
      return `variants[${index}].params must be an object`;
    }
    if (variant.ruleKey !== undefined && typeof variant.ruleKey !== "string") {
      return `variants[${index}].ruleKey must be a string`;
    }
  }

  if (body.symbols !== undefined && !Array.isArray(body.symbols)) {
    return "symbols must be an array";
  }
  return null;
}

/**
 * Accepts the ingest token, or a key from public.runner_tokens.
 *
 * Not a Supabase JWT: the anon key is published inside the dashboard bundle, so
 * accepting it would let anyone who has loaded the site start runs. A backtest
 * cannot announce anything, but it can read every bar and spend the project's
 * compute, so it is worth a real key.
 *
 * The runner keys exist because the ingest token is not reachable from
 * anywhere else. It lives only in this function's environment, which means the
 * scheduled job that keeps experiments running while the market is closed could
 * never present it. Those keys are stored hashed, so this compares hashes.
 */
async function authorized(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : req.headers.get("x-ingest-token")?.trim() ?? "";

  if (presented === "") return false;

  const ingestToken = Deno.env.get("INGEST_TOKEN");
  if (ingestToken && timingSafeEqual(presented, ingestToken)) return true;

  return await isRunnerToken(supabase, presented);
}

async function isRunnerToken(
  supabase: SupabaseClient,
  presented: string,
): Promise<boolean> {
  const hash = await sha256Hex(presented);

  // Looked up by hash rather than compared in this process, so the plaintext
  // never has to exist anywhere but in the caller's hands.
  const { data, error } = await supabase
    .from("runner_tokens")
    .select("id")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error) {
    console.error("runner token lookup failed:", error.message);
    return false;
  }
  if (!data) return false;

  // Diagnostic: an unused key is one that can be revoked without asking.
  const { error: touchError } = await supabase
    .from("runner_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id as string);

  if (touchError) console.error("runner token touch failed:", touchError.message);

  return true;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);

  return diff === 0;
}

// ------------------------------------------------------------------- rules

async function loadRules(supabase: SupabaseClient): Promise<RuleRow[]> {
  const { data, error } = await supabase
    .from("rules")
    .select("key, name, enabled, telegram_enabled, horizon_bars, params")
    .eq("enabled", true)
    .order("key");

  if (error) throw new Error(`rules load failed: ${error.message}`);
  return (data ?? []) as RuleRow[];
}

/** The settings actually in force, scored alongside every run. Empty params
 *  means applyVariant hands back the live rules untouched. */
const BASELINE: VariantSpec = { label: "baseline", params: {} };

/**
 * Produces the rule set a variant describes.
 *
 * The params are merged onto the live ones rather than replacing them, so a
 * variant says only what it changes and stays readable next to the baseline.
 */
function applyVariant(rules: RuleRow[], variant: VariantSpec): RuleRow[] {
  const changed = Object.keys(variant.params).length > 0;
  if (!changed) return rules;

  return rules.map((rule) => {
    if (variant.ruleKey && variant.ruleKey !== rule.key) return rule;
    return { ...rule, params: { ...(rule.params ?? {}), ...variant.params } };
  });
}

function paramsOf(rules: RuleRow[]): Record<string, unknown> {
  return Object.fromEntries(rules.map((rule) => [rule.key, rule.params ?? {}]));
}

// -------------------------------------------------------------------- bars

/**
 * Loads every instrument's closed bars with their footprints attached.
 *
 * The footprint is what the rules read, so it cannot be left behind, and it is
 * roughly a hundred rows per bar. Fetching it as an embedded select costs one
 * round trip per page instead of one per bar.
 */
async function loadFeeds(
  supabase: SupabaseClient,
  symbols: string[] | undefined,
  maxBars: number,
): Promise<Feed[]> {
  let query = supabase.from("instruments").select("id, symbol, tick_size");
  if (symbols && symbols.length > 0) query = query.in("symbol", symbols);

  const { data, error } = await query;
  if (error) throw new Error(`instrument load failed: ${error.message}`);

  const feeds: Feed[] = [];
  for (const row of (data ?? []) as InstrumentRow[]) {
    const tickSize = Number(row.tick_size);
    if (!(tickSize > 0)) continue;

    for (const [timeframe, bars] of await loadBars(supabase, row.id, maxBars)) {
      feeds.push({ symbol: row.symbol, timeframe, tickSize, bars });
    }
  }

  return feeds;
}

interface InstrumentRow {
  id: string;
  symbol: string;
  tick_size: number;
}

interface BarPageRow {
  opened_at: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ask_volume: number;
  bid_volume: number;
  delta: number;
  min_delta: number;
  max_delta: number;
  ticks: number;
  trades: number;
  cluster_levels: ClusterLevel[] | null;
}

const BAR_COLUMNS =
  "opened_at, timeframe, open, high, low, close, volume, ask_volume, bid_volume, delta, min_delta, max_delta, ticks, trades, cluster_levels(price, ask, bid, between, volume, ticks)";

async function loadBars(
  supabase: SupabaseClient,
  instrumentId: string,
  maxBars: number,
): Promise<Map<string, StoredBar[]>> {
  const collected: BarPageRow[] = [];

  // Newest first so that a cap keeps the most recent bars, which are the ones a
  // decision is actually about; the order is undone before simulating.
  for (let from = 0; from < maxBars; from += BARS_PER_PAGE) {
    const to = Math.min(from + BARS_PER_PAGE, maxBars) - 1;
    const { data, error } = await supabase
      .from("bars")
      .select(BAR_COLUMNS)
      .eq("instrument_id", instrumentId)
      .eq("is_closed", true)
      .order("opened_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`bar load failed: ${error.message}`);

    const page = (data ?? []) as unknown as BarPageRow[];
    collected.push(...page);
    if (page.length < to - from + 1) break;
  }

  const byTimeframe = new Map<string, StoredBar[]>();
  for (const row of collected.reverse()) {
    const list = byTimeframe.get(row.timeframe) ?? [];
    list.push(asStoredBar(row));
    byTimeframe.set(row.timeframe, list);
  }

  return byTimeframe;
}

function asStoredBar(row: BarPageRow): StoredBar {
  return {
    openedAt: row.opened_at,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    askVolume: Number(row.ask_volume),
    bidVolume: Number(row.bid_volume),
    delta: Number(row.delta),
    minDelta: Number(row.min_delta),
    maxDelta: Number(row.max_delta),
    ticks: Number(row.ticks),
    trades: Number(row.trades),
    levels: (row.cluster_levels ?? []).map((level) => ({
      price: Number(level.price),
      ask: Number(level.ask),
      bid: Number(level.bid),
      between: Number(level.between),
      volume: Number(level.volume),
      ticks: Number(level.ticks),
    })),
  };
}

// ----------------------------------------------------------------- results

type TaggedTrade = SimulatedTrade & { symbol: string };

interface ResultRow {
  variant: string;
  params: Record<string, unknown>;
  symbol: string | null;
  rule_key: string | null;
  direction: string | null;
  trades: number;
  wins: number;
  win_rate: number;
  total_r: number;
  hit_target: number;
  hit_stop: number;
  hit_trail: number;
  timed_out: number;
  max_drawdown_r: number;
  worst_losing_streak: number;
  /** Only on a variant's total row: the breakdowns cannot own a share of it,
   *  because a signal that never filled has no rule or instrument outcome to
   *  be attributed to. Splitting it would be inventing a number. */
  missed_fills: number | null;
}

/**
 * Breaks one variant's trades down three ways.
 *
 * The total is what decides whether a change is worth adopting. The per-symbol
 * split is what says whether it is a real effect or one instrument carrying it,
 * and the per-setup split is what says which rule the change actually moved —
 * a threshold can help overall while quietly ruining one setup.
 */
function resultRows(
  label: string,
  rules: RuleRow[],
  trades: TaggedTrade[],
  missed: number,
): ResultRow[] {
  const params = paramsOf(rules);
  const row = (
    scope: Pick<ResultRow, "symbol" | "rule_key" | "direction">,
    subset: TaggedTrade[],
  ): ResultRow => {
    const s = summarise(subset);
    return {
      variant: label,
      params,
      ...scope,
      trades: s.trades,
      wins: s.wins,
      win_rate: s.winRate,
      total_r: s.totalR,
      hit_target: s.target,
      hit_stop: s.stop,
      hit_trail: s.trail,
      timed_out: s.timeout,
      // Stored per breakdown, not only for the total: a variant whose overall
      // drawdown looks calm can still have put one instrument through a run
      // that would have ended the account trading it alone.
      max_drawdown_r: s.maxDrawdownR,
      worst_losing_streak: s.worstLosingStreak,
      missed_fills: null,
    };
  };

  const rows: ResultRow[] = [
    {
      ...row({ symbol: null, rule_key: null, direction: null }, trades),
      missed_fills: missed,
    },
  ];

  for (const symbol of unique(trades.map((t) => t.symbol))) {
    rows.push(
      row(
        { symbol, rule_key: null, direction: null },
        trades.filter((t) => t.symbol === symbol),
      ),
    );
  }

  for (const key of unique(trades.map((t) => `${t.ruleKey}|${t.direction}`))) {
    const [ruleKey, direction] = key.split("|");
    rows.push(
      row(
        { symbol: null, rule_key: ruleKey, direction },
        trades.filter((t) => t.ruleKey === ruleKey && t.direction === direction),
      ),
    );
  }

  return rows;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

// -------------------------------------------------------------- experiment

async function createExperiment(
  supabase: SupabaseClient,
  body: RunRequest,
  rules: RuleRow[],
  feeds: Feed[],
): Promise<string> {
  const opened = feeds.flatMap((feed) => feed.bars.map((bar) => bar.openedAt)).sort();

  const { data, error } = await supabase
    .from("experiments")
    .insert({
      name: body.name.trim(),
      note: body.note ?? null,
      baseline: paramsOf(rules),
      variants: body.variants,
      symbols: unique(feeds.map((feed) => feed.symbol)),
      bars_from: opened.at(0) ?? null,
      bars_to: opened.at(-1) ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`experiment insert failed: ${error.message}`);
  return data.id as string;
}

async function writeResults(
  supabase: SupabaseClient,
  experimentId: string,
  rows: ResultRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase
    .from("experiment_results")
    .insert(rows.map((row) => ({ ...row, experiment_id: experimentId })));

  if (error) throw new Error(`experiment results insert failed: ${error.message}`);
}

async function finishExperiment(
  supabase: SupabaseClient,
  experimentId: string,
  status: "done" | "failed",
  message?: string,
): Promise<void> {
  const { error } = await supabase
    .from("experiments")
    .update({ status, error: message ?? null, finished_at: new Date().toISOString() })
    .eq("id", experimentId);

  // The results are the point; failing to stamp the row must not lose them.
  if (error) console.error("experiment status update failed:", error.message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
