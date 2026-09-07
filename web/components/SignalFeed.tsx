"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { num, shortTime } from "@/lib/format";
import { SIGNAL_SELECT, type Direction, type SignalRow } from "@/lib/types";
import { DirectionTag } from "./DirectionTag";
import { OutcomeTag } from "./OutcomeTag";

interface Props {
  initial: SignalRow[];
  ruleNames: Record<string, string>;
}

export function SignalFeed({ initial, ruleNames }: Props) {
  const [signals, setSignals] = useState<SignalRow[]>(initial);
  const [rule, setRule] = useState<string>("all");
  const [direction, setDirection] = useState<Direction | "all">("all");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("signals-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "signals" },
        async (payload) => {
          // The realtime row is the bare table row; re-read it with the joins
          // the feed renders so a new signal looks identical to the rest.
          const { data } = await supabase
            .from("signals")
            .select(SIGNAL_SELECT)
            .eq("id", (payload.new as { id: string }).id)
            .single();

          if (data) {
            setSignals((prev) => [data as unknown as SignalRow, ...prev].slice(0, 100));
          }
        },
      )
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const visible = useMemo(
    () =>
      signals.filter((signal) =>
        (rule === "all" || signal.rule_key === rule) &&
        (direction === "all" || signal.direction === direction)
      ),
    [signals, rule, direction],
  );

  return (
    <section>
      {/* Filters sit in one row above the content. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          className="rounded-md border px-2 py-1.5 text-sm hairline bg-transparent"
        >
          <option value="all">ทุกกฎ</option>
          {Object.entries(ruleNames).map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>

        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as Direction | "all")}
          className="rounded-md border px-2 py-1.5 text-sm hairline bg-transparent"
        >
          <option value="all">ทุกทิศทาง</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>

        <span className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: live ? "var(--status-good)" : "var(--text-muted)" }}
          />
          {live ? "เชื่อมต่อสด" : "ออฟไลน์"}
        </span>
      </div>

      {visible.length === 0
        ? (
          <div className="card p-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>
            ยังไม่มีสัญญาณ — เปิด ATAS แล้วใส่ indicator &ldquo;Signal Bridge&rdquo; ลงบนชาร์ต
          </div>
        )
        : (
          <div className="card divide-y" style={{ borderColor: "var(--border-hairline)" }}>
            {visible.map((signal) => (
              <Link
                key={signal.id}
                href={`/signals/${signal.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:opacity-80"
                style={{ borderColor: "var(--border-hairline)" }}
              >
                <DirectionTag direction={signal.direction} />

                <span className="font-medium">
                  {signal.instruments?.symbol ?? "?"}
                </span>
                <span style={{ color: "var(--text-muted)" }}>{signal.timeframe}</span>

                <span className="tabular">{num(signal.entry_price ?? signal.price)}</span>

                {/* The levels matter more than the rule's name when scanning the
                    feed: they are what says whether the trade is still live. */}
                {/* `!=` on purpose: it rejects undefined as well as null, so a
                    column that was never selected shows nothing rather than a
                    stop of zero. */}
                {signal.stop_price != null && signal.target_price != null && (
                  <span className="tabular text-xs whitespace-nowrap">
                    <span style={{ color: "var(--short)" }}>SL {num(signal.stop_price)}</span>
                    <span style={{ color: "var(--text-muted)" }}> · </span>
                    <span style={{ color: "var(--long)" }}>TP {num(signal.target_price)}</span>
                  </span>
                )}

                <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                  {signal.rules?.name ?? signal.rule_key}
                </span>

                <span className="ml-auto text-xs" style={{ color: "var(--text-muted)" }}>
                  ยังไม่สอบเทียบ
                </span>

                <span className="w-28 text-right">
                  <OutcomeTag
                    status={signal.signal_outcomes?.status}
                    pnlTicks={num(signal.signal_outcomes?.pnl_ticks)}
                    riskTicks={signal.risk_ticks}
                  />
                </span>

                <span className="w-32 text-right tabular text-xs" style={{ color: "var(--text-muted)" }}>
                  {shortTime(signal.fired_at)}
                </span>
              </Link>
            ))}
          </div>
        )}
    </section>
  );
}
