import { num, percent, signedTicks } from "@/lib/format";

/**
 * Win rate is a magnitude on a fixed 0-100% scale, so it gets one sequential
 * hue and a reference mark at break-even. The number is always printed beside
 * the bar; the fill is a reading aid, not the encoding.
 */
export function WinRateMeter({ value, trades }: { value: number; trades: number }) {
  const pct = Math.max(0, Math.min(1, num(value)));

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-2 w-24 overflow-hidden rounded-sm"
        style={{ background: "var(--neutral-mid)" }}
        title={`ชนะ ${percent(pct, 1)} จาก ${trades} ไม้`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{ width: `${pct * 100}%`, background: "var(--ask)" }}
        />
        {/* Break-even reference: half the bar is the line worth beating. */}
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: "50%", background: "var(--baseline)" }}
          aria-hidden
        />
      </div>
      <span className="tabular text-xs">{percent(pct, 1)}</span>
    </div>
  );
}

/**
 * Average P&L has a meaningful zero, so it is diverging: the bar grows either
 * side of a centre baseline, blue for profit and red for loss, with the signed
 * number as the direct label.
 */
export function PnlBar({ value, max }: { value: number; max: number }) {
  const ticks = num(value);
  const scale = max > 0 ? Math.min(Math.abs(ticks) / max, 1) : 0;
  const positive = ticks >= 0;

  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-24" title={`เฉลี่ย ${signedTicks(ticks)} ticks ต่อไม้`}>
        <div
          className="absolute inset-y-0 w-px"
          style={{ left: "50%", background: "var(--baseline)" }}
          aria-hidden
        />
        <div
          className="absolute inset-y-0 rounded-sm"
          style={{
            width: `${(scale * 100) / 2}%`,
            left: positive ? "50%" : undefined,
            right: positive ? undefined : "50%",
            background: positive ? "var(--long)" : "var(--short)",
          }}
        />
      </div>
      <span
        className="tabular text-xs font-medium"
        style={{ color: positive ? "var(--success-text)" : "var(--status-critical)" }}
      >
        {signedTicks(ticks)}
      </span>
    </div>
  );
}
