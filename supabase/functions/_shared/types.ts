// Shared shapes for the ATAS -> Supabase ingest path.

/** One price level of a bar's footprint, as reported by ATAS. */
export interface ClusterLevel {
  price: number;
  /** Volume traded at the ask: aggressive buyers. */
  ask: number;
  /** Volume traded at the bid: aggressive sellers. */
  bid: number;
  between: number;
  volume: number;
  ticks: number;
}

/** A bar as posted by the indicator, footprint included. */
export interface BarInput {
  openedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  askVolume: number;
  bidVolume: number;
  delta: number;
  minDelta: number;
  maxDelta: number;
  cumDelta?: number | null;
  ticks: number;
  trades: number;
  isClosed: boolean;
  levels: ClusterLevel[];
}

/** Body of a POST to the ingest function. */
export interface IngestPayload {
  symbol: string;
  exchange?: string;
  tickSize: number;
  tickValue?: number | null;
  timeframe: string;
  bars: BarInput[];
}

/**
 * A previously stored bar, reduced to what the rules actually read. Historical
 * footprints are never re-fetched; poc_price is persisted on the bar itself.
 */
export interface HistoryBar {
  openedAt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  delta: number;
  pocPrice: number | null;
}

export interface RuleRow {
  key: string;
  name: string;
  enabled: boolean;
  telegram_enabled: boolean;
  horizon_bars: number;
  params: Record<string, unknown>;
}

export interface RuleContext {
  /** The closed bar under evaluation. */
  bar: BarInput;
  /** bar.levels sorted ascending by price. */
  levels: ClusterLevel[];
  /** Preceding closed bars, oldest first, excluding `bar`. */
  history: HistoryBar[];
  tickSize: number;
  params: Record<string, unknown>;
}

export interface RuleSignal {
  direction: "long" | "short";
  price: number;
  /** 0..1, how strongly the evidence exceeded the rule's threshold. */
  confidence: number;
  /** Why it fired. Persisted so a signal can be audited later. */
  payload: Record<string, unknown>;
}

export type RuleEvaluator = (ctx: RuleContext) => RuleSignal[];
