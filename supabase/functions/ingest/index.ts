import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

import type { IngestPayload } from "../_shared/types.ts";
import { ingest, type IngestResult, validate } from "../_shared/ingest.ts";
import { flushOutcomeNotifications } from "../_shared/outcomes.ts";
import { hasIngestAuthorization } from "../_shared/auth.ts";

/**
 * HTTP shell for the ingest pipeline.
 *
 * Everything with logic in it lives in _shared/ingest.ts so it can be tested
 * against a stub client; this file only does transport, auth and logging.
 */
Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }
  if (!hasIngestAuthorization(req)) {
    return json({ error: "unauthorized" }, 401);
  }

  let payload: IngestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid json body" }, 400);
  }

  const problem = validate(payload);
  if (problem) {
    return json({ error: problem }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await ingest(supabase, payload);
    const outcomesNotified = await flushOutcomeNotifications(supabase);

    await log(supabase, payload, { ...result, durationMs: Date.now() - startedAt });

    return json({ ok: true, ...result, outcomesNotified });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("ingest failed:", message);

    await log(supabase, payload, {
      barsWritten: 0,
      levelsWritten: 0,
      signalsCreated: 0,
      durationMs: Date.now() - startedAt,
      error: message,
    });

    return json({ error: message }, 500);
  }
});

async function log(
  supabase: SupabaseClient,
  payload: IngestPayload,
  result: Partial<IngestResult> & { durationMs: number; error?: string },
): Promise<void> {
  const { error } = await supabase.from("ingest_log").insert({
    symbol: payload?.symbol ?? null,
    timeframe: payload?.timeframe ?? null,
    bars_count: result.barsWritten ?? 0,
    levels_count: result.levelsWritten ?? 0,
    signals_count: result.signalsCreated ?? 0,
    duration_ms: result.durationMs,
    error: result.error ?? null,
  });

  // Logging is diagnostic only; never let it mask the real outcome.
  if (error) console.error("ingest log write failed:", error.message);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
