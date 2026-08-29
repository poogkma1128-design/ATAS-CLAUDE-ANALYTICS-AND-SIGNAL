import Link from "next/link";

const LINKS = [
  { href: "/", label: "สัญญาณ" },
  { href: "/stats", label: "สถิติ" },
  { href: "/rules", label: "กฎ" },
];

/**
 * Which build is being looked at.
 *
 * Stamped in next.config.ts, so it names the deployment rather than the
 * moment the page was requested. It sits next to the nav because the question
 * it answers — "am I looking at the latest one?" — is asked while wondering
 * whether something is missing, not on a page anyone would go looking for.
 */
function BuildTag() {
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "dev";
  const builtAt = process.env.NEXT_PUBLIC_BUILT_AT ?? "";

  return (
    <span
      className="ml-auto shrink-0 font-mono text-[11px]"
      style={{ color: "var(--text-muted)" }}
      title={builtAt ? `เว็บตัวนี้ build เมื่อ ${builtAt} น. (ไทย)` : undefined}
    >
      web {commit}
    </span>
  );
}

export function Nav({ current }: { current: string }) {
  return (
    <header
      className="sticky top-0 z-10 border-b hairline"
      style={{ background: "var(--surface-page)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3">
        <span className="text-sm font-semibold tracking-tight">ATAS Signal Board</span>
        <nav className="flex items-center gap-4">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm"
              style={{
                color: current === link.href
                  ? "var(--text-primary)"
                  : "var(--text-secondary)",
                fontWeight: current === link.href ? 600 : 400,
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <BuildTag />
      </div>
    </header>
  );
}
