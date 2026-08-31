import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendOutcome, telegramConfig } from "./telegram.ts";

interface ClaimedRow {
  signal_id: string;
  pnl_ticks: number | null;
  mfe_ticks: number | null;
  mae_ticks: number | null;
  bars_used: number | null;
  exit_reason: string | null;
  seq: number | null;
  direction: string | null;
  symbol: string | null;
  timeframe: string | null;
  telegram_message_id: number | null;
  entry_price: number | null;
  stop_price: number | null;
  risk_ticks: number | null;
}

/**
 * Replies to each announced signal with how it actually turned out, once.
 *
 * Called at the end of every ingest rather than on its own timer: the
 * indicator posts continuously while the market is open, which is exactly when
 * outcomes resolve. The `outcome-notify` function exposes the same routine over
 * HTTP for manual or scheduled runs.
 *
 * "Once" used to be a hope rather than a property. This read the unnotified
 * rows, sent them, and stamped them afterwards; four charts post independently,
 * so several ingests were always in flight, and each one read the same unmarked
 * rows before any of them wrote. Every result arrived two or three times.
 *
 * The claim now happens in the database, in the same statement that reads the
 * row (see claim_outcome_notifications). This function is handed rows nobody
 * else can have, so the only way to send twice is to be handed the same row
 * twice, which the stamp prevents.
 */
export async function flushOutcomeNotifications(
  supabase: SupabaseClient,
  limit = 20,
): Promise<number> {
  const cfg = telegramConfig();
  // Without a bot there is nothing to reply to, and claiming would burn the
  // backlog before Telegram is ever configured. Nothing is claimed here.
  if (!cfg) return 0;

  const { data, error } = await supabase.rpc("claim_outcome_notifications", {
    max_rows: limit,
  });

  if (error) {
    console.error("outcome claim failed:", error.message);
    return 0;
  }

  const rows = (data ?? []) as ClaimedRow[];
  if (rows.length === 0) return 0;

  // Claimed but not delivered. Marked back as unnotified at the end so the next
  // ingest retries them, because a result that was never sent must not be
  // recorded as sent -- the same rule the rest of this system holds to.
  const undelivered: string[] = [];

  let sent = 0;
  for (const row of rows) {
    // Never announced, so there is no message to reply to. It stays claimed:
    // re-releasing it would make every later flush pick it up and skip it
    // again, forever.
    if (!row.telegram_message_id) continue;

    const ok = await sendOutcome(cfg, {
      seq: row.seq === null || row.seq === undefined ? null : Number(row.seq),
      symbol: row.symbol,
      timeframe: row.timeframe,
      direction: row.direction === "long" || row.direction === "short"
        ? row.direction
        : null,
      replyToMessageId: row.telegram_message_id,
      pnlTicks: Number(row.pnl_ticks ?? 0),
      mfeTicks: Number(row.mfe_ticks ?? 0),
      maeTicks: Number(row.mae_ticks ?? 0),
      barsUsed: row.bars_used ?? 0,
      exitReason: row.exit_reason,
      priceStep: priceStepOf(row),
      riskTicks: row.risk_ticks === null || row.risk_ticks === undefined
        ? null
        : Number(row.risk_ticks),
    });

    if (ok !== null) sent++;
    else undelivered.push(row.signal_id);
  }

  if (undelivered.length > 0) {
    const { error: releaseError } = await supabase
      .from("signal_outcomes")
      .update({ notified_at: null })
      .in("signal_id", undelivered);

    if (releaseError) {
      // Now genuinely lost: claimed, not sent, and not given back. Said out
      // loud rather than swallowed, because the row itself will look delivered.
      console.error(
        `outcome release failed for ${undelivered.length} signal(s):`,
        releaseError.message,
      );
    }
  }

  return sent;
}

/**
 * Price covered by one tick of the plan, recovered from the plan itself.
 *
 * The stop sits exactly `risk_ticks` away from the entry, so their ratio is the
 * step the plan was built with — no need to carry the instrument's tick size
 * into the reply, and it stays correct for a signal whose chart was later
 * re-grouped. The same trick states the trail in `formatSignal`.
 */
function priceStepOf(row: ClaimedRow): number | null {
  const risk = Number(row.risk_ticks ?? 0);
  const entry = Number(row.entry_price ?? 0);
  const stop = Number(row.stop_price ?? 0);

  if (!(risk > 0) || !Number.isFinite(entry) || !Number.isFinite(stop)) {
    return null;
  }

  const step = Math.abs(stop - entry) / risk;
  return step > 0 ? step : null;
}
