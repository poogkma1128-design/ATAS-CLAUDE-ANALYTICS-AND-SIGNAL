import { createClient } from "@/lib/supabase/server";
import { Nav } from "@/components/Nav";
import { SignalFeed } from "@/components/SignalFeed";
import { FeedStatus, type InstrumentStatus } from "@/components/FeedStatus";
import { SIGNAL_SELECT, type RuleRow, type SignalRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const supabase = await createClient();

  const [{ data: signals }, { data: rules }, { data: status }] = await Promise.all([
    supabase
      .from("signals")
      .select(SIGNAL_SELECT)
      .order("fired_at", { ascending: false })
      .limit(100),
    supabase.from("rules").select("key, name").order("name"),
    supabase
      .from("instrument_status")
      .select(
        "symbol, timeframe, feed, bars, signals, announced, muted, last_bar_at, last_ingest_at, bar_age_minutes, quiet_minutes, errors_24h, last_error",
      )
      .order("symbol"),
  ]);

  const ruleNames = Object.fromEntries(
    ((rules ?? []) as Pick<RuleRow, "key" | "name">[]).map((r) => [r.key, r.name]),
  );

  return (
    <>
      <Nav current="/" />
      <main className="mx-auto max-w-6xl px-5 py-6">
        <FeedStatus rows={(status ?? []) as unknown as InstrumentStatus[]} />

        <h1 className="mb-4 text-base font-semibold">สัญญาณล่าสุด</h1>
        <SignalFeed
          initial={(signals ?? []) as unknown as SignalRow[]}
          ruleNames={ruleNames}
        />
      </main>
    </>
  );
}
