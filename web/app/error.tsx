"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { BuildTag } from "@/components/BuildTag";

/**
 * What a page says when it throws.
 *
 * Without this file Next renders its own wall: "Application error: a
 * server-side exception has occurred" and a digest, on a white page, with no
 * way forward. That is the one screen in this whole dashboard that tells the
 * reader nothing — every other absence here is spelled out (a chart that never
 * posted, a drawdown nobody measured, a stop that is missing rather than zero),
 * and then the failure that actually stops you gets a bare number.
 *
 * The digest is kept and shown rather than hidden, because it is the only
 * handle on the server log that holds the real message: Next deliberately
 * withholds the text from the browser so a stack trace cannot leak, and the
 * digest is what matches this crash to that line.
 *
 * The sign-out button is here for a specific trap. A session cookie that
 * middleware accepts but the page cannot use puts the reader in a loop: every
 * route throws, and the only escape — /login — redirects back out because
 * middleware still sees a signed-in user. Clearing the session from the crash
 * page itself is the way out of that loop.
 */
export default function ErrorPage(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void },
) {
  useEffect(() => {
    // Reaches the browser console and, on the server, the runtime log.
    console.error("page threw:", error);
  }, [error]);

  async function signOutAndRetry() {
    try {
      await createClient().auth.signOut();
    } catch {
      // Already unusable, which is the case this button exists for. The
      // redirect below still clears the loop.
    }
    window.location.assign("/login");
  }

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="card w-full max-w-md p-6">
        <h1 className="text-lg font-semibold">หน้านี้โหลดไม่สำเร็จ</h1>

        <p className="mt-2 text-sm" style={{ color: "var(--text-secondary)" }}>
          เซิร์ฟเวอร์เกิดข้อผิดพลาดระหว่างสร้างหน้านี้ —
          <strong> ข้อมูลสัญญาณและการแจ้งเตือน Telegram ไม่ได้รับผลกระทบ</strong>
          {" "}เพราะสองอย่างนั้นทำงานอยู่ฝั่ง Supabase ไม่ได้ผ่านหน้าเว็บ
        </p>

        {error.digest && (
          <div
            className="mt-4 rounded-md px-3 py-2 text-sm"
            style={{ background: "var(--neutral-mid)" }}
          >
            <div style={{ color: "var(--text-muted)" }}>รหัสอ้างอิงของข้อผิดพลาด</div>
            <code className="font-mono">{error.digest}</code>
            <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
              เอาเลขนี้ไปค้นใน Vercel → Deployment → Runtime Logs
              จะเจอข้อความจริงของข้อผิดพลาด (เบราว์เซอร์ไม่แสดงให้ เพื่อไม่ให้ stack trace รั่ว)
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-md px-3 py-2 text-sm font-medium text-white"
            style={{ background: "var(--long)" }}
          >
            ลองโหลดใหม่
          </button>
          <button
            type="button"
            onClick={signOutAndRetry}
            className="w-full rounded-md px-3 py-2 text-sm underline"
            style={{ color: "var(--text-secondary)" }}
          >
            ออกจากระบบแล้วเข้าใหม่
          </button>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ถ้ากด “ลองโหลดใหม่” แล้วยังพัง ให้ลองปุ่มล่าง — session ที่หมดอายุครึ่ง ๆ
            ทำให้ทุกหน้าพังพร้อมกันได้ และออกจากระบบคือทางเดียวที่หลุดออกมา
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <BuildTag />
        </div>
      </div>
    </main>
  );
}
