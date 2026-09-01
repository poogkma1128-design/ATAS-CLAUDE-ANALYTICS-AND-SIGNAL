import { assertEquals } from "jsr:@std/assert@1";
import { AnnouncementEligibility } from "./announcement_policy.ts";
import type { RuleRow } from "./types.ts";

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    key: "absorption",
    name: "Absorption",
    enabled: true,
    telegram_enabled: true,
    announcement_mode: "evidence_first",
    horizon_bars: 10,
    params: {},
    ...overrides,
  };
}

Deno.test("announcement policy: evidence-first announces only a proven direction", () => {
  const eligibility = AnnouncementEligibility.fromProven([
    { rule_key: "absorption", direction: "long" },
  ]);

  assertEquals(eligibility.allows(rule(), "long"), true);
  assertEquals(eligibility.allows(rule(), "short"), false);
});

Deno.test("announcement policy: a failed evidence read fails closed", () => {
  assertEquals(AnnouncementEligibility.unavailable().allows(rule(), "long"), false);
  // A missing mode is also fail-closed; this is the deploy-order safety net.
  assertEquals(
    AnnouncementEligibility.unavailable().allows(
      rule({ announcement_mode: undefined }),
      "long",
    ),
    false,
  );
});

Deno.test("announcement policy: manual is an explicit owner override", () => {
  assertEquals(
    AnnouncementEligibility.unavailable().allows(
      rule({ announcement_mode: "manual" }),
      "short",
    ),
    true,
  );
});
