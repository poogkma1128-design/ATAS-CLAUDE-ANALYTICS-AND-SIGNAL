import type { RuleContext, RuleEvaluator, RuleRow, RuleSignal } from "../types.ts";
import { sortLevels } from "../util.ts";
import { evaluate as stackedImbalance } from "./stacked_imbalance.ts";
import { evaluate as deltaDivergence } from "./delta_divergence.ts";
import { evaluate as absorption } from "./absorption.ts";
import { evaluate as pocShift } from "./poc_shift.ts";

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

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const evaluator = evaluators[rule.key];
    if (!evaluator) continue;

    try {
      const signals = evaluator({ ...ctx, levels, params: rule.params ?? {} });
      for (const signal of signals) {
        out.push({ ...signal, ruleKey: rule.key });
      }
    } catch (error) {
      console.error(`rule ${rule.key} threw:`, error);
    }
  }

  return out;
}
