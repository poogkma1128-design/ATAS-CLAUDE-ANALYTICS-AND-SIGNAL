"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Nav } from "@/components/Nav";

/**
 * Where the password gets set, so signing in stops depending on email.
 *
 * This is the one step that cannot be done from the login page: setting a
 * password needs a session, and the only way to a first session is the emailed
 * code. So the order is: code once, password here, password from then on.
 *
 * Sign out is here too. It had no home before, which mattered on the day a
 * half-valid session made every page throw — the only way out was the button
 * the error page happens to carry.
 */
export default function AccountPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setProblem("");
    setDone(false);

    // Checked here rather than left to Supabase, which rejects a short password
    // with an English message about character counts.
    if (password.length < 8) {
      setProblem("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
      return;
    }
    if (password !== again) {
      setProblem("รหัสผ่านสองช่องไม่ตรงกัน");
      return;
    }

    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setProblem(error.message);
      return;
    }
    setPassword("");
    setAgain("");
    setDone(true);
  }

  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  const field =
    "w-full rounded-md border px-3 py-2 text-sm hairline bg-transparent";

  return (
    <>
      <Nav current="/account" />
      <main className="mx-auto max-w-sm px-5 py-6">
        <h1 className="text-base font-semibold">บัญชี</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          {email
            ? <>เข้าสู่ระบบอยู่ในชื่อ <b>{email}</b></>
            : "กำลังอ่านข้อมูลบัญชี..."}
        </p>

        <div className="card mt-5 p-4">
          <h2 className="text-sm font-semibold">ตั้งรหัสผ่าน</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            ตั้งครั้งเดียว แล้วครั้งต่อไปเข้าด้วยอีเมล + รหัสผ่านได้เลย
            ไม่ต้องรอรหัสจากอีเมลอีก
          </p>

          {problem && (
            <p
              className="mt-3 rounded-md px-3 py-2 text-sm"
              style={{
                color: "var(--status-critical)",
                background: "var(--neutral-mid)",
              }}
            >
              {problem}
            </p>
          )}

          {done && (
            <p
              className="mt-3 rounded-md px-3 py-2 text-sm"
              style={{ color: "var(--long)", background: "var(--neutral-mid)" }}
            >
              ตั้งรหัสผ่านเรียบร้อย — ครั้งหน้าใช้รหัสนี้เข้าได้เลย
            </p>
          )}

          <form onSubmit={save} className="mt-4 space-y-3">
            {/* Hidden but present: password managers file the saved credential
                under the right account only if the username is in the form. */}
            <input
              type="email"
              autoComplete="username"
              value={email ?? ""}
              readOnly
              hidden
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)"
              className={field}
              style={{ color: "var(--text-primary)" }}
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
              placeholder="พิมพ์รหัสผ่านอีกครั้ง"
              className={field}
              style={{ color: "var(--text-primary)" }}
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--long)" }}
            >
              {busy ? "กำลังบันทึก..." : "บันทึกรหัสผ่าน"}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={signOut}
          className="mt-5 w-full rounded-md px-3 py-2 text-sm underline"
          style={{ color: "var(--text-secondary)" }}
        >
          ออกจากระบบ
        </button>
      </main>
    </>
  );
}
