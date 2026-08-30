import { num, percent, shortTime } from "@/lib/format";
import type { ExperimentResultRow, ExperimentRow } from "@/lib/types";

/**
 * One experiment: what was changed, and what the same bars did under it.
 *
 * Every row is a simulation over stored bars. Nothing here was ever announced,
 * and nothing here is in force — the settings actually running are on /rules.
 *
 * Total R is shown next to R per trade because they answer different questions.
 * A variant that loosens a filter takes more trades, so its total can rise while
 * every individual trade got slightly worse; per trade is what says whether the
 * change made the system better rather than merely busier.
 */
export function ExperimentCard(
  { experiment, results }: {
    experiment: ExperimentRow;
    results: ExperimentResultRow[];
  },
) {
  const overall = results.filter(
    (r) => r.symbol === null && r.rule_key === null,
  );
  const baseline = overall.find((r) => r.variant === "baseline") ?? null;
  const variants = overall.filter((r) => r.variant !== "baseline");

  const changeOf = (label: string) =>
    experiment.variants?.find((v) => v.label === label);

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">{experiment.name}</h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {shortTime(experiment.created_at)}
        </span>
        {experiment.status !== "done" && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--surface-sunken)", color: "var(--text-secondary)" }}
          >
            {experiment.status === "running" ? "กำลังรัน" : "ล้มเหลว"}
          </span>
        )}
      </div>

      {experiment.note && (
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {experiment.note}
        </p>
      )}

      <p className="mt-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {experiment.symbols?.join(" · ") || "ไม่มีข้อมูล"}
        {experiment.bars_from && experiment.bars_to && (
          <> · แท่ง {shortTime(experiment.bars_from)} ถึง {shortTime(experiment.bars_to)}</>
        )}
      </p>

      {overall.length === 0
        ? (
          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            {experiment.error ?? "ยังไม่มีผล"}
          </p>
        )
        : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr
                  className="border-b text-xs"
                  style={{ color: "var(--text-muted)", borderColor: "var(--border-hairline)" }}
                >
                  <th className="px-2 py-1.5 text-left font-normal">ทดลองเปลี่ยน</th>
                  <th className="px-2 py-1.5 text-right font-normal">ไม้</th>
                  <th className="px-2 py-1.5 text-right font-normal">ชนะ</th>
                  <th className="px-2 py-1.5 text-right font-normal">R รวม</th>
                  <th className="px-2 py-1.5 text-right font-normal">R ต่อไม้</th>
                  <th className="px-2 py-1.5 text-right font-normal">ต่างจากเดิม</th>
                  <th className="px-2 py-1.5 text-left font-normal">จบยังไง</th>
                </tr>
              </thead>
              <tbody>
                {baseline && <Row row={baseline} baseline={baseline} change={null} />}
                {variants.map((row) => (
                  <Row
                    key={row.variant}
                    row={row}
                    baseline={baseline}
                    change={changeOf(row.variant)?.params ?? null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

function Row(
  { row, baseline, change }: {
    row: ExperimentResultRow;
    baseline: ExperimentResultRow | null;
    change: Record<string, unknown> | null;
  },
) {
  const isBaseline = row.variant === "baseline";
  const totalR = num(row.total_r);
  const perTrade = row.trades > 0 ? totalR / row.trades : 0;

  const basePerTrade = baseline && baseline.trades > 0
    ? num(baseline.total_r) / baseline.trades
    : null;
  const delta = isBaseline || basePerTrade === null ? null : perTrade - basePerTrade;

  return (
    <tr
      className="border-b last:border-0"
      style={{
        borderColor: "var(--border-hairline)",
        background: isBaseline ? "var(--surface-sunken)" : undefined,
      }}
    >
      <td className="px-2 py-2">
        <div className="font-medium">{isBaseline ? "ค่าที่ใช้อยู่จริง" : row.variant}</div>
        {change && Object.keys(change).length > 0 && (
          <code className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {Object.entries(change).map(([k, v]) => `${k} = ${String(v)}`).join(" · ")}
          </code>
        )}
      </td>
      <td className="px-2 py-2 text-right tabular">{row.trades}</td>
      <td className="px-2 py-2 text-right tabular">{percent(num(row.win_rate), 0)}</td>
      <td className="px-2 py-2 text-right tabular">{signedR(totalR)}</td>
      <td className="px-2 py-2 text-right tabular">{perTrade.toFixed(3)}</td>
      <td className="px-2 py-2 text-right tabular">
        {delta === null ? (
          <span style={{ color: "var(--text-muted)" }}>–</span>
        ) : (
          <span
            style={{
              color: delta > 0.001
                ? "var(--success-text)"
                : delta < -0.001
                ? "var(--status-critical)"
                : "var(--text-muted)",
            }}
          >
            {delta > 0 ? "+" : ""}{delta.toFixed(3)} R/ไม้
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>
        TP {row.hit_target} · SL {row.hit_stop} · trail {row.hit_trail} · หมดเวลา{" "}
        {row.timed_out}
      </td>
    </tr>
  );
}

function signedR(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
