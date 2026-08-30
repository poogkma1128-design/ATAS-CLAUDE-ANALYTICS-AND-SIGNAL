/**
 * Which build is being looked at.
 *
 * Stamped in next.config.ts and inlined at build time, so it names the
 * deployment rather than the moment the page was requested.
 *
 * It appears on the login page as well as behind it. The question it answers —
 * "am I looking at the latest one?" — is asked exactly when something seems
 * missing, and that includes when sign-in itself is not working: a version you
 * can only read after logging in is no help on the days you cannot.
 */
export function BuildTag({ className = "" }: { className?: string }) {
  // The REV comes from a committed file, so unlike the commit it is always
  // known — including under `next dev`, where there is no deployment to name.
  const rev = process.env.NEXT_PUBLIC_BUILD_REV ?? "?";
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "dev";
  const builtAt = process.env.NEXT_PUBLIC_BUILT_AT ?? "";

  // The indicator carries its own REV and moves far more slowly, so the two
  // numbers are not expected to match. Labelling this one "web" is what stops
  // a mismatch from reading as a problem.
  return (
    <span
      className={`shrink-0 font-mono text-[11px] ${className}`}
      style={{ color: "var(--text-muted)" }}
      title={builtAt ? `เว็บตัวนี้ build เมื่อ ${builtAt} น. (ไทย)` : undefined}
    >
      web REV {rev} · {commit}
    </span>
  );
}
