// deno-lint-ignore-file no-import-prefix -- matches the repository's test import convention.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { type SessionDefinition, stampSession } from "./market_sessions.ts";

const chicago: SessionDefinition = {
  version: "test-cme-v1",
  exchangeTimeZone: "America/Chicago",
  tradingDayRolloverMinute: 17 * 60,
  windows: [
    { key: "us_open", startMinute: 8 * 60 + 30, endMinute: 9 * 60 + 30 },
    { key: "us_regular", startMinute: 8 * 60 + 30, endMinute: 15 * 60 },
    { key: "power_hour", startMinute: 14 * 60, endMinute: 15 * 60 },
    { key: "overnight_test", startMinute: 23 * 60, endMinute: 2 * 60 },
  ],
};

Deno.test("sessions: IANA exchange time keeps a local window stable across DST", () => {
  const beforeDst = stampSession("2026-03-06T14:45:00.000Z", chicago);
  const afterDst = stampSession("2026-03-09T13:45:00.000Z", chicago);

  assertEquals(beforeDst.exchangeMinute, 8 * 60 + 45);
  assertEquals(afterDst.exchangeMinute, 8 * 60 + 45);
  assertEquals(beforeDst.sessionTags, ["us_open", "us_regular"]);
  assertEquals(afterDst.sessionTags, ["us_open", "us_regular"]);
});

Deno.test("sessions: the evening rollover names the next trading day", () => {
  assertEquals(
    stampSession("2026-09-06T21:59:00.000Z", chicago).tradingDay,
    "2026-09-06",
  );
  assertEquals(
    stampSession("2026-09-06T22:00:00.000Z", chicago).tradingDay,
    "2026-09-07",
  );
});

Deno.test("sessions: a midnight rollover keeps the exchange calendar date", () => {
  const midnight = { ...chicago, tradingDayRolloverMinute: 0 };
  assertEquals(
    stampSession("2026-09-06T18:00:00.000Z", midnight).tradingDay,
    "2026-09-06",
  );
});

Deno.test("sessions: wrapped windows and exclusive end boundaries are deterministic", () => {
  assertEquals(
    stampSession("2026-01-07T05:30:00.000Z", chicago).sessionTags,
    ["overnight_test"],
  );
  assertEquals(stampSession("2026-01-07T08:00:00.000Z", chicago).sessionTags, []);
});

Deno.test("sessions: duplicate tags fail closed", () => {
  assertThrows(
    () =>
      stampSession("2026-01-01T00:00:00Z", {
        ...chicago,
        windows: [...chicago.windows, chicago.windows[0]],
      }),
    Error,
    "duplicate session window",
  );
});
