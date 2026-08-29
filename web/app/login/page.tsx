"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BuildTag } from "@/components/BuildTag";

/**
 * Sign-in offers two ways through on purpose.
 *
 * The emailed link is the convenient one, but it breaks in ways that are
 * invisible from here: it only works in the browser that asked for it, and it
 * only reaches this site if the deployment's URL is on the Supabase redirect
 * allow-list. The six digit code in the same email has neither constraint, so
 * it stays as the way in that always works.
 */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"form" | "sent">("form");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [next, setNext] = useState("/");

  // Read once on mount rather than through useSearchParams, which would force
  // this whole page behind a Suspense boundary at build time.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next") ?? "/");

    // A rejected link comes back as a query from our own callback route, or as
    // a URL fragment when Supabase bounced it before it ever reached us.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const reason = params.get("error") ?? hash.get("error_code") ?? hash.get("error");
    if (reason) setProblem(explain(reason, params.get("detail") ?? hash.get("error_description")));
  }, []);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo:
          `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setBusy(false);
    if (error) {
      setProblem(error.message);
      return;
    }
    setStage("sent");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    if (error) {
      setBusy(false);
      setProblem(
        error.message.toLowerCase().includes("expired")
          ? "รหัสหมดอายุหรือไม่ถูกต้อง — กด “ส่งอีกครั้ง” เพื่อขอรหัสใหม่"
          : error.message,
      );
      return;
    }

    // A full navigation, not a client-side push: the session lives in a cookie
    // that the middleware has to see before it will let the page through.
    window.location.assign(next);
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">ATAS Signal Board</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {stage === "form"
            ? "ใส่อีเมลเพื่อรับลิงก์และรหัสเข้าสู่ระบบ"
            : `ส่งไปที่ ${email} แล้ว`}
        </p>

        {problem && (
          <p
            className="mt-4 rounded-md px-3 py-2 text-sm"
            style={{ color: "var(--status-critical)", background: "var(--neutral-mid)" }}
          >
            {problem}
          </p>
        )}

        {stage === "form"
          ? (
            <form onSubmit={sendLink} className="mt-5 space-y-3">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border px-3 py-2 text-sm hairline bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--long)" }}
              >
                {busy ? "กำลังส่ง..." : "ส่งลิงก์เข้าสู่ระบบ"}
              </button>
            </form>
          )
          : (
            <form onSubmit={verifyCode} className="mt-5 space-y-3">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                กดลิงก์ในอีเมลได้เลย หรือถ้าลิงก์เปิดไม่ได้
                ให้กรอกรหัส 6 หลักจากอีเมลฉบับเดียวกัน
              </p>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="w-full rounded-md border px-3 py-2 text-center text-lg tracking-[0.4em] hairline bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                disabled={busy || code.length < 6}
                className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--long)" }}
              >
                {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStage("form");
                  setCode("");
                  setProblem("");
                }}
                className="w-full text-sm underline"
                style={{ color: "var(--text-secondary)" }}
              >
                ส่งอีกครั้ง / เปลี่ยนอีเมล
              </button>
            </form>
          )}
      </div>

      <div className="fixed bottom-4 left-0 right-0 flex justify-center">
        <BuildTag />
      </div>
    </main>
  );
}

/** Turns a callback failure code into something a person can act on. */
function explain(reason: string, detail: string | null): string {
  switch (reason) {
    case "wrong_browser":
      return "ลิงก์นี้ใช้ได้เฉพาะในเบราว์เซอร์เดียวกับที่ขอลิงก์ " +
        "ถ้าขอจากคอมแล้วมากดบนมือถือจะไม่ผ่าน — ขอลิงก์ใหม่แล้วใช้รหัส 6 หลักแทน";
    case "link_rejected":
    case "otp_expired":
      return "ลิงก์หมดอายุหรือถูกใช้ไปแล้ว (บางครั้งระบบสแกนอีเมลกดลิงก์ไปก่อน) — " +
        "ขอใหม่แล้วใช้รหัส 6 หลักแทน";
    case "missing_code":
      return "ลิงก์ไม่มีข้อมูลยืนยันติดมาด้วย — ขอลิงก์ใหม่อีกครั้ง";
    default:
      return detail ?? `เข้าสู่ระบบไม่สำเร็จ (${reason})`;
  }
}
