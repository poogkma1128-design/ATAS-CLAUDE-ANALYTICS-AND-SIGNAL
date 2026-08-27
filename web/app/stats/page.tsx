import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { DirectionTag } from "@/components/DirectionTag";
import { PnlBar, WinRateMeter } from "@/components/StatBars";
import { num, percent, signedTicks } from "@/lib/format";
import type { RuleRow, SetupStatRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const supabase = await createClient();

  const [{ data: stats }, { data: rules }, { count: pending }] = await Promise.all([
    supabase.from("setup_stats").select("*"),
    supabase.from("rules").select("key, name"),
    supabase
      .from("signal_outcomes")
      .select("signal_id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const rows = ((stats ?? []) as SetupStatRow[])
    .map((row) => ({ ...row, win_rate: num(row.win_rate), avg_pnl_ticks: num(row.avg_pnl_ticks) }))
    .sort((a, b) => num(b.total_pnl_ticks) - num(a.total_pnl_ticks));

  const ruleNames = Object.fromEntries(
    ((rules ?? []) as Pick<RuleRow, "key" | "name">[]).map((r) => [r.key, r.name]),
  );

  const totalTrades = rows.reduce((sum, r) => sum + r.trades, 0);
  const totalWins = rows.reduce((sum, r) => sum + r.wins, 0);
  const totalTicks = rows.reduce((sum, r) => sum + num(r.total_pnl_ticks), 0);
  const maxAbsPnl = Math.max(...rows.map((r) => Math.abs(r.avg_pnl_ticks)), 1);

  return (
    <>
      <Nav current="/stats" />
      <main className="mx-auto max-w-5xl px-5 py-6">
        <h1 className="text-base font-semibold">setup ไหนได้เงินจริง</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          นับเฉพาะสัญญาณที่ครบ horizon แล้ว วัดจากแท่งที่ ATAS ส่งเข้ามาหลังเกิดสัญญาณ
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="ไม้ที่วัดผลแล้ว" value={String(totalTrades)} />
          <Tile
            label="ชนะรวม"
            value={totalTrades > 0 ? percent(totalWins / totalTrades, 1) : "–"}
          />
          <Tile
            label="รวมทั้งหมด"
            value={`${signedTicks(totalTicks)} ticks`}
            tone={totalTicks > 0 ? "good" : totalTicks < 0 ? "bad" : "flat"}
          />
          <Tile label="กำลังรอผล" value={String(pending ?? 0)} />
        </div>

        {rows.length === 0
          ? (
            <div className="card mt-5 p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
              ยังไม่มีสัญญาณที่วัดผลเสร็จ — สถิติจะขึ้นเมื่อมีแท่งหลังสัญญาณครบตาม horizon ของกฎ
            </div>
          )
          : (
            <div className="card mt-5 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr
                    className="border-b text-xs"
                    style={{ color: "var(--text-muted)", borderColor: "var(--border-hairline)" }}
                  >
                    <th className="px-4 py-2 text-left font-normal">Setup</th>
                    <th className="px-4 py-2 text-left font-normal">ทิศทาง</th>
                    <th className="px-4 py-2 text-right font-normal">ไม้</th>
                    <th className="px-4 py-2 text-left font-normal">อัตราชนะ</th>
                    <th className="px-4 py-2 text-left font-normal">เฉลี่ยต่อไม้</th>
                    <th className="px-4 py-2 text-right font-normal">รวม</th>
                    <th className="px-4 py-2 text-right font-normal">ไกลสุด</th>
                    <th className="px-4 py-2 text-right font-normal">สวนสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.rule_key}-${row.direction}`}
                      className="border-b last:border-0"
                      style={{ borderColor: "var(--border-hairline)" }}
                    >
                      <td className="px-4 py-2.5 font-medium">
                        {ruleNames[row.rule_key] ?? row.rule_key}
                      </td>
                      <td className="px-4 py-2.5">
                        <DirectionTag direction={row.direction} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular">{row.trades}</td>
                      <td className="px-4 py-2.5">
                        <WinRateMeter value={row.win_rate} trades={row.trades} />
                      </td>
                      <td className="px-4 py-2.5">
                        <PnlBar value={row.avg_pnl_ticks} max={maxAbsPnl} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular">
                        {signedTicks(num(row.total_pnl_ticks))}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {num(row.avg_mfe_ticks)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {num(row.avg_mae_ticks)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          ทุกตัวเลขเป็นหน่วย tick · &ldquo;ไกลสุด&rdquo; คือ MFE, &ldquo;สวนสุด&rdquo; คือ MAE
        </p>
      </main>
    </>
  );
}

function Tile(
  { label, value, tone = "flat" }: {
    label: string;
    value: string;
    tone?: "good" | "bad" | "flat";
  },
) {
  const color = tone === "good"
    ? "var(--success-text)"
    : tone === "bad"
    ? "var(--status-critical)"
    : "var(--text-primary)";

  return (
    <div className="card p-3">
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-1 text-xl font-semibold tabular" style={{ color }}>{value}</div>
    </div>
  );
}
