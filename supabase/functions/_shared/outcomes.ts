import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sendOutcome, telegramConfig } from "./telegram.ts";

interface PendingRow {
  signal_id: string;
  pnl_ticks: number | null;
  mfe_ticks: number | null;
  mae_ticks: number | null;
  bars_used: number | null;
  exit_reason: string | null;
  signals: { telegram_message_id: number | null } | null;
}

/**
 * Replies to each announced signal with how it actually turned out, once.
 *
 * Called at the end of every ingest rather than on its own timer: the
 * indicator posts continuously while the market is open, which is exactly when
 * outcomes resolve. The `outcome-notify` function exposes the same routine over
 * HTTP for manual or scheduled runs.
 */
export async function flushOutcomeNotifications(
  supabase: SupabaseClient,
  limit = 20,
): Promise<number> {
  const cfg = telegramConfig();
  // Without a bot there is nothing to reply to. Leave the rows unmarked so the
  // backlog is not silently consumed before Telegram is ever configured.
  if (!cfg) return 0;

  const { data, error } = await supabase
    .from("signal_outcomes")
    .select(
      "signal_id, pnl_ticks, mfe_ticks, mae_ticks, bars_used, exit_reason, signals!inner(telegram_message_id)",
    )
    .eq("status", "resolved")
    .is("notified_at", null)
    .limit(limit);

  if (error) {
    console.error("outcome flush query failed:", error.message);
    return 0;
  }

  const rows = (data ?? []) as unknown as PendingRow[];
  if (rows.length === 0) return 0;

  let sent = 0;
  for (const row of rows) {
    const messageId = row.signals?.telegram_message_id;
    if (!messageId) continue;

    const ok = await sendOutcome(cfg, {
      replyToMessageId: messageId,
      pnlTicks: Number(row.pnl_ticks ?? 0),
      mfeTicks: Number(row.mfe_ticks ?? 0),
      maeTicks: Number(row.mae_ticks ?? 0),
      barsUsed: row.bars_used ?? 0,
      exitReason: row.exit_reason,
    });
    if (ok !== null) sent++;
  }

  // Mark the whole batch, including signals that were never announced, so the
  // unnotified index stays small instead of accumulating rows forever.
  const { error: updateError } = await supabase
    .from("signal_outcomes")
    .update({ notified_at: new Date().toISOString() })
    .in("signal_id", rows.map((r) => r.signal_id));

  if (updateError) {
    console.error("outcome flush update failed:", updateError.message);
  }

  return sent;
}
