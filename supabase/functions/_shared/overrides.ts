import type { RuleRow } from "./types.ts";

/**
 * Per-instrument settings layered over a rule's own row.
 *
 * A rule in public.rules speaks for every chart at once, and the recorded
 * outcomes say that is the wrong shape. poc_shift short is +9.41R over 18
 * trades on BTCUSDT and -9.09R over 36 trades on MNQU6 — near enough a mirror
 * image that a single shared switch is guaranteed to be wrong for one of them.
 *
 * Two things are settable, and they are settable at different times, which is
 * why they are resolved separately below:
 *
 *   params  are read while a rule is still deciding, before any direction
 *           exists, so they are per (rule, instrument, timeframe).
 *   muted   is a property of an emitted signal, by which time the direction is
 *           known, so it is per (rule, instrument, timeframe, direction) with
 *           an 'any' row as the fallback.
 */
export interface OverrideRow {
  rule_key: string;
  timeframe: string;
  direction: "any" | "long" | "short";
  muted: boolean;
  params: Record<string, unknown>;
}

/** Overrides for one instrument and timeframe, indexed for lookup. */
export class Overrides {
  private readonly byRule = new Map<string, OverrideRow[]>();

  constructor(rows: OverrideRow[]) {
    for (const row of rows) {
      const list = this.byRule.get(row.rule_key);
      if (list) list.push(row);
      else this.byRule.set(row.rule_key, [row]);
    }
  }

  static empty(): Overrides {
    return new Overrides([]);
  }

  /**
   * The rule as this instrument should run it.
   *
   * Returns the same object when nothing is overridden, so the common case
   * costs nothing and the rule row can still be compared by identity.
   */
  applyTo(rule: RuleRow): RuleRow {
    const extra = this.paramsFor(rule.key);
    if (extra === null) return rule;

    return { ...rule, params: { ...(rule.params ?? {}), ...extra } };
  }

  /** Whether a signal from this rule and direction should be announced. */
  isMuted(ruleKey: string, direction: "long" | "short"): boolean {
    const rows = this.byRule.get(ruleKey);
    if (!rows) return false;

    // Most specific wins: a direction row answers on its own, and only its
    // absence falls through to the 'any' row.
    const specific = rows.find((row) => row.direction === direction);
    if (specific) return specific.muted;

    return rows.find((row) => row.direction === "any")?.muted ?? false;
  }

  /**
   * Params are not direction-specific, but a row still has to be picked from
   * rows that carry a direction. They are merged least-specific first so a
   * direction row's params, if someone sets them anyway, do not silently win
   * over the 'any' row in an order that depends on how Postgres sorted them.
   */
  private paramsFor(ruleKey: string): Record<string, unknown> | null {
    const rows = this.byRule.get(ruleKey);
    if (!rows) return null;

    const merged: Record<string, unknown> = {};
    let found = false;

    for (const row of [...rows].sort(byDirectionBreadth)) {
      const params = row.params;
      if (!params || Object.keys(params).length === 0) continue;
      Object.assign(merged, params);
      found = true;
    }

    return found ? merged : null;
  }
}

/** 'any' first, so more specific rows are merged over it. */
function byDirectionBreadth(a: OverrideRow, b: OverrideRow): number {
  const rank = (d: string) => (d === "any" ? 0 : 1);
  return rank(a.direction) - rank(b.direction);
}
