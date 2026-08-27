import { signedTicks } from "@/lib/format";

interface Props {
  status: string | null | undefined;
  pnlTicks: number | null | undefined;
}

/**
 * Outcome state pairs its colour with an icon and the signed number, so the
 * status hue never has to carry the meaning by itself.
 */
export function OutcomeTag({ status, pnlTicks }: Props) {
  if (!status || status === "pending") {
    return (
      <span className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
        ○ รอผล
      </span>
    );
  }

  if (status === "expired") {
    return (
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        — ไม่มีข้อมูลพอ
      </span>
    );
  }

  const pnl = pnlTicks ?? 0;
  const won = pnl > 0;
  const flat = pnl === 0;

  return (
    <span
      className="text-xs font-medium tabular"
      style={{
        color: flat
          ? "var(--text-secondary)"
          : won
          ? "var(--success-text)"
          : "var(--status-critical)",
      }}
    >
      {flat ? "➖" : won ? "✓" : "✕"} {signedTicks(pnl)} ticks
    </span>
  );
}
