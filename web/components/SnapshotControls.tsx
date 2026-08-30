"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { num, percent, shortTime } from "@/lib/format";
import type { RuleSnapshotRow } from "@/lib/types";

/**
 * Saved arrangements of every rule's settings, and the way back to one.
 *
 * Adopting a change is only safe if undoing it is exact. A snapshot stores every
 * rule's params together, so going back is a restore rather than an attempt to
 * remember what the numbers used to be — which is the difference between trying
 * something and gambling with it.
 *
 * "ดีที่สุดเท่าที่รู้" marks the arrangement with the strongest evidence behind
 * it. That is not always the one running: a change can be live while still being
 * on trial.
 */
export function SnapshotControls({ snapshots }: { snapshots: RuleSnapshotRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );
  const [label, setLabel] = useState("");

  async function save() {
    const name = label.trim();
    if (name === "") return;

    setBusy("save");
    const supabase = createClient();
    const { error } = await supabase.rpc("snapshot_rules", {
      snapshot_label: name,
      snapshot_note: null,
    });
    setBusy(null);

    if (error) return setMessage({ tone: "bad", text: error.message });
    setLabel("");
    setMessage({ tone: "ok", text: `บันทึกค่าปัจจุบันไว้เป็น "${name}" แล้ว` });
    router.refresh();
  }

  async function restore(snapshot: RuleSnapshotRow) {
    const ok = window.confirm(
      `กลับไปใช้ค่าชุด "${snapshot.label}" ทุกกฎเลยไหม\n` +
        `ค่าที่ใช้อยู่ตอนนี้จะถูกทับ — ถ้ายังไม่ได้บันทึกไว้ ให้กดบันทึกก่อน`,
    );
    if (!ok) return;

    setBusy(snapshot.id);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("restore_rules", {
      snapshot: snapshot.id,
    });
    setBusy(null);

    if (error) return setMessage({ tone: "bad", text: error.message });
    setMessage({
      tone: "ok",
      text: data === 0
        ? "ค่าที่ใช้อยู่ตรงกับชุดนี้อยู่แล้ว ไม่มีอะไรเปลี่ยน"
        : `กลับไปใช้ค่าชุด "${snapshot.label}" แล้ว (${data} กฎเปลี่ยน) มีผลกับแท่งถัดไป`,
    });
    router.refresh();
  }

  async function markBest(snapshot: RuleSnapshotRow) {
    setBusy(snapshot.id);
    const supabase = createClient();

    // Only one arrangement may hold the title, and a unique index enforces it,
    // so the old holder has to be cleared before the new one is set.
    const cleared = await supabase
      .from("rule_snapshots")
      .update({ is_best_known: false })
      .eq("is_best_known", true);

    if (cleared.error) {
      setBusy(null);
      return setMessage({ tone: "bad", text: cleared.error.message });
    }

    const marked = await supabase
      .from("rule_snapshots")
      .update({ is_best_known: true })
      .eq("id", snapshot.id);

    setBusy(null);
    if (marked.error) return setMessage({ tone: "bad", text: marked.error.message });
    router.refresh();
  }

  return (
    <section className="card p-4">
      <h2 className="text-sm font-semibold">ค่าที่สำรองไว้</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
        ชุดค่าทั้งหมดของทุกกฎ ณ เวลาที่กดบันทึก กดกลับไปใช้ได้ตลอดถ้าค่าใหม่ทำผลได้แย่กว่า
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="ชื่อชุดค่า เช่น ก่อนลอง rewardRatio 3"
          className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm hairline bg-transparent"
        />
        <button
          onClick={save}
          disabled={busy !== null || label.trim() === ""}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--long)" }}
        >
          {busy === "save" ? "กำลังบันทึก..." : "บันทึกค่าปัจจุบัน"}
        </button>
      </div>

      {message && (
        <p
          className="mt-2 text-xs"
          style={{
            color: message.tone === "ok"
              ? "var(--success-text)"
              : "var(--status-critical)",
          }}
        >
          {message.text}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {snapshots.length === 0 && (
          <li className="text-xs" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีชุดค่าที่สำรองไว้
          </li>
        )}

        {snapshots.map((snapshot) => (
          <li
            key={snapshot.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-2 first:border-0 first:pt-0"
            style={{ borderColor: "var(--border-hairline)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{snapshot.label}</span>
                {snapshot.is_best_known && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px]"
                    style={{ background: "var(--surface-sunken)", color: "var(--success-text)" }}
                  >
                    ดีที่สุดเท่าที่รู้
                  </span>
                )}
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {shortTime(snapshot.taken_at)}
                </span>
              </div>
              <div className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                {snapshot.measured_trades
                  ? `วัดไว้ ${snapshot.measured_trades} ไม้ · ชนะ ${
                    percent(num(snapshot.measured_win_rate), 0)
                  } · ${num(snapshot.measured_r) > 0 ? "+" : ""}${
                    num(snapshot.measured_r).toFixed(2)
                  }R`
                  : "ยังไม่ได้บันทึกผลที่วัดได้"}
                {snapshot.note ? ` · ${snapshot.note}` : ""}
              </div>
            </div>

            <div className="flex gap-2">
              {!snapshot.is_best_known && (
                <button
                  onClick={() => markBest(snapshot)}
                  disabled={busy !== null}
                  className="rounded-md border px-2 py-1 text-xs hairline disabled:opacity-50"
                  style={{ color: "var(--text-secondary)" }}
                >
                  ตั้งเป็นดีที่สุด
                </button>
              )}
              <button
                onClick={() => restore(snapshot)}
                disabled={busy !== null}
                className="rounded-md border px-2 py-1 text-xs hairline disabled:opacity-50"
              >
                {busy === snapshot.id ? "กำลังกลับ..." : "กลับไปใช้ค่านี้"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
