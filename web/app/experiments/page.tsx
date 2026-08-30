import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { ExperimentCard } from "@/components/ExperimentCard";
import { SnapshotControls } from "@/components/SnapshotControls";
import type {
  ExperimentResultRow,
  ExperimentRow,
  RuleSnapshotRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * What has been tried, what it did, and how to go back.
 *
 * Everything on this page is a simulation over bars already stored. No result
 * here was ever sent to Telegram and none of it is in force: the settings
 * actually running are on /rules. That separation is the point — a rule change
 * can be judged before anyone's phone rings for it.
 */
export default async function ExperimentsPage() {
  const supabase = await createClient();

  const { data: experimentRows } = await supabase
    .from("experiments")
    .select("id, name, note, variants, symbols, bars_from, bars_to, status, error, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  const experiments = (experimentRows ?? []) as ExperimentRow[];

  const [{ data: resultRows }, { data: snapshotRows }] = await Promise.all([
    experiments.length > 0
      ? supabase
        .from("experiment_results")
        .select(
          "experiment_id, variant, symbol, rule_key, direction, trades, wins, win_rate, total_r, hit_target, hit_stop, hit_trail, timed_out",
        )
        .in("experiment_id", experiments.map((e) => e.id))
        .order("id")
      : Promise.resolve({ data: [] as ExperimentResultRow[] }),
    supabase
      .from("rule_snapshots")
      .select(
        "id, label, note, params, measured_r, measured_win_rate, measured_trades, is_best_known, taken_at",
      )
      .order("taken_at", { ascending: false })
      .limit(20),
  ]);

  const results = (resultRows ?? []) as ExperimentResultRow[];
  const byExperiment = new Map<string, ExperimentResultRow[]>();
  for (const row of results) {
    const list = byExperiment.get(row.experiment_id) ?? [];
    list.push(row);
    byExperiment.set(row.experiment_id, list);
  }

  return (
    <>
      <Nav current="/experiments" />
      <main className="mx-auto max-w-5xl px-5 py-6">
        <h1 className="text-base font-semibold">ทดลองปรับกฎ</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          ทุกอย่างในหน้านี้รันย้อนหลังบนแท่งที่เก็บไว้ ไม่มีอันไหนถูกส่งเข้า Telegram
          และไม่มีอันไหนถูกใช้จริง — ค่าที่ใช้อยู่จริงอยู่ที่หน้า{" "}
          <span className="font-medium">กฎ</span>
        </p>

        <div className="mt-5">
          <SnapshotControls snapshots={(snapshotRows ?? []) as RuleSnapshotRow[]} />
        </div>

        <div className="mt-5 space-y-3">
          {experiments.length === 0
            ? (
              <div
                className="card p-8 text-center text-sm"
                style={{ color: "var(--text-secondary)" }}
              >
                ยังไม่มีการทดลอง
              </div>
            )
            : experiments.map((experiment) => (
              <ExperimentCard
                key={experiment.id}
                experiment={experiment}
                results={byExperiment.get(experiment.id) ?? []}
              />
            ))}
        </div>

        <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          R คือกำไรเทียบกับความเสี่ยงของไม้นั้นเอง เป็นหน่วยเดียวที่เทียบข้ามสินทรัพย์ได้
          · &ldquo;R ต่อไม้&rdquo; สำคัญกว่า &ldquo;R รวม&rdquo;
          เพราะการปลดล็อกให้เทรดถี่ขึ้นก็ทำให้ R รวมสูงขึ้นได้ทั้งที่แต่ละไม้แย่ลง
        </p>
      </main>
    </>
  );
}
