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
  /** public.signals.seq — the number shown as #S<seq>. */
  seq: number | null;
  ruleName: string;
  ruleKey: string;
  direction: "long" | "short";
  symbol: string;
  timeframe: string;
  price: number;
  confidence: number;
  firedAt: string;
  evidence: string | null;
  plan: TradePlanLines | null;
}

/** The alert has to be actionable on its own: someone reading it on a phone,
 *  away from the chart, must be able to place the trade from the message. */
export interface TradePlanLines {
  entry: number;
  stop: number;
  target: number;
  riskTicks: number;
  rewardTicks: number;
  trailTriggerTicks: number;
  trailOffsetTicks: number;
  holdBars: number;
}

/** Trims the float noise that price arithmetic leaves behind. */
function fmt(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Same, with the sign kept on gains so a result reads at a glance. */
function signed(value: number): string {
  const trimmed = Number(value.toFixed(2));
  return (trimmed > 0 ? "+" : "") + String(trimmed);
}

/**
 * Bangkok time, which is where these are read.
 *
 * Applied as a fixed offset rather than through Intl: Thailand has not observed
 * daylight saving since 1941, so UTC+7 holds on every date, and an edge runtime
 * is not guaranteed to ship a full timezone database — a missing one would
 * silently print UTC while claiming to be local, which is worse than not
 * converting at all.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkokTime(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + BANGKOK_OFFSET_MS);
  return shifted.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * The number that ties an alert to its result.
 *
 * `#S` and not a bare `#123`: Telegram only linkifies a hashtag that contains a
 * non-digit, and a tappable tag turns "which trade was that?" into a search
 * that finds both messages.
 */
function tag(seq: number | null): string | null {
  return seq === null ? null : `#S${seq}`;
}

export function formatSignal(msg: SignalMessage): string {
  const arrow = msg.direction === "long" ? "🟢 LONG" : "🔴 SHORT";
  const confidence = Math.round(msg.confidence * 100);

  const label = tag(msg.seq);

  const lines = [
    `${label ? `<b>${label}</b> · ` : ""}<b>${arrow}</b> · ${escapeHtml(msg.ruleName)}`,
    `<code>${escapeHtml(msg.symbol)}</code> · ${escapeHtml(msg.timeframe)} · ความมั่นใจ ${confidence}%`,
  ];

  if (msg.plan) {
    const p = msg.plan;
    const rr = p.riskTicks > 0 ? (p.rewardTicks / p.riskTicks).toFixed(1) : "-";

    // Distances are given in price, not in ticks. ATAS reports TickSize as the
    // chart's footprint row spacing, which is a multiple of the exchange tick
    // (0.75 on an MNQ chart grouping three ticks per row), so a tick count here
    // would read as three times tighter than the trade actually is.
    const risk = Math.abs(p.stop - p.entry);
    const reward = Math.abs(p.target - p.entry);

    // The plan stores its trail in the same unit as the risk, so the price step
    // it was built from is recoverable without carrying tick size around.
    const step = p.riskTicks > 0 ? risk / p.riskTicks : 0;
    const away = msg.direction === "long" ? 1 : -1;
    const trailAt = p.entry + away * p.trailTriggerTicks * step;
    const trailBy = p.trailOffsetTicks * step;

    lines.push(
      "",
      `🎯 เข้า <b>${p.entry}</b>`,
      `🛑 SL <b>${p.stop}</b>  (เสี่ยง ${fmt(risk)})`,
      `✅ TP <b>${p.target}</b>  (ได้ ${fmt(reward)} · RR 1:${rr})`,
      `↕️ ราคาถึง ${fmt(trailAt)} แล้วเลื่อน SL ตามห่าง ${fmt(trailBy)}`,
      `⏱ ถือไม่เกิน ${p.holdBars} แท่ง ไม่ถึง TP/SL ให้ปิดที่ราคาตลาด`,
      "",
    );
  }

  if (msg.evidence) lines.push(escapeHtml(msg.evidence));

  lines.push(`<i>${escapeHtml(bangkokTime(msg.firedAt))} น. (ไทย)</i>`);

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
  /** Same number as the alert this replies to, so the two can be matched even
   *  when Telegram truncates the quoted message. */
  seq: number | null;
  replyToMessageId: number;
  pnlTicks: number;
  mfeTicks: number;
  maeTicks: number;
  barsUsed: number;
  exitReason: string | null;
  /** Price per plan tick, so the result can be stated in the same unit the
   *  alert used. Null when the plan carried no risk to divide by. */
  priceStep: number | null;
  /** The plan's own risk, which is what turns a distance into an R. */
  riskTicks: number | null;
}

const EXIT_LABEL: Record<string, string> = {
  target: "ถึง TP",
  stop: "โดน SL",
  trail: "SL ที่เลื่อนตามมา",
  timeout: "ครบจำนวนแท่ง ปิดที่ราคาตลาด",
};

export function formatOutcome(msg: OutcomeMessage): string {
  const mark = msg.pnlTicks > 0 ? "✅" : msg.pnlTicks < 0 ? "❌" : "➖";
  const how = msg.exitReason ? EXIT_LABEL[msg.exitReason] ?? msg.exitReason : null;
  const label = tag(msg.seq);

  // Stated in price, matching the alert. The alert deliberately avoids tick
  // counts because ATAS reports a footprint row as its TickSize, so "+200
  // ticks" against an alert promising "ได้ 60.00" describes the same trade in
  // two units and reads like a different one.
  const step = msg.priceStep;
  const amount = step !== null
    ? signed(msg.pnlTicks * step)
    : `${signed(msg.pnlTicks)} ticks`;

  // R is the unit every statistic in this system is kept in, and the only one
  // that compares a BTCUSDT result against an MNQU6 one.
  const r = msg.riskTicks && msg.riskTicks > 0
    ? ` (${signed(msg.pnlTicks / msg.riskTicks)}R)`
    : "";

  const far = step !== null ? fmt(msg.mfeTicks * step) : `${msg.mfeTicks} ticks`;
  const against = step !== null ? fmt(msg.maeTicks * step) : `${msg.maeTicks} ticks`;

  return [
    [
      mark,
      label ? `<b>${label}</b> ·` : null,
      `<b>${amount}${r}</b>`,
      `หลังจบ ${msg.barsUsed} แท่ง`,
    ].filter((part): part is string => part !== null).join(" "),
    how ? `จบเพราะ: ${escapeHtml(how)}` : null,
    `ไปได้ไกลสุด +${far} · สวนไปสุด -${against}`,
  ].filter((line): line is string => line !== null).join("\n");
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
