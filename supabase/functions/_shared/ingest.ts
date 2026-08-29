import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type {
  BarInput,
  ClusterLevel,
  HistoryBar,
  IngestPayload,
  RuleRow,
} from "./types.ts";
import { pointOfControl, sortLevels } from "./util.ts";
import { runRules } from "./rules/index.ts";
import { describeEvidence } from "./evidence.ts";
import { buildPlan } from "./plan.ts";
import { sendSignal, telegramConfig } from "./telegram.ts";

/** Enough history for every rule's lookback, with room to spare. */
const HISTORY_BARS = 50;
const MAX_BARS_PER_REQUEST = 200;
const MAX_LEVELS_PER_BAR = 2000;

/**
 * A wide backfill can carry tens of thousands of footprint rows. They go up in
 * chunks so one request never grows past what PostgREST will accept, while
 * still being far fewer round trips than a request per bar.
 */
const LEVEL_ROWS_PER_REQUEST = 1000;

// --------------------------------------------------------------- validation

export function validate(payload: IngestPayload): string | null {
  if (!payload || typeof payload !== "object") return "body must be an object";
  if (typeof payload.symbol !== "string" || payload.symbol.trim() === "") {
    return "symbol is required";
  }
  if (typeof payload.timeframe !== "string" || payload.timeframe.trim() === "") {
    return "timeframe is required";
  }
  if (typeof payload.tickSize !== "number" || !(payload.tickSize > 0)) {
    return "tickSize must be a positive number";
  }
  if (!Array.isArray(payload.bars)) return "bars must be an array";
  if (payload.bars.length === 0) return "bars must not be empty";
  if (payload.bars.length > MAX_BARS_PER_REQUEST) {
    return `too many bars in one request (max ${MAX_BARS_PER_REQUEST})`;
  }

  for (const [index, bar] of payload.bars.entries()) {
    if (!bar || typeof bar !== "object") return `bars[${index}] must be an object`;
    if (typeof bar.openedAt !== "string" || Number.isNaN(Date.parse(bar.openedAt))) {
      return `bars[${index}].openedAt must be an ISO timestamp`;
    }
    for (const field of ["open", "high", "low", "close"] as const) {
      if (typeof bar[field] !== "number" || !Number.isFinite(bar[field])) {
        return `bars[${index}].${field} must be a finite number`;
      }
    }
    if (bar.levels != null) {
      if (!Array.isArray(bar.levels)) return `bars[${index}].levels must be an array`;
      if (bar.levels.length > MAX_LEVELS_PER_BAR) {
        return `bars[${index}] has too many levels (max ${MAX_LEVELS_PER_BAR})`;
      }
    }
  }

  return null;
}

// ------------------------------------------------------------------ ingest

export interface IngestResult {
  barsWritten: number;
  levelsWritten: number;
  signalsCreated: number;
}

/** A bar with the derived values every later step needs, computed once. */
interface PreparedBar {
  bar: BarInput;
  levels: ClusterLevel[];
  pocPrice: number | null;
}

export async function ingest(
  supabase: SupabaseClient,
  payload: IngestPayload,
): Promise<IngestResult> {
  const instrumentId = await upsertInstrument(supabase, payload);
  const rules = await loadRules(supabase);
  const tickSize = payload.tickSize;

  // Oldest first, so a request carrying several bars builds history in order.
  const bars = orderBars(payload.bars);

  // The indicator posts exactly one bar as it closes, and the whole visible
  // history in a single batch when it starts up. Announcing that batch means a
  // phone full of alerts for bars that closed hours ago, so a multi-bar request
  // is treated as history: the signals are still stored and still counted in
  // the statistics, they are simply not announced.
  const isHistoricalBatch = bars.length > 1;

  const prepared: PreparedBar[] = bars.map((bar) => {
    const levels = collapseLevels(bar.levels ?? []);
    return { bar, levels, pocPrice: pointOfControl(levels)?.price ?? null };
  });

  // Everything below is batched. A hundred-bar backfill used to cost four round
  // trips per bar; it now costs a handful for the whole request, which is the
  // difference between the function finishing in a second and timing out.
  const barIds = await upsertBars(supabase, instrumentId, payload.timeframe, prepared);
  const levelsWritten = await upsertLevels(supabase, prepared, barIds);

  const signalRows = await evaluateBars(
    supabase,
    { instrumentId, timeframe: payload.timeframe },
    rules,
    prepared,
    barIds,
    tickSize,
  );

  const signalsCreated = await persistSignals(
    supabase,
    { instrumentId, timeframe: payload.timeframe, symbol: payload.symbol },
    rules,
    signalRows,
    isHistoricalBatch,
  );

  return { barsWritten: prepared.length, levelsWritten, signalsCreated };
}

