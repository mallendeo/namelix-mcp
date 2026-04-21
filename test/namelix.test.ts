import { describe, expect, test } from "bun:test";
import { type FetchLike, NamelixClient } from "../src/namelix.ts";

interface CapturedCall {
  url: string;
  body: URLSearchParams;
}

function makeFetchStub(responses: Array<string | unknown>): {
  fetchFn: FetchLike;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  let i = 0;
  const fetchFn: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : String(input);
    const body = new URLSearchParams(String(init?.body ?? ""));
    calls.push({ url, body });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    const text = typeof next === "string" ? next : JSON.stringify(next);
    return new Response(text, { status: 200 });
  };
  return { fetchFn, calls };
}

const SAMPLE_ITEM = {
  businessName: "Caffe Grove",
  description: "Caffé Grove - where mornings begin",
  hasDomain: true,
  domains: "com,io",
};

describe("NamelixClient.generate", () => {
  test("encodes all expected namelix params", async () => {
    const { fetchFn, calls } = makeFetchStub([[SAMPLE_ITEM]]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    await client.generate({
      keywords: "coffee shop",
      description: "ethical roasters",
      style: "brandable",
      maxLength: 20,
      randomness: "high",
      count: 3,
      requireDomain: true,
      tlds: ["com", "io"],
      avoid: ["Starbucks"],
    });

    expect(calls).toHaveLength(1);
    const body = calls[0]!.body;
    expect(body.get("keywords")).toBe("coffee shop");
    expect(body.get("description")).toBe("ethical roasters");
    expect(body.get("style")).toBe("1");
    expect(body.get("max_length")).toBe("20");
    expect(body.get("random")).toBe("2");
    expect(body.get("extensions")).toBe("com,io");
    expect(body.get("require_domains")).toBe("true");
    expect(body.get("prev_names")).toBe("Starbucks");
    expect(body.get("num")).toBe("5");
    expect(body.get("page")).toBe("0");
  });

  test("retries while namelix returns []", async () => {
    const { fetchFn, calls } = makeFetchStub([[], [], [SAMPLE_ITEM]]);
    const client = new NamelixClient({
      fetchFn,
      maxRetries: 5,
      retryDelayMs: 0,
      sleep: async () => {},
    });

    const result = await client.generate({ keywords: "tea", count: 1 });

    expect(calls).toHaveLength(3);
    expect(result.names).toHaveLength(1);
    expect(result.names[0]!.name).toBe("Caffe Grove");
  });

  test("returns note when all retries return []", async () => {
    const { fetchFn, calls } = makeFetchStub([[]]);
    const client = new NamelixClient({
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 0,
      sleep: async () => {},
    });

    const result = await client.generate({ keywords: "tea" });

    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(result.names).toEqual([]);
    expect(result.note).toBeDefined();
  });

  test("makes multiple internal calls to satisfy count and accumulates prev_names", async () => {
    const batch1 = [
      { ...SAMPLE_ITEM, businessName: "A1", description: "a1" },
      { ...SAMPLE_ITEM, businessName: "A2", description: "a2" },
      { ...SAMPLE_ITEM, businessName: "A3", description: "a3" },
      { ...SAMPLE_ITEM, businessName: "A4", description: "a4" },
      { ...SAMPLE_ITEM, businessName: "A5", description: "a5" },
    ];
    const batch2 = [
      { ...SAMPLE_ITEM, businessName: "B1", description: "b1" },
      { ...SAMPLE_ITEM, businessName: "B2", description: "b2" },
    ];
    const { fetchFn, calls } = makeFetchStub([batch1, batch2]);
    const client = new NamelixClient({
      fetchFn,
      maxRetries: 0,
      retryDelayMs: 0,
      sleep: async () => {},
    });

    const result = await client.generate({ keywords: "x", count: 7 });

    expect(calls).toHaveLength(2);
    expect(result.names.map((n) => n.name)).toEqual([
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "B1",
      "B2",
    ]);
    const secondPrev = calls[1]!.body.get("prev_names")!.split("|");
    expect(secondPrev).toContain("A1");
    expect(secondPrev).toContain("A5");
    expect(calls[0]!.body.get("page")).toBe("0");
    expect(calls[1]!.body.get("page")).toBe("1");
  });

  test("dedupes results by name case-insensitively", async () => {
    const dup = [
      { ...SAMPLE_ITEM, businessName: "Java Joy" },
      { ...SAMPLE_ITEM, businessName: "java joy" },
      { ...SAMPLE_ITEM, businessName: "Bean Dwell" },
    ];
    const { fetchFn } = makeFetchStub([dup]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    const result = await client.generate({ keywords: "x", count: 10 });

    expect(result.names.map((n) => n.name)).toEqual(["Java Joy", "Bean Dwell"]);
  });

  test("parses domains field into array", async () => {
    const items = [
      { ...SAMPLE_ITEM, businessName: "X", domains: "com, io , ai" },
      { ...SAMPLE_ITEM, businessName: "Y", domains: "" },
    ];
    const { fetchFn } = makeFetchStub([items]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    const result = await client.generate({ keywords: "x", count: 5 });

    expect(result.names[0]!.domainsAvailable).toEqual(["com", "io", "ai"]);
    expect(result.names[1]!.domainsAvailable).toEqual([]);
  });

  test("throws on non-200", async () => {
    const fetchFn: FetchLike = async () =>
      new Response("nope", { status: 500, statusText: "err" });
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    await expect(client.generate({ keywords: "x" })).rejects.toThrow(
      /HTTP 500/,
    );
  });

  test("throws on non-array response", async () => {
    const { fetchFn } = makeFetchStub([{ not: "an array" }]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    await expect(client.generate({ keywords: "x" })).rejects.toThrow(
      /not an array/,
    );
  });

  test("clamps count to [1, 25]", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...SAMPLE_ITEM,
      businessName: `N${i}`,
    }));
    const { fetchFn, calls } = makeFetchStub([many, many, many, many, many]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    const big = await client.generate({ keywords: "x", count: 9999 });
    expect(calls.length).toBeLessThanOrEqual(5);
    expect(big.names.length).toBeLessThanOrEqual(25);
  });

  test("defaults tlds to ['com']", async () => {
    const { fetchFn, calls } = makeFetchStub([[SAMPLE_ITEM]]);
    const client = new NamelixClient({ fetchFn, maxRetries: 0 });

    await client.generate({ keywords: "x" });

    expect(calls[0]!.body.get("extensions")).toBe("com");
  });
});
