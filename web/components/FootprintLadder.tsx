import { num } from "@/lib/format";
import type { ClusterLevelRow } from "@/lib/types";

interface Props {
  levels: ClusterLevelRow[];
  pocPrice: number | null;
  /** Prices the rule cited as evidence; ringed so the reason is visible. */
  highlighted: number[];
  signalPrice: number;
}

/**
 * The bar's footprint as a bid x ask ladder, highest price at the top.
 *
 * Ask and bid are two sequential contexts on screen at once, so they get their
 * own one-hue ramps (blue and orange). Every cell also prints its number, so
 * the shading is a reading aid rather than the only encoding.
 */
export function FootprintLadder({ levels, pocPrice, highlighted, signalPrice }: Props) {
  if (levels.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        ไม่มีข้อมูล footprint ของแท่งนี้
      </p>
    );
  }

  const rows = [...levels].sort((a, b) => num(b.price) - num(a.price));
  const maxAsk = Math.max(...rows.map((r) => num(r.ask)), 1);
  const maxBid = Math.max(...rows.map((r) => num(r.bid)), 1);
  const flagged = new Set(highlighted.map((p) => num(p).toFixed(8)));

  return (
    <div>
      {/* Two series on screen, so a legend is always present. */}
      <div className="mb-2 flex items-center gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--bid)" }} />
          Bid (คนขายไล่ราคา)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--ask)" }} />
          Ask (คนซื้อไล่ราคา)
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-3.5 w-1 rounded-sm"
            style={{ background: "var(--text-primary)" }}
          />
          หลักฐานที่ทำให้เกิดสัญญาณ
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[380px] text-sm tabular">
          <thead>
            <tr style={{ color: "var(--text-muted)" }} className="text-xs">
              <th className="w-2 py-1" aria-label="หลักฐาน" />
              <th className="py-1 pr-2 text-right font-normal">Bid</th>
              <th className="py-1 px-3 text-center font-normal">ราคา</th>
              <th className="py-1 pl-2 text-left font-normal">Ask</th>
              <th className="py-1 pl-3 pr-1 text-right font-normal">รวม</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const price = num(row.price);
              const ask = num(row.ask);
              const bid = num(row.bid);
              const isPoc = pocPrice !== null && Math.abs(price - num(pocPrice)) < 1e-9;
              const isFlagged = flagged.has(price.toFixed(8));
              const isEntry = Math.abs(price - num(signalPrice)) < 1e-9;

              return (
                <tr key={price}>
                  <td
                    className="w-2 p-0"
                    title={isFlagged ? "ระดับราคาที่กฎใช้เป็นหลักฐาน" : undefined}
                  >
                    {isFlagged && (
                      <span
                        className="block h-5 w-1 rounded-sm"
                        style={{ background: "var(--text-primary)" }}
                      />
                    )}
                  </td>

                  <td
                    className="py-0.5 pr-2 text-right"
                    title={`Bid ${bid} @ ${price}`}
                    style={{
                      background: `color-mix(in oklab, var(--bid) ${
                        Math.round((bid / maxBid) * 70)
                      }%, transparent)`,
                    }}
                  >
                    {bid || ""}
                  </td>

                  <td
                    className="px-3 text-center"
                    style={{
                      color: "var(--text-secondary)",
                      fontWeight: isPoc || isEntry ? 600 : 400,
                    }}
                  >
                    {price}
                    {isPoc && <span title="Point of Control"> ◆</span>}
                    {isEntry && <span title="ราคาที่เกิดสัญญาณ"> ←</span>}
                  </td>

                  <td
                    className="py-0.5 pl-2 text-left"
                    title={`Ask ${ask} @ ${price}`}
                    style={{
                      background: `color-mix(in oklab, var(--ask) ${
                        Math.round((ask / maxAsk) * 70)
                      }%, transparent)`,
                    }}
                  >
                    {ask || ""}
                  </td>

                  <td className="pl-3 pr-1 text-right text-xs" style={{ color: "var(--text-muted)" }}>
                    {num(row.volume)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        ◆ = Point of Control · ← = ราคาที่เกิดสัญญาณ
      </p>
    </div>
  );
}
