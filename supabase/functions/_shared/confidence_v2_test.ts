import { assertEquals } from "jsr:@std/assert@1";
import { collectConfidenceV2 } from "./confidence_v2.ts";
import type { BarInput, HistoryBar } from "./types.ts";

const bar: BarInput = {
  openedAt: "2026-09-01T00:00:00.000Z",
  open: 100,
  high: 110,
  low: 90,
  close: 108,
  volume: 300,
  askVolume: 180,
  bidVolume: 120,
  delta: 60,
  minDelta: -20,
  maxDelta: 75,
  ticks: 30,
  trades: 0,
  isClosed: true,
  levels: [],
};

const history: HistoryBar[] = [
  {
    openedAt: "2026-08-31T23:50:00.000Z",
    open: 98,
    high: 104,
    low: 96,
    close: 101,
    volume: 100,
    delta: 10,
    ticks: 10,
    pocPrice: 100,
  },
  {
    openedAt: "2026-08-31T23:55:00.000Z",
    open: 101,
    high: 106,
    low: 98,
    close: 102,
    volume: 200,
    delta: -5,
    ticks: 20,
    pocPrice: 101,
  },
];

Deno.test("confidence v2 freezes whitelisted signal-time features without a score", () => {
  const snapshot = collectConfidenceV2(
    "speed_of_tape",
    { bar, history },
    {
      confidence: 0.65,
      payload: {
        observedRatio: 2.5,
        closeShare: 0.9,
        tradeSizeRatio: 1.2,
        trades: 30,
        ignoredFutureOutcome: 99,
      },
    },
    {
      structure: "up",
      bos: "bullish",
      choch: false,
      sweep: "high",
      rangePosition: 0.9,
      zone: "premium",
      swingHigh: 110,
      swingLow: 90,
    },
  );

  assertEquals(snapshot.mode, "shadow");
  assertEquals(snapshot.score, null);
  assertEquals(snapshot.scoreReason, "no_calibrated_model");
  assertEquals(snapshot.features.shared.volumeRatioToHistoryMedian, 2);
  assertEquals(snapshot.features.shared.tickRatioToHistoryMedian, 2);
  assertEquals(snapshot.features.shared.closeLocation, 0.9);
  assertEquals(snapshot.features.shared.priceActionSweep, "high");
  assertEquals(snapshot.features.rule, {
    observedRatio: 2.5,
    closeShare: 0.9,
    tradeSizeRatio: 1.2,
    trades: 30,
  });
});
