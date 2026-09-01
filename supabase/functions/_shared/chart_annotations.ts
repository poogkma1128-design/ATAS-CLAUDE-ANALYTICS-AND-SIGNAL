export interface ChartAnnotationRequest {
  symbol: string;
  timeframe: string;
  since: string | null;
  limit: number;
}

export interface ChartAnnotation {
  id: string;
  seq: number | null;
  ruleKey: string;
  direction: "long" | "short";
  entryOpenedAt: string;
  entry: number;
  stop: number;
  target: number;
  status: "pending" | "resolved" | "expired" | null;
  exitOpenedAt: string | null;
  exitPrice: number | null;
  exitReason: string | null;
}

interface EmbeddedBar {
  opened_at?: string | null;
}

interface EmbeddedOutcome {
  status?: ChartAnnotation["status"];
  exit_price?: number | string | null;
  exit_reason?: string | null;
  exit_bar?: EmbeddedBar | EmbeddedBar[] | null;
}

interface AnnotationRow {
  id: string;
  seq?: number | null;
  rule_key: string;
  direction: "long" | "short";
  entry_price: number | string;
  stop_price: number | string;
  target_price: number | string;
  entry_bar?: EmbeddedBar | EmbeddedBar[] | null;
  outcome?: EmbeddedOutcome | EmbeddedOutcome[] | null;
}

export function parseChartAnnotationRequest(url: URL): ChartAnnotationRequest | string {
  const symbol = (url.searchParams.get("symbol") ?? "").trim();
  const timeframe = (url.searchParams.get("timeframe") ?? "").trim();
  const since = url.searchParams.get("since");
  const rawLimit = Number(url.searchParams.get("limit") ?? "100");

  if (!/^[A-Za-z0-9._-]{1,64}$/.test(symbol)) return "invalid symbol";
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(timeframe)) return "invalid timeframe";
  if (since !== null && Number.isNaN(Date.parse(since))) return "invalid since";
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
    return "limit must be an integer from 1 to 200";
  }

  return {
    symbol,
    timeframe,
    since: since === null ? null : new Date(since).toISOString(),
    limit: rawLimit,
  };
}

export function mapChartAnnotations(rows: AnnotationRow[]): ChartAnnotation[] {
  return rows.flatMap((row) => {
    const entryBar = first<EmbeddedBar>(row.entry_bar);
    if (!entryBar?.opened_at) return [];

    const outcome = first<EmbeddedOutcome>(row.outcome);
    const exitBar = first<EmbeddedBar>(outcome?.exit_bar ?? null);

    return [{
      id: row.id,
      seq: row.seq ?? null,
      ruleKey: row.rule_key,
      direction: row.direction,
      entryOpenedAt: entryBar.opened_at,
      entry: Number(row.entry_price),
      stop: Number(row.stop_price),
      target: Number(row.target_price),
      status: outcome?.status ?? null,
      exitOpenedAt: exitBar?.opened_at ?? null,
      exitPrice: outcome?.exit_price == null ? null : Number(outcome.exit_price),
      exitReason: outcome?.exit_reason ?? null,
    }];
  });
}

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}
