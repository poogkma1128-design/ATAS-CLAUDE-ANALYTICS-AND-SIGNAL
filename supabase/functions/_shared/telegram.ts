export interface TelegramConfig {
  botToken: string;
  chatId: string;
  dashboardUrl: string;
}

/**
 * Telegram is optional. When the secrets are absent the system stores signals
 * as normal and simply does not announce them, so the stack can be deployed
 * before a bot exists.
 */
export function telegramConfig(): TelegramConfig | null {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!botToken || !chatId) return null;

  return {
    botToken,
    chatId,
    dashboardUrl: (Deno.env.get("DASHBOARD_URL") ?? "").replace(/\/+$/, ""),
  };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function callTelegram(
  cfg: TelegramConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${cfg.botToken}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cfg.chatId, ...body }),
      },
    );

    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error(`telegram ${method} failed:`, JSON.stringify(result));
      return null;
    }

    return typeof result.result?.message_id === "number"
      ? result.result.message_id
      : null;
  } catch (error) {
    // A Telegram outage must never fail an ingest: the data is already stored.
    console.error(`telegram ${method} threw:`, error);
    return null;
  }
}

export interface SignalMessage {
  signalId: string;
  ruleName: string;
  ruleKey: string;
  direction: "long" | "short";
  symbol: string;
  timeframe: string;
  price: number;
  confidence: number;
  firedAt: string;
  evidence: string | null;
}

export function formatSignal(msg: SignalMessage): string {
  const arrow = msg.direction === "long" ? "🟢 LONG" : "🔴 SHORT";
  const confidence = Math.round(msg.confidence * 100);

  const lines = [
    `<b>${arrow}</b> · ${escapeHtml(msg.ruleName)}`,
    `<code>${escapeHtml(msg.symbol)}</code> · ${escapeHtml(msg.timeframe)} @ <b>${msg.price}</b>`,
    `ความมั่นใจ ${confidence}%`,
  ];

  if (msg.evidence) lines.push(escapeHtml(msg.evidence));

  lines.push(
    `<i>${escapeHtml(new Date(msg.firedAt).toISOString().replace("T", " ").slice(0, 19))} UTC</i>`,
  );

  return lines.join("\n");
}

export function sendSignal(
  cfg: TelegramConfig,
  msg: SignalMessage,
): Promise<number | null> {
  const body: Record<string, unknown> = {
    text: formatSignal(msg),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (cfg.dashboardUrl) {
    body.reply_markup = {
      inline_keyboard: [[{
        text: "ดูรายละเอียด",
        url: `${cfg.dashboardUrl}/signals/${msg.signalId}`,
      }]],
    };
  }

  return callTelegram(cfg, "sendMessage", body);
}

export interface OutcomeMessage {
  replyToMessageId: number;
  pnlTicks: number;
  mfeTicks: number;
  maeTicks: number;
  barsUsed: number;
}

export function formatOutcome(msg: OutcomeMessage): string {
  const won = msg.pnlTicks > 0;
  const mark = won ? "✅" : msg.pnlTicks < 0 ? "❌" : "➖";
  const sign = msg.pnlTicks > 0 ? "+" : "";

  return [
    `${mark} <b>${sign}${msg.pnlTicks} ticks</b> หลังจบ ${msg.barsUsed} แท่ง`,
    `ไปได้ไกลสุด +${msg.mfeTicks} · สวนไปสุด -${msg.maeTicks}`,
  ].join("\n");
}

/** Posts the result as a reply on the original alert, keeping them together. */
export function sendOutcome(
  cfg: TelegramConfig,
  msg: OutcomeMessage,
): Promise<number | null> {
  return callTelegram(cfg, "sendMessage", {
    text: formatOutcome(msg),
    parse_mode: "HTML",
    reply_to_message_id: msg.replyToMessageId,
    allow_sending_without_reply: true,
  });
}
