import type { Direction } from "@/lib/types";

/**
 * Direction is never carried by colour alone: the word LONG or SHORT is always
 * present, which is what makes the blue/red pair safe for colourblind readers.
 */
export function DirectionTag({ direction }: { direction: Direction }) {
  const isLong = direction === "long";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{
        color: "#fff",
        background: isLong ? "var(--long)" : "var(--short)",
      }}
    >
      {isLong ? "▲" : "▼"} {isLong ? "LONG" : "SHORT"}
    </span>
  );
}
