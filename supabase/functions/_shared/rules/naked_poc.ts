import type { HistoryBar, RuleContext, RuleSignal } from "../types.ts";
import { clamp01, num } from "../util.ts";

/** A stored point of control that no later bar has traded through. */
interface NakedPoc {
  price: number;
  /** Bars between the one that printed it and the bar being evaluated. */
  ageBars: number;
}

/**
 * The first trade back to a point of control nobody has been back to.
 *
 * Every bar already stores its POC -- POC Shift reads the chain of them -- so
 * the prices where volume concentrated are on record without anything new being
 * collected. A POC that no later bar's range has covered is unfinished
 * business: volume built there, price left, and the level has never been
 * offered back. The first bar to reach it is the first test that level has had.
 *
 * The direction is the fade. A level reached from below is resistance until it
 * is not; reached from above it is support. Which side the market came from is
 * read off the previous bar's close, and that is never ambiguous here -- a bar
 * whose range covered the price would have taken the level's nakedness with it,
 * so a naked POC is always strictly above or strictly below where price was.
 *
 * When a wide bar reaches several at once the deepest one wins: that is how far
 * the market actually pushed to find a test, and the shallower levels on the
 * way were passed rather than tested.
 *
 * Scope, honestly stated: this is the naked POC of the history window the rules
 * are given (HISTORY_BARS = 50 bars, so a little over four hours on a 5m
 * chart), not of a trading session. A session or daily POC needs volume
 * aggregated per session, which is a profile table this system does not have
 * yet -- see HANDOFF 5.15. The window version is the one that could be built
 * out of what is already stored, and it is the one running here.
 */
export function evaluate(ctx: RuleContext): RuleSignal[] {
  const lookbackBars = Math.max(
    2,
    Math.round(num(ctx.params, "lookbackBars", 40)),
  );
  const minAgeBars = Math.max(1, Math.round(num(ctx.params, "minAgeBars", 5)));

  const window = ctx.history.slice(-lookbackBars);
  if (window.length <= minAgeBars) return [];

  const { bar } = ctx;
  const naked = nakedPocs(window, minAgeBars);

  const reached = naked.filter((n) => bar.low <= n.price && n.price <= bar.high);
  if (reached.length === 0) return [];

  const from = window[window.length - 1].close;
  const deepest = furthestFrom(reached, from);
  const direction = deepest.price > from ? "short" : "long";

  const range = bar.high - bar.low;
  // How far back off the level the bar closed, as a share of its own range.
  // Recorded rather than required: whether a rejection has to be there before
  // the signal counts is a question for the outcomes table, the way the volume
  // gate was decided, not a threshold to assume now.
  const rejection = direction === "short"
    ? deepest.price - bar.close
    : bar.close - deepest.price;
  const rejectionShare = range > 0 ? clamp01(rejection / range) : 0;

  const ageSpan = Math.max(1, lookbackBars - minAgeBars);
  const ageBonus = clamp01((deepest.ageBars - minAgeBars) / ageSpan) * 0.25;

  return [{
    direction,
    price: bar.close,
    confidence: clamp01(0.35 + ageBonus + rejectionShare * 0.2),
    payload: {
      kind: direction === "short" ? "naked_poc_from_below" : "naked_poc_from_above",
      level: { price: deepest.price, ageBars: deepest.ageBars },
      approachedFrom: from,
      nakedInWindow: naked.length,
      reachedThisBar: reached.length,
      lookbackBars,
      minAgeBars,
      windowBars: window.length,
      closedBackShare: Number(rejectionShare.toFixed(4)),
      barHigh: bar.high,
      barLow: bar.low,
      barClose: bar.close,
    },
  }];
}

/**
 * Every POC in the window that is old enough to count and that no later bar in
 * the window has traded through.
 *
 * Quadratic in the window, which is fine at fifty bars and is why the window is
 * a parameter rather than the whole of history.
 */
function nakedPocs(window: HistoryBar[], minAgeBars: number): NakedPoc[] {
  const out: NakedPoc[] = [];

  for (let i = 0; i < window.length; i++) {
    const price = window[i].pocPrice;
    if (price === null) continue;

    const ageBars = window.length - i;
    if (ageBars < minAgeBars) continue;

    let covered = false;
    for (let j = i + 1; j < window.length; j++) {
      if (window[j].low <= price && price <= window[j].high) {
        covered = true;
        break;
      }
    }
    if (!covered) out.push({ price, ageBars });
  }

  return out;
}

/** The level furthest from where price was, ties going to the older one. */
function furthestFrom(levels: NakedPoc[], from: number): NakedPoc {
  let best = levels[0];
  for (const level of levels) {
    const distance = Math.abs(level.price - from);
    const bestDistance = Math.abs(best.price - from);
    if (distance > bestDistance + 1e-9) best = level;
    else if (
      Math.abs(distance - bestDistance) <= 1e-9 && level.ageBars > best.ageBars
    ) {
      best = level;
    }
  }
  return best;
}
