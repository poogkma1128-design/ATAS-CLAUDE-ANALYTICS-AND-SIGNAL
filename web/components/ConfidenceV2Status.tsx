type Snapshot = {
  modelVersion?: unknown;
  mode?: unknown;
  target?: unknown;
  score?: unknown;
  scoreReason?: unknown;
  features?: { shared?: unknown; rule?: unknown };
};

/**
 * Makes v2 visible without pretending that an untrained model has a forecast.
 * The complete snapshot remains in the evidence JSON below for auditability.
 */
export function ConfidenceV2Status({ payload }: { payload: Record<string, unknown> }) {
  const v2 = payload.confidenceV2 as Snapshot | undefined;
  if (!v2 || v2.mode !== "shadow") {
    return (
      <div className="card mt-5 p-4">
        <h2 className="text-sm font-semibold">Confidence v2</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          สัญญาณนี้เกิดก่อนเริ่มเก็บ feature ของ v2 จึงไม่มีข้อมูลรุ่นใหม่
        </p>
      </div>
    );
  }

  const sharedCount = Object.keys((v2.features?.shared ?? {}) as object).length;
  const ruleCount = Object.keys((v2.features?.rule ?? {}) as object).length;

  return (
    <div className="card mt-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Confidence v2</h2>
        <span
          className="rounded px-1.5 py-0.5 text-xs"
          style={{ background: "var(--surface-raised)", color: "var(--text-secondary)" }}
        >
          Shadow · กำลังเก็บข้อมูล
        </span>
      </div>
      <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        เก็บ feature ณ เวลาที่เกิดสัญญาณแล้ว แต่ยังไม่มีโมเดลที่สอบเทียบเป็นเปอร์เซ็นต์ได้
        จึงไม่ใช้กรองหรือเปลี่ยน Telegram
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
        <Field label="เวอร์ชัน" value={typeof v2.modelVersion === "string" ? v2.modelVersion : "–"} />
        <Field label="เป้าหมาย" value="P(R > 0) หลังครบ horizon" />
        <Field label="feature ร่วม" value={`${sharedCount} ค่า`} />
        <Field label="feature ของกฎ" value={`${ruleCount} ค่า`} />
      </dl>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
