import type { RuleRow } from "./types.ts";

type Direction = "long" | "short";

/**
 * The notification gate is deliberately separate from the rule engine.
 *
 * A muted or unproven setup still has to be stored and scored: otherwise it
 * could never accumulate the outcome data needed to become eligible. This
 * object answers only the narrow question "may this already-fired signal make
 * noise?" and lets the caller snapshot that answer in signals.muted.
 */
export class AnnouncementEligibility {
  constructor(
    private readonly evidenceAvailable: boolean,
    private readonly provenCells: ReadonlySet<string>,
  ) {}

  static unavailable(): AnnouncementEligibility {
    return new AnnouncementEligibility(false, new Set());
  }

  static fromProven(
    rows: { rule_key: string; direction: Direction }[],
  ): AnnouncementEligibility {
    return new AnnouncementEligibility(
      true,
      new Set(rows.map((row) => keyFor(row.rule_key, row.direction))),
    );
  }

  allows(rule: RuleRow, direction: Direction): boolean {
    // `manual` is an explicit owner override. Every other value — including a
    // missing column during a partial rollout — fails closed on evidence.
    if (rule.announcement_mode === "manual") return true;
    return this.evidenceAvailable && this.provenCells.has(keyFor(rule.key, direction));
  }
}

function keyFor(ruleKey: string, direction: Direction): string {
  return `${ruleKey}:${direction}`;
}
