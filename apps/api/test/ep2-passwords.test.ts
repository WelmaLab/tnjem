import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import argon2 from "argon2";
import { rlSubject } from "../src/lib/rate-limit";
import { PASSWORD_MAIL } from "../src/lib/password-copy";
import {
  startApp, stopApp, seedProfile, login, sql, fxClientIp, fxSignupEmail, cleanupIp, type App, type Res,
} from "./support/fx";
import {
  ARGON2_OPTIONS, hashPassword, verifyPassword, issuePasswordGrant, passwordGrantValid, PASSWORD_GRANT_TTL_MS,
  PASSWORD_LOCK_MS, passwordFailKeys,
} from "../src/lib/password";

/* espace prof v2 · phase 2 — PASSWORDS, against the real routes and a real Postgres.

   Every request carries its own private client address (fxClientIp): the per-IP
   budgets live in rate_limits and are shared with every other test file running
   in parallel, and the lockout tests must not lock anyone else out. */

let app: App;
const ips: string[] = [];
const ip = () => {
  const a = fxClientIp();
  ips.push(a);
  return a;
};

const STRONG = "Le-soleil-de-Sousse-26";
const OTHER_STRONG = "Mon cartable bleu 2026!";

/** Every address a request named, so after() can drop its rate_limits rows. */
const addresses = new Set<string>();

async function req(method: "GET" | "POST", url: string, opts: { ip: string; cookie?: string; body?: unknown }): Promise<Res> {
  const named = (opts.body as { identifier?: unknown } | undefined)?.identifier;
  if (typeof named === "string") addresses.add(named.trim().toLowerCase());
  const res = await app.inject({
    method,
    url,
    payload: opts.body as Record<string, unknown> | undefined,
    headers: opts.cookie ? { cookie: opts.cookie } : {},
    remoteAddress: opts.ip,
  });
  let body: any = null;
  try {
    body = res.body ? JSON.parse(res.body) : null;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, raw: res.body };
}

const cookieOf = (r: Res) => `tnajem_session=${(r.body.session as { token: string }).token}`;

/** Request a code (dev posture: no provider → the code comes back) and return it. */
async function devCode(address: string, from: string, purpose?: "login" | "password"): Promise<string> {
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
  const r = await req("POST", "/auth/otp/request", { ip: from, body: { identifier: address, locale: "fr", ...(purpose ? { purpose } : {}) } });
  assert.equal(r.body?.ok, true, r.raw);
  return String(r.body.devCode);
}

/** Sign up through the real endpoints and set a password with the grant. */
async function signUpWithPassword(password = STRONG): Promise<{ email: string; id: string; cookie: string }> {
  const from = ip();
  const email = fxSignupEmail();
  const code = await devCode(email, from);
  const v = await req("POST", "/auth/otp/verify", { ip: from, body: { identifier: email, code, role: "tutor", birthYear: 1988, birthMonth: 3, locale: "fr" } });
  assert.equal(v.body.ok, true, v.raw);
  const cookie = cookieOf(v);
  const set = await req("POST", "/auth/password/set", { ip: from, cookie, body: { password, grant: v.body.passwordGrant } });
  assert.deepEqual(set.body, { ok: true, ended: 0 }, set.raw);
  const [p] = await sql<{ id: string }[]>`select id from profiles where email = ${email}`;
  return { email, id: p.id, cookie };
}

const passwordLogin = (identifier: string, password: string, from: string) =>
  req("POST", "/auth/password/login", { ip: from, body: { identifier, password, locale: "fr" } });

const whoAmI = async (cookie: string, from: string) => (await req("GET", "/me", { ip: from, cookie })).body as { id?: string } | null;

before(async () => {
  app = await startApp();
});

after(async () => {
  // Every per-IP key (otp:, acct:status:, pw:) ends in the address; every per-address
  // key ends in its keyed hash. The audit rows stay: admin_actions is append-only (0031).
  for (const a of ips) await cleanupIp(a);
  for (const address of addresses) await sql`delete from rate_limits where key like ${`%:${rlSubject(address)}`}`;
  await stopApp(app);
});

