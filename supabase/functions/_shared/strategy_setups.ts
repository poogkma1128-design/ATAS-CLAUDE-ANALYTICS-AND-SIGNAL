import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type {
  PullbackCarry,
  PullbackOpenSetup,
  PullbackOpportunity,
} from "./strategy/pullback.ts";

/**
 * The durable half of a strategy that spans more than one bar.
 *
 * `MNQ_PULLBACK_V1` gives a setup six bars to find its confirmation, and an Edge
 * Function remembers nothing between invocations, so without a table the live
 * rule could only ever emit a confirmation landing on the touch bar itself —
 * one of the five the contract finds. This module is the round trip that closes
 * that gap: it reads what was waiting, and writes back what still is.
 *
 * It computes nothing. Every value it stores was decided by the evaluator in
 * `strategy/pullback.ts`, and every value it loads goes back in unchanged. If
 * that stops being true the live path and a backtest will start judging the same
 * bar differently, which is the failure this shape exists to prevent.
 */

export const PULLBACK_STRATEGY_KEY = "mnq_pullback_v1";

export interface SetupScope {
  instrumentId: string;
  timeframe: string;
}

interface SetupRow {
  anchor_identity: string;
  anchor_touch_id: string;
  direction: "long" | "short";
  anchor_price: number;
  opened_at: string;
  last_seen_at: string;
  age_bars: number;
  touch_bars: number;
  saw_evaluable_trigger: boolean;
  saw_opposing_trigger: boolean;
  saw_missing_bias: boolean;
  saw_missing_volatility: boolean;
}

const OPEN_COLUMNS =
  "anchor_identity, anchor_touch_id, direction, anchor_price, opened_at, last_seen_at, " +
  "age_bars, touch_bars, saw_evaluable_trigger, saw_opposing_trigger, saw_missing_bias, " +
  "saw_missing_volatility";

/**
 * The setups waiting on this feed, ready to hand to the evaluator.
 *
 * Rows opened under a different contract version are not carried. A setup that
 * began under one zone width cannot be judged under another without silently
 * mixing two experiments, so they are closed as `contract_changed` and left in
 * the table as the record that they were dropped rather than resolved.
 *
 * `lastDecisionAt` is the newest `last_seen_at` among the carried rows, which is
 * the previous decision bar: every open setup is advanced on every bar, so they
 * all carry it. With nothing open there is no boundary to remember, because
 * there is nothing a gap could close.
 */
export async function loadPullbackCarry(
  supabase: SupabaseClient,
  scope: SetupScope,
  contractVersion: string,
): Promise<PullbackCarry> {
  const { data, error } = await supabase
    .from("strategy_setups")
    .select(`${OPEN_COLUMNS}, contract_version`)
    .eq("strategy_key", PULLBACK_STRATEGY_KEY)
    .eq("instrument_id", scope.instrumentId)
    .eq("timeframe", scope.timeframe)
    .eq("status", "open");

  if (error) throw new Error(`strategy setup load failed: ${error.message}`);

  const rows = (data ?? []) as (SetupRow & { contract_version: string })[];
  const stale = rows.filter((row) => row.contract_version !== contractVersion);
  const usable = rows.filter((row) => row.contract_version === contractVersion);

  if (stale.length > 0) {
    await resolveByTouchId(
      supabase,
      scope,
      stale.map((row) => row.anchor_touch_id),
      "rejected",
      "data_unavailable:contract_changed",
    );
  }

  return {
    open: usable.map(asOpenSetup),
    lastDecisionAt: usable
      .map((row) => row.last_seen_at)
      .sort()
      .at(-1) ?? null,
  };
}

/**
 * Writes back one batch's worth of change.
 *
 * Called once per request rather than once per bar: `before` is the state the
 * batch started from and `after` is where it ended, so the difference between
 * them is the whole story regardless of how many bars ran in between. A setup
 * that both opened and resolved inside the batch appears in neither and is
 * inserted already closed — it still happened, and a strategy's rejections are
 * the only evidence of what it declined.
 */
