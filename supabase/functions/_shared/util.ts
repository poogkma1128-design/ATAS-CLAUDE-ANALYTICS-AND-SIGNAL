import type { ClusterLevel } from "./types.ts";

/** Reads a numeric threshold out of a rule's params jsonb, with a fallback. */
export function num(
  params: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const raw = params?.[key];
  const value = typeof raw === "string" ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Prices arrive as floats, so tick adjacency has to be compared with a
 * tolerance rather than by equality.
 */
export function isOneTickApart(
  lower: number,
  upper: number,
  tickSize: number,
): boolean {
  return Math.abs(upper - lower - tickSize) < tickSize * 1e-6;
}

/**
 * Ratio of an aggressor side against the opposing side it traded into.
 * A zero opposing side is treated as an unbounded imbalance rather than NaN,
 * which matches how footprint charts colour a lone print.
 */
export function imbalanceRatio(aggressor: number, opposing: number): number {
  if (opposing <= 0) return aggressor > 0 ? Number.POSITIVE_INFINITY : 0;
  return aggressor / opposing;
}

/** The price level that traded the most volume in a bar. */
export function pointOfControl(levels: ClusterLevel[]): ClusterLevel | null {
  let best: ClusterLevel | null = null;
  for (const level of levels) {
    if (best === null || level.volume > best.volume) best = level;
  }
  return best;
}

export function sortLevels(levels: ClusterLevel[]): ClusterLevel[] {
  return [...levels].sort((a, b) => a.price - b.price);
}
