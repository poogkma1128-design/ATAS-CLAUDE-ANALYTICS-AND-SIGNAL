import { assertEquals } from "jsr:@std/assert@1";
import { mapChartAnnotations, parseChartAnnotationRequest } from "./chart_annotations.ts";

Deno.test("chart annotations: validates a bounded, chart-scoped request", () => {
  assertEquals(
    parseChartAnnotationRequest(
      new URL("https://example.test?symbol=MNQU6&timeframe=5m&limit=100"),
    ),
    { symbol: "MNQU6", timeframe: "5m", since: null, limit: 100 },
  );
  assertEquals(
    parseChartAnnotationRequest(
      new URL("https://example.test?symbol=MNQ%20U6&timeframe=5m"),
    ),
    "invalid symbol",
  );
  assertEquals(
    parseChartAnnotationRequest(
      new URL("https://example.test?symbol=MNQU6&timeframe=5m&limit=201"),
    ),
    "limit must be an integer from 1 to 200",
  );
});

Deno.test("chart annotations: carries the entry and resolved exit bars", () => {
  const annotations = mapChartAnnotations([{
    id: "signal-1",
    seq: 42,
    rule_key: "poc_shift",
    direction: "long",
    entry_price: "100",
    stop_price: "95",
    target_price: "110",
    entry_bar: { opened_at: "2026-09-01T10:00:00.000Z" },
    outcome: [{
      status: "resolved",
      exit_price: "110",
      exit_reason: "target",
      exit_bar: { opened_at: "2026-09-01T10:10:00.000Z" },
    }],
  }]);

  assertEquals(annotations, [{
    id: "signal-1",
    seq: 42,
    ruleKey: "poc_shift",
    direction: "long",
    entryOpenedAt: "2026-09-01T10:00:00.000Z",
    entry: 100,
    stop: 95,
    target: 110,
    status: "resolved",
    exitOpenedAt: "2026-09-01T10:10:00.000Z",
    exitPrice: 110,
    exitReason: "target",
  }]);
});
