// Test-only dependency, matching the isolated regression scripts.
// deno-lint-ignore no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  type DrainEvidence,
  drainReady,
  maintenanceResponse,
} from "../../../ops/tick-unit-cutover/handler.ts";

const start = Date.parse("2026-09-09T10:00:00Z");
const drained: DrainEvidence = {
  admissionGateVerified: true,
  oldWorkersTerminated: true,
  pendingOldSends: 0,
  verifiedMaxWorkerLifetimeMs: 400_000,
  gateVerifiedAtMs: start,
  lastOldActivityAtMs: 0,
};

Deno.test("cutover: maintenance refuses admission instead of acknowledging dropped data", async () => {
  const response = maintenanceResponse();
  assertEquals(response.status, 503);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), {
    ok: false,
    error: "tick_unit_cutover_maintenance",
    marker: "TICK_UNIT_CUTOVER_V1",
    accepted: false,
  });
});

Deno.test("cutover: mute alone and HTTP idle timeout cannot authorize migration", () => {
  assertEquals(
    drainReady({ ...drained, admissionGateVerified: false }, start + 900_000),
    false,
  );
  assertEquals(
    drainReady({ ...drained, oldWorkersTerminated: false }, start + 900_000),
    false,
  );
  assertEquals(drainReady({ ...drained, pendingOldSends: 1 }, start + 900_000), false);
  assertEquals(drainReady(drained, start + 150_000), false);
  assertEquals(drainReady(drained, start + 459_999), false);
  assertEquals(drainReady(drained, start + 460_000), true);
});

Deno.test("cutover: late old sender resets drain, so it must finish before migration", () => {
  // The reported interleaving: old request cached enabled=true and committed a
  // legacy row, while its DB response (and subsequent send) was still pending.
  const inflight = { ...drained, oldWorkersTerminated: false, pendingOldSends: 1 };
  assertEquals(drainReady(inflight, start + 460_000), false);
  const lateSendFinished = { ...drained, lastOldActivityAtMs: start + 460_000 };
  assertEquals(drainReady(lateSendFinished, start + 460_000), false);
  assertEquals(drainReady(lateSendFinished, start + 919_999), false);
  assertEquals(drainReady(lateSendFinished, start + 920_000), true);
});

Deno.test("cutover: incomplete or impossible evidence fails closed", () => {
  for (const invalid of [NaN, Infinity, -1, 0, 150_000]) {
    assertEquals(
      drainReady({ ...drained, verifiedMaxWorkerLifetimeMs: invalid }, start + 900_000),
      false,
    );
  }
  assertEquals(drainReady(drained, NaN), false);
  assertEquals(drainReady(drained, start - 1), false);
  assertEquals(drainReady({ ...drained, gateVerifiedAtMs: NaN }, start + 900_000), false);
  assertEquals(
    drainReady({ ...drained, lastOldActivityAtMs: Infinity }, start + 900_000),
    false,
  );
});