export async function persistPullbackCarry(
  supabase: SupabaseClient,
  scope: SetupScope,
  contractVersion: string,
  before: PullbackCarry,
  after: PullbackCarry,
  resolved: PullbackOpportunity[],
): Promise<void> {
  const known = new Set(before.open.map((setup) => setup.anchorTouchId));

  // Resolutions first. A setup that closed and one that re-opened on the same
  // anchor in the same batch would otherwise both be open for an instant, and
  // the partial unique index would refuse the second.
  for (const opportunity of resolved) {
    const { status, reason } = resolutionOf(opportunity);

    if (known.has(opportunity.anchorTouchId)) {
      await resolveByTouchId(
        supabase,
        scope,
        [opportunity.anchorTouchId],
        status,
        reason,
      );
      continue;
    }

    const { error } = await supabase.from("strategy_setups").insert({
      ...rowFor(scope, contractVersion, asOpenSetupFromOpportunity(opportunity)),
      status,
      outcome_reason: reason,
      resolved_at: new Date().toISOString(),
    });
    if (error) {
      throw new Error(`strategy setup insert (resolved) failed: ${error.message}`);
    }
  }

  for (const setup of after.open) {
    if (known.has(setup.anchorTouchId)) {
      const { error } = await supabase
        .from("strategy_setups")
        .update({
          last_seen_at: setup.lastSeenAt,
          age_bars: setup.ageBars,
          touch_bars: setup.touchBars,
          saw_evaluable_trigger: setup.sawEvaluableTrigger,
          saw_opposing_trigger: setup.sawOpposingTrigger,
          saw_missing_bias: setup.sawMissingBias,
          saw_missing_volatility: setup.sawMissingVolatility,
          updated_at: new Date().toISOString(),
        })
        .eq("strategy_key", PULLBACK_STRATEGY_KEY)
        .eq("instrument_id", scope.instrumentId)
        .eq("timeframe", scope.timeframe)
        .eq("anchor_touch_id", setup.anchorTouchId)
        .eq("status", "open");

      if (error) throw new Error(`strategy setup update failed: ${error.message}`);
      continue;
    }

    const { error } = await supabase
      .from("strategy_setups")
      .insert(rowFor(scope, contractVersion, setup));

    if (error) throw new Error(`strategy setup insert failed: ${error.message}`);
  }
}

async function resolveByTouchId(
  supabase: SupabaseClient,
  scope: SetupScope,
  touchIds: string[],
  status: "triggered" | "rejected",
  reason: string,
): Promise<void> {
  if (touchIds.length === 0) return;

  const stamp = new Date().toISOString();
  const { error } = await supabase
    .from("strategy_setups")
    .update({
      status,
      outcome_reason: reason,
      resolved_at: stamp,
      updated_at: stamp,
    })
    .eq("strategy_key", PULLBACK_STRATEGY_KEY)
    .eq("instrument_id", scope.instrumentId)
    .eq("timeframe", scope.timeframe)
    .in("anchor_touch_id", touchIds)
    .eq("status", "open");

  if (error) throw new Error(`strategy setup resolve failed: ${error.message}`);
}

/** The evaluator's own words for how a setup ended, never a summary of them. */
function resolutionOf(
  opportunity: PullbackOpportunity,
): { status: "triggered" | "rejected"; reason: string } {
  const outcome = opportunity.outcome;
  if (outcome.kind === "triggered") {
    return { status: "triggered", reason: `triggered:${outcome.trigger}` };
  }
  if (outcome.kind === "rejected") {
    return { status: "rejected", reason: outcome.reason };
  }
  return { status: "rejected", reason: `right_censored:${outcome.reason}` };
}

function asOpenSetup(row: SetupRow): PullbackOpenSetup {
  return {
    anchorIdentity: row.anchor_identity,
    anchorTouchId: row.anchor_touch_id,
    direction: row.direction,
    openedAt: new Date(row.opened_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
    anchorPrice: Number(row.anchor_price),
    touchBars: row.touch_bars,
    ageBars: row.age_bars,
    sawEvaluableTrigger: row.saw_evaluable_trigger,
    sawOpposingTrigger: row.saw_opposing_trigger,
    sawMissingBias: row.saw_missing_bias,
    sawMissingVolatility: row.saw_missing_volatility,
  };
}

/**
 * A resolved opportunity as the row it would have been.
 *
 * An opportunity does not carry the four `saw` flags — they exist to decide its
 * reason and have done their job by the time it closes. They are recorded false
 * rather than guessed, and `outcome_reason` is what a reader should believe.
 */
function asOpenSetupFromOpportunity(
  opportunity: PullbackOpportunity,
): PullbackOpenSetup {
  return {
    anchorIdentity: opportunity.anchorIdentity,
    anchorTouchId: opportunity.anchorTouchId,
    direction: opportunity.direction,
    openedAt: opportunity.openedAt,
    lastSeenAt: opportunity.outcome.at,
    anchorPrice: opportunity.anchorPrice,
    touchBars: opportunity.touchBars,
    ageBars: opportunity.ageBars,
    sawEvaluableTrigger: false,
    sawOpposingTrigger: false,
    sawMissingBias: false,
    sawMissingVolatility: false,
  };
}

function rowFor(
  scope: SetupScope,
  contractVersion: string,
  setup: PullbackOpenSetup,
): Record<string, unknown> {
  return {
    strategy_key: PULLBACK_STRATEGY_KEY,
    contract_version: contractVersion,
    instrument_id: scope.instrumentId,
    timeframe: scope.timeframe,
    anchor_identity: setup.anchorIdentity,
    anchor_touch_id: setup.anchorTouchId,
    direction: setup.direction,
    anchor_price: setup.anchorPrice,
    opened_at: setup.openedAt,
    last_seen_at: setup.lastSeenAt,
    age_bars: setup.ageBars,
    touch_bars: setup.touchBars,
    saw_evaluable_trigger: setup.sawEvaluableTrigger,
    saw_opposing_trigger: setup.sawOpposingTrigger,
    saw_missing_bias: setup.sawMissingBias,
    saw_missing_volatility: setup.sawMissingVolatility,
  };
}
