"use client";

/**
 * The last resort: a throw in the root layout itself.
 *
 * error.tsx cannot catch that one, because the layout it would render inside
 * is the thing that failed. This replaces the whole document, so it carries its
 * own <html> and <body> and cannot rely on globals.css having loaded -- every
 * style here is inline for that reason.
 *
 * Kept deliberately plain. If this is ever on screen, the interesting question
 * is not how the page looks, it is which digest to search for.
 */
export default function GlobalError(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void },
) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "1.5rem",
          background: "#0b0f14",
          color: "#e6edf3",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.05rem", margin: 0 }}>
            เว็บโหลดไม่ขึ้นทั้งหน้า
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#9fb0c0", lineHeight: 1.6 }}>
            ข้อผิดพลาดเกิดที่ layout หลัก ไม่ใช่แค่หน้าใดหน้าหนึ่ง —
            <strong> การรับสัญญาณและ Telegram ยังทำงานปกติ</strong> เพราะไม่ได้ผ่านเว็บ
          </p>

          {error.digest && (
            <p style={{ fontSize: "0.85rem", lineHeight: 1.6 }}>
              รหัสอ้างอิง:{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </code>
              <br />
              <span style={{ color: "#9fb0c0", fontSize: "0.75rem" }}>
                ค้นเลขนี้ใน Vercel → Deployment → Runtime Logs เพื่อดูข้อความจริง
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              marginTop: "0.5rem",
              fontSize: "0.85rem",
              color: "#fff",
              background: "#22c55e",
              border: "none",
              borderRadius: "0.375rem",
            }}
          >
            ลองโหลดใหม่
          </button>
        </div>
      </body>
    </html>
  );
}
