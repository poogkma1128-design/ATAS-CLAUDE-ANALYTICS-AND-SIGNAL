/**
 * Shared authentication for ATAS-only Edge Functions.
 *
 * The bridge uses a dedicated secret rather than a Supabase user JWT. Keep the
 * comparison constant-time so a rejected request cannot reveal token prefixes.
 */
export function hasIngestAuthorization(req: Request): boolean {
  const expected = Deno.env.get("INGEST_TOKEN");
  if (!expected) {
    console.error("INGEST_TOKEN is not set; refusing request");
    return false;
  }

  const header = req.headers.get("authorization") ?? "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : req.headers.get("x-ingest-token")?.trim() ?? "";

  return timingSafeEqual(presented, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);

  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
