import type { BarInput, HistoryBar } from "./types.ts";

/**
 * Where each signal sat in the price structure when it fired.
 *
 * Nothing here filters anything. These are recorded onto every signal so that
 * the question "do signals with a sweep behind them actually do better?" can be
 * answered from the outcomes table in a few days, instead of assumed now. The
 * volume gate earned its place that way; these should have to as well.
 *
 * Everything is derived from bars already stored, so no new data has to be
 * collected and the flags can be measured against signals as they resolve.
 */
export interface PriceActionContext {
  /** Higher highs and higher lows, the reverse, or neither. Null when there
   *  are too few confirmed swings to say. */
  structure: "up" | "down" | "range" | null;
  /** A close beyond the most recent swing, which is a break of structure. */
  bos: "bullish" | "bearish" | null;
  /** A break of structure against the prevailing one: a change of character. */
  choch: boolean;
  /** A wick through a swing that the close came back from — the shape of stops
   *  being taken before a reversal. */
  sweep: "high" | "low" | null;
  /** Close within the recent range: 0 at the low, 1 at the high. */
  rangePosition: number | null;
  zone: "premium" | "discount" | "equilibrium" | null;
  swingHigh: number | null;
  swingLow: number | null;
}

/**
 * Bars either side of a candidate for it to count as a swing. Two is the
 * smallest number that rejects a single-bar spike while still confirming a
 * swing quickly enough to be useful on a 5m chart.
 *
 * These are constants rather than rule params on purpose: the context belongs
 * to the bar, not to any one rule, and nothing reads it yet. Whichever of these
 * earns promotion to a filter takes its threshold into rules.params then.
 */
const SWING_STRENGTH = 2;
const RANGE_LOOKBACK = 20;
const EQUILIBRIUM_BAND = 0.05;

export function priceActionContext(
  bar: BarInput,
  history: HistoryBar[],
): PriceActionContext {
  const swings = findSwings(history, SWING_STRENGTH);
  const swingHigh = last(swings.highs);
  const swingLow = last(swings.lows);

  const structure = readStructure(swings);
  const bos = readBreak(bar, swingHigh, swingLow);
  const range = readRange(bar, history);

  return {
    structure,
    bos,
    // A break the other way from an established trend is the interesting one.
    choch: bos !== null && structure !== null && structure !== "range" &&
      ((structure === "up" && bos === "bearish") ||
        (structure === "down" && bos === "bullish")),
    sweep: readSweep(bar, swingHigh, swingLow),
    rangePosition: range.position,
    zone: range.zone,
    swingHigh,
    swingLow,
  };
}

interface Swings {
  highs: number[];
  lows: number[];
}

/**
 * Fractal swings: a high with no equal or higher high within `strength` bars on
 * either side. The equality test means a flat double top is not a swing, which
 * keeps the result deterministic rather than depending on which side is checked
 * first.
 */
function findSwings(bars: HistoryBar[], strength: number): Swings {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = strength; i < bars.length - strength; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - strength; j <= i + strength; j++) {
      if (j === i) continue;
      if (bars[j].high >= bars[i].high) isHigh = false;
      if (bars[j].low <= bars[i].low) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) highs.push(bars[i].high);
    if (isLow) lows.push(bars[i].low);
  }

  return { highs, lows };
}

/** Both sides have to agree before this calls a trend. */
function readStructure(swings: Swings): PriceActionContext["structure"] {
  if (swings.highs.length < 2 || swings.lows.length < 2) return null;

  const [prevHigh, lastHigh] = swings.highs.slice(-2);
  const [prevLow, lastLow] = swings.lows.slice(-2);

  if (lastHigh > prevHigh && lastLow > prevLow) return "up";
  if (lastHigh < prevHigh && lastLow < prevLow) return "down";
  return "range";
}

/**
 * Measured on the close, not the high. A wick through a swing that the bar
 * gives back is a sweep, not a break, and calling it a break would be the one
 * mistake that makes this flag worse than useless.
 */
function readBreak(
  bar: BarInput,
  swingHigh: number | null,
  swingLow: number | null,
): PriceActionContext["bos"] {
  if (swingHigh !== null && bar.close > swingHigh) return "bullish";
  if (swingLow !== null && bar.close < swingLow) return "bearish";
  return null;
}

function readSweep(
  bar: BarInput,
  swingHigh: number | null,
  swingLow: number | null,
): PriceActionContext["sweep"] {
  const above = swingHigh !== null && bar.high > swingHigh && bar.close <= swingHigh
    ? bar.high - swingHigh
    : null;
  const below = swingLow !== null && bar.low < swingLow && bar.close >= swingLow
    ? swingLow - bar.low
    : null;

  // An outside bar can take both sides; the deeper excursion is the one that
  // actually reached for stops.
  if (above !== null && below !== null) return above >= below ? "high" : "low";
  if (above !== null) return "high";
  if (below !== null) return "low";
  return null;
}

function readRange(
  bar: BarInput,
  history: HistoryBar[],
): { position: number | null; zone: PriceActionContext["zone"] } {
  const window = history.slice(-RANGE_LOOKBACK);
  if (window.length === 0) return { position: null, zone: null };

  const high = Math.max(bar.high, ...window.map((b) => b.high));
  const low = Math.min(bar.low, ...window.map((b) => b.low));
  if (high <= low) return { position: null, zone: null };

  const position = (bar.close - low) / (high - low);

  return {
    position: Number(position.toFixed(4)),
    zone: position > 0.5 + EQUILIBRIUM_BAND
      ? "premium"
      : position < 0.5 - EQUILIBRIUM_BAND
      ? "discount"
      : "equilibrium",
  };
}

function last(values: number[]): number | null {
  return values.length > 0 ? values[values.length - 1] : null;
}
