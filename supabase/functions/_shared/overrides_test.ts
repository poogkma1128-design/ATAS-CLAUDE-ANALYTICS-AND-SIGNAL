import { assertEquals } from "jsr:@std/assert@1";
import type { RuleRow } from "./types.ts";
import { Overrides, type OverrideRow } from "./overrides.ts";

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    key: "poc_shift",
    name: "POC Shift",
    enabled: true,
    telegram_enabled: true,
    horizon_bars: 10,
    params: { minTicks: 8, consecutive: 3, minRiskRangeShare: 0.3 },
    ...overrides,
  };
}

function row(overrides: Partial<OverrideRow> = {}): OverrideRow {
  return {
    rule_key: "poc_shift",
    timeframe: "5m",
    direction: "any",
    muted: false,
    params: {},
    ...overrides,
  };
}

Deno.test("overrides: no rows leaves the rule exactly as it was", () => {
  const original = rule();
  const resolved = Overrides.empty().applyTo(original);

  // Same object, so the common path allocates nothing.
  assertEquals(resolved, original);
  assertEquals(Overrides.empty().isMuted("poc_shift", "long"), false);
});

Deno.test("overrides: params layer over the rule without dropping the rest", () => {
  const resolved = new Overrides([row({ params: { consecutive: 4 } })])
    .applyTo(rule());

  assertEquals(resolved.params.consecutive, 4);
  // Untouched keys survive: an override is a patch, not a replacement.
  assertEquals(resolved.params.minTicks, 8);
  assertEquals(resolved.params.minRiskRangeShare, 0.3);
});

Deno.test("overrides: one direction can be muted while the other trades", () => {
  // The case this exists for: on BTCUSDT absorption is +26.10R long and
  // -9.57R short, so the two directions cannot share one switch.
  const overrides = new Overrides([
    row({ rule_key: "absorption", direction: "short", muted: true }),
  ]);

  assertEquals(overrides.isMuted("absorption", "short"), true);
  assertEquals(overrides.isMuted("absorption", "long"), false);
});

Deno.test("overrides: an 'any' row mutes both directions", () => {
  const overrides = new Overrides([row({ direction: "any", muted: true })]);

  assertEquals(overrides.isMuted("poc_shift", "long"), true);
  assertEquals(overrides.isMuted("poc_shift", "short"), true);
});

Deno.test("overrides: a direction row wins over the 'any' row", () => {
  // Mute the rule broadly, then let one direction back in.
  const overrides = new Overrides([
    row({ direction: "any", muted: true }),
    row({ direction: "short", muted: false }),
  ]);

  assertEquals(overrides.isMuted("poc_shift", "long"), true);
  assertEquals(overrides.isMuted("poc_shift", "short"), false);
});

Deno.test("overrides: a row for another rule does not leak across", () => {
  const overrides = new Overrides([
    row({ rule_key: "absorption", muted: true, params: { edgeTicks: 5 } }),
  ]);

  assertEquals(overrides.isMuted("poc_shift", "long"), false);
  assertEquals(overrides.applyTo(rule()).params.edgeTicks, undefined);
});

Deno.test("overrides: 'any' params are merged first so a direction row wins", () => {
  const overrides = new Overrides([
    row({ direction: "short", params: { minTicks: 20 } }),
    row({ direction: "any", params: { minTicks: 12, consecutive: 5 } }),
  ]);

  const params = overrides.applyTo(rule()).params;
  assertEquals(params.minTicks, 20);
  assertEquals(params.consecutive, 5);
});

Deno.test("overrides: muting does not disable the rule", () => {
  // Muted setups keep being evaluated and scored — that is what lets one earn
  // its way back — so `enabled` must survive untouched.
  const resolved = new Overrides([row({ muted: true })]).applyTo(rule());

  assertEquals(resolved.enabled, true);
  assertEquals(resolved.telegram_enabled, true);
});
