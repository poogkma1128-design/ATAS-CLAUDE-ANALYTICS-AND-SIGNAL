"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RuleRow } from "@/lib/types";

/**
 * Thresholds live in the database precisely so they can be changed here.
 * Saving takes effect on the next bar the ingest function evaluates: no
 * redeploy, no rebuilding the ATAS indicator.
 */
export function RuleEditor({ rule }: { rule: RuleRow }) {
  const [params, setParams] = useState<Record<string, number>>(rule.params ?? {});
  const [enabled, setEnabled] = useState(rule.enabled);
  const [telegram, setTelegram] = useState(rule.telegram_enabled);
  const [horizon, setHorizon] = useState(rule.horizon_bars);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  async function save() {
    setState("saving");

    const supabase = createClient();
    const { error: saveError } = await supabase
      .from("rules")
      .update({
        params,
        enabled,
        telegram_enabled: telegram,
        horizon_bars: horizon,
      })
      .eq("key", rule.key);

    if (saveError) {
      setState("error");
      setError(saveError.message);
      return;
    }

    setState("saved");
    setTimeout(() => setState("idle"), 2000);
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{rule.name}</h2>
          {rule.description && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              {rule.description}
            </p>
          )}
          <code className="mt-1 block text-[11px]" style={{ color: "var(--text-muted)" }}>
            {rule.key}
          </code>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {rule.announcement_mode === "manual"
              ? "Telegram: owner override — ไม่รอหลักฐาน"
              : "Telegram: Evidence-first — ส่งเฉพาะ rule / สินทรัพย์ / ทิศทางที่ผ่านหลักฐาน"}
          </p>
        </div>

        <div className="flex flex-col gap-1.5 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            เปิดใช้งาน
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={telegram}
              onChange={(e) => setTelegram(e.target.checked)}
            />
            เปิดช่อง Telegram
          </label>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(params).map(([key, value]) => (
          <label key={key} className="block">
            <span className="block text-xs" style={{ color: "var(--text-muted)" }}>{key}</span>
            <input
              type="number"
              step="any"
              value={value}
              onChange={(e) =>
                setParams({ ...params, [key]: Number(e.target.value) })}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm tabular hairline bg-transparent"
            />
          </label>
        ))}

        <label className="block">
          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
            horizon_bars
          </span>
          <input
            type="number"
            min={1}
            max={500}
            value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
            className="mt-1 w-full rounded-md border px-2 py-1 text-sm tabular hairline bg-transparent"
          />
        </label>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={state === "saving"}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          style={{ background: "var(--long)" }}
        >
          {state === "saving" ? "กำลังบันทึก..." : "บันทึก"}
        </button>

        {state === "saved" && (
          <span className="text-xs" style={{ color: "var(--success-text)" }}>
            ✓ บันทึกแล้ว มีผลกับแท่งถัดไปทันที
          </span>
        )}
        {state === "error" && (
          <span className="text-xs" style={{ color: "var(--status-critical)" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
