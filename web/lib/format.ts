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

export function shortTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function num(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}
