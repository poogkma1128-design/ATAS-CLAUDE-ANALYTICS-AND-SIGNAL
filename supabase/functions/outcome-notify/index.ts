import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { flushOutcomeNotifications } from "../_shared/outcomes.ts";

/**
 * Sends the "here is how that signal turned out" replies.
 *
 * The ingest function already calls this routine after every post, which covers
 * market hours. This endpoint exists for the quiet periods and for manual runs,
 * and can be pointed at by any external scheduler.
 */
Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("INGEST_TOKEN");
  const header = req.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  if (!expected || presented !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const notified = await flushOutcomeNotifications(supabase, 50);

  return new Response(JSON.stringify({ ok: true, notified }), {
    headers: { "Content-Type": "application/json" },
  });
});
