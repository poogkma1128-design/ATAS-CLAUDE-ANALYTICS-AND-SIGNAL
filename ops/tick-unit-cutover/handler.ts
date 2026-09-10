// Temporary replacement for the EXISTING ingest/outcome-notify entrypoints.
// No DB, Telegram, request-body reads, background tasks, or runtime secrets.
// Only deploy under the reviewed cutover runbook and written owner GO.
export function maintenanceResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "tick_unit_cutover_maintenance",
      marker: "TICK_UNIT_CUTOVER_V1",
      accepted: false,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Retry-After": "60",
      },
    },
  );
}

// This checks an operator's evidence; it cannot attest remote deployment state.
// Hosted wall-clock lifetime is at most 400s as documented on 2026-09-09.
// Reverify the bound at execution time; an unsupported runtime needs its own
// independently verified bound. This offline function cannot identify a host.
export interface DrainEvidence {
  admissionGateVerified: boolean;
  oldWorkersTerminated: boolean;
  pendingOldSends: number;
  verifiedMaxWorkerLifetimeMs: number;
  gateVerifiedAtMs: number;
  lastOldActivityAtMs: number;
}

export function drainReady(evidence: DrainEvidence, nowMs: number): boolean {
  const { verifiedMaxWorkerLifetimeMs: lifetime, gateVerifiedAtMs, lastOldActivityAtMs } =
    evidence;
  if (
    evidence.admissionGateVerified !== true || evidence.oldWorkersTerminated !== true ||
    evidence.pendingOldSends !== 0 || !Number.isFinite(lifetime) || lifetime < 400_000 ||
    !Number.isFinite(nowMs) || !Number.isFinite(gateVerifiedAtMs) ||
    !Number.isFinite(lastOldActivityAtMs) || gateVerifiedAtMs <= 0 ||
    lastOldActivityAtMs < 0
  ) return false;
  // Restart the drain interval after ANY old deployment activity. Neither an
  // idle HTTP 504 nor one quiet sample proves a worker has stopped executing.
  return nowMs - Math.max(gateVerifiedAtMs, lastOldActivityAtMs) >= lifetime + 60_000;
}
