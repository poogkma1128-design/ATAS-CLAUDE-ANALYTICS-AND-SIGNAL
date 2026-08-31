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
    case "delta_flip": {
      const level = payload.level as { price?: number } | undefined;
      const pressed = payload.kind === "delta_flip_up" ? "กด" : "ดัน";
      const run = `หลังโดน${pressed}มา ${payload.runBars} แท่ง`;
      return `Delta พลิกเป็น ${payload.delta} ${run} · ที่ POC เดิม ${level?.price ?? "?"}`;
    }
    case "lvn": {
      const level = payload.level as { price?: number } | undefined;
      const side = payload.kind === "lvn_break_up" ? "ปิดเหนือ" : "ปิดใต้";
      const share = `volume ${payload.observedShare}× ค่าเฉลี่ย`;
      return `LVN ที่ ${level?.price ?? "?"} · ${share} · ${side}ช่องว่าง`;
    }
    case "naked_poc": {
      const level = payload.level as { price?: number; ageBars?: number } | undefined;
      const side = payload.kind === "naked_poc_from_below" ? "จากล่าง" : "จากบน";
      const age = `ทิ้งไว้ ${level?.ageBars ?? "?"} แท่ง`;
      return `แตะ POC ที่ไม่เคยถูกทดสอบ ${level?.price ?? "?"} · ${age} · เข้า${side}`;
    }
    case "speed_of_tape": {
      const side = payload.kind === "tape_burst_up" ? "ปิดบน" : "ปิดล่าง";
      const rate = `เทรด ${payload.trades} ครั้ง = ${payload.observedRatio}× ปกติ`;
      return `Tape เร่ง · ${rate} · ${side}สุดแท่ง`;
    }
    default:
      return null;
  }
}