describe("ep2 · hashing: argon2id with OWASP parameters, never the plaintext", () => {
  test("the hash is an argon2id PHC string with m=19456, t=2, p=1", async () => {
    assert.deepEqual(ARGON2_OPTIONS, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
    const h = await hashPassword(STRONG);
    assert.match(h, /^\$argon2id\$v=19\$/);
    const params = Object.fromEntries(h.split("$")[3].split(",").map((kv) => kv.split("=")));
    assert.deepEqual(params, { m: "19456", t: "2", p: "1" });
    assert.ok(!h.includes(STRONG), "the plaintext is nowhere in the hash");
    assert.notEqual(h, await hashPassword(STRONG), "salted: the same password never hashes the same twice");
    assert.equal(await verifyPassword(h, STRONG), true);
    assert.equal(await verifyPassword(h, OTHER_STRONG), false);
  });

  test("what the database stores after sign-up is the hash — and the database refuses anything else", async () => {
    const me = await signUpWithPassword();
    const [row] = await sql<{ password_hash: string; password_set_at: Date | null }[]>`
      select password_hash, password_set_at from profiles where id = ${me.id}`;
    assert.match(row.password_hash, /^\$argon2id\$v=19\$m=19456/);
    assert.ok(!row.password_hash.includes(STRONG));
    assert.ok(row.password_set_at, "password_set_at is recorded");
    await assert.rejects(
      sql`update profiles set password_hash = ${STRONG} where id = ${me.id}`,
      (e: { code?: string }) => e.code === "23514",
      "a CHECK refuses a plaintext password at the database",
    );
  });

  test("an unknown address and a password-less account still pay for one argon2 verify", async () => {
    const plain = await seedProfile({ role: "student" });
    const original = argon2.verify;
    let verifies = 0;
    (argon2 as { verify: typeof argon2.verify }).verify = (async (...args: Parameters<typeof argon2.verify>) => {
      verifies++;
      return original(...args);
    }) as typeof argon2.verify;
    try {
      await passwordLogin(fxSignupEmail(), STRONG, ip());
      assert.equal(verifies, 1, "unknown address: one dummy verify");
      await passwordLogin(plain.email, STRONG, ip());
      assert.equal(verifies, 2, "no password on file: one dummy verify");
    } finally {
      (argon2 as { verify: typeof argon2.verify }).verify = original;
    }
  });
});

describe("ep2 · the generic answer: no oracle for existence or for having a password", () => {
  test("unknown address, account without a password and wrong password get byte-identical responses", async () => {
    const withPw = await signUpWithPassword();
    const noPw = await seedProfile({ role: "student" });
    const unknown = await passwordLogin(fxSignupEmail(), STRONG, ip());
    const noPassword = await passwordLogin(noPw.email, STRONG, ip());
    const wrong = await passwordLogin(withPw.email, OTHER_STRONG, ip());
    for (const r of [unknown, noPassword, wrong]) {
      assert.equal(r.status, 200);
      assert.equal(r.raw, unknown.raw);
    }
    assert.deepEqual(unknown.body, { ok: false, error: "invalid-credentials" });
  });

  test("the right password signs in, and the session works", async () => {
    const me = await signUpWithPassword();
    const from = ip();
    const ok = await passwordLogin(me.email, STRONG, from);
    assert.equal(ok.body.ok, true, ok.raw);
    assert.equal(ok.body.role, "tutor");
    assert.equal(ok.body.hasStorefront, false);
    assert.equal((await whoAmI(cookieOf(ok), from))?.id, me.id);
    // The address is matched case-insensitively, like the code sign-in.
    assert.equal((await passwordLogin(me.email.toUpperCase(), STRONG, ip())).body.ok, true);
  });

  test("a blocked account is told only once the password is right", async () => {
    const me = await signUpWithPassword();
    await sql`update profiles set blocked_at = now(), blocked_reason = 'test' where id = ${me.id}`;
    assert.deepEqual((await passwordLogin(me.email, OTHER_STRONG, ip())).body, { ok: false, error: "invalid-credentials" });
    assert.deepEqual((await passwordLogin(me.email, STRONG, ip())).body, { ok: false, error: "account-blocked" });
  });
});

describe("ep2 · lockout: 5 failed passwords → 15 minutes, per account AND per IP", () => {
  test("per account: after 5 failures from 5 different IPs, even the right password waits 15 minutes", async () => {
    const me = await signUpWithPassword();
    for (let i = 0; i < 5; i++) {
      assert.equal((await passwordLogin(me.email, OTHER_STRONG, ip())).body.error, "invalid-credentials", `failure ${i + 1}`);
    }
    const locked = await passwordLogin(me.email, STRONG, ip());
    assert.equal(locked.body.ok, false);
    assert.equal(locked.body.error, "too-many-attempts", locked.raw);
    assert.ok(locked.body.retryAfter > 14 * 60 && locked.body.retryAfter <= 15 * 60, `retryAfter ${locked.body.retryAfter}s ≈ 15 min`);

    const key = passwordFailKeys(me.email, "").id;
    const [row] = await sql<{ count: number; secs: number }[]>`
      select count, extract(epoch from reset_at - now())::int as secs from rate_limits where key = ${key}`;
    assert.equal(row.count, 5);
    assert.ok(row.secs > 14 * 60 && row.secs <= PASSWORD_LOCK_MS / 1000, "the lock runs 15 minutes from the 5th failure");
    assert.ok(!key.includes(me.email) && !key.includes("@"), "the key holds a keyed hash, never the address");

    // 15 minutes later (moved by hand), the right password works again — and resets the count.
    await sql`update rate_limits set reset_at = now() - interval '1 second' where key = ${key}`;
    assert.equal((await passwordLogin(me.email, STRONG, ip())).body.ok, true);
  });

  test("per IP: 5 failures on 5 different addresses lock that IP — even for an account whose password is right", async () => {
    const me = await signUpWithPassword();
    const from = ip();
    for (let i = 0; i < 5; i++) await passwordLogin(fxSignupEmail(), STRONG, from);
    const locked = await passwordLogin(me.email, STRONG, from);
    assert.equal(locked.body.error, "too-many-attempts", locked.raw);
    assert.equal((await passwordLogin(me.email, STRONG, ip())).body.ok, true, "another IP is unaffected");
  });

  test("a locked address reveals nothing: unknown and existing addresses get the same locked answer", async () => {
    const me = await signUpWithPassword();
    const ghost = fxSignupEmail();
    for (const address of [me.email, ghost]) {
      for (let i = 0; i < 5; i++) await passwordLogin(address, OTHER_STRONG, ip());
    }
    const a = await passwordLogin(me.email, OTHER_STRONG, ip());
    const b = await passwordLogin(ghost, OTHER_STRONG, ip());
    assert.equal(a.body.error, "too-many-attempts");
    assert.deepEqual(Object.keys(a.body).sort(), Object.keys(b.body).sort());
    assert.equal(a.body.error, b.body.error);
    assert.ok(Math.abs(a.body.retryAfter - b.body.retryAfter) <= 5);
  });
});

describe("ep2 · reset: a code, a new password, and EVERY session ends", () => {
  test("« Mot de passe oublié » revokes every existing session and signs this device in", async () => {
    const me = await signUpWithPassword();
    const phone = await login(me.id);
    const laptop = await login(me.id);
    const from = ip();
    assert.equal((await whoAmI(phone, from))?.id, me.id);

    const code = await devCode(me.email, from, "password");
    const res = await req("POST", "/auth/password/reset", { ip: from, body: { identifier: me.email, code, password: OTHER_STRONG, locale: "fr" } });
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.ended, 3, "the sign-up session, the phone and the laptop");
    assert.equal(await whoAmI(phone, from), null, "the phone is signed out");
    assert.equal(await whoAmI(laptop, from), null, "the laptop is signed out");
    assert.equal(await whoAmI(me.cookie, from), null, "the sign-up session is signed out");
    assert.equal((await whoAmI(cookieOf(res), from))?.id, me.id, "this device has a fresh session");

    assert.equal((await passwordLogin(me.email, STRONG, ip())).body.error, "invalid-credentials", "the old password is dead");
    assert.equal((await passwordLogin(me.email, OTHER_STRONG, ip())).body.ok, true, "the new one works");
    const [audit] = await sql<{ n: number }[]>`
      select count(*)::int n from admin_actions where action = 'account.password.reset' and subject_id = ${me.id}`;
    assert.equal(audit.n, 1, "the reset is in the audit log");
  });

  test("a weak new password is refused BEFORE the code is spent; a wrong code changes nothing", async () => {
    const me = await signUpWithPassword();
    const from = ip();
    const code = await devCode(me.email, from, "password");
    const weak = await req("POST", "/auth/password/reset", { ip: from, body: { identifier: me.email, code, password: "password2024" } });
    assert.deepEqual(weak.body, { ok: false, error: "weak-password", reason: "too-common" });
    const wrong = code === "000000" ? "111111" : "000000";
    const bad = await req("POST", "/auth/password/reset", { ip: from, body: { identifier: me.email, code: wrong, password: OTHER_STRONG } });
    assert.deepEqual(bad.body, { ok: false, error: "invalid-code" });
    const good = await req("POST", "/auth/password/reset", { ip: from, body: { identifier: me.email, code, password: OTHER_STRONG } });
    assert.equal(good.body.ok, true, "the code survived the weak password and the wrong guess");
  });

  test("a reset lifts the account's lockout: the owner proved the mailbox", async () => {
    const me = await signUpWithPassword();
    for (let i = 0; i < 5; i++) await passwordLogin(me.email, OTHER_STRONG, ip());
    assert.equal((await passwordLogin(me.email, STRONG, ip())).body.error, "too-many-attempts");
    const from = ip();
    const code = await devCode(me.email, from, "password");
    assert.equal((await req("POST", "/auth/password/reset", { ip: from, body: { identifier: me.email, code, password: OTHER_STRONG } })).body.ok, true);
    assert.equal((await passwordLogin(me.email, OTHER_STRONG, ip())).body.ok, true);
  });
});

