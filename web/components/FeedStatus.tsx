import { shortTime, thaiAgo } from "@/lib/format";

/**
 * What each chart is doing right now.
 *
 * The feed alone cannot say this. A market that is closed and a bridge that
 * has stopped working look identical from a list of signals: both simply stop
 * producing rows. On a Saturday that reads as three broken futures charts next
 * to one working crypto one, when nothing is broken at all.
 *
 * So each chart states its own case, and an instrument with no row here has
 * never posted anything — which is its own answer, spelled out below rather
 * than left as an absence to interpret.
 */
export interface InstrumentStatus {
  symbol: string;
  timeframe: string;
  feed: "live" | "history-only" | "silent";
  bars: number | null;
  signals: number;
  announced: number;
  muted: number;
  last_bar_at: string | null;
  last_ingest_at: string | null;
  bar_age_minutes: number | null;
  quiet_minutes: number | null;
  errors_24h: number | null;
  last_error: string | null;
}

const FEED = {
  live: {
    label: "สด",
    note: "แท่งใหม่กำลังเข้ามาต่อเนื่อง",
    dot: "#22c55e",
  },
  "history-only": {
    label: "ประวัติย้อนหลัง",
    note: "ได้ประวัติตอนเปิดชาร์ตแล้ว แต่ยังไม่มีแท่งใหม่ — ปกติถ้าตลาดปิด",
    dot: "#f59e0b",
  },
  silent: {
    label: "เงียบ",
    note: "ไม่มีข้อมูลเข้ามาเกิน 24 ชม. — ชาร์ตปิดอยู่หรือ indicator หลุด",
    dot: "#6b7280",
  },
} as const;

export function FeedStatus({ rows }: { rows: InstrumentStatus[] }) {
  const live = rows.filter((r) => r.feed === "live").length;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">สถานะการรับข้อมูล</h2>
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {rows.length === 0
            ? "ยังไม่มีชาร์ตไหนส่งข้อมูลเข้ามาเลย"
            : live === 0
            ? `ไม่มีชาร์ตไหนส่งสดอยู่เลย (ทั้งหมด ${rows.length} ชาร์ต) — ถ้าตลาดเปิดอยู่ แปลว่าผิดปกติ`
            : `${live} จาก ${rows.length} ชาร์ตกำลังส่งสด`}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => {
          const feed = FEED[row.feed] ?? FEED.silent;
          return (
            <div key={`${row.symbol}-${row.timeframe}`} className="card p-3">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: feed.dot }}
                />
                <span className="text-sm font-semibold">{row.symbol}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {row.timeframe}
                </span>
                <span className="ml-auto text-xs font-medium">{feed.label}</span>
              </div>

              <p className="mt-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
                {feed.note}
              </p>

              <dl className="mt-2 space-y-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {/* Both lines, always, and always with an age beside them.
                    They answer two different questions that look like one: the
                    bar says whether the market is moving, the post says whether
                    the bridge is still talking to us. During the eight hours
                    ATAS stopped posting on 29 Aug these two would have
                    disagreed, and only the second one would have said so. */}
                <div className="flex justify-between gap-3">
                  <dt>แท่งล่าสุด</dt>
                  <dd>
                    {row.last_bar_at ? shortTime(row.last_bar_at) : "ยังไม่เคยมี"}
                    {row.last_bar_at && ` · ${thaiAgo(row.bar_age_minutes)}`}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>ส่งเข้าล่าสุด</dt>
                  <dd
                    style={{
                      color: row.quiet_minutes !== null && row.quiet_minutes > 30
                        ? "#f59e0b"
                        : undefined,
                    }}
                  >
                    {row.last_ingest_at ? shortTime(row.last_ingest_at) : "ยังไม่เคยส่ง"}
                    {row.last_ingest_at && ` · ${thaiAgo(row.quiet_minutes)}`}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>สัญญาณ</dt>
                  <dd>
                    {row.signals} · แจ้งเตือน {row.announced}
                    {row.muted > 0 && ` · ปิดเสียง ${row.muted}`}
                  </dd>
                </div>
                {row.errors_24h !== null && row.errors_24h > 0 && (
                  <div className="flex justify-between gap-3" style={{ color: "#ef4444" }}>
                    <dt>ผิดพลาด 24 ชม.</dt>
                    <dd>{row.errors_24h}</dd>
                  </div>
                )}
              </dl>
            </div>
          );
        })}
      </div>

      {/* The absence of a chart is a finding, not a gap in the page. */}
      <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        แสดงเฉพาะชาร์ตที่เคยส่งข้อมูลเข้ามาแล้ว — ถ้าไม่เห็นชื่อที่ควรมี แปลว่าชาร์ตนั้นยังไม่เคยส่งเลยสักครั้ง
        (ยังไม่ได้ Add Signal Bridge ลงชาร์ต หรือยังไม่ได้กรอก Endpoint URL / Ingest token)
      </p>
    </section>
  );
}
