import type { BarInput, ClusterLevel, HistoryBar, RuleRow } from "./types.ts";
import { runRules } from "./rules/index.ts";
import { buildPlan, type TradePlan } from "./plan.ts";
import { pointOfControl, sortLevels } from "./util.ts";

/**
 * Re-runs the rule engine over stored bars under settings that were never live.
 *
 * The point is to try changes that alter *which* signals fire, which the SQL
 * sweep in docs/queries/risk_floor_sweep.sql cannot do: that one re-prices
 * trades the rules already found, so it can answer questions about stops and
 * trails but not about a rule's own thresholds.
 *
 * The only way to answer those honestly is to run the same evaluators the live
 * path runs. So this imports runRules and buildPlan rather than restating
 * them: two implementations of a rule would drift, and the day they disagreed
 * the backtest would be confidently wrong.
 *
 * Nothing here writes to public.signals, and nothing here can announce. A
 * backtest result is a different kind of object from a signal — it belongs to
 * an experiment, not to the record of what the system actually told anyone —
 * so the separation is structural rather than a flag that has to be remembered.
 */

/** The part of a bar that scoring needs: an exit only ever looks at range
 *  and close, never at the footprint. */
export interface PriceBar {
  high: number;
  low: number;
  close: number;
}

/** A bar with its footprint, as the engine needs it. */
export interface StoredBar extends PriceBar {
  openedAt: string;
  open: number;
  volume: number;
  askVolume: number;
  bidVolume: number;
  delta: number;
  minDelta: number;
  maxDelta: number;
  ticks: number;
  trades: number;
  levels: ClusterLevel[];
}

export interface SimulatedTrade {
  openedAt: string;
  ruleKey: string;
  direction: "long" | "short";
  confidence: number;
  plan: TradePlan;
  exitReason: "target" | "stop" | "trail" | "timeout";
  exitPrice: number;
  barsUsed: number;
  pnlTicks: number;
  mfeTicks: number;
  maeTicks: number;
  /** pnl in units of the trade's own risk, the only unit that compares
   *  instruments to each other. */
  r: number;
}

export interface SimulationSummary {
  trades: number;
  wins: number;
  winRate: number;
  totalR: number;
  target: number;
  stop: number;
  trail: number;
  timeout: number;
}

/** Enough history for every rule's lookback, matching the live path. */
const HISTORY_BARS = 50;

/**
 * Walks one instrument's bars in order, firing rules and scoring each trade.
 *
 * `bars` must be closed bars for a single instrument and timeframe, oldest
 * first. Signals are only taken on bars that have enough history behind them
 * and enough bars ahead to be scored, so a trade is never counted on evidence
 * the live system would not have had.
 */
export function simulate(
  bars: StoredBar[],
  rules: RuleRow[],
  tickSize: number,
): SimulatedTrade[] {
  const out: SimulatedTrade[] = [];
  const history: HistoryBar[] = [];

  for (const [index, stored] of bars.entries()) {
    const levels = sortLevels(stored.levels);
    const bar = asBarInput(stored, levels);

    const evaluated = runRules(rules, {
      bar,
      levels,
      history: history.slice(-HISTORY_BARS),
      tickSize,
    });

    for (const signal of evaluated) {
      const rule = rules.find((r) => r.key === signal.ruleKey);
      const holdBars = rule?.horizon_bars ?? 10;

      const plan = buildPlan(
        signal.direction,
        bar,
        tickSize,
        rule?.params ?? {},
        holdBars,
        history.slice(-HISTORY_BARS),
      );

      // A trade with no room left to be scored is not evidence either way,
      // so it is dropped rather than counted as a timeout at the last bar.
      const forward = bars.slice(index + 1, index + 1 + holdBars);
      if (forward.length < holdBars) continue;

      const scored = scorePlan(plan, signal.direction, forward, tickSize);
      out.push({
        openedAt: stored.openedAt,
        ruleKey: signal.ruleKey,
        direction: signal.direction,
        confidence: signal.confidence,
        plan,
        ...scored,
      });
    }

    // Only after evaluating, so a bar is never part of its own history.
    history.push({
      openedAt: stored.openedAt,
      open: stored.open,
      high: stored.high,
      low: stored.low,
      close: stored.close,
      volume: stored.volume,
      delta: stored.delta,
      pocPrice: pointOfControl(levels)?.price ?? null,
    });
  }

  return out;
}

