import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  formatOutcome,
  formatSignal,
  type OutcomeMessage,
  type SignalMessage,
} from "./telegram.ts";

function signal(overrides: Partial<SignalMessage> = {}): SignalMessage {
  return {
    signalId: "b3f1c2d4-0000-4000-8000-000000000000",
    seq: 226,
    ruleName: "Absorption at Level",
    ruleKey: "absorption",
    direction: "long",
    symbol: "BTCUSDT",
    timeframe: "5m",
    price: 77570.1,
    confidence: 0.75,
    firedAt: "2026-08-29T12:15:01.000Z",
    evidence: null,
    plan: {
      entry: 77570.1,
      stop: 77540.1,
      target: 77630.1,
      riskTicks: 100,
      rewardTicks: 200,
      trailTriggerTicks: 100,
      trailOffsetTicks: 50,
      holdBars: 10,
    },
    ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeMessage> = {}): OutcomeMessage {
  return {
    seq: 226,
    replyToMessageId: 226,
    pnlTicks: 200,
    mfeTicks: 203,
    maeTicks: 0,
    barsUsed: 1,
    exitReason: "target",
    priceStep: 0.3,
    riskTicks: 100,
    ...overrides,
  };
}

Deno.test("telegram: the alert is stamped in Bangkok time", () => {
  // 12:15 UTC is 19:15 where this is read. Nothing in the message says UTC any
  // more, so the label has to be the local one or it is simply wrong.
  const text = formatSignal(signal());

  assertStringIncludes(text, "2026-08-29 19:15:01 น. (ไทย)");
  assertEquals(text.includes("UTC"), false);
});

Deno.test("telegram: the Bangkok stamp rolls the date over", () => {
  const text = formatSignal(signal({ firedAt: "2026-08-29T18:30:00.000Z" }));

  assertStringIncludes(text, "2026-08-30 01:30:00 น. (ไทย)");
});

Deno.test("telegram: the alert leads with its number", () => {
  assertStringIncludes(formatSignal(signal()), "<b>#S226</b>");
});

Deno.test("telegram: the result carries the same number as its alert", () => {
  // The whole point: a reply rendered under a later alert still says which
  // trade it settled.
  assertStringIncludes(formatOutcome(outcome()), "<b>#S226</b>");
});

Deno.test("telegram: the result is stated in price and R, as the alert was", () => {
  // The alert promised "TP 77630.1 (ได้ 60)". Reporting "+200 ticks" describes
  // that same trade in a unit the alert never used.
  const text = formatOutcome(outcome());

  assertStringIncludes(text, "+60 (+2R)");
  assertStringIncludes(text, "ไปได้ไกลสุด +60.9");
  assertEquals(text.includes("ticks"), false);
});

Deno.test("telegram: a loss keeps its sign", () => {
  const text = formatOutcome(outcome({ pnlTicks: -100, exitReason: "stop" }));

  assertStringIncludes(text, "❌");
  assertStringIncludes(text, "-30 (-1R)");
});

Deno.test("telegram: without a plan step the result falls back to ticks", () => {
  // Better a unit that is stated than a price silently computed from nothing.
  const text = formatOutcome(outcome({ priceStep: null, riskTicks: null }));

  assertStringIncludes(text, "+200 ticks");
});

Deno.test("telegram: an unnumbered signal still renders", () => {
  // Signals written before the sequence existed, and the null path generally.
  assertEquals(formatSignal(signal({ seq: null })).includes("#S"), false);
  assertEquals(formatOutcome(outcome({ seq: null })).includes("#S"), false);
});