describe("ep2 · change: the current password, and every OTHER session ends", () => {
  test("changing the password keeps this device and signs the others out", async () => {
    const me = await signUpWithPassword();
    const from = ip();
    const here = me.cookie;
    const elsewhere = await login(me.id);

    const wrong = await req("POST", "/auth/password/change", { ip: from, cookie: here, body: { currentPassword: OTHER_STRONG, newPassword: "Une autre phrase 2026" } });
    assert.deepEqual(wrong.body, { ok: false, error: "wrong-password" });
    const weak = await req("POST", "/auth/password/change", { ip: from, cookie: here, body: { currentPassword: STRONG, newPassword: "court" } });
    assert.deepEqual(weak.body, { ok: false, error: "weak-password", reason: "too-short" });
    assert.equal((await whoAmI(elsewhere, from))?.id, me.id, "nothing changed yet");

    const ok = await req("POST", "/auth/password/change", { ip: from, cookie: here, body: { currentPassword: STRONG, newPassword: OTHER_STRONG } });
    assert.deepEqual(ok.body, { ok: true, ended: 1 });
    assert.equal((await whoAmI(here, from))?.id, me.id, "this device stays signed in");
    assert.equal(await whoAmI(elsewhere, from), null, "the other device is signed out");
    assert.equal((await passwordLogin(me.email, OTHER_STRONG, ip())).body.ok, true);
    const [audit] = await sql<{ n: number }[]>`
      select count(*)::int n from admin_actions where action = 'account.password.change' and subject_id = ${me.id}`;
    assert.equal(audit.n, 1);
  });

  test("change needs a session, and an account that has a password", async () => {
    const from = ip();
    assert.deepEqual((await req("POST", "/auth/password/change", { ip: from, body: { currentPassword: STRONG, newPassword: OTHER_STRONG } })).body, { ok: false, error: "not-authenticated" });
    const noPw = await seedProfile({ role: "student" });
    const cookie = await login(noPw.id);
    assert.deepEqual((await req("POST", "/auth/password/change", { ip: from, cookie, body: { currentPassword: STRONG, newPassword: OTHER_STRONG } })).body, { ok: false, error: "no-password" });
  });
});

