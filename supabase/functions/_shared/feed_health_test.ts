import { assertEquals } from "jsr:@std/assert@1";
import { bangkokStamp, describeQuiet } from "./feed_health.ts";

Deno.test("feed alert: the stamp is Bangkok time, not UTC", () => {
  // 03:05 UTC is 10:05 in Bangkok on the same day.
  assertEquals(bangkokStamp("2026-08-30T03:05:00Z"), "30 ส.ค. 10:05 น.");
});

Deno.test("feed alert: the Bangkok stamp rolls the date over", () => {
  // 19:30 UTC is 02:30 the next morning in Bangkok.
  assertEquals(bangkokStamp("2026-08-29T19:30:00Z"), "30 ส.ค. 02:30 น.");
});

Deno.test("feed alert: a chart that never posted says so", () => {
  assertEquals(bangkokStamp(null), "ยังไม่เคยมี");
});

Deno.test("feed alert: silence is stated in the unit a person would use", () => {
  assertEquals(describeQuiet(35), "เงียบมา 35 นาที");
  assertEquals(describeQuiet(8 * 60), "เงียบมา 8 ชั่วโมง");
  assertEquals(describeQuiet(50 * 60), "เงียบมา 2 วัน 2 ชั่วโมง");
  assertEquals(describeQuiet(null), "ไม่เคยส่งเข้ามาเลย");
});
