import { test, expect } from "@playwright/test";
import { createTutorLookup, type TutorLookupDeps } from "../apps/web/lib/tutor-lookup";
import { clientIpFrom } from "../apps/web/lib/client-ip";

/* ════════════════════════════════════════════════════════════════════════════
   The middleware's tutor lookup, without a server: TTLs, the per-IP budget, the
   in-flight cap and the fail-open log, with an injected clock and fetch.

   Why it matters: every request to tnajem.com/<anything> that looks like a slug
   runs this. Before 15 Sept a "missing" answer was never remembered, so a crawler
   walking nonsense slugs cost one internal HTTP call and one storefront read each;
   and a failure passed silently. ADDED, never edited into an existing spec. */

type Answer = { exists: boolean } | { status: number } | "hang" | "throw";

function harness(answers: Record<string, Answer>, options = {}) {
  let now = 1_000_000;
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: TutorLookupDeps = {
    now: () => now,
    log: (line) => logs.push(line),
    fetch: (url, init) => {
      const slug = decodeURIComponent(url.split("/").pop() ?? "");
      calls.push(slug);
      const a = answers[slug] ?? { exists: false };
      if (a === "throw") return Promise.reject(new Error("ECONNREFUSED"));
      if (a === "hang") {
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
      }
      if ("status" in a) return Promise.resolve({ ok: false, json: async () => ({}) });
      return Promise.resolve({ ok: true, json: async () => a });
    },
  };
  const lookup = createTutorLookup(deps, options);
  const ctx = { ip: "198.51.100.7", origin: "http://127.0.0.1:3000" };
  return {
    ask: (slug: string, ip = ctx.ip) => lookup.lookup(slug, { ...ctx, ip }),
    advance: (ms: number) => { now += ms; },
    calls,
    logs,
    size: lookup.size,
  };
}

test.describe("tutor lookup (middleware 404 decision)", () => {
  test("an existing tutor is remembered for 30s, then asked again", async () => {
    const h = harness({ "yassine-math": { exists: true } });
    expect(await h.ask("yassine-math")).toBe("exists");
    h.advance(29_999);
    expect(await h.ask("yassine-math")).toBe("exists");
    expect(h.calls, "the second answer came from memory").toHaveLength(1);
    h.advance(2);
    await h.ask("yassine-math");
    expect(h.calls).toHaveLength(2);
  });

  test("a missing slug is remembered for only 10s — a newly approved tutor is 404'd at most that long", async () => {
    const answers: Record<string, Answer> = { "new-tutor": { exists: false } };
    const h = harness(answers);
    expect(await h.ask("new-tutor")).toBe("missing");
    expect(await h.ask("new-tutor")).toBe("missing");
    expect(h.calls, "the negative answer is cached").toHaveLength(1);

    answers["new-tutor"] = { exists: true }; // an admin approves the tutor
    h.advance(9_999);
    expect(await h.ask("new-tutor"), "still inside the negative TTL").toBe("missing");
    h.advance(2);
    expect(await h.ask("new-tutor"), "after 10s the truth wins").toBe("exists");
  });

  test("each IP has a budget; over it the request passes through (unknown) instead of being refused", async () => {
    const h = harness({}, { bucketCapacity: 3, bucketRefillMs: 3_000 });
    for (const s of ["aaa-1", "aaa-2", "aaa-3"]) expect(await h.ask(s)).toBe("missing");
    expect(await h.ask("aaa-4"), "the 4th distinct slug from one IP").toBe("unknown");
    expect(h.calls).toHaveLength(3);

    expect(await h.ask("aaa-4", "203.0.113.50"), "another IP has its own budget").toBe("missing");
    expect(await h.ask("aaa-1"), "a remembered answer costs no budget").toBe("missing");

    h.advance(3_000);
    expect(await h.ask("aaa-5"), "one token back after the refill interval").toBe("missing");
    expect(await h.ask("aaa-6")).toBe("unknown");
  });

  test("no more than N lookups in flight at once", async () => {
    const h = harness({ "slow-1": "hang", "slow-2": "hang" }, { maxInFlight: 2, timeoutMs: 200 });
    const pending = [h.ask("slow-1"), h.ask("slow-2")];
    expect(await h.ask("slow-3"), "the third concurrent lookup is not started").toBe("unknown");
    expect(h.calls).toEqual(["slow-1", "slow-2"]);
    expect(await Promise.all(pending), "hung lookups time out and fail open").toEqual(["unknown", "unknown"]);
    expect(h.size().inFlight).toBe(0);
  });

  test("failures fail open, are not remembered, and are logged once per interval without the slug or the IP", async () => {
    const answers: Record<string, Answer> = { "flaky-slug": { status: 503 } };
    const h = harness(answers, { logIntervalMs: 60_000 });
    expect(await h.ask("flaky-slug")).toBe("unknown");
    expect(await h.ask("flaky-slug")).toBe("unknown");
    expect(h.calls, "a failure is never cached").toHaveLength(2);
    expect(h.logs, "the second http_error within a minute is suppressed").toHaveLength(1);

    const first = JSON.parse(h.logs[0]);
    expect(first).toMatchObject({ level: "warn", event: "tutor_lookup_fail_open", reason: "http_error", suppressed: 0 });
    expect(Object.keys(first).sort()).toEqual(["at", "event", "level", "reason", "suppressed"]);
    expect(h.logs[0]).not.toContain("flaky-slug");
    expect(h.logs[0]).not.toContain("198.51.100.7");

    answers["flaky-slug"] = "throw";
    expect(await h.ask("flaky-slug")).toBe("unknown");
    expect(JSON.parse(h.logs[1]).reason, "a different reason logs on its own").toBe("network");

    answers["flaky-slug"] = { status: 500 };
    h.advance(60_000);
    await h.ask("flaky-slug");
    expect(JSON.parse(h.logs[2]), "the next line counts what was suppressed").toMatchObject({ reason: "http_error", suppressed: 1 });
  });

  test("the answer cache is bounded: the oldest slug is evicted first", async () => {
    const h = harness({}, { maxEntries: 2 });
    await h.ask("one-slug");
    await h.ask("two-slug");
    await h.ask("three-slug");
    expect(h.size().answers).toBe(2);
    await h.ask("two-slug");
    expect(h.calls, "two-slug is still remembered").toHaveLength(3);
    await h.ask("one-slug");
    expect(h.calls, "one-slug was evicted and asked again").toHaveLength(4);
  });
});

test.describe("client IP (rate-limit key)", () => {
  const bag = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });

  test("X-Real-IP from the proxy wins", () => {
    expect(clientIpFrom(bag({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  test("otherwise the RIGHTMOST X-Forwarded-For hop — never the one the client wrote", () => {
    expect(clientIpFrom(bag({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIpFrom(bag({ "x-forwarded-for": " 203.0.113.9 " }))).toBe("203.0.113.9");
  });

  test("no proxy headers → empty, not a guess", () => {
    expect(clientIpFrom(bag({}))).toBe("");
  });
});
