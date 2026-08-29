import { NextResponse, type NextRequest } from "next/server";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes an email sign-in and turns it into a session cookie.
 *
 * Two shapes arrive here, depending on what the Supabase email template sends:
 *
 *   ?code=...                    the PKCE flow. The verifier lives in the
 *                                browser that asked for the link, so this only
 *                                works if the link is opened in that same
 *                                browser.
 *   ?token_hash=...&type=...     the OTP flow, which carries everything it
 *                                needs and therefore survives being opened on
 *                                a different device.
 *
 * Failures redirect back to the login page with a reason attached, because a
 * silent bounce to a blank form is indistinguishable from the link doing
 * nothing at all.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next") ?? "/";
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    return error ? fail(origin, "link_rejected", error.message) : done(origin, next);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return error ? fail(origin, "wrong_browser", error.message) : done(origin, next);
  }

  return fail(origin, "missing_code");
}

function done(origin: string, next: string) {
  return NextResponse.redirect(`${origin}${next}`);
}

function fail(origin: string, reason: string, detail?: string) {
  const url = new URL("/login", origin);
  url.searchParams.set("error", reason);
  if (detail) url.searchParams.set("detail", detail);
  return NextResponse.redirect(url);
}
