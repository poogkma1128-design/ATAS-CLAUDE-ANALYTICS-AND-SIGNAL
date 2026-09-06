// deno-lint-ignore-file no-import-prefix -- matches the repository's test import convention.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type CausalLevelBar, computeKeyLevels } from "./key_levels.ts";
import type { ClusterLevel } from "./types.ts";

function level(price: number, volume: number): ClusterLevel {
  return { price, volume, ask: volume, bid: 0, between: 0, ticks: 1 };
}

function bar(overrides: Partial<CausalLevelBar>): CausalLevelBar {
  return {
    openedAt: "2026-09-07T13:30:00.000Z",
    closedAt: "2026-09-07T13:35:00.000Z",
    isClosed: true,
    high: 101,
    low: 99,
    tradingDay: "2026-09-07",
    sessionTags: ["us_regular", "initial_balance"],
    levels: [],
    ...overrides,
  };
}

const options = { profileSessionTag: "us_regular", initialBalanceTag: "initial_balance" };

Deno.test("key levels: hand-calculated profile and ranges use only causal bars", () => {
  const result = computeKeyLevels(
    [
      bar({
        openedAt: "2026-09-06T19:00:00Z",
        closedAt: "2026-09-06T19:05:00Z",
        tradingDay: "2026-09-06",
        high: 105,
        low: 95,
        sessionTags: ["us_regular"],
        levels: [level(100, 1)],
      }),
      bar({ levels: [level(99, 10), level(100, 20)] }),
      bar({
        openedAt: "2026-09-07T13:35:00Z",
        closedAt: "2026-09-07T13:40:00Z",
        high: 102,
        low: 100,
        sessionTags: ["us_regular"],
        levels: [level(100, 20), level(101, 50)],
      }),
    ],
    "2026-09-07T13:40:00Z",
    "2026-09-07",
    options,
  );

  assertEquals(result.profileStatus, "complete");
  assertEquals(result.vwap, 100.4);
  assertEquals(result.sessionPoc, 101);
  assertEquals(result.val, 100);
  assertEquals(result.vah, 101);
  assertEquals(result.previousDayHigh, 105);
  assertEquals(result.previousDayLow, 95);
  assertEquals(result.sessionHigh, 102);
  assertEquals(result.sessionLow, 99);
  assertEquals(result.initialBalanceHigh, 101);
  assertEquals(result.initialBalanceLow, 99);
});

Deno.test("key levels: a missing footprint nulls the whole profile", () => {
  const result = computeKeyLevels(
    [bar({ levels: null })],
    "2026-09-07T13:35:00Z",
    "2026-09-07",
    options,
  );

  assertEquals(result.profileStatus, "missing_footprint");
  assertEquals(result.vwap, null);
  assertEquals(result.vah, null);
  assertEquals(result.val, null);
  assertEquals(result.sessionPoc, null);
});

Deno.test("key levels: future bars fail closed instead of being silently dropped", () => {
  assertThrows(
    () =>
      computeKeyLevels(
        [
          bar({ closedAt: "2026-09-07T13:45:00Z" }),
        ],
        "2026-09-07T13:40:00Z",
        "2026-09-07",
        options,
      ),
    Error,
    "future bar",
  );
});

Deno.test("key levels: an in-progress bar cannot enter the profile", () => {
  assertThrows(
    () =>
      computeKeyLevels(
        [bar({ isClosed: false })],
        "2026-09-07T13:35:00Z",
        "2026-09-07",
        options,
      ),
    Error,
    "unclosed bar",
  );
});
