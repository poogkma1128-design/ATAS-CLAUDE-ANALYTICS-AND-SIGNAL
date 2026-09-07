/**
 * Measures how often `MNQ_PULLBACK_V1` finds anything, offline.
 *
 * The runner in `supabase/functions/backtest` cannot answer this. It reports
 * trades, so a strategy that never opens a setup and a strategy that opens
 * setups nothing confirms both arrive as the same empty row — and it dies with
 * WORKER_RESOURCE_LIMIT above roughly 400 bars per feed, which is less history
 * than one previous trading day plus a session. Three runs on 2026-09-07
 * (experiments 2d17efb1, 85db5d77, fdb0245f) spent that budget to learn only
 * that the count was zero.
 *
 * This reads bars from a file and runs the same `buildDecision()` the live rule
 * runs, so what it reports is the production evaluator's own verdict rather than
 * a second implementation of it. Nothing here touches the database: it takes a
 * file, prints a census, and exits.
 *
 *   deno run --allow-read scripts/mnq_pullback_probe.ts <bars.psv> [zoneProximity] \
 *     [--levels=<levels.psv>] [--windows]
 *
 * Input is one pipe-separated bar per line, oldest or newest first, both fine:
 *
 *   openedAt|open|high|low|close|volume|delta|ticks|pocPrice
 *
 * Export it with (psql, or the SQL editor):
 *
 *   select to_char(b.opened_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
 *          ||'|'||b.open||'|'||b.high||'|'||b.low||'|'||b.close||'|'||b.volume
 *          ||'|'||b.delta||'|'||b.ticks||'|'||coalesce(b.poc_price::text,'')
 *     from public.bars b join public.instruments i on i.id = b.instrument_id
 *    where i.symbol = 'MNQU6' and b.timeframe = '5m' and b.is_closed
 *    order by b.opened_at;
 *
 * Without `--levels` the export carries no footprint, so `stacked_imbalance` is
 * reported unavailable on every bar and the trigger side of the census is a
 * lower bound. Setup eligibility — the number this was written to find — does
 * not read the footprint at all on the P-A path, so that half of the census is
 * exact either way. `--levels` takes a second file, one bar per line:
 *
 *   openedAt|price:ask:bid:between:volume:ticks,price:...
 *
 * Bars absent from it keep an empty footprint, which is why a file covering
 * only the setup windows answers "would the footprint trigger have confirmed
 * these?" without exporting a hundred thousand rows to ask it.
 */

import type {
  BarInput,
  ClusterLevel,
  HistoryBar,
  RuleContext,
} from "../supabase/functions/_shared/types.ts";
import {
  buildDecision,
  contractFor,
  RULE_KEY,
} from "../supabase/functions/_shared/rules/mnq_pullback_v1.ts";
import {
  evaluatePullback,
  type PullbackDecisionBar,
} from "../supabase/functions/_shared/strategy/pullback.ts";

/** Mirrors `STRATEGY_HISTORY_BARS` in ingest.ts and backtest.ts. */
const STRATEGY_HISTORY_BARS = 700;
/** Mirrors `HISTORY_BARS`: what the trigger detectors read. */
const HISTORY_BARS = 50;

/**
 * The live rule row on 2026-09-07. Passed through because `buildDecision()`
 * hands it to `delta_flip`, whose thresholds decide whether a trigger is even
 * evaluable — leaving it empty would measure a different rule.
 */
const LIVE_PARAMS: Record<string, unknown> = {
  ratio: 3,
  stack: 3,
  runBars: 3,
  minVolume: 10,
  levelShare: 0.25,
  minRunDelta: 0,
  levelLookback: 20,
  minVolumeRatio: 0,
  minVolumeHistory: 10,
  minDeltaMagnitude: 200,
};

interface ParsedBar {
  openedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  ticks: number;
  pocPrice: number | null;
}

function parse(text: string): ParsedBar[] {
  const seen = new Map<string, ParsedBar>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const parts = trimmed.split("|");
    if (parts.length < 9) throw new Error(`malformed line: ${trimmed}`);

    const openedAt = new Date(parts[0]).toISOString();
    // A repeated timestamp is a duplicate export, not two bars: the evaluator
    // rejects a non-ascending sequence outright, so drop it here and say so.
    if (seen.has(openedAt)) continue;

    seen.set(openedAt, {
      openedAt,
      open: Number(parts[1]),
      high: Number(parts[2]),
      low: Number(parts[3]),
      close: Number(parts[4]),
      volume: Number(parts[5]),
      delta: Number(parts[6]),
      ticks: Number(parts[7]),
      pocPrice: parts[8] === "" ? null : Number(parts[8]),
    });
  }

  return [...seen.values()].sort((a, b) =>
    Date.parse(a.openedAt) - Date.parse(b.openedAt)
  );
}

