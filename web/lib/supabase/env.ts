/**
 * Reads the Supabase connection settings, failing with a message that names
 * the missing variable rather than surfacing an undefined-url error from deep
 * inside the client library.
 */
export function supabaseEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured: ${missing.join(" and ")} ${
        missing.length > 1 ? "are" : "is"
      } not set. ` +
        "Add it to the hosting project's environment variables and redeploy.",
    );
  }

  return { url: url!, key: key! };
}