describe("ep2 · a first password needs fresh proof of the mailbox", () => {
  test("a session alone cannot add a password; a code to one's own address can — and the others are signed out", async () => {
    const noPw = await seedProfile({ role: "student" });
    const cookie = await login(noPw.id);
    const other = await login(noPw.id);
    const from = ip();
    assert.deepEqual((await req("POST", "/auth/password/set", { ip: from, cookie, body: { password: STRONG } })).body, { ok: false, error: "proof-required" });

    for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
    const sent = await req("POST", "/auth/password/code", { ip: from, cookie, body: { locale: "fr" } });
    assert.equal(sent.body.ok, true, sent.raw);
    const set = await req("POST", "/auth/password/set", { ip: from, cookie, body: { password: STRONG, code: sent.body.devCode } });
    assert.deepEqual(set.body, { ok: true, ended: 1 });
    assert.equal(await whoAmI(other, from), null, "the other session is signed out");
    assert.equal((await passwordLogin(noPw.email, STRONG, ip())).body.ok, true);

    assert.deepEqual((await req("POST", "/auth/password/set", { ip: from, cookie, body: { password: OTHER_STRONG, code: "123456" } })).body, { ok: false, error: "has-password" }, "a second 'first password' is refused — that is /change");
    assert.deepEqual((await req("POST", "/auth/password/code", { ip: from, cookie, body: {} })).body, { ok: false, error: "has-password" });
  });

  test("the grant is bound to its profile and expires after 30 minutes", async () => {
    const a = await seedProfile({ role: "student" });
    const b = await seedProfile({ role: "student" });
    const grantA = issuePasswordGrant(a.id);
    assert.equal(passwordGrantValid(a.id, grantA), true);
    assert.equal(passwordGrantValid(b.id, grantA), false, "another profile's grant opens nothing");
    assert.equal(passwordGrantValid(a.id, issuePasswordGrant(a.id, Date.now() - PASSWORD_GRANT_TTL_MS - 1000)), false);
    assert.equal(passwordGrantValid(a.id, `${Date.now()}.${"0".repeat(64)}`), false, "a forged MAC");

    const cookieB = await login(b.id);
    const res = await req("POST", "/auth/password/set", { ip: ip(), cookie: cookieB, body: { password: STRONG, grant: grantA } });
    assert.deepEqual(res.body, { ok: false, error: "grant-expired" });
  });
});