function asHistoryBar(bar: ParsedBar): HistoryBar {
  return {
    openedAt: bar.openedAt,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    delta: bar.delta,
    ticks: bar.ticks,
    pocPrice: bar.pocPrice,
  };
}

function parseLevels(text: string): Map<string, ClusterLevel[]> {
  const out = new Map<string, ClusterLevel[]>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const [stamp, ladder] = trimmed.split("|");
    if (!ladder) continue;

    out.set(
      new Date(stamp).toISOString(),
      ladder.split(",").map((level) => {
        const [price, ask, bid, between, volume, ticks] = level.split(":");
        return {
          price: Number(price),
          ask: Number(ask),
          bid: Number(bid),
          between: Number(between),
          volume: Number(volume),
          ticks: Number(ticks),
        };
      }),
    );
  }

  return out;
}

function asBarInput(bar: ParsedBar, levels: ClusterLevel[]): BarInput {
  return {
    openedAt: bar.openedAt,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    // Bar-level order-flow aggregates are not exported. `stacked_imbalance`
    // reads the ladder rather than these, and nothing on the P-A path reads
    // them at all, so a zero here cannot be mistaken for a measurement.
    askVolume: 0,
    bidVolume: 0,
    delta: bar.delta,
    minDelta: 0,
    maxDelta: 0,
    ticks: bar.ticks,
    trades: 0,
    isClosed: true,
    levels,
  };
}

/** How near the bar came to its anchor, in median true ranges. */
interface Approach {
  openedAt: string;
  anchorIdentity: string;
  distance: number;
  closedOnTrendSide: boolean;
}

function approaches(decision: PullbackDecisionBar): Approach[] {
  const direction = decision.bias === "bullish"
    ? "long"
    : decision.bias === "bearish"
    ? "short"
    : null;
  const mtr = decision.medianTrueRange;
  if (direction === null || mtr === null || !(mtr > 0)) return [];

  const extreme = direction === "long" ? decision.low : decision.high;
  const out: Approach[] = [];

  for (const anchor of decision.anchors) {
    if (anchor.price === null || !Number.isFinite(anchor.price)) continue;
    out.push({
      openedAt: decision.openedAt,
      anchorIdentity: anchor.identity,
      distance: Math.abs(extreme - anchor.price) / mtr,
      closedOnTrendSide: direction === "long"
        ? decision.close > anchor.price
        : decision.close < anchor.price,
    });
  }

  return out;
}

function tally(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[rank];
}

