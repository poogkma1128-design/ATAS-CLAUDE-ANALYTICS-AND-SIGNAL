/**
 * Wording for the feed alerts.
 *
 * Split out from the function so it can be unit tested: an alert that is only
 * ever seen in production is one whose wording nobody checks.
 */

/**
 * Bangkok time, as a fixed +7 offset.
 *
 * Same reasoning as telegram.ts: Thailand has had no daylight saving since
 * 1941, and an edge runtime is not guaranteed to carry a timezone database — a
 * missing one makes Intl print UTC while the label still claims local time,
 * which is worse than not converting.
 */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

export function bangkokStamp(iso: string | null): string {
  if (!iso) return "ยังไม่เคยมี";

  const d = new Date(new Date(iso).getTime() + BANGKOK_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");

  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} น.`;
}

/** How long the silence has run, in the units a person would use for it. */
export function describeQuiet(minutes: number | null): string {
  if (minutes === null) return "ไม่เคยส่งเข้ามาเลย";
  if (minutes < 60) return `เงียบมา ${Math.round(minutes)} นาที`;

  const hours = minutes / 60;
  if (hours < 24) return `เงียบมา ${Math.round(hours)} ชั่วโมง`;

  return `เงียบมา ${Math.floor(hours / 24)} วัน ${Math.round(hours % 24)} ชั่วโมง`;
}

/**
 * Sends a notice about the system itself.
 *
 * Kept here rather than in telegram.ts, which exists to format trades. This
 * message is not a trade: it has no direction, no plan, and nothing to reply
 * to. Sharing that module would have made feed-watch carry every trade
 * formatter to use none of them, and tied its deployments to changes in
 * message wording it does not participate in — a real cost, because deploying
 * an edge function here means uploading everything it imports (HANDOFF 7.3).
 *
 * The secrets are read exactly as telegram.ts reads them, so there is still one
 * way to configure a bot, only two callers.
 */
export async function sendNotice(text: string): Promise<boolean> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  // No bot configured is not an error: the alert has nowhere to go, and the
  // state is still recorded so nothing is announced twice later.
  if (!botToken || !chatId) return false;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      },
    );
    const result = await response.json();
    if (!response.ok || !result.ok) {
      console.error("feed notice failed:", JSON.stringify(result));
      return false;
    }
    return true;
  } catch (error) {
    // A Telegram outage must not stop the watcher recording what it saw.
    console.error("feed notice threw:", error);
    return false;
  }
}
