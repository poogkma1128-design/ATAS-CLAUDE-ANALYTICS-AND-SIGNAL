import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { DirectionTag } from "@/components/DirectionTag";
import { OutcomeTag } from "@/components/OutcomeTag";
import { FootprintLadder } from "@/components/FootprintLadder";
import { num, percent, shortTime, signedTicks } from "@/lib/format";
import type { ClusterLevelRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Pulls the price levels a rule cited out of its payload, so the ladder can
 * ring exactly the evidence that produced the signal.
 */
function evidencePrices(payload: Record<string, unknown>): number[] {
  const out: number[] = [];

  const levels = payload.levels as { price?: number }[] | undefined;
  if (Array.isArray(levels)) {
    for (const level of levels) {
      if (typeof level?.price === "number") out.push(level.price);
    }
  }

  const single = payload.level as { price?: number } | undefined;
  if (typeof single?.price === "number") out.push(single.price);

  const poc = payload.poc as { price?: number } | undefined;
  if (typeof poc?.price === "number") out.push(poc.price);

  return out;
}

export default async function SignalDetailPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: signal } = await supabase
    .from("signals")
    .select(
      "id, fired_at, direction, price, confidence, rule_key, timeframe, payload, bar_id, entry_price, stop_price, target_price, risk_ticks, reward_ticks, trail_trigger_ticks, trail_offset_ticks, hold_bars, instruments(symbol, tick_size), rules(name, description), signal_outcomes(status, pnl_ticks, mfe_ticks, mae_ticks, bars_used, horizon_bars, exit_reason)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!signal) notFound();

  const [{ data: bar }, { data: levels }] = await Promise.all([
    supabase
      .from("bars")
      .select("opened_at, open, high, low, close, volume, ask_volume, bid_volume, delta, min_delta, max_delta, poc_price")
      .eq("id", signal.bar_id)
      .maybeSingle(),
    supabase
      .from("cluster_levels")
      .select("price, ask, bid, between, volume, ticks")
      .eq("bar_id", signal.bar_id),
  ]);

  const instrument = signal.instruments as unknown as { symbol: string; tick_size: number } | null;
  const rule = signal.rules as unknown as { name: string; description: string | null } | null;
  const outcome = signal.signal_outcomes as unknown as
    | {
      status: string;
      pnl_ticks: number | null;
      mfe_ticks: number | null;
      mae_ticks: number | null;
      bars_used: number | null;
      horizon_bars: number;
      exit_reason: string | null;
    }
    | null;
  const payload = (signal.payload ?? {}) as Record<string, unknown>;

  return (
    <>
      <Nav current="/" />
      <main className="mx-auto max-w-4xl px-5 py-6">
        <Link href="/" className="text-sm" style={{ color: "var(--text-secondary)" }}>
          ← กลับไปหน้าสัญญาณ
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <DirectionTag direction={signal.direction} />
          <h1 className="text-lg font-semibold">
            {instrument?.symbol ?? "?"} · {signal.timeframe}
          </h1>
          <span className="tabular text-lg">{num(signal.entry_price ?? signal.price)}</span>
          <span className="ml-auto text-sm tabular" style={{ color: "var(--text-muted)" }}>
            {shortTime(signal.fired_at)}
          </span>
        </div>

        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {rule?.name ?? signal.rule_key}
          {rule?.description ? ` — ${rule.description}` : ""}
        </p>

        {/* Headline numbers: single values, so they are stat tiles, not a chart. */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="ความมั่นใจ" value={percent(num(signal.confidence))} />
          <Tile
            label="ผลลัพธ์"
            value={<OutcomeTag status={outcome?.status} pnlTicks={num(outcome?.pnl_ticks)} />}
          />
          <Tile label="ไปได้ไกลสุด" value={`${signedTicks(num(outcome?.mfe_ticks))} ticks`} />
          <Tile label="สวนไปสุด" value={`-${num(outcome?.mae_ticks)} ticks`} />
        </div>

        {signal.stop_price !== null && (
          <div className="card mt-5 p-4">
            <h2 className="mb-1 text-sm font-semibold">แผนเทรด</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
              ระยะบอกเป็นราคา ไม่ใช่จำนวน tick เพราะ ATAS รายงาน tick size
              เป็นความห่างของแถว footprint บนชาร์ต ซึ่งเป็นหลายเท่าของ tick จริง
            </p>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
              <Field label="จุดเข้า" value={num(signal.entry_price ?? signal.price)} />
              <Field
                label="SL"
                value={`${num(signal.stop_price)}  (−${fmtDistance(
                  Math.abs(num(signal.stop_price) - num(signal.entry_price ?? signal.price)),
                )})`}
              />
              <Field
                label="TP"
                value={`${num(signal.target_price)}  (+${fmtDistance(
                  Math.abs(num(signal.target_price) - num(signal.entry_price ?? signal.price)),
                )})`}
              />
              <Field label="RR" value={rewardRatio(signal)} />
              <Field label="เลื่อน SL เมื่อถึง" value={trailStart(signal)} />
              <Field label="ตามห่าง" value={fmtDistance(trailDistance(signal))} />
              <Field label="ถือไม่เกิน" value={`${signal.hold_bars ?? "-"} แท่ง`} />
              <Field label="จบเพราะ" value={EXIT_LABEL[outcome?.exit_reason ?? ""] ?? "ยังไม่จบ"} />
              <Field label="ถือจริง" value={outcome?.bars_used != null ? `${outcome.bars_used} แท่ง` : "-"} />
            </dl>
          </div>
        )}

        {bar && (
          <div className="card mt-5 p-4">
            <h2 className="mb-3 text-sm font-semibold">แท่งที่เกิดสัญญาณ</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
              <Field label="เปิด" value={num(bar.open)} />
              <Field label="สูงสุด" value={num(bar.high)} />
              <Field label="ต่ำสุด" value={num(bar.low)} />
              <Field label="ปิด" value={num(bar.close)} />
              <Field label="Volume" value={num(bar.volume)} />
              <Field label="Delta" value={signedTicks(num(bar.delta))} />
              <Field label="Delta สูงสุด" value={signedTicks(num(bar.max_delta))} />
              <Field label="Delta ต่ำสุด" value={signedTicks(num(bar.min_delta))} />
            </dl>
          </div>
        )}

        <div className="card mt-5 p-4">
          <h2 className="mb-3 text-sm font-semibold">Footprint</h2>
          <FootprintLadder
            levels={(levels ?? []) as ClusterLevelRow[]}
            pocPrice={bar?.poc_price ?? null}
            highlighted={evidencePrices(payload)}
            signalPrice={num(signal.price)}
          />
        </div>

        <div className="card mt-5 p-4">
          <h2 className="mb-2 text-sm font-semibold">หลักฐานดิบ</h2>
          <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
            ค่าที่กฎใช้ตัดสินใจตอนนั้น เก็บไว้ทั้งหมดเพื่อย้อนตรวจได้ภายหลัง
          </p>
          <pre
            className="overflow-x-auto rounded-md p-3 text-xs"
            style={{ background: "var(--surface-page)", color: "var(--text-secondary)" }}
          >
{JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </main>
    </>
  );
}

const EXIT_LABEL: Record<string, string> = {
  target: "ถึง TP",
  stop: "โดน SL",
  trail: "SL ที่เลื่อนตามมา",
  timeout: "ครบจำนวนแท่ง",
};

/** Price arithmetic leaves float noise; trim it without inventing precision. */
function fmtDistance(value: number): string {
  return String(Number(value.toFixed(4)));
}

function rewardRatio(signal: { risk_ticks: number | null; reward_ticks: number | null }): string {
  const risk = num(signal.risk_ticks);
  if (risk <= 0) return "-";
  return `1 : ${(num(signal.reward_ticks) / risk).toFixed(1)}`;
}

/**
 * The plan stores its trail in the same unit as its risk, so the price step it
 * was built from is recoverable from the two together without carrying the
 * instrument's tick size into the view.
 */
function priceStep(signal: {
  risk_ticks: number | null;
  stop_price: number | null;
  entry_price: number | null;
  price: number;
}): number {
  const risk = num(signal.risk_ticks);
  if (risk <= 0) return 0;
  return Math.abs(num(signal.stop_price) - num(signal.entry_price ?? signal.price)) / risk;
}

function trailStart(signal: {
  direction: string;
  risk_ticks: number | null;
  trail_trigger_ticks: number | null;
  stop_price: number | null;
  entry_price: number | null;
  price: number;
}): string {
  const entry = num(signal.entry_price ?? signal.price);
  const away = signal.direction === "long" ? 1 : -1;
  return fmtDistance(entry + away * num(signal.trail_trigger_ticks) * priceStep(signal));
}

function trailDistance(signal: {
  risk_ticks: number | null;
  trail_offset_ticks: number | null;
  stop_price: number | null;
  entry_price: number | null;
  price: number;
}): number {
  return num(signal.trail_offset_ticks) * priceStep(signal);
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card p-3">
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-1 text-base font-semibold tabular">{value}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