/**
 * Postgres rejects an ON CONFLICT batch that touches the same key twice, so a
 * timestamp repeated inside one request has to be collapsed before it is sent.
 * The last copy wins: within a request it is the more complete one.
 */
function orderBars(bars: BarInput[]): BarInput[] {
  const byTime = new Map<number, BarInput>();
  for (const bar of bars) byTime.set(Date.parse(bar.openedAt), bar);

  return [...byTime.values()].sort(
    (a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt),
  );
}

/** The same collapsing for footprint rows, which are keyed by (bar, price). */
function collapseLevels(levels: ClusterLevel[]): ClusterLevel[] {
  const byPrice = new Map<number, ClusterLevel>();
  for (const level of levels) byPrice.set(level.price, level);
  return sortLevels([...byPrice.values()]);
}

async function upsertInstrument(
  supabase: SupabaseClient,
  payload: IngestPayload,
): Promise<string> {
  const { data, error } = await supabase
    .from("instruments")
    .upsert(
      {
        symbol: payload.symbol.trim(),
        exchange: (payload.exchange ?? "").trim(),
        tick_size: payload.tickSize,
        tick_value: payload.tickValue ?? null,
      },
      { onConflict: "symbol,exchange" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`instrument upsert failed: ${error.message}`);
  return data.id as string;
}

async function loadRules(supabase: SupabaseClient): Promise<RuleRow[]> {
  const { data, error } = await supabase
    .from("rules")
    .select("key, name, enabled, telegram_enabled, horizon_bars, params")
    .eq("enabled", true);

  if (error) throw new Error(`rules load failed: ${error.message}`);
  return (data ?? []) as RuleRow[];
}

async function upsertBars(
  supabase: SupabaseClient,
  instrumentId: string,
  timeframe: string,
  prepared: PreparedBar[],
): Promise<number[]> {
  const rows = prepared.map(({ bar, pocPrice }) => ({
    instrument_id: instrumentId,
    timeframe,
    opened_at: new Date(bar.openedAt).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    ask_volume: bar.askVolume ?? 0,
    bid_volume: bar.bidVolume ?? 0,
    delta: bar.delta ?? 0,
    min_delta: bar.minDelta ?? 0,
    max_delta: bar.maxDelta ?? 0,
    cum_delta: bar.cumDelta ?? null,
    poc_price: pocPrice,
    ticks: bar.ticks ?? 0,
    trades: bar.trades ?? 0,
    is_closed: bar.isClosed === true,
  }));

  const { data, error } = await supabase
    .from("bars")
    .upsert(rows, { onConflict: "instrument_id,timeframe,opened_at" })
    .select("id, opened_at");

  if (error) throw new Error(`bar upsert failed: ${error.message}`);

  // The returned rows are not promised to come back in the order they were
  // sent, and Postgres normalises the timestamp text, so the ids are matched
  // on the instant rather than on position or on the string.
  const idByInstant = new Map<number, number>();
  for (const row of (data ?? []) as { id: number; opened_at: string }[]) {
    idByInstant.set(Date.parse(row.opened_at), row.id);
  }

  return prepared.map(({ bar }) => {
    const id = idByInstant.get(Date.parse(bar.openedAt));
    if (id === undefined) {
      throw new Error(`bar upsert returned no id for ${bar.openedAt}`);
    }
    return id;
  });
}

async function upsertLevels(
  supabase: SupabaseClient,
  prepared: PreparedBar[],
  barIds: number[],
): Promise<number> {
  // Volume within a bar only accumulates, so upserting by price is safe and
  // avoids deleting and rewriting the footprint on every intrabar update.
  const rows = prepared.flatMap((entry, index) =>
    entry.levels.map((level) => ({
      bar_id: barIds[index],
      price: level.price,
      ask: level.ask ?? 0,
      bid: level.bid ?? 0,
      between: level.between ?? 0,
      volume: level.volume ?? 0,
      ticks: level.ticks ?? 0,
    }))
  );

  for (let start = 0; start < rows.length; start += LEVEL_ROWS_PER_REQUEST) {
    const { error } = await supabase
      .from("cluster_levels")
      .upsert(rows.slice(start, start + LEVEL_ROWS_PER_REQUEST), {
        onConflict: "bar_id,price",
      });

    if (error) throw new Error(`cluster level upsert failed: ${error.message}`);
  }

  return rows.length;
}

interface SignalRow {
  bar_id: number;
  instrument_id: string;
  timeframe: string;
  rule_key: string;
  direction: string;
  price: number;
  confidence: number;
  payload: Record<string, unknown>;
  entry_price: number;
  stop_price: number;
  target_price: number;
  risk_ticks: number;
  reward_ticks: number;
  trail_trigger_ticks: number;
  trail_offset_ticks: number;
  hold_bars: number;
}

/**
 * Runs every rule over every closed bar in the request. History is fetched once
 * for the batch and then extended in memory, because the bars of the batch are
 * exactly the bars that would come back from a per-bar query anyway.
 */
async function evaluateBars(
  supabase: SupabaseClient,
  scope: { instrumentId: string; timeframe: string },
  rules: RuleRow[],
  prepared: PreparedBar[],
  barIds: number[],
  tickSize: number,
): Promise<SignalRow[]> {
  // Rules only ever judge finished bars; an in-progress footprint would fire
  // and un-fire as volume lands.
  const firstClosed = prepared.findIndex((entry) => entry.bar.isClosed);
  if (firstClosed === -1 || rules.length === 0) return [];

  const history = await loadHistory(
    supabase,
    scope.instrumentId,
    scope.timeframe,
    prepared[firstClosed].bar.openedAt,
  );

  const rows: SignalRow[] = [];
  const byKey = new Map(rules.map((rule) => [rule.key, rule]));

  for (const [index, entry] of prepared.entries()) {
    if (!entry.bar.isClosed) continue;

    // Shared by the rules and by plan sizing, and correct for both only
    // because the bar is appended to `history` after it has been evaluated.
    const recent = history.slice(-HISTORY_BARS);

    const evaluated = runRules(rules, {
      bar: entry.bar,
      levels: entry.levels,
      history: recent,
      tickSize,
    });

    for (const signal of evaluated) {
      const rule = byKey.get(signal.ruleKey);
      const plan = buildPlan(
        signal.direction,
        entry.bar,
        tickSize,
        rule?.params ?? {},
        rule?.horizon_bars ?? 10,
        recent,
      );

      rows.push({
        bar_id: barIds[index],
        instrument_id: scope.instrumentId,
        timeframe: scope.timeframe,
        rule_key: signal.ruleKey,
        direction: signal.direction,
        price: signal.price,
        confidence: Number(signal.confidence.toFixed(3)),
        payload: signal.payload,
        entry_price: plan.entry,
        stop_price: plan.stop,
        target_price: plan.target,
        risk_ticks: plan.riskTicks,
        reward_ticks: plan.rewardTicks,
        trail_trigger_ticks: plan.trailTriggerTicks,
        trail_offset_ticks: plan.trailOffsetTicks,
        hold_bars: plan.holdBars,
      });
    }

    // Only now, so a bar is never part of its own history.
    history.push(asHistoryBar(entry));
  }

  return rows;
}

function asHistoryBar({ bar, pocPrice }: PreparedBar): HistoryBar {
  return {
    openedAt: new Date(bar.openedAt).toISOString(),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    delta: bar.delta ?? 0,
    pocPrice,
  };
}

async function loadHistory(
  supabase: SupabaseClient,
  instrumentId: string,
  timeframe: string,
  before: string,
): Promise<HistoryBar[]> {
  const { data, error } = await supabase
    .from("bars")
    .select("opened_at, open, high, low, close, volume, delta, poc_price")
    .eq("instrument_id", instrumentId)
    .eq("timeframe", timeframe)
    .eq("is_closed", true)
    .lt("opened_at", new Date(before).toISOString())
    .order("opened_at", { ascending: false })
    .limit(HISTORY_BARS);

  if (error) throw new Error(`history load failed: ${error.message}`);

  // Query returns newest first; rules read oldest first.
  return (data ?? []).reverse().map((row) => ({
    openedAt: row.opened_at as string,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
    delta: Number(row.delta),
    pocPrice: row.poc_price === null ? null : Number(row.poc_price),
  }));
}

interface SignalTarget {
  instrumentId: string;
  timeframe: string;
  symbol: string;
}

async function persistSignals(
  supabase: SupabaseClient,
  target: SignalTarget,
  rules: RuleRow[],
  rows: SignalRow[],
  isHistoricalBatch: boolean,
): Promise<number> {
  if (rows.length === 0) return 0;

  // ignoreDuplicates makes the unique(bar_id, rule_key, direction) constraint
  // do the deduplication: re-posting a bar returns only genuinely new signals,
  // which is also exactly the set that should be announced.
  const { data, error } = await supabase
    .from("signals")
    .upsert(rows, {
      onConflict: "bar_id,rule_key,direction",
      ignoreDuplicates: true,
    })
    .select("id, seq, rule_key, direction, price, confidence, payload, fired_at, entry_price, stop_price, target_price, risk_ticks, reward_ticks, trail_trigger_ticks, trail_offset_ticks, hold_bars");

  if (error) throw new Error(`signal insert failed: ${error.message}`);

  const created = data ?? [];
  if (created.length === 0) return 0;

  if (!isHistoricalBatch) {
    await announce(supabase, target, rules, created);
  }

  return created.length;
}

async function announce(
  supabase: SupabaseClient,
  target: SignalTarget,
  rules: RuleRow[],
  created: Record<string, unknown>[],
): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg) return;

  const byKey = new Map(rules.map((rule) => [rule.key, rule]));

  for (const signal of created) {
    const rule = byKey.get(signal.rule_key as string);
    if (!rule?.telegram_enabled) continue;

    const payload = (signal.payload ?? {}) as Record<string, unknown>;

    const messageId = await sendSignal(cfg, {
      signalId: signal.id as string,
      seq: signal.seq === null || signal.seq === undefined
        ? null
        : Number(signal.seq),
      ruleName: rule.name,
      ruleKey: rule.key,
      direction: signal.direction as "long" | "short",
      symbol: target.symbol,
      timeframe: target.timeframe,
      price: Number(signal.price),
      confidence: Number(signal.confidence),
      firedAt: signal.fired_at as string,
      evidence: describeEvidence(rule.key, payload),
      plan: {
        entry: Number(signal.entry_price),
        stop: Number(signal.stop_price),
        target: Number(signal.target_price),
        riskTicks: Number(signal.risk_ticks),
        rewardTicks: Number(signal.reward_ticks),
        trailTriggerTicks: Number(signal.trail_trigger_ticks),
        trailOffsetTicks: Number(signal.trail_offset_ticks),
        holdBars: Number(signal.hold_bars),
      },
    });

    if (messageId === null) continue;

    const { error } = await supabase
      .from("signals")
      .update({ telegram_message_id: messageId })
      .eq("id", signal.id as string);

    if (error) console.error("could not store telegram message id:", error.message);
  }
}
