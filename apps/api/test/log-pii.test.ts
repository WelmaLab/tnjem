import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq, inArray, like, or, profiles, rateLimits } from "@tnajem/db";
import { buildServer } from "../src/server";
import { db } from "../src/db";

/* security: no personal data reaches a log line.

   The rule (lib/logging.ts): a session token, an OTP, a document path, an e-mail
   address and a phone number never reach a log. This drives the flows most likely
   to break it — login, a wrong code, a throttled identity, profile writes with a
   phone number, the unique-phone conflict that used to 500 with the number in the
   error, an admin looking an account up by address, a deletion request — while
   capturing EVERY line the API writes: pino's stream and console.*. Then it looks
   for any e-mail address or phone number at all, not only the ones it sent. */

const run = randomBytes(4).toString("hex");
const ADMIN = `pii-admin-${run}@tnajem.invalid`;
const STUDENT = `pii-student-${run}@tnajem.invalid`;
const OTHER = `pii-other-${run}@tnajem.invalid`;
// Numbers that are unmistakably this test's, in the format the app stores.
const PHONE = `+2169${String(Date.now()).slice(-7)}`;
// espace prof v2 · phase 2: passwords that are unmistakably this test's.
const PW_1 = `Pii-premier-${run}-mot`;
const PW_2 = `Pii-second-${run}-mot`;
const PW_3 = `Pii-troisieme-${run}-mot`;

const lines: string[] = [];
const consoleOriginals = { log: console.log, warn: console.warn, error: console.error, info: console.info };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// +216 followed by 8 digits (spaces allowed), or a bare 8-digit Tunisian mobile/landline.
const PHONE_RE = /(\+?216[\s.-]?\d{2}[\s.-]?\d{3}[\s.-]?\d{3})|(?<![\w-])[2-9]\d{7}(?![\w-])/;

function scrubbedForScan(line: string): string {
  // Decoded first: an address in a logged URL arrives as %40.
  let decoded = line;
  try {
    decoded = decodeURIComponent(line);
  } catch {
    /* not URI-encoded */
  }
  // UUIDs, hex tokens and ISO timestamps contain digit runs that are not phone numbers.
  return decoded
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, "<time>")
    .replace(/"time":\d+/g, '"time":0')
    .replace(/"responseTime":[\d.]+/g, '"responseTime":0');
}

let app: Awaited<ReturnType<typeof buildServer>>;
const cookieJar = new Map<string, string>();

async function call(method: "GET" | "POST", url: string, who: string | null, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    headers: who && cookieJar.has(who) ? { cookie: `tnajem_session=${cookieJar.get(who)}` } : {},
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null };
}

async function login(address: string, role: "student" | "tutor" | undefined, birthYear?: number) {
  const req = await call("POST", "/auth/otp/request", null, { identifier: address, locale: "fr" });
  assert.equal(req.body?.ok, true, `otp request failed: ${JSON.stringify(req.body)}`);
  const code = String(req.body?.devCode);
  const wrong = code === "000000" ? "111111" : "000000";
  // phase-a lane L2 (A24): sign-up needs a birth month as well as the year.
  const birthMonth = birthYear ? 1 : undefined;
  await call("POST", "/auth/otp/verify", null, { identifier: address, code: wrong, role, birthYear, birthMonth });
  const ok = await call("POST", "/auth/otp/verify", null, { identifier: address, code, role, birthYear, birthMonth });
  const session = ok.body?.session as { token: string } | undefined;
  assert.ok(session?.token, `verify failed: ${JSON.stringify(ok.body)}`);
  cookieJar.set(address, session.token);
}

