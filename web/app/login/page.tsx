"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BuildTag } from "@/components/BuildTag";

/**
 * Sign-in, with a password first and the emailed code kept as the way back in.
 *
 * The emailed link came first and was the wrong default for one person signing
 * in from a phone: it only works in the browser that asked for it, and it only
 * reaches this site if the deployment's URL is on the Supabase redirect
 * allow-list — which a preview URL never is, since it changes with the branch.
 * Both failures look identical from here, and neither is the reader's fault.
 *
 * A password has neither constraint. It is typed into this page, it works on
 * any device and any deployment, and the phone's keychain fills it in. The
 * six-digit code stays because the password has to be set once before it
 * exists, and because a forgotten password would otherwise lock the account
 * out entirely. The emailed link is gone: it was never the reliable path, and
 * offering three ways in made the working one harder to find.
 */
type Mode = "password" | "code";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [next, setNext] = useState("/");

  // Read once on mount rather than through useSearchParams, which would force
  // this whole page behind a Suspense boundary at build time.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next") ?? "/");

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const reason = params.get("error") ?? hash.get("error_code") ?? hash.get("error");
    if (reason) {
      setProblem(
        params.get("detail") ?? hash.get("error_description") ??
          `เข้าสู่ระบบไม่สำเร็จ (${reason})`,
      );
    }
  }, []);

  /** A full navigation, not a client-side push: the session lives in a cookie
   *  that the middleware has to see before it will let the page through. */
  function enter() {
    window.location.assign(next);
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");

    const { error } = await createClient().auth.signInWithPassword({
      email,
      password,
    });

    setBusy(false);
    if (error) {
      // Supabase answers a wrong password and an account with no password set
      // with the same message, and on this dashboard the second is far more
      // likely — so the way out of it is named rather than left to be guessed.
      setProblem(
        error.message.toLowerCase().includes("invalid login credentials")
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง — ถ้ายังไม่เคยตั้งรหัสผ่าน " +
            "ให้กด “ใช้รหัสจากอีเมลแทน” ข้างล่าง แล้วไปตั้งที่หน้า “บัญชี”"
          : error.message,
      );
      return;
    }
    enter();
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");

    // shouldCreateUser stays off: this dashboard has one account, and a typo in
    // the address would otherwise quietly make a second one that can see
    // nothing, which reads as "the code never arrived".
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    setBusy(false);
    if (error) {
      setProblem(error.message);
      return;
    }
    setCodeSent(true);
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem("");

    const { error } = await createClient().auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });

    if (error) {
      setBusy(false);
      setProblem(
        error.message.toLowerCase().includes("expired")
          ? "รหัสหมดอายุหรือไม่ถูกต้อง — กด “ส่งรหัสอีกครั้ง” เพื่อขอรหัสใหม่"
          : error.message,
      );
      return;
    }
    enter();
  }

  const field =
    "w-full rounded-md border px-3 py-2 text-sm hairline bg-transparent";
  const primary =
    "w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60";

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">ATAS Signal Board</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {mode === "password"
            ? "ใส่อีเมลและรหัสผ่านเพื่อเข้าสู่ระบบ"
            : codeSent
            ? `ส่งรหัส 6 หลักไปที่ ${email} แล้ว`
            : "ขอรหัส 6 หลักทางอีเมล"}
        </p>

        {problem && (
          <p
            className="mt-4 rounded-md px-3 py-2 text-sm"
            style={{
              color: "var(--status-critical)",
              background: "var(--neutral-mid)",
            }}
          >
            {problem}
          </p>
        )}

        {mode === "password" && (
          <form onSubmit={signInWithPassword} className="mt-5 space-y-3">
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={field}
              style={{ color: "var(--text-primary)" }}
            />
            <input
              type="password"
              required
              // Tells the phone's keychain this is the sign-in field to fill,
              // which is most of what makes a password the easy option here.
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="รหัสผ่าน"
              className={field}
              style={{ color: "var(--text-primary)" }}
            />
            <button
              type="submit"
              disabled={busy}
              className={primary}
              style={{ background: "var(--long)" }}
            >
              {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
            </button>
          </form>
        )}

        {mode === "code" && !codeSent && (
          <form onSubmit={sendCode} className="mt-5 space-y-3">
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={field}
              style={{ color: "var(--text-primary)" }}
            />
            <button
              type="submit"
              disabled={busy}
              className={primary}
              style={{ background: "var(--long)" }}
            >
              {busy ? "กำลังส่ง..." : "ส่งรหัสเข้าอีเมล"}
            </button>
          </form>
        )}

        {mode === "code" && codeSent && (
          <form onSubmit={verifyCode} className="mt-5 space-y-3">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className={`${field} text-center text-lg tracking-[0.4em]`}
              style={{ color: "var(--text-primary)" }}
            />
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className={primary}
              style={{ background: "var(--long)" }}
            >
              {busy ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setProblem("");
              }}
              className="w-full text-sm underline"
              style={{ color: "var(--text-secondary)" }}
            >
              ส่งรหัสอีกครั้ง / เปลี่ยนอีเมล
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "code" : "password");
            setCodeSent(false);
            setCode("");
            setPassword("");
            setProblem("");
          }}
          className="mt-4 w-full text-sm underline"
          style={{ color: "var(--text-secondary)" }}
        >
          {mode === "password"
            ? "ใช้รหัสจากอีเมลแทน (ยังไม่ได้ตั้งรหัสผ่าน / ลืมรหัสผ่าน)"
            : "กลับไปใช้รหัสผ่าน"}
        </button>

        {mode === "code" && (
          <p className="mt-3 text-[11px]" style={{ color: "var(--text-muted)" }}>
            เข้าด้วยรหัสแล้วไปที่หน้า <b>บัญชี</b> เพื่อตั้งรหัสผ่าน
            ครั้งต่อไปจะเข้าได้เลยไม่ต้องรออีเมล
          </p>
        )}
      </div>

      <div className="fixed bottom-4 left-0 right-0 flex justify-center">
        <BuildTag />
      </div>
    </main>
  );
}
