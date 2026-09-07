import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { RuleEditor } from "@/components/RuleEditor";
import type { RuleRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const supabase = await createClient();

  const { data: rules } = await supabase
    .from("rules")
    .select("key, name, description, enabled, telegram_enabled, announcement_mode, horizon_bars, params, updated_at")
    .order("name");

  return (
    <>
      <Nav current="/rules" />
      <main className="mx-auto max-w-4xl px-5 py-6">
        <h1 className="text-base font-semibold">กฎและค่าที่ใช้ตัดสิน</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          แก้ค่าตรงนี้แล้วกดบันทึก มีผลทันทีกับแท่งถัดไป ไม่ต้อง deploy ใหม่และไม่ต้อง build indicator ใหม่
        </p>

        <div className="mt-5 space-y-3">
          {((rules ?? []) as RuleRow[]).map((rule) => (
            <RuleEditor key={rule.key} rule={rule} />
          ))}
        </div>
      </main>
    </>
  );
}
