import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { SignalFeed } from "@/components/SignalFeed";
import type { RuleRow, SignalRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const supabase = await createClient();

  const [{ data: signals }, { data: rules }] = await Promise.all([
    supabase
      .from("signals")
      .select(
        "id, fired_at, direction, price, confidence, rule_key, timeframe, payload, instruments(symbol), rules(name), signal_outcomes(status, pnl_ticks, mfe_ticks, mae_ticks)",
      )
      .order("fired_at", { ascending: false })
      .limit(100),
    supabase.from("rules").select("key, name").order("name"),
  ]);

  const ruleNames = Object.fromEntries(
    ((rules ?? []) as Pick<RuleRow, "key" | "name">[]).map((r) => [r.key, r.name]),
  );

  return (
    <>
      <Nav current="/" />
      <main className="mx-auto max-w-6xl px-5 py-6">
        <h1 className="mb-4 text-base font-semibold">สัญญาณล่าสุด</h1>
        <SignalFeed
          initial={(signals ?? []) as unknown as SignalRow[]}
          ruleNames={ruleNames}
        />
      </main>
    </>
  );
}