describe("ep2 · sign-up and the one-time prompt", () => {
  test("a new account is asked for a password; an older one without a password is offered one ONCE", async () => {
    const from = ip();
    const email = fxSignupEmail();
    const created = await req("POST", "/auth/otp/verify", { ip: from, body: { identifier: email, code: await devCode(email, from), role: "student", birthYear: 1995, birthMonth: 3 } });
    assert.equal(created.body.created, true);
    assert.equal(created.body.needsPassword, true);
    assert.equal(created.body.promptPassword, false);
    assert.match(created.body.passwordGrant, /^\d+\.[0-9a-f]{64}$/);

    // They left at the password step. Next code sign-in: offered once…
    const again = await req("POST", "/auth/otp/verify", { ip: from, body: { identifier: email, code: await devCode(email, from) } });
    assert.equal(again.body.ok, true, again.raw);
    assert.equal(again.body.promptPassword, true);
    assert.equal(again.body.needsPassword, false);
    const [p] = await sql<{ at: Date | null }[]>`select password_prompted_at as at from profiles where email = ${email}`;
    assert.ok(p.at, "the offer is remembered");

    // …and never again.
    const third = await req("POST", "/auth/otp/verify", { ip: from, body: { identifier: email, code: await devCode(email, from) } });
    assert.equal(third.body.ok, true);
    assert.equal(third.body.promptPassword, undefined);
    assert.equal(third.body.passwordGrant, undefined, "no grant once nothing is offered");
  });
});

describe("ep2 · « email already exists »: { exists, hasPassword } and nothing else, rate-limited", () => {
  test("the three states, and no other field", async () => {
    const withPw = await signUpWithPassword();
    const noPw = await seedProfile({ role: "student" });
    const status = (identifier: string) => req("POST", "/auth/account-status", { ip: ip(), body: { identifier } });
    assert.deepEqual((await status(fxSignupEmail())).body, { ok: true, exists: false, hasPassword: false });
    assert.deepEqual((await status(noPw.email)).body, { ok: true, exists: true, hasPassword: false });
    assert.deepEqual((await status(withPw.email.toUpperCase())).body, { ok: true, exists: true, hasPassword: true });
    assert.deepEqual((await status("pas-une-adresse")).body, { ok: false, error: "invalid-email" });
  });

  test("per IP: 20 per 10 minutes; per address: 10 per 10 minutes", async () => {
    const from = ip();
    for (let i = 0; i < 20; i++) {
      assert.equal((await req("POST", "/auth/account-status", { ip: from, body: { identifier: fxSignupEmail() } })).body.ok, true, `ask ${i + 1}`);
    }
    const ipLimited = await req("POST", "/auth/account-status", { ip: from, body: { identifier: fxSignupEmail() } });
    assert.equal(ipLimited.body.error, "too-many-attempts", ipLimited.raw);

    const address = fxSignupEmail();
    for (let i = 0; i < 10; i++) await req("POST", "/auth/account-status", { ip: ip(), body: { identifier: address } });
    const idLimited = await req("POST", "/auth/account-status", { ip: ip(), body: { identifier: address } });
    assert.equal(idLimited.body.error, "too-many-attempts", "a fresh IP does not reset the per-address budget");
  });
});

