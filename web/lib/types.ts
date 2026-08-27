export type Direction = "long" | "short";

export interface SignalRow {
  id: string;
  fired_at: string;
  direction: Direction;
  price: number;
  confidence: number;
  rule_key: string;
  timeframe: string;
  payload: Record<string, unknown>;
  instruments: { symbol: string } | null;
  rules: { name: string } | null;
  signal_outcomes:
    | { status: string; pnl_ticks: number | null; mfe_ticks: number | null; mae_ticks: number | null }
    | null;
}

export interface SetupStatRow {
  rule_key: string;
  direction: Direction;
  trades: number;
  wins: number;
  win_rate: number;
  avg_pnl_ticks: number;
  total_pnl_ticks: number;
  avg_mfe_ticks: number;
  avg_mae_ticks: number;
  avg_confidence: number;
  last_signal_at: string;
}

export interface RuleRow {
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  telegram_enabled: boolean;
  horizon_bars: number;
  params: Record<string, number>;
  updated_at: string;
}

export interface ClusterLevelRow {
  price: number;
  ask: number;
  bid: number;
  between: number;
  volume: number;
  ticks: number;
}
