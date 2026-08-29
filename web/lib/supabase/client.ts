import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/** Browser client. Carries the signed-in user's JWT, so RLS applies. */
export function createClient() {
  const { url, key } = supabaseEnv();
  return createBrowserClient(url, key);
}