describe("ep2 · Zod on every input", () => {
  test("a body of the wrong shape is a 400; a refused password is a domain answer", async () => {
    const from = ip();
    const cases: [string, unknown][] = [
      ["/auth/account-status", {}],
      ["/auth/account-status", { identifier: 42 }],
      ["/auth/password/login", { identifier: "a@tnajem.invalid" }],
      ["/auth/password/login", { identifier: "a@tnajem.invalid", password: "" }],
      ["/auth/password/login", { identifier: "a@tnajem.invalid", password: ["x"] }],
      ["/auth/password/reset", { identifier: "a@tnajem.invalid", password: STRONG }],
      ["/auth/password/reset", { identifier: "a@tnajem.invalid", code: 123456, password: STRONG }],
    ];
    for (const [url, body] of cases) {
      const r = await req("POST", url, { ip: from, body });
      assert.equal(r.status, 400, `${url} ${JSON.stringify(body)} → ${r.raw}`);
    }
    const reasons: [string, string][] = [["court", "too-short"], ["1234567890", "too-common"], ["x".repeat(600), "too-long"]];
    for (const [password, reason] of reasons) {
      const r = await req("POST", "/auth/password/reset", { ip: from, body: { identifier: "a@tnajem.invalid", code: "123456", password } });
      assert.deepEqual(r.body, { ok: false, error: "weak-password", reason });
    }
  });
});

describe("ep2 · the e-mail notice after every set, change and reset", () => {
  test("it says what happened, when (Tunis), that other devices were signed out, and what to do if it was not them", () => {
    for (const event of ["set", "change", "reset"] as const) {
      const fr = PASSWORD_MAIL.fr.body(event, "01/10/2026", "14:32");
      assert.match(fr, /01\/10\/2026 à 14:32/);
      assert.match(fr, /autres appareils ont été déconnectés/);
      assert.match(fr, /« Mot de passe oublié »/);
      const ar = PASSWORD_MAIL.ar.body(event, "01/10/2026", "14:32");
      assert.match(ar, /01\/10\/2026/);
      assert.match(ar, /نسيت كلمة السرّ/);
      assert.ok(PASSWORD_MAIL.fr.subject(event).startsWith("Tnajem — "));
      assert.ok(PASSWORD_MAIL.ar.subject(event).startsWith("تنجّم — "));
    }
    assert.notEqual(PASSWORD_MAIL.fr.body("set", "d", "t"), PASSWORD_MAIL.fr.body("reset", "d", "t"), "each event says which it was");
  });
});

describe("ep2 · Réglages › Sécurité: what is stored, nothing more", () => {
  test("GET /auth/security lists live sessions with dates and a 'current' flag — no token, no IP, no device", async () => {
    const me = await signUpWithPassword();
    const second = await login(me.id);
    const from = ip();
    const r = await req("GET", "/auth/security", { ip: from, cookie: second });
    assert.equal(r.body.ok, true, r.raw);
    assert.equal(r.body.password.set, true);
    assert.ok(r.body.password.setAt);
    assert.equal(r.body.sessions.length, 2);
    assert.equal(r.body.sessions.filter((s: { current: boolean }) => s.current).length, 1);
    for (const s of r.body.sessions) {
      assert.deepEqual(Object.keys(s).sort(), ["createdAt", "current", "expiresAt", "lastSeenAt"]);
    }
    assert.ok(!r.raw.includes(second.split("=")[1]), "the token is not echoed");
    assert.deepEqual((await req("GET", "/auth/security", { ip: from })).body, { ok: false, error: "not-authenticated" });
  });
});