function main(): void {
  const positional = Deno.args.filter((arg) => !arg.startsWith("--"));
  const [path, zoneOverride] = positional;
  if (!path) {
    console.error(
      "usage: deno run --allow-read scripts/mnq_pullback_probe.ts <bars.psv>" +
        " [zoneProximity] [--levels=<levels.psv>] [--windows]",
    );
    Deno.exit(2);
  }

  const levelsArg = Deno.args.find((arg) => arg.startsWith("--levels="));
  const footprints = levelsArg
    ? parseLevels(Deno.readTextFileSync(levelsArg.slice("--levels=".length)))
    : new Map<string, ClusterLevel[]>();

  const bars = parse(Deno.readTextFileSync(path));
  // Built the way the live rule builds it, from a params row, so the probe
  // cannot drift into measuring a contract production never runs.
  const contract = contractFor(
    zoneOverride ? { ...LIVE_PARAMS, zoneProximity: Number(zoneOverride) } : LIVE_PARAMS,
  );

  const decisions: PullbackDecisionBar[] = [];
  const history: HistoryBar[] = [];
  const allApproaches: Approach[] = [];

  let reconciled = 0;

  for (const bar of bars) {
    const levels = footprints.get(bar.openedAt) ?? [];
    const ctx: RuleContext = {
      bar: asBarInput(bar, levels),
      levels,
      history: history.slice(-HISTORY_BARS),
      strategyHistory: history.slice(-STRATEGY_HISTORY_BARS),
      symbol: "MNQU6",
      timeframe: "5m",
      tickSize: 0.25,
      params: LIVE_PARAMS,
    };

    const decision = buildDecision(ctx, ctx.strategyHistory!);
    if (
      decision.triggers.some((trigger) =>
        trigger.kind === "stacked_imbalance" && trigger.available
      )
    ) reconciled += 1;
    decisions.push(decision);
    allApproaches.push(...approaches(decision));
    history.push(asHistoryBar(bar));
  }

  const result = evaluatePullback(decisions, contract);

  const anchored =
    decisions.filter((decision) =>
      decision.anchors.some((anchor) => anchor.price !== null)
    ).length;
  const distances = allApproaches.map((a) => a.distance).sort((a, b) => a - b);
  const trendSide = allApproaches.filter((a) => a.closedOnTrendSide);
  const trendSideDistances = trendSide.map((a) => a.distance).sort((a, b) => a - b);

  console.log(`rule:              ${RULE_KEY}`);
  console.log(`contract:          ${contract.version}`);
  console.log(`zoneProximity:     ${contract.zoneProximity} x median true range`);
  console.log(`bars:              ${bars.length}`);
  console.log(`window:            ${bars.at(0)?.openedAt} .. ${bars.at(-1)?.openedAt}`);
  console.log("");

  console.log("-- gates, per decision bar --");
  console.log(`decision bars:     ${result.diagnostics.decisionBars}`);
  console.log(`no volatility:     ${result.diagnostics.barsWithoutVolatility}`);
  console.log(`no bias:           ${result.diagnostics.barsWithoutBias}`);
  console.log(`prior day known:   ${anchored}`);
  console.log(
    `footprint usable:  ${reconciled} (supplied for ${footprints.size} bars)`,
  );
  console.log("");

  console.log("-- how close price came to its anchor, in median true ranges --");
  console.log(
    `(bar, anchor) pairs with a usable bias, volatility and level: ${distances.length}`,
  );
  for (const fraction of [0.01, 0.05, 0.1, 0.25, 0.5]) {
    console.log(
      `  p${(fraction * 100).toString().padStart(2, "0")}: ${
        quantile(distances, fraction).toFixed(3)
      }`,
    );
  }
  console.log(`  closest:  ${distances.at(0)?.toFixed(3) ?? "n/a"}`);
  console.log(
    `  within ${contract.zoneProximity}: ${
      distances.filter((d) => d <= contract.zoneProximity).length
    }`,
  );
  console.log(
    `  within ${contract.zoneProximity} and closing on the trend side: ${
      trendSideDistances.filter((d) => d <= contract.zoneProximity).length
    }`,
  );
  console.log("");

  console.log("-- why each (bar, anchor) pair opened no setup --");
  for (const [reason, count] of tally(result.barOutcomes.map((o) => o.reason))) {
    console.log(`  ${count.toString().padStart(6)}  ${reason}`);
  }
  console.log("");

  console.log(`-- opportunities: ${result.opportunities.length} --`);
  for (
    const [label, count] of tally(
      result.opportunities.map((o) =>
        o.outcome.kind === "triggered"
          ? `triggered:${o.outcome.trigger}`
          : o.outcome.kind === "rejected"
          ? `rejected:${o.outcome.reason}`
          : `right_censored:${o.outcome.reason}`
      ),
    )
  ) {
    console.log(`  ${count.toString().padStart(6)}  ${label}`);
  }

  const sameBar = result.opportunities.filter((o) =>
    o.outcome.kind === "triggered" && o.outcome.at === o.openedAt
  );
  console.log("");
  console.log(
    `live preview (touch_bar_only) would have fired: ${sameBar.length}`,
  );

  // Every bar an opportunity was open on, so a second pass can fetch the
  // footprint for exactly those bars instead of the whole table. Named here
  // rather than eyeballed, so the narrower run is reproducible.
  if (Deno.args.includes("--windows")) {
    const wanted = new Set<string>();
    const index = new Map(decisions.map((d, at) => [d.openedAt, at]));
    for (const opportunity of result.opportunities) {
      const from = index.get(opportunity.openedAt) ?? 0;
      for (
        let at = from;
        at < Math.min(decisions.length, from + contract.setupMaxAgeBars + 1);
        at++
      ) wanted.add(decisions[at].openedAt);
    }
    console.log("");
    console.log(`-- ${wanted.size} bars carry an open setup --`);
    for (const openedAt of [...wanted].sort()) console.log(openedAt);
  }
}

if (import.meta.main) main();
