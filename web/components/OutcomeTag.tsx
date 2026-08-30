import { signed } from "@/lib/format";

interface Props {
  status: string | null | undefined;
  pnlTicks: number | null | undefined;
  /** The plan's own risk. Given it, the result is stated in R. */
  riskTicks?: number | null;
}

/**
 * Outcome state pairs its colour with an icon and the signed number, so the
 * status hue never has to carry the meaning by itself.
 */
export function OutcomeTag({ status, pnlTicks, riskTicks }: Props) {
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

  // R, not ticks, whenever the plan carried a risk to divide by. ATAS reports a
  // footprint row as its TickSize, so a tick count beside an entry given in
  // price describes the same trade in two units and reads like a different one
  // (HANDOFF rule 10). R is also the only unit that compares BTCUSDT with MNQU6.
  const amount = riskTicks && riskTicks > 0
    ? `${signed(pnl / riskTicks)}R`
    : `${signed(pnl)} ticks`;

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
      {flat ? "➖" : won ? "✓" : "✕"} {amount}
    </span>
  );
}
