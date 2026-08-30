/** Signed quantities read better with an explicit plus, whatever the unit. */
export function signed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "–";
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

/** Signed tick counts read better with an explicit plus. */
export function signedTicks(value: number | null | undefined): string {
  return signed(value);
}

export function percent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * Bangkok time, written in Thai.
 *
 * Applied as a fixed +7 offset rather than through the browser's locale, for
 * three reasons. Thailand has not observed daylight saving since 1941, so the
 * offset is right on every date. The Telegram alerts already state Bangkok time
 * the same way, and a dashboard that disagreed with the alert about when a
 * trade fired would be worse than one that showed no time at all. And this page
 * renders on the server as well as in the browser: `toLocaleString` with the
 * ambient timezone produced UTC on the server and local time on the client for
 * the same row, which React reconciles silently.
 *
 * The year stays Gregorian, matching the alerts and the exchange's own
 * timestamps — a Buddhist year here would read as Thai but compare wrongly
 * against everything else the trade is checked against.
 */
const THAI_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function bangkok(iso: string): Date {
  // Shifted then read in UTC, so the fields come out as Bangkok wall clock
  // wherever this runs.
  return new Date(new Date(iso).getTime() + BANGKOK_OFFSET_MS);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `30 ส.ค. 18:35:01 น.` — the year appears only when it is not this one. */
export function shortTime(iso: string): string {
  const d = bangkok(iso);
  const now = bangkok(new Date().toISOString());
  const year = d.getUTCFullYear() === now.getUTCFullYear()
    ? ""
    : ` ${d.getUTCFullYear()}`;

  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]}${year} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} น.`;
}

/**
 * How long ago, in Thai.
 *
 * A timestamp alone does not answer "is this still arriving?" — the reader has
 * to know the current time and do the subtraction. This says it outright, which
 * is the whole point of showing the last bar at all.
 */
export function thaiAgo(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "–";
  if (minutes < 1) return "เมื่อครู่";
  if (minutes < 60) return `${Math.round(minutes)} นาทีที่แล้ว`;

  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} ชม.ที่แล้ว`;

  const days = hours / 24;
  return `${Math.floor(days)} วัน ${Math.round(hours % 24)} ชม.ที่แล้ว`;
}

export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}