before(async () => {
  // inject() always comes from 127.0.0.1: start from a fresh per-IP OTP budget.
  await db.delete(rateLimits).where(or(like(rateLimits.key, "otp:vfy:ip:127.0.0.1"), like(rateLimits.key, "otp:req:ip:127.0.0.1")));
  // espace prof v2 · phase 2: the password and account-status budgets of the same address.
  await db.delete(rateLimits).where(or(like(rateLimits.key, "pw:%:ip:127.0.0.1"), like(rateLimits.key, "acct:status:ip:127.0.0.1")));
  process.env.ADMIN_EMAILS = ADMIN;
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
  const capture = (level: string) => (...args: unknown[]) => {
    lines.push(`console.${level} ${args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  };
  console.log = capture("log");
  console.warn = capture("warn");
  console.error = capture("error");
  console.info = capture("info");
  app = await buildServer({ logStream: { write: (line: string) => void lines.push(line) } });
});

after(async () => {
  Object.assign(console, consoleOriginals);
  await app.close();
  await db.delete(profiles).where(inArray(profiles.email, [ADMIN, STUDENT, OTHER]));
});

describe("security: no personal data reaches a log line", () => {
  test("login, profile writes, conflicts, throttling, admin lookup and deletion log no address or number", async () => {
    await login(STUDENT, "student", 1995);
    await login(OTHER, "student", 1996);
    await login(ADMIN, "tutor", 1985); // phase-a lane L2 (A14): /signup/prof asks an age now

    // Profile writes carrying a phone number, then the unique-phone conflict.
    assert.equal((await call("POST", "/profile/student", STUDENT, { fullName: "Pii Student", phone: PHONE })).body?.ok, true);
    const conflict = await call("POST", "/profile/student", OTHER, { fullName: "Pii Other", phone: PHONE });
    assert.equal(conflict.status, 200, "a taken number is an answer, not a 500");
    assert.deepEqual(conflict.body, { ok: false, error: "phone-unavailable" });

    // The admin looks the student up by address (a body, never a query string).
    const found = await call("POST", "/admin/accounts/find", ADMIN, { email: STUDENT });
    assert.equal((found.body?.account as { email?: string } | undefined)?.email, STUDENT);

    // A throttled identity: wrong codes until the budget is spent.
    await call("POST", "/auth/otp/request", null, { identifier: OTHER, locale: "fr" });
    let last: Record<string, unknown> | null = null;
    for (let i = 0; i < 12; i++) {
      last = (await call("POST", "/auth/otp/verify", null, { identifier: OTHER, code: "999999" })).body;
    }
    assert.equal(last?.error, "too-many-attempts");

    /* espace prof v2 · phase 2 — passwords: create one with a code, sign in right and
       wrong, change it, reset it. None of the three may appear in any line. */
    const code = String((await call("POST", "/auth/password/code", STUDENT, { locale: "fr" })).body?.devCode);
    assert.equal((await call("POST", "/auth/password/set", STUDENT, { password: PW_1, code })).body?.ok, true);
    assert.equal((await call("POST", "/auth/password/login", null, { identifier: STUDENT, password: PW_2 })).body?.error, "invalid-credentials");
    assert.equal((await call("POST", "/auth/password/login", null, { identifier: STUDENT, password: PW_1 })).body?.ok, true);
    assert.equal((await call("POST", "/auth/password/change", STUDENT, { currentPassword: PW_1, newPassword: PW_2 })).body?.ok, true);
    const resetCode = String((await call("POST", "/auth/otp/request", null, { identifier: STUDENT, locale: "fr", purpose: "password" })).body?.devCode);
    assert.equal((await call("POST", "/auth/password/reset", null, { identifier: STUDENT, code: resetCode, password: PW_3 })).body?.ok, true);
    await call("POST", "/auth/account-status", null, { identifier: STUDENT });
    // The reset ended every session; sign back in for the deletion request below.
    const back = await call("POST", "/auth/password/login", null, { identifier: STUDENT, password: PW_3 });
    cookieJar.set(STUDENT, (back.body?.session as { token: string }).token);

    // A deletion request, a malformed body and an unknown route.
    await call("POST", "/account/delete", STUDENT, {});
    await app.inject({ method: "POST", url: "/auth/otp/verify", payload: "{not json", headers: { "content-type": "application/json" } });
    await call("GET", "/nope", null);

    const [row] = await db.select({ phone: profiles.phone }).from(profiles).where(eq(profiles.email, STUDENT));
    assert.equal(row.phone, PHONE, "the flows really ran against the database");

    assert.ok(lines.length > 20, `expected a real log to scan, got ${lines.length} lines`);
    // The scanner itself must see what it is looking for.
    assert.ok(EMAIL_RE.test(STUDENT) && PHONE_RE.test(PHONE) && PHONE_RE.test(`tel ${PHONE.slice(4)}`), "the patterns match the test values");
    assert.ok(lines.some((l) => l.includes("\"url\"") || l.includes("incoming request") || l.includes("request completed")), "request logs were captured");
    const leaks = lines.filter((l) => EMAIL_RE.test(scrubbedForScan(l)) || PHONE_RE.test(scrubbedForScan(l)));
    assert.deepEqual(leaks, [], `personal data in ${leaks.length} log line(s)`);
    for (const secret of [STUDENT, OTHER, ADMIN, PHONE, PHONE.slice(4)]) {
      assert.ok(!lines.some((l) => l.includes(secret) || l.includes(encodeURIComponent(secret))), "no line may contain the test's own address or number");
    }
    // espace prof v2 · phase 2: nor a password, nor its argon2 hash.
    for (const secret of [PW_1, PW_2, PW_3, "$argon2id$"]) {
      assert.ok(!lines.some((l) => l.includes(secret) || l.includes(encodeURIComponent(secret))), "no line may contain a password or a password hash");
    }
  });
});
