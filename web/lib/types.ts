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
  entry_price: number | null;
  stop_price: number | null;
  target_price: number | null;
  risk_ticks: number | null;
  reward_ticks: number | null;
  trail_trigger_ticks: number | null;
  trail_offset_ticks: number | null;
  hold_bars: number | null;
  instruments: { symbol: string } | null;
  rules: { name: string } | null;
  signal_outcomes:
    | {
      status: string;
      pnl_ticks: number | null;
      mfe_ticks: number | null;
      mae_ticks: number | null;
      exit_reason: string | null;
      bars_used: number | null;
    }
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
  avg_r: number | null;
  total_r: number | null;
  hit_target: number;
  hit_stop: number;
  hit_trail: number;
  timed_out: number;
  avg_mfe_ticks: number;
  avg_mae_ticks: number;
  avg_bars_held: number | null;
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

export interface ExperimentRow {
  id: string;
  name: string;
  note: string | null;
  variants: { label: string; ruleKey?: string; params: Record<string, unknown> }[];
  symbols: string[];
  bars_from: string | null;
  bars_to: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface ExperimentResultRow {
  experiment_id: string;
  variant: string;
  symbol: string | null;
  rule_key: string | null;
  direction: Direction | null;
  trades: number;
  wins: number;
  win_rate: number | null;
  total_r: number | null;
  hit_target: number;
  hit_stop: number;
  hit_trail: number;
  timed_out: number;
}

export interface RuleSnapshotRow {
  id: string;
  label: string;
  note: string | null;
  params: Record<string, Record<string, number>>;
  measured_r: number | null;
  measured_win_rate: number | null;
  measured_trades: number | null;
  is_best_known: boolean;
  taken_at: string;
}

/** One arrangement of plan geometry, and how the trades that used it turned out. */
export interface SettingsEffectRow {
  reward_r: number | null;
  trail_after_r: number | null;
  trail_offset_r: number | null;
  trades: number;
  symbols: number;
  sessions: number;
  wins: number;
  win_rate: number | null;
  total_r: number | null;
  r_per_trade: number | null;
  hit_stop: number;
  hit_target: number;
  hit_trail: number;
  timed_out: number;
  first_fired: string | null;
  last_fired: string | null;
  is_live: boolean;
  verdict: "need more trades" | "need more symbols" | "comparable";
}

/** One price action cell, and whether it has earned the right to be read yet. */
export interface PriceActionEdgeRow {
  sweep: string | null;
  zone: string | null;
  direction: Direction;
  trades: number;
  sessions: number;
  wins: number;
  win_rate: number | null;
  total_r: number | null;
  r_per_trade: number | null;
  overall_r_per_trade: number | null;
  verdict: "need more trades" | "need more sessions" | "separates" | "no different";
}

/** One settings arrangement, scored only on trades that fired after it went live. */
export interface ForwardTestRow {
  reward_r: number | null;
  trail_after_r: number | null;
  trail_offset_r: number | null;
  trades: number;
  symbols: number;
  sessions: number;
  adopted_at: string | null;
  last_fired: string | null;
  total_r: number | null;
  r_per_trade: number | null;
  max_drawdown_r: number | null;
  win_rate: number | null;
  verdict: "need more trades" | "need more symbols" | "readable";
}
