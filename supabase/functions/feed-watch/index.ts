import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { bangkokStamp, describeQuiet, sendNotice } from "../_shared/feed_health.ts";

/**
 * Says when a chart stops posting, and when it starts again.
 *
 * Run from pg_cron rather than from ingest, because ingest only runs while the
 * bridge is posting: the process that would notice the silence is the one that
 * has gone silent. See migration 0022.
 */

interface StatusRow {
  symbol: string;
  timeframe: string;
  feed: "live" | "history-only" | "silent";
  last_bar_at: string | null;
  last_ingest_at: string | null;
  quiet_minutes: number | null;
}

interface AlertRow {
  symbol: string;
  timeframe: string;
  told_state: "live" | "quiet";
}

/**
 * A single missed post is not an outage. Three bars of a 5m chart is fifteen
 * minutes, so thirty leaves room for one late post without crying wolf.
 */
const QUIET_AFTER_MINUTES = 30;

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("INGEST_TOKEN");
  const header = req.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Either the ingest token or a runner token opens this, matching backtest.
  let allowed = expected !== undefined && presented === expected;
  if (!allowed && presented !== "") {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(presented),
    );
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { data } = await supabase
      .from("runner_tokens")
      .select("id")
      .eq("token_hash", hash)
      .maybeSingle();
    allowed = data !== null;
  }

  if (!allowed) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: statusData, error: statusError } = await supabase
    .from("instrument_status")
    .select("symbol, timeframe, feed, last_bar_at, last_ingest_at, quiet_minutes");

  if (statusError) {
    return new Response(JSON.stringify({ error: statusError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const status = (statusData ?? []) as StatusRow[];
  const { data: alertData } = await supabase
    .from("feed_alerts")
    .select("symbol, timeframe, told_state");

  const told = new Map(
    ((alertData ?? []) as AlertRow[]).map((a) => [
      `${a.symbol}|${a.timeframe}`,
      a.told_state,
    ]),
  );

  const changes: { symbol: string; from: string; to: string }[] = [];

  for (const row of status) {
    const key = `${row.symbol}|${row.timeframe}`;
    const quiet = row.feed !== "live" &&
      (row.quiet_minutes ?? 0) >= QUIET_AFTER_MINUTES;
    const now: "live" | "quiet" = quiet ? "quiet" : "live";

    // A chart seen for the first time is recorded without announcing: its
    // current state is not news, it is the starting point.
    const previous = told.get(key);
    if (previous === undefined) {
      await supabase.from("feed_alerts").upsert({
        symbol: row.symbol,
        timeframe: row.timeframe,
        told_state: now,
        told_at: new Date().toISOString(),
      });
      continue;
    }

    if (previous === now) continue;

    await sendNotice(
        now === "quiet"
          ? `🔇 <b>${row.symbol}</b> ${row.timeframe} หยุดส่งข้อมูล\n` +
            `${describeQuiet(row.quiet_minutes)}\n` +
            `แท่งล่าสุด: ${bangkokStamp(row.last_bar_at)}\n` +
            `<i>ถ้าตลาดปิดอยู่ถือว่าปกติ · ถ้าตลาดเปิด แปลว่า ATAS หรือ indicator หลุด</i>`
          : `🔊 <b>${row.symbol}</b> ${row.timeframe} กลับมาส่งข้อมูลแล้ว\n` +
            `แท่งล่าสุด: ${bangkokStamp(row.last_bar_at)}`,
    );

    await supabase.from("feed_alerts").upsert({
      symbol: row.symbol,
      timeframe: row.timeframe,
      told_state: now,
      told_at: new Date().toISOString(),
    });

    changes.push({ symbol: row.symbol, from: previous, to: now });
  }

  return new Response(
    JSON.stringify({ ok: true, checked: status.length, changes }),
    { headers: { "Content-Type": "application/json" } },
  );
});
