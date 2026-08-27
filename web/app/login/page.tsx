"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createClient();
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold">ATAS Signal Board</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
          ใส่อีเมลเพื่อรับลิงก์เข้าสู่ระบบ
        </p>

        {status === "sent"
          ? (
            <p className="mt-6 text-sm" style={{ color: "var(--success-text)" }}>
              ส่งลิงก์ไปที่ {email} แล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเข้าใช้งาน
            </p>
          )
          : (
            <form onSubmit={signIn} className="mt-5 space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-md border px-3 py-2 text-sm hairline bg-transparent"
                style={{ color: "var(--text-primary)" }}
              />
              <button
                type="submit"
                disabled={status === "sending"}
                className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "var(--long)" }}
              >
                {status === "sending" ? "กำลังส่ง..." : "ส่งลิงก์เข้าสู่ระบบ"}
              </button>
              {status === "error" && (
                <p className="text-sm" style={{ color: "var(--status-critical)" }}>
                  {message}
                </p>
              )}
            </form>
          )}
      </div>
    </main>
  );
}
