import { CONTRACT_VERSION, contractFor, GC_MARKET_TICK_SIZE } from "./gc_sweep_v1.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (Object.is(actual, expected)) return;
  throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertStringIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`expected ${actual} to include ${expected}`);
  }
}

function assertThrows(fn: () => unknown, expected: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && error.message.includes(expected)) return;
    throw error;
  }
  throw new Error(`expected function to throw ${expected}`);
}

Deno.test("GC sweep reads the curated market tick from params", () => {
  const contract = contractFor({ marketTickSize: 0.25 });

  assertEquals(contract.marketTickSize, 0.25);
  assertStringIncludes(contract.version, "marketTickSize=0.25");
});

Deno.test("GC sweep keeps the frozen exchange tick as its default", () => {
  const contract = contractFor({});

  assertEquals(contract.marketTickSize, GC_MARKET_TICK_SIZE);
  assertEquals(contract.version, CONTRACT_VERSION);
});

Deno.test("GC sweep refuses a non-positive market tick", () => {
  assertThrows(() => contractFor({ marketTickSize: 0 }), "marketTickSize");
});
