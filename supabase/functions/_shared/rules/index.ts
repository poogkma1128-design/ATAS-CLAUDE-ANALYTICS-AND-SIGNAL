import type { RuleContext, RuleEvaluator, RuleRow, RuleSignal } from "../types.ts";
import { sortLevels } from "../util.ts";
import { hasEnoughLiquidity } from "../liquidity.ts";
import { priceActionContext } from "../price_action.ts";
import { collectConfidenceV2 } from "../confidence_v2.ts";
import { evaluate as stackedImbalance } from "./stacked_imbalance.ts";
import { evaluate as deltaDivergence } from "./delta_divergence.ts";
import { evaluate as absorption } from "./absorption.ts";
import { evaluate as pocShift } from "./poc_shift.ts";
import { evaluate as deltaFlip } from "./delta_flip.ts";
import { evaluate as lvn } from "./lvn.ts";
import { evaluate as nakedPoc } from "./naked_poc.ts";
import { evaluate as speedOfTape } from "./speed_of_tape.ts";
import {
  advance as mnqPullbackAdvance,
  evaluate as mnqPullbackV1,
  RULE_KEY as MNQ_PULLBACK_KEY,
} from "./mnq_pullback_v1.ts";
import type { PullbackCarry, PullbackOpportunity } from "../strategy/pullback.ts";
import type {
  FailedBreakCarry,
  FailedBreakOpportunity,
} from "../strategy/failed_break.ts";
import {
  advance as mnqReversalAdvance,
  evaluate as mnqReversalV1,
  RULE_KEY as MNQ_REVERSAL_KEY,
} from "./mnq_reversal_v1.ts";
import {
  advance as gcSweepAdvance,
  evaluate as gcSweepV1,
  RULE_KEY as GC_SWEEP_KEY,
} from "./gc_sweep_v1.ts";

/**
 * Registry of rule evaluators, keyed to match public.rules.key.
 *
 * Adding a rule: write the evaluator, register it here, insert a matching row
 * in public.rules. A rules row with no evaluator is skipped rather than
 * treated as an error, so the database can be seeded ahead of a deploy.
 */
export const evaluators: Record<string, RuleEvaluator> = {
  stacked_imbalance: stackedImbalance,
  delta_divergence: deltaDivergence,
  absorption: absorption,
  poc_shift: pocShift,
  delta_flip: deltaFlip,
  lvn: lvn,
  naked_poc: nakedPoc,
  speed_of_tape: speedOfTape,
  mnq_pullback_v1: mnqPullbackV1,
  mnq_reversal_v1: mnqReversalV1,
  gc_sweep_v1: gcSweepV1,
};

export interface EvaluatedSignal extends RuleSignal {
  ruleKey: string;
}

/**
 * Where a rule that spans bars keeps what it is waiting for.
 *
 * Owned by the caller, not by this module: the live path loads it from a table
 * and saves it back, a backtest holds it in a variable for the length of a feed,
 * and a caller that passes nothing gets the single-bar behaviour unchanged. One
 * store belongs to one (instrument, timeframe); handing the same one to two
 * feeds would let a setup from one instrument be confirmed by another's bar.
 */
export interface StrategyStore {
  pullback?: PullbackCarry;
  /**
   * Every setup resolved while this store was in use, confirmations and
   * rejections alike, in the order they closed. A confirmation also becomes a
   * signal; a rejection becomes nothing else anywhere, so this is the only
   * record that the strategy saw an opportunity and declined it.
   */
  pullbackResolved?: PullbackOpportunity[];
  reversal?: FailedBreakCarry;
  reversalResolved?: FailedBreakOpportunity[];
  sweep?: FailedBreakCarry;
  sweepResolved?: FailedBreakOpportunity[];
}

/**
 * The rules that keep state, and how they read and write it.
 *
 * Separate from `evaluators` because the difference is real: a stateless rule is
 * a function of one bar and can be replayed from any starting point, and one of
 * these cannot. A rule listed here still appears in `evaluators`, so a caller
 * with no store gets its single-bar behaviour rather than nothing at all.
 */
const statefulEvaluators: Record<
  string,
  (ctx: RuleContext, store: StrategyStore) => RuleSignal[]
> = {
  [MNQ_PULLBACK_KEY]: (ctx, store) => {
    const { signals, carry, resolved } = mnqPullbackAdvance(ctx, store.pullback);
    store.pullback = carry;
    if (resolved.length > 0) {
      store.pullbackResolved = [...(store.pullbackResolved ?? []), ...resolved];
    }
    return signals;
  },
  [MNQ_REVERSAL_KEY]: (ctx, store) => {
    const { signals, carry, resolved } = mnqReversalAdvance(ctx, store.reversal);
    store.reversal = carry;
    if (resolved.length > 0) {
      store.reversalResolved = [...(store.reversalResolved ?? []), ...resolved];
    }
    return signals;
  },
  [GC_SWEEP_KEY]: (ctx, store) => {
    const { signals, carry, resolved } = gcSweepAdvance(ctx, store.sweep);
    store.sweep = carry;
    if (resolved.length > 0) {
      store.sweepResolved = [...(store.sweepResolved ?? []), ...resolved];
    }
    return signals;
  },
};

/**
 * Runs every enabled rule against one closed bar.
 *
 * A rule that throws is contained: it is logged and skipped, so one bad
 * evaluator can never stop the others from firing or reject the ingest.
 */
export function runRules(
  rules: RuleRow[],
  ctx: Omit<RuleContext, "params">,
  store?: StrategyStore,
): EvaluatedSignal[] {
  const levels = sortLevels(ctx.levels);
  const out: EvaluatedSignal[] = [];

  // Recorded on every signal, read by nothing. It is here so that in a few days
  // the outcomes table can answer whether any of it predicts anything, the way
  // the volume gate was decided. Computed once: it describes the bar, not the
  // rule that happened to fire on it.
  const priceAction = priceActionContext(ctx.bar, ctx.history);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const evaluator = evaluators[rule.key];
    if (!evaluator) continue;

    const ruleCtx = { ...ctx, levels, params: rule.params ?? {} };

    // Gated here rather than inside each rule: it is a property of the bar, not
    // of the setup, and every rule was calibrated against bars that had volume.
    //
    // A skipped bar also skips a stateful rule's advance, so an open setup sees
    // the following bar as further away than it is. That is reported rather than
    // silent — the setup closes as `data_unavailable:feed_gap` — but it is a
    // reason to leave `minVolumeRatio` at 0 for a rule that spans bars.
    if (!hasEnoughLiquidity(ruleCtx)) continue;

    const stateful = store ? statefulEvaluators[rule.key] : undefined;

    try {
      const signals = stateful ? stateful(ruleCtx, store!) : evaluator(ruleCtx);
      for (const signal of signals) {
        const payload = { ...signal.payload, priceAction };
        out.push({
          ...signal,
          ruleKey: rule.key,
          payload: {
            ...payload,
            confidenceV2: collectConfidenceV2(rule.key, ruleCtx, signal, priceAction),
          },
        });
      }
    } catch (error) {
      console.error(`rule ${rule.key} threw:`, error);
    }
  }

  return out;
}
