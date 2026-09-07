import type { ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { DirectionTag } from "@/components/DirectionTag";
import { PnlBar, WinRateMeter } from "@/components/StatBars";
import { num, percent, signed, signedTicks } from "@/lib/format";
import type {
  ForwardTestRow,
  ConfidenceV2ProgressRow,
  OutcomePathQualityRow,
  PriceActionEdgeRow,
  RuleRow,
  SettingsEffectRow,
  SetupStatRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const supabase = await createClient();

  const [
    { data: stats },
    { data: rules },
    { count: pending },
    { data: settings },
    { data: priceAction },
    { data: forward },
    { data: confidenceV2 },
    { data: outcomePathQuality },
  ] = await Promise.all([
    supabase.from("setup_stats").select("*"),
    supabase.from("rules").select("key, name"),
    supabase
      .from("signal_outcomes")
      .select("signal_id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase.from("settings_effect").select("*"),
    supabase.from("price_action_edge_by_setup").select("*"),
    supabase.from("forward_test").select("*"),
    supabase.from("confidence_v2_progress").select("*"),
    supabase.from("outcome_path_quality").select("*"),
  ]);

  const rows = ((stats ?? []) as SetupStatRow[])
    .map((row) => ({ ...row, win_rate: num(row.win_rate), avg_pnl_ticks: num(row.avg_pnl_ticks) }))
    .sort((a, b) => num(b.total_pnl_ticks) - num(a.total_pnl_ticks));

  const ruleNames = Object.fromEntries(
    ((rules ?? []) as Pick<RuleRow, "key" | "name">[]).map((r) => [r.key, r.name]),
  );

  const forwardRows = ((forward ?? []) as ForwardTestRow[])
    .sort((a, b) => (b.adopted_at ?? "").localeCompare(a.adopted_at ?? ""));

  const settingsRows = ((settings ?? []) as SettingsEffectRow[])
    .sort((a, b) => (b.last_fired ?? "").localeCompare(a.last_fired ?? ""));

  const confidenceV2Rows = ((confidenceV2 ?? []) as ConfidenceV2ProgressRow[])
    .sort((a, b) => b.captured_signals - a.captured_signals);

  // Cells this thin cannot say anything either way, and two dozen of them bury
  // the ones that might. They are counted below the table rather than dropped
  // silently -- an absence that is never explained reads as a bug.
  const allPriceAction = (priceAction ?? []) as PriceActionEdgeRow[];
  const priceActionRows = allPriceAction
    .filter((r) => r.trades >= 5)
    .sort((a, b) => b.trades - a.trades);
  const thinCells = allPriceAction.length - priceActionRows.length;

  const pathQualityRows = ((outcomePathQuality ?? []) as OutcomePathQualityRow[])
    .filter((row) => row.audited_signals > 0)
    .sort((a, b) => b.audited_signals - a.audited_signals);

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

        <section className="mt-10">
          <h2 className="text-base font-semibold">ตรวจเส้นทางราคาในแท่ง</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            OHLC บอกได้แค่ว่าราคาวิ่งถึงไหน ไม่บอกว่าโดน SL หรือ TP ก่อนเมื่อทั้งคู่เกิดในแท่งเดียว
            ระบบยังนับ SL ก่อนแบบระวังความเสี่ยง แต่บันทึกกรณีนั้นให้ตรวจสอบได้แล้ว
          </p>

          {pathQualityRows.length === 0
            ? <Empty>เริ่ม audit กับผลลัพธ์ที่ปิดหลังการอัปเดตนี้</Empty>
            : (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <Head
                      cells={[
                        ["กฎ", "left"],
                        ["สินทรัพย์", "left"],
                        ["ทิศทาง", "left"],
                        ["ตรวจแล้ว", "right"],
                        ["กำกวม", "right"],
                        ["สัดส่วน", "right"],
                      ]}
                    />
                  </thead>
                  <tbody>
                    {pathQualityRows.map((row) => (
                      <tr
                        key={`${row.rule_key}-${row.symbol}-${row.timeframe}-${row.direction}`}
                        className="border-b last:border-0"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <td className="px-4 py-2.5 font-medium">{ruleNames[row.rule_key] ?? row.rule_key}</td>
                        <td className="px-4 py-2.5 tabular">{row.symbol} · {row.timeframe}</td>
                        <td className="px-4 py-2.5"><DirectionTag direction={row.direction} /></td>
                        <td className="px-4 py-2.5 text-right tabular">{row.audited_signals}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.ambiguous_paths}</td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {row.ambiguous_share === null ? "–" : percent(num(row.ambiguous_share), 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold">Confidence v2 — Shadow mode</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            เก็บ feature ของสัญญาณ ณ เวลายิงเพื่อสร้างโมเดลที่สอบเทียบได้ภายหลัง
            ตารางนี้บอกความพร้อมของข้อมูลเท่านั้น ไม่ใช่คะแนนพยากรณ์ และยังไม่เปลี่ยน Telegram
          </p>

          {confidenceV2Rows.length === 0
            ? <Empty>เริ่มเก็บ feature แล้ว — รอสัญญาณ v2 ชุดแรกปิดผล</Empty>
            : (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <Head
                      cells={[
                        ["กฎ", "left"],
                        ["ทิศทาง", "left"],
                        ["เก็บแล้ว", "right"],
                        ["ปิดผลแล้ว", "right"],
                        ["สินทรัพย์", "right"],
                        ["เซสชัน", "right"],
                        ["R/ไม้", "right"],
                        ["สถานะ", "left"],
                      ]}
                    />
                  </thead>
                  <tbody>
                    {confidenceV2Rows.map((row) => (
                      <tr
                        key={`${row.model_version}-${row.rule_key}-${row.direction}`}
                        className="border-b last:border-0"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <td className="px-4 py-2.5 font-medium">
                          {ruleNames[row.rule_key] ?? row.rule_key}
                        </td>
                        <td className="px-4 py-2.5"><DirectionTag direction={row.direction} /></td>
                        <td className="px-4 py-2.5 text-right tabular">{row.captured_signals}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.resolved_signals}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.symbols}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.sessions}</td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {row.r_per_trade === null ? "–" : signed(num(row.r_per_trade), 3)}
                        </td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "var(--text-muted)" }}>
                          {confidenceV2Verdict(row)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            “พร้อมสอบเทียบ” หมายถึงมีข้อมูลพอเริ่มสร้างโมเดล offline เท่านั้น; ก่อนใช้กรอง
            ต้องตรึง model version แล้วพิสูจน์กับสัญญาณที่เกิดหลังจากนั้น (forward test)
          </p>
        </section>

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

        <section className="mt-10">
          <h2 className="text-base font-semibold">ผลจริงหลังรับค่าไปใช้ (ข้อมูลที่ backtest ไม่เคยเห็น)</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            ทุกการกวาดค่าเลือกค่าจากแท่งที่มีอยู่ทั้งหมด รวมแท่งที่ใช้เลือกเอง ตารางนี้ต่างออกไป —
            นับเฉพาะไม้ที่ยิงจริง<strong>หลัง</strong>ค่านั้นถูกใช้ จึงเป็นข้อมูลนอกกลุ่มตัวอย่างจริง ๆ
            และ <strong>ขาดทุนลึกสุด</strong> คือสิ่งที่ R รวมกับ R/ไม้ ไม่เคยบอก
          </p>

          {forwardRows.length === 0
            ? <Empty>ยังไม่มีไม้ที่วัดผลเสร็จ</Empty>
            : (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <Head
                      cells={[
                        ["ตั้งค่า", "left"],
                        ["ไม้", "right"],
                        ["สินทรัพย์", "right"],
                        ["อัตราชนะ", "right"],
                        ["รวม R", "right"],
                        ["R/ไม้", "right"],
                        ["ขาดทุนลึกสุด", "right"],
                        ["สรุปได้ไหม", "left"],
                      ]}
                    />
                  </thead>
                  <tbody>
                    {forwardRows.map((row) => (
                      <tr
                        key={`${row.reward_r}-${row.trail_after_r}-${row.trail_offset_r}`}
                        className="border-b last:border-0"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <td className="px-4 py-2.5 tabular font-medium">
                          TP {num(row.reward_r)}R · trail {num(row.trail_after_r)}/{num(row.trail_offset_r)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">{row.trades}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.symbols}</td>
                        <td className="px-4 py-2.5 text-right tabular">{percent(num(row.win_rate), 1)}</td>
                        <td className="px-4 py-2.5 text-right tabular">{signed(num(row.total_r))}</td>
                        <td className="px-4 py-2.5 text-right tabular">{signed(num(row.r_per_trade), 3)}</td>
                        <td
                          className="px-4 py-2.5 text-right tabular"
                          style={{ color: "var(--status-critical)" }}
                        >
                          −{num(row.max_drawdown_r)}R
                        </td>
                        <td className="px-4 py-2.5">
                          <Verdict
                            text={forwardVerdict(row)}
                            settled={row.verdict === "readable"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            <strong>ขาดทุนลึกสุด</strong> = ตกจากยอดสูงสุดมากที่สุดกี่ R ระหว่างทาง —
            ค่าสองชุดที่ R/ไม้ เท่ากันอาจต้องนั่งทนหลุมลึกไม่เท่ากัน และหลุมที่ลึกกว่าคือตัวที่คนเลิกใช้ก่อนจะได้กำไร
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold">การเปลี่ยนค่าได้ผลไหม</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            จัดกลุ่มตามค่าที่ <strong>บันทึกไว้บนไม้ตอนยิง</strong> ไม่ใช่ตามวันที่ —
            เปลี่ยนค่าเมื่อไรก็แตกกลุ่มใหม่เอง กลุ่มเดิมไม่ถูกปน
          </p>

          {settingsRows.length === 0
            ? <Empty>ยังไม่มีไม้ที่วัดผลเสร็จ</Empty>
            : (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead>
                    <Head
                      cells={[
                        ["ตั้งค่า", "left"],
                        ["ไม้", "right"],
                        ["สินทรัพย์", "right"],
                        ["อัตราชนะ", "right"],
                        ["รวม R", "right"],
                        ["R/ไม้", "right"],
                        ["SL / TP / trail / หมดเวลา", "right"],
                        ["สรุปได้ไหม", "left"],
                      ]}
                    />
                  </thead>
                  <tbody>
                    {settingsRows.map((row) => (
                      <tr
                        key={`${row.reward_r}-${row.trail_after_r}-${row.trail_offset_r}`}
                        className="border-b last:border-0"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <td className="px-4 py-2.5">
                          <span className="tabular font-medium">
                            TP {num(row.reward_r)}R · trail {num(row.trail_after_r)}/{num(row.trail_offset_r)}
                          </span>
                          {row.is_live && (
                            <span
                              className="ml-2 rounded px-1.5 py-0.5 text-xs"
                              style={{ background: "var(--surface-raised)", color: "var(--text-secondary)" }}
                            >
                              ใช้อยู่
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">{row.trades}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.symbols}</td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {percent(num(row.win_rate), 1)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {signed(num(row.total_r))}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {signed(num(row.r_per_trade), 3)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right tabular"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {row.hit_stop} / {row.hit_target} / {row.hit_trail} / {row.timed_out}
                        </td>
                        <td className="px-4 py-2.5">
                          <Verdict text={settingsVerdict(row)} settled={row.verdict === "comparable"} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            เกณฑ์ก่อนจะเทียบกันได้: ≥ 30 ไม้ และมีอย่างน้อย 2 สินทรัพย์ ·
            แถวที่ยังไม่ถึงเกณฑ์แปลว่า <strong>ยังตอบไม่ได้</strong> ไม่ใช่ตอบแล้วว่าแย่
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold">price action flags คุ้มจะเอามากรองไหม</h2>
          <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
            เก็บอย่างเดียวมาตลอด ยังไม่เคยกรองอะไร — ตารางนี้เทียบภายในกฎ / สินทรัพย์ /
            ทิศทางเดียวกันก่อน จึงไม่เอาผลของกลุ่มอื่นมาหลอกตา
          </p>

          {priceActionRows.length === 0
            ? <Empty>ยังไม่มีช่องไหนที่มีไม้ถึง 5 ไม้</Empty>
            : (
              <div className="card mt-4 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead>
                    <Head
                      cells={[
                        ["กฎ", "left"],
                        ["สินทรัพย์", "left"],
                        ["sweep", "left"],
                        ["zone", "left"],
                        ["ทิศทาง", "left"],
                        ["ไม้", "right"],
                        ["เซสชัน", "right"],
                        ["อัตราชนะ", "right"],
                        ["รวม R", "right"],
                        ["R/ไม้", "right"],
                        ["สรุปได้ไหม", "left"],
                      ]}
                    />
                  </thead>
                  <tbody>
                    {priceActionRows.map((row) => (
                      <tr
                        key={`${row.rule_key}-${row.symbol}-${row.timeframe}-${row.sweep}-${row.zone}-${row.direction}`}
                        className="border-b last:border-0"
                        style={{ borderColor: "var(--border-hairline)" }}
                      >
                        <td className="px-4 py-2.5 font-medium">{ruleNames[row.rule_key] ?? row.rule_key}</td>
                        <td className="px-4 py-2.5 tabular">{row.symbol} · {row.timeframe}</td>
                        <td className="px-4 py-2.5" style={{ color: row.sweep ? undefined : "var(--text-muted)" }}>
                          {row.sweep ?? "ไม่มี"}
                        </td>
                        <td className="px-4 py-2.5">{row.zone ?? "–"}</td>
                        <td className="px-4 py-2.5">
                          <DirectionTag direction={row.direction} />
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">{row.trades}</td>
                        <td className="px-4 py-2.5 text-right tabular">{row.sessions}</td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {percent(num(row.win_rate), 1)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {signed(num(row.total_r))}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular">
                          {signed(num(row.r_per_trade), 3)}
                        </td>
                        <td className="px-4 py-2.5">
                          <Verdict
                            text={priceActionVerdict(row)}
                            settled={row.verdict === "separates" || row.verdict === "no different"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
            เกณฑ์: ≥ 30 ไม้ และ ≥ 3 เซสชัน ถึงจะอ่านผลได้ · ช่องที่แยกตัวชัดค่อยเลื่อนขึ้นเป็นตัวกรอง
            ช่องที่ไม่ต่างลบทิ้งได้โดยไม่เสียอะไร · เทียบกับค่าเฉลี่ยของ setup เดียวกันเท่านั้น
            {thinCells > 0 && ` · อีก ${thinCells} ช่องมีไม้ไม่ถึง 5 ไม้ จึงยังไม่แสดง`}
          </p>
        </section>
      </main>
    </>
  );
}

/** Says what is still missing, so a thin row is not misread as a bad result. */
function forwardVerdict(row: ForwardTestRow): string {
  if (row.verdict === "need more trades") {
    return `ยังตอบไม่ได้ · ขาดอีก ${30 - row.trades} ไม้`;
  }
  if (row.verdict === "need more symbols") return "ยังตอบไม่ได้ · ยังมีสินทรัพย์เดียว";
  return "เทียบได้แล้ว";
}

function settingsVerdict(row: SettingsEffectRow): string {
  if (row.verdict === "need more trades") {
    return `ยังตอบไม่ได้ · ขาดอีก ${30 - row.trades} ไม้`;
  }
  if (row.verdict === "need more symbols") return "ยังตอบไม่ได้ · ยังมีสินทรัพย์เดียว";
  return "เทียบได้แล้ว";
}

function priceActionVerdict(row: PriceActionEdgeRow): string {
  if (row.verdict === "need more trades") {
    return `ยังตอบไม่ได้ · ขาดอีก ${30 - row.trades} ไม้`;
  }
  if (row.verdict === "need more sessions") {
    return `ยังตอบไม่ได้ · ขาดอีก ${3 - row.sessions} เซสชัน`;
  }
  return row.verdict === "separates" ? "แยกตัวชัด" : "ไม่ต่างจากค่าเฉลี่ย";
}

function confidenceV2Verdict(row: ConfidenceV2ProgressRow): string {
  if (row.verdict === "collecting: need more trades") {
    return `กำลังเก็บ · ขาดอีก ${30 - row.resolved_signals} ไม้`;
  }
  if (row.verdict === "collecting: need more symbols") return "กำลังเก็บ · ยังมีสินทรัพย์เดียว";
  if (row.verdict === "collecting: need more sessions") return "กำลังเก็บ · ยังไม่ครบ 3 เซสชัน";
  return "พร้อมสร้างโมเดล offline";
}

function Verdict({ text, settled }: { text: string; settled: boolean }) {
  return (
    <span
      className="text-xs"
      style={{ color: settled ? "var(--text-primary)" : "var(--text-muted)" }}
    >
      {text}
    </span>
  );
}

function Head({ cells }: { cells: [string, "left" | "right"][] }) {
  return (
    <tr
      className="border-b text-xs"
      style={{ color: "var(--text-muted)", borderColor: "var(--border-hairline)" }}
    >
      {cells.map(([label, align]) => (
        <th
          key={label}
          className={align === "right" ? "px-4 py-2 text-right font-normal" : "px-4 py-2 text-left font-normal"}
        >
          {label}
        </th>
      ))}
    </tr>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="card mt-4 p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
      {children}
    </div>
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