/**
 * Scores one plan against the bars that followed it.
 *
 * This mirrors public.evaluate_pending_outcomes deliberately, including the
 * two decisions that shape every number it produces:
 *
 *   - a bar reports only its range, so when one contains both the stop and the
 *     target there is no way to know which traded first. It is scored as the
 *     stop. Assuming the good fill would quietly inflate every statistic the
 *     system exists to produce.
 *   - the trail advances only after the bar has been checked for exits, since
 *     a stop raised using the same bar's high would be a level that never
 *     existed while the bar was forming.
 *
 * Any drift from the SQL scorer makes an experiment incomparable with live
 * results, so backtest_test.ts checks this against outcomes the database
 * scored itself.
 */
export function scorePlan(
  plan: TradePlan,
  direction: "long" | "short",
  forward: PriceBar[],
  tickSize: number,
): Omit<SimulatedTrade, "openedAt" | "ruleKey" | "direction" | "confidence" | "plan"> {
  const long = direction === "long";
  const entry = plan.entry;

  let stop = plan.stop;
  let trailing = false;
  let best = entry;
  let high = -Infinity;
  let low = Infinity;

  let exitPrice: number | null = null;
  let exitReason: SimulatedTrade["exitReason"] | null = null;
  let barsUsed = 0;
  let lastClose = entry;

  for (const bar of forward) {
    barsUsed++;
    high = Math.max(high, bar.high);
    low = Math.min(low, bar.low);
    lastClose = bar.close;

    if (long ? bar.low <= stop : bar.high >= stop) {
      exitPrice = stop;
      exitReason = trailing ? "trail" : "stop";
    } else if (long ? bar.high >= plan.target : bar.low <= plan.target) {
      exitPrice = plan.target;
      exitReason = "target";
    }

    if (exitPrice !== null) break;

    best = long ? Math.max(best, bar.high) : Math.min(best, bar.low);

    if (plan.trailTriggerTicks > 0) {
      const moved = long ? best - entry : entry - best;
      if (moved >= plan.trailTriggerTicks * tickSize) trailing = true;

      if (trailing) {
        const follow = plan.trailOffsetTicks * tickSize;
        stop = long
          ? Math.max(stop, best - follow)
          : Math.min(stop, best + follow);
      }
    }
  }

  if (exitPrice === null) {
    exitPrice = lastClose;
    exitReason = "timeout";
  }

  const pnlTicks = (long ? exitPrice - entry : entry - exitPrice) / tickSize;
  const mfeTicks = Math.max(0, (long ? high - entry : entry - low) / tickSize);
  const maeTicks = Math.max(0, (long ? entry - low : high - entry) / tickSize);

  return {
    exitReason: exitReason!,
    exitPrice,
    barsUsed,
    pnlTicks: round2(pnlTicks),
    mfeTicks: round2(mfeTicks),
    maeTicks: round2(maeTicks),
    r: plan.riskTicks > 0 ? round2(pnlTicks / plan.riskTicks) : 0,
  };
}

export function summarise(trades: SimulatedTrade[]): SimulationSummary {
  const wins = trades.filter((t) => t.pnlTicks > 0).length;
  const by = (reason: SimulatedTrade["exitReason"]) =>
    trades.filter((t) => t.exitReason === reason).length;

  return {
    trades: trades.length,
    wins,
    winRate: trades.length > 0 ? round3(wins / trades.length) : 0,
    totalR: round2(trades.reduce((sum, t) => sum + t.r, 0)),
    target: by("target"),
    stop: by("stop"),
    trail: by("trail"),
    timeout: by("timeout"),
  };
}

function asBarInput(stored: StoredBar, levels: ClusterLevel[]): BarInput {
  return {
    openedAt: stored.openedAt,
    open: stored.open,
    high: stored.high,
    low: stored.low,
    close: stored.close,
    volume: stored.volume,
    askVolume: stored.askVolume,
    bidVolume: stored.bidVolume,
    delta: stored.delta,
    minDelta: stored.minDelta,
    maxDelta: stored.maxDelta,
    ticks: stored.ticks,
    trades: stored.trades,
    isClosed: true,
    levels,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
