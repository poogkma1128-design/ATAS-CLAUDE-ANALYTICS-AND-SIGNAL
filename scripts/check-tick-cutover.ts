// Offline evidence validation only. Does not query/deploy/change production.
import { drainReady } from "../ops/tick-unit-cutover/handler.ts";

const file = Deno.args[0];
if (!file) {
  throw new Error(
    "usage: deno run --allow-read scripts/check-tick-cutover.ts evidence.json",
  );
}
const evidence = JSON.parse(await Deno.readTextFile(file));
if (!evidence || !drainReady(evidence, Date.now())) {
  throw new Error(
    "NO-GO: missing/unverified admission, unfinished old sends/workers, or drain interval",
  );
}
console.log(
  "PASS: supplied drain evidence satisfies timing/state checks; verify its remote artifacts and owner GO separately.",
);
