import Link from "next/link";

import { BuildTag } from "./BuildTag";

const LINKS = [
  { href: "/", label: "สัญญาณ" },
  { href: "/stats", label: "สถิติ" },
  { href: "/rules", label: "กฎ" },
  { href: "/experiments", label: "ทดลอง" },
];

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
        <BuildTag className="ml-auto" />
      </div>
    </header>
  );
}
