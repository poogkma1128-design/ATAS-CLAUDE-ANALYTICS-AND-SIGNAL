/**
 * Condenses a rule's payload into the one line that goes in a Telegram alert.
 * The full payload is always kept in the database; this is only the summary.
 */
export function describeEvidence(
  ruleKey: string,
  payload: Record<string, unknown>,
): string | null {
  switch (ruleKey) {
    case "stacked_imbalance": {
      const ratio = payload.avgRatio ?? "∞";
      return `Stack ${payload.stackLength} ระดับ · ratio เฉลี่ย ${ratio} · ${payload.priceFrom}–${payload.priceTo}`;
    }
    case "delta_divergence": {
      const extreme = payload.kind === "new_high_negative_delta" ? "high" : "low";
      return `ราคาทำ ${extreme} ใหม่ แต่ delta ${payload.delta}`;
    }
    case "absorption": {
      const level = payload.level as { price?: number } | undefined;
      return `Volume ${payload.observedMultiple}× ค่าเฉลี่ย ที่ ${level?.price ?? "?"} · ถอยกลับ ${payload.rejectionTicks} ticks`;
    }
    case "poc_shift": {
      return `POC ขยับ ${payload.totalShiftTicks} ticks${payload.isHvn ? " · HVN" : ""}`;
    }
    default:
      return null;
  }
}
