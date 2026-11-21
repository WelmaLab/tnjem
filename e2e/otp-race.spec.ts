import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { email, seedProfile } from "./support/seed";
import { recoverOtp, resetRateLimits } from "./support/otp";

/* ════════════════════════════════════════════════════════════════════════════
   One code, one winner, five guesses — under concurrency, not just in sequence.

   Measured on 15 Sept against the old read-then-write verifyOtpCode:
     • parallel CORRECT verifies all succeeded — one code, several sessions — and a
       first-time signup inserted the profile twice and answered HTTP 500;
     • parallel WRONG guesses all passed "attempts < 5" before any increment
       landed, so a burst was not bound by the 5-guess budget.

   Talks to the API directly: the race is in the API, and the browser would
   serialise the requests. ADDED, never edited into an existing spec. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const newAddress = () => email(`e2e-otprace-${randomBytes(4).toString("hex")}`);
const request = (identifier: string) => post("/auth/otp/request", { identifier, locale: "fr" });
const verify = (identifier: string, code: string, extra: Record<string, unknown> = {}) =>
  post("/auth/otp/verify", { identifier, code, locale: "fr", ...extra });

test.describe("OTP under concurrency", () => {
  test.beforeEach(async () => {
    await resetRateLimits(); // the limiter is Postgres-backed and outlives runs
  });

  test("two rapid requests for one address leave exactly one live code", async () => {
    const id = newAddress();
    const [a, b] = await Promise.all([request(id), request(id)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const outcomes = [a.json, b.json].map((j) => (j.ok ? "sent" : String(j.error))).sort();
    expect(outcomes, "one is sent, the other is told to wait").toEqual(["sent", "too-soon"]);

    const [row] = await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${id}`;
    expect(row.n).toBe(1);

    const again = await request(id);
    expect(again.json).toMatchObject({ ok: false, error: "too-soon" });
    expect(Number(again.json.retryAfter)).toBeGreaterThan(0);
  });

  test("five parallel correct verifies on a signup: one account, one session, no 500", async () => {
    const id = newAddress();
    expect((await request(id)).json.ok).toBe(true);
    const code = await recoverOtp(id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => verify(id, code, { role: "student", birthYear: 1995, birthMonth: 3 /* phase-a lane L2 (A24) */ })),
    );
    expect(results.map((r) => r.status), "no request may crash").toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => r.json.ok === true), "exactly one caller consumes the code").toHaveLength(1);
    /* VULN-001 follow-up: these callers hold no trusted-browser token, so past the 3rd
       concurrent attempt the strict identity-wide delay may tell one to wait instead.
       Either answer refuses; only the one consumer signs in. */
    for (const r of results.filter((x) => x.json.ok !== true)) expect(["invalid-code", "too-many-attempts"]).toContain(r.json.error);

    const profiles = await sql<{ id: string }[]>`select id from profiles where email = ${id}`;
    expect(profiles).toHaveLength(1);
    const [s] = await sql<{ n: number }[]>`select count(*)::int n from sessions where profile_id = ${profiles[0].id}`;
    expect(s.n, "one code, one session").toBe(1);
    const [left] = await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${id}`;
    expect(left.n, "the code is gone").toBe(0);
  });

  test("an existing account: parallel correct verifies still mint one session", async () => {
    const me = await seedProfile({ role: "student", birthYear: 1990 });
    expect((await request(me.email)).json.ok).toBe(true);
    const code = await recoverOtp(me.email);

    const results = await Promise.all(Array.from({ length: 4 }, () => verify(me.email, code)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((r) => r.json.ok === true)).toHaveLength(1);
    const [s] = await sql<{ n: number }[]>`select count(*)::int n from sessions where profile_id = ${me.id}`;
    expect(s.n).toBe(1);
  });

  test("eight parallel wrong guesses spend at most five attempts — then even the right code is refused", async () => {
    const id = newAddress();
    expect((await request(id)).json.ok).toBe(true);
    const code = await recoverOtp(id);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

    /* VULN-001: past 5 failures for one address its progressive delay (≤ 60 s) holds a
       network that has already failed, so a request that lands after six failures were
       recorded may be told to wait instead. Either answer refuses; neither signs in.
       VULN-001 follow-up: these requests carry no trusted-browser token, so the strict
       identity-wide delay lets only 3 of a burst through before every other one waits.
       So the burst is repeated, the waits elapsing in between (resetRateLimits), until
       the code's own budget is spent: it must never exceed five, whatever the bursts. */
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all(Array.from({ length: 8 }, () => verify(id, wrong, { role: "student", birthYear: 1995, birthMonth: 3 /* phase-a lane L2 (A24) */ })));
      expect(results.every((r) => r.status === 200 && ["invalid-code", "too-many-attempts"].includes(String(r.json.error)))).toBe(true);
      await resetRateLimits();
    }

    const [row] = await sql<{ attempts: number }[]>`select attempts from otp_codes where identifier = ${id}`;
    expect(row.attempts, "the budget binds a burst").toBe(5);

    const late = await verify(id, code, { role: "student", birthYear: 1995, birthMonth: 3 /* phase-a lane L2 (A24) */ });
    expect(late.json, "a code whose budget is spent is dead, even the right one").toMatchObject({ ok: false, error: "invalid-code" });
    const [p] = await sql<{ n: number }[]>`select count(*)::int n from profiles where email = ${id}`;
    expect(p.n).toBe(0);
  });
});
