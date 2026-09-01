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
};

export interface EvaluatedSignal extends RuleSignal {
  ruleKey: string;
}

/**
 * Runs every enabled rule against one closed bar.
 *
 * A rule that throws is contained: it is logged and skipped, so one bad
 * evaluator can never stop the others from firing or reject the ingest.
 */
export function runRules(
  rules: RuleRow[],
  ctx: Omit<RuleContext, "params">,
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
    if (!hasEnoughLiquidity(ruleCtx)) continue;

    try {
      const signals = evaluator(ruleCtx);
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
