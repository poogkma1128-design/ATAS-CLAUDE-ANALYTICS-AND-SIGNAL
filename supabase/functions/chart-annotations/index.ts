import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { hasIngestAuthorization } from "../_shared/auth.ts";
import {
  mapChartAnnotations,
  parseChartAnnotationRequest,
} from "../_shared/chart_annotations.ts";

/**
 * Read-only chart companion for the ATAS bridge. Ingest remains write-only and
 * can continue safely if this optional overlay endpoint is unavailable.
 */
Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  if (!hasIngestAuthorization(req)) return json({ error: "unauthorized" }, 401);

  const query = parseChartAnnotationRequest(new URL(req.url));
  if (typeof query === "string") return json({ error: query }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const { data: instruments, error: instrumentError } = await supabase
    .from("instruments")
    .select("id")
    .eq("symbol", query.symbol)
    .limit(1);
  if (instrumentError) return json({ error: instrumentError.message }, 500);

  const instrument = instruments?.[0];
  if (!instrument) return json({ ok: true, annotations: [] });

  const { data: policies, error: policyError } = await supabase
    .from("instrument_signal_policies")
    .select("role")
    .eq("instrument_id", instrument.id)
    .eq("timeframe", query.timeframe)
    .limit(1);
  if (policyError) return json({ error: policyError.message }, 500);
  if (policies?.[0]?.role === "shadow") return json({ ok: true, annotations: [] });

  let signalQuery = supabase
    .from("signals")
    .select(
      "id, seq, rule_key, direction, entry_price, stop_price, target_price, entry_bar:bars!signals_bar_id_fkey(opened_at), outcome:signal_outcomes(status, exit_price, exit_reason, exit_bar:bars!signal_outcomes_exit_bar_id_fkey(opened_at))",
    )
    .eq("instrument_id", instrument.id)
    .eq("timeframe", query.timeframe)
    .eq("muted", false)
    .order("fired_at", { ascending: false })
    .limit(query.limit);

  if (query.since) signalQuery = signalQuery.gte("fired_at", query.since);
  const { data: rows, error: signalError } = await signalQuery;
  if (signalError) return json({ error: signalError.message }, 500);

  return json({ ok: true, annotations: mapChartAnnotations(rows ?? []) });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
