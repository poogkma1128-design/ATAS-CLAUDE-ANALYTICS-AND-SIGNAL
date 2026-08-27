import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

import type {
  BarInput,
  HistoryBar,
  IngestPayload,
  RuleRow,
} from "./types.ts";
import { pointOfControl, sortLevels } from "./util.ts";
import { runRules } from "./rules/index.ts";
import { describeEvidence } from "./evidence.ts";
import { sendSignal, telegramConfig } from "./telegram.ts";

/** Enough history for every rule's lookback, with room to spare. */
const HISTORY_BARS = 50;
const MAX_BARS_PER_REQUEST = 200;
const MAX_LEVELS_PER_BAR = 2000;

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

export async function ingest(
  supabase: SupabaseClient,
  payload: IngestPayload,
): Promise<IngestResult> {
  const instrumentId = await upsertInstrument(supabase, payload);
  const rules = await loadRules(supabase);
  const tickSize = payload.tickSize;

  let barsWritten = 0;
  let levelsWritten = 0;
  let signalsCreated = 0;

  // Oldest first, so a request carrying several bars builds history in order.
  const bars = [...payload.bars].sort(
    (a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt),
  );

  for (const bar of bars) {
    const levels = sortLevels(bar.levels ?? []);
    const poc = pointOfControl(levels);

    const barId = await upsertBar(supabase, instrumentId, payload.timeframe, bar, poc?.price ?? null);
    barsWritten++;

    if (levels.length > 0) {
      await upsertLevels(supabase, barId, levels);
      levelsWritten += levels.length;
    }

    // Rules only ever judge finished bars; an in-progress footprint would fire
    // and un-fire as volume lands.
    if (!bar.isClosed) continue;

    const history = await loadHistory(
      supabase,
      instrumentId,
      payload.timeframe,
      bar.openedAt,
    );

    const evaluated = runRules(rules, { bar, levels, history, tickSize });
    if (evaluated.length === 0) continue;

    signalsCreated += await persistSignals(
      supabase,
      { instrumentId, barId, timeframe: payload.timeframe, symbol: payload.symbol },
      rules,
      evaluated,
    );
  }

  return { barsWritten, levelsWritten, signalsCreated };
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

async function upsertBar(
  supabase: SupabaseClient,
  instrumentId: string,
  timeframe: string,
  bar: BarInput,
  pocPrice: number | null,
): Promise<number> {
  const { data, error } = await supabase
    .from("bars")
    .upsert(
      {
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
      },
      { onConflict: "instrument_id,timeframe,opened_at" },
    )
    .select("id")
    .single();

  if (error) throw new Error(`bar upsert failed: ${error.message}`);
  return data.id as number;
}

async function upsertLevels(
  supabase: SupabaseClient,
  barId: number,
  levels: BarInput["levels"],
): Promise<void> {
  // Volume within a bar only accumulates, so upserting by price is safe and
  // avoids deleting and rewriting the footprint on every intrabar update.
  const rows = levels.map((level) => ({
    bar_id: barId,
    price: level.price,
    ask: level.ask ?? 0,
    bid: level.bid ?? 0,
    between: level.between ?? 0,
    volume: level.volume ?? 0,
    ticks: level.ticks ?? 0,
  }));

  const { error } = await supabase
    .from("cluster_levels")
    .upsert(rows, { onConflict: "bar_id,price" });

  if (error) throw new Error(`cluster level upsert failed: ${error.message}`);
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
  barId: number;
  timeframe: string;
  symbol: string;
}

async function persistSignals(
  supabase: SupabaseClient,
  target: SignalTarget,
  rules: RuleRow[],
  evaluated: ReturnType<typeof runRules>,
): Promise<number> {
  const rows = evaluated.map((signal) => ({
    bar_id: target.barId,
    instrument_id: target.instrumentId,
    timeframe: target.timeframe,
    rule_key: signal.ruleKey,
    direction: signal.direction,
    price: signal.price,
    confidence: Number(signal.confidence.toFixed(3)),
    payload: signal.payload,
  }));

  // ignoreDuplicates makes the unique(bar_id, rule_key, direction) constraint
  // do the deduplication: re-posting a bar returns only genuinely new signals,
  // which is also exactly the set that should be announced.
  const { data, error } = await supabase
    .from("signals")
    .upsert(rows, {
      onConflict: "bar_id,rule_key,direction",
      ignoreDuplicates: true,
    })
    .select("id, rule_key, direction, price, confidence, payload, fired_at");

  if (error) throw new Error(`signal insert failed: ${error.message}`);

  const created = data ?? [];
  if (created.length === 0) return 0;

  await announce(supabase, target, rules, created);
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
      ruleName: rule.name,
      ruleKey: rule.key,
      direction: signal.direction as "long" | "short",
      symbol: target.symbol,
      timeframe: target.timeframe,
      price: Number(signal.price),
      confidence: Number(signal.confidence),
      firedAt: signal.fired_at as string,
      evidence: describeEvidence(rule.key, payload),
    });

    if (messageId === null) continue;

    const { error } = await supabase
      .from("signals")
      .update({ telegram_message_id: messageId })
      .eq("id", signal.id as string);

    if (error) console.error("could not store telegram message id:", error.message);
  }
}

