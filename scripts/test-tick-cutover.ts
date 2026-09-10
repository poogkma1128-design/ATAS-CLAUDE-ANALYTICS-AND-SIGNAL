// Reproduce the actual pre-fix sender crossing a DB mute with a delayed insert
// response. Exercise the replacement admission handler and drain gate around
// it. All DB/Telegram transport is mocked; no network permission is granted.
// deno run --allow-read --allow-env --allow-run=git scripts/test-tick-cutover.ts
// deno-lint-ignore no-import-prefix
import { assertEquals } from "jsr:@std/assert@1";
import {
  type DrainEvidence,
  drainReady,
  maintenanceResponse,
} from "../ops/tick-unit-cutover/handler.ts";

const base = "5ca966557c62b0de18674f6d31524bc4b5512ca0";
const shared = new URL("../supabase/functions/_shared/", import.meta.url).href;
const imported = (code: string) =>
  import(
    "data:application/typescript," +
      encodeURIComponent(code.replaceAll('from "./', 'from "' + shared))
  );
const sourceResult = await new Deno.Command("git", {
  args: ["show", `${base}:supabase/functions/_shared/ingest.ts`],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!sourceResult.success) {
  throw new Error("pre-fix source unavailable; fetch full repository history");
}
const old = await imported(new TextDecoder().decode(sourceResult.stdout));
const helperSource = await Deno.readTextFile(new URL(shared + "ingest_test.ts"));
const helpers = await imported(
  helperSource.slice(0, helperSource.indexOf("Deno.test(")) +
    "\nexport { readyClient, payload, STACKED_RULE };",
);
const dbRule = {
  ...helpers.STACKED_RULE,
  params: { ...helpers.STACKED_RULE.params, marketTickSize: 0.1 },
};
const client = helpers.readyClient([{ ...dbRule }]);
let release!: (result: unknown) => void;
client.queue("signals.upsert", new Promise((resolve) => release = resolve));
const start = Date.parse("2026-09-09T10:00:00Z");
const evidence: DrainEvidence = {
  admissionGateVerified: true,
  oldWorkersTerminated: false,
  pendingOldSends: 1,
  verifiedMaxWorkerLifetimeMs: 400_000,
  gateVerifiedAtMs: start,
  lastOldActivityAtMs: 0,
};
let cutover = false;
let sentBeforeCutover = 0;
let sentAfterCutover = 0;
const originalFetch = globalThis.fetch;
const oldToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
const oldChat = Deno.env.get("TELEGRAM_CHAT_ID");
Deno.env.set("TELEGRAM_BOT_TOKEN", "test-only-no-network");
Deno.env.set("TELEGRAM_CHAT_ID", "test-only-no-network");
globalThis.fetch = () => {
  assertEquals(dbRule.telegram_enabled, false); // cached true survives DB mute
  if (cutover) sentAfterCutover++;
  else sentBeforeCutover++;
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true, result: { message_id: 123 } })),
  );
};
try {
  const running = old.ingest(
    client.asClient(),
    helpers.payload(),
    new Date("2026-08-27T10:05:02Z"),
  );
  for (let i = 0; i < 200 && !client.callsFor("signals", "upsert").length; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assertEquals(client.callsFor("signals", "upsert").length, 1);
  const row = client.rowsFor("signals", "upsert")[0];
  assertEquals(row.payload.executionUnits.version, "market-tick-v1");
  assertEquals(row.payload.executionUnits.marketTickSize, 0.25);
  assertEquals(row.payload.executionUnits.planTickSize, 0.1);
  dbRule.telegram_enabled = false;
  assertEquals(maintenanceResponse().status, 503);
  // Even after 460s, unfinished old work prevents crossing the migration gate.
  assertEquals(drainReady(evidence, start + 460_000), false);
  release({
    data: [{ ...row, id: "fixture", seq: 1, fired_at: "2026-08-27T10:05:00Z" }],
    error: null,
  });
  await running;
  assertEquals(sentBeforeCutover, 1); // Demonstrates why mute alone was unsafe.
  evidence.pendingOldSends = 0;
  evidence.oldWorkersTerminated = true;
  evidence.lastOldActivityAtMs = start + 460_000;
  assertEquals(drainReady(evidence, start + 460_000), false);
  cutover = drainReady(evidence, start + 920_000);
  assertEquals(cutover, true);
  assertEquals(maintenanceResponse().status, 503); // Keep gate until v2 deployed.
  assertEquals(sentAfterCutover, 0);
  console.log(
    "PASS: actual old source sends despite mute; admission/drain gate defers cutover until old work finishes. Zero sends after cutover. Mock transport only.",
  );
} finally {
  globalThis.fetch = originalFetch;
  if (oldToken === undefined) Deno.env.delete("TELEGRAM_BOT_TOKEN");
  else Deno.env.set("TELEGRAM_BOT_TOKEN", oldToken);
  if (oldChat === undefined) Deno.env.delete("TELEGRAM_CHAT_ID");
  else Deno.env.set("TELEGRAM_CHAT_ID", oldChat);
}
