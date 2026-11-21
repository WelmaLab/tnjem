import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { rlSubject } from "../src/lib/rate-limit";
import { hashPassword } from "../src/lib/password";
import { issueTrustedToken, trustedSubject, TRUSTED_TOKEN_TTL_MS } from "../src/lib/trusted-browser";
import { startApp, stopApp, seedProfile, sql, fxClientIp, fxSignupEmail, cleanupIp, login, type App, type Res } from "./support/fx";

/* VULN-001 (follow-up) — trusted browsers keep the lenient delay; everyone else
   gets a strict one (security audit, Nov 2026).

   eb3d5df replaced the per-address lock with a short delay (≤ 60 s) that only held
   networks which had already failed. With unlimited IPs that left ~7,200 code
   guesses a day per address (5 per code, a code a minute). The founder's rules:

     1. a code is dead after 5 wrong attempts, sign-in and reset together;
     2. code REQUESTS stay limited per address and per IP;
     3. a successful sign-in (code, password, reset) gives the browser a signed
        « trusted browser » token, bound to that account, with an expiry;
     4. a browser presenting a valid token for the address keeps the lenient path;
        every other attempt on the address — whatever its IP — counts towards a
        STRICT identity-wide delay: after 3 failures in 24 h, 60 s doubling to a
        15-minute cap. Still a delay, never a lock.

   Every request has its own private client address (fxClientIp), as in
   sec-001-lockout.test.ts: the rate_limits table is shared with every test file. */

let app: App;
const ips: string[] = [];
const ip = () => {
  const a = fxClientIp();
  ips.push(a);
  return a;
};
const addresses = new Set<string>();

const STRONG = "Le-soleil-de-Sousse-26";
const WRONG_PW = "Mon cartable bleu 2026!";
const NEW_PW = "Une-autre-phrase-2026";
const TB = "tnajem_tb";
const TOKEN_RE = /^v1\.[0-9a-f]{32}\.\d{13}\.[0-9a-f]{64}$/;

async function req(url: string, from: string, body: Record<string, unknown>, tb?: string | null, cookie?: string): Promise<Res> {
  if (typeof body.identifier === "string") addresses.add(body.identifier.toLowerCase());
  const cookies: Record<string, string> = {};
  if (tb) cookies[TB] = tb;
  const res = await app.inject({
    method: "POST",
    url,
    payload: body,
    remoteAddress: from,
    ...(Object.keys(cookies).length ? { cookies } : {}),
    ...(cookie ? { headers: { cookie } } : {}),
  });
  let parsed: any = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { status: res.statusCode, body: parsed, raw: res.body };
}

/** A fresh code for this address (dev posture: no mail provider → it comes back).
    The previous code row is dropped first so the 60 s resend cooldown never gets in
    the way of a test that needs a second code. */
async function freshCode(address: string, from: string, purpose?: "password"): Promise<string> {
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
  await sql`delete from otp_codes where identifier = ${address}`;
  const r = await req("/auth/otp/request", from, { identifier: address, locale: "fr", ...(purpose ? { purpose } : {}) });
  assert.equal(r.body?.ok, true, r.raw);
  return String(r.body.devCode);
}

const wrongOtp = (address: string, from: string, tb?: string | null) =>
  req("/auth/otp/verify", from, { identifier: address, code: "000000" }, tb);
const otp = (address: string, code: string, from: string, tb?: string | null) =>
  req("/auth/otp/verify", from, { identifier: address, code }, tb);
const reset = (address: string, code: string, from: string, tb?: string | null) =>
  req("/auth/password/reset", from, { identifier: address, code, password: NEW_PW, locale: "fr" }, tb);
const pwLogin = (address: string, password: string, from: string, tb?: string | null) =>
  req("/auth/password/login", from, { identifier: address, password, locale: "fr" }, tb);

async function withPassword(): Promise<{ email: string; id: string }> {
  const p = await seedProfile({ role: "tutor" });
  await sql`update profiles set password_hash = ${await hashPassword(STRONG)}, password_set_at = now() where id = ${p.id}`;
  return p;
}

/** Sign in by code from `from` (with `tb` if given); returns the browser's new cookie value. */
async function trust(address: string, from = ip(), tb?: string | null): Promise<string> {
  const code = await freshCode(address, from);
  const r = await otp(address, code, from, tb);
  assert.equal(r.body.ok, true, r.raw);
  assert.ok(r.body.trustedBrowser?.token, `a successful sign-in hands back a trusted-browser token: ${r.raw}`);
  return String(r.body.trustedBrowser.token);
}

/** The strict, identity-wide wait elapses (the test's clock is the row's reset_at). */
async function waitOutStrict(address: string): Promise<void> {
  await sql`update rate_limits set reset_at = now() - interval '1 second'
            where key like ${`%:sgate:${rlSubject(address)}`}`;
}
/** Every wait on this address elapses, lenient and strict. */
async function waitOutAll(address: string): Promise<void> {
  await sql`update rate_limits set reset_at = now() - interval '1 second'
            where key like ${`%gate:${rlSubject(address)}`}`;
}
/** Seconds left on the strict gate of one flow ("code" or "pw:fail"), or 0. */
async function strictSecs(prefix: string, address: string): Promise<number> {
  const [r] = await sql<{ secs: number }[]>`
    select greatest(0, ceil(extract(epoch from reset_at - now())))::int as secs
    from rate_limits where key = ${`${prefix}:sgate:${rlSubject(address)}`} and reset_at > now()`;
  return r?.secs ?? 0;
}
async function codeAttempts(address: string): Promise<number | null> {
  const [r] = await sql<{ attempts: number }[]>`select attempts from otp_codes where identifier = ${address}`;
  return r ? r.attempts : null;
}

before(async () => {
  app = await startApp();
});

after(async () => {
  for (const a of ips) await cleanupIp(a);
  for (const address of addresses) {
    await sql`delete from rate_limits where key like ${`%:${rlSubject(address)}`}`;
    await sql`delete from otp_codes where identifier = ${address}`;
  }
  await stopApp(app);
});

describe("1 · a code is dead after 5 wrong attempts", () => {
  test("3 wrong on sign-in + 2 wrong on reset spend the one code; the right code then fails", async () => {
    const victim = await withPassword();
    const code = await freshCode(victim.email, ip());
    for (let i = 0; i < 3; i++) {
      await waitOutAll(victim.email);
      assert.equal((await wrongOtp(victim.email, ip())).body.error, "invalid-code", `sign-in guess ${i + 1} is evaluated`);
    }
    for (let i = 0; i < 2; i++) {
      await waitOutAll(victim.email);
      assert.equal((await reset(victim.email, "000000", ip())).body.error, "invalid-code", `reset guess ${i + 1} is evaluated`);
    }
    assert.equal(await codeAttempts(victim.email), 5, "both flows spend the same code's budget");
    await waitOutAll(victim.email);
    const late = await otp(victim.email, code, ip());
    assert.equal(late.body.ok, false, late.raw);
    assert.equal(late.body.error, "invalid-code", "the right code after 5 wrong ones is refused");
    await waitOutAll(victim.email);
    assert.equal((await reset(victim.email, code, ip())).body.error, "invalid-code", "on reset too");
    // A new code is the way back in.
    await waitOutAll(victim.email);
    const home = ip();
    const again = await freshCode(victim.email, home);
    assert.equal((await otp(victim.email, again, home)).body.ok, true, "a new code works");
  });
});

describe("2 · code requests stay rate-limited", () => {
  test("per address: a second code within the minute is refused", async () => {
    const p = await seedProfile();
    await freshCode(p.email, ip());
    const again = await req("/auth/otp/request", ip(), { identifier: p.email, locale: "fr" });
    assert.equal(again.body.ok, false);
    assert.equal(again.body.error, "too-soon");
    assert.ok(again.body.retryAfter > 0 && again.body.retryAfter <= 60, again.raw);
  });

  test("per IP: the 11th request in 10 minutes from one network is refused, whatever the address", async () => {
    const host = ip();
    for (let i = 0; i < 10; i++) {
      const r = await req("/auth/otp/request", host, { identifier: fxSignupEmail(), locale: "fr" });
      assert.equal(r.body.ok, true, `request ${i + 1}: ${r.raw}`);
    }
    const r = await req("/auth/otp/request", host, { identifier: fxSignupEmail(), locale: "fr" });
    assert.equal(r.body.error, "too-soon", r.raw);
  });
});

describe("3 · a successful sign-in marks the browser", () => {
  test("code sign-in, password sign-in and reset each return a signed token holding no address", async () => {
    const p = await withPassword();
    const t1 = await trust(p.email);
    assert.match(t1, TOKEN_RE);
    assert.ok(!t1.includes(p.email) && !t1.includes(p.email.split("@")[0]), "never the raw address");

    const r2 = await pwLogin(p.email, STRONG, ip());
    assert.equal(r2.body.ok, true, r2.raw);
    assert.match(r2.body.trustedBrowser.token, TOKEN_RE);
    const days = (Date.parse(r2.body.trustedBrowser.expiresAt) - Date.now()) / 86_400_000;
    assert.ok(days > 179 && days <= 180, `≈ 180 days: ${days}`);

    const home = ip();
    const code = await freshCode(p.email, home, "password");
    const r3 = await reset(p.email, code, home);
    assert.equal(r3.body.ok, true, r3.raw);
    assert.match(r3.body.trustedBrowser.token, TOKEN_RE);
  });

  test("one browser keeps the last few accounts (≤ 5), newest first", async () => {
    let cookie: string | null = null;
    const accounts: { email: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await seedProfile();
      accounts.push(p);
      cookie = await trust(p.email, ip(), cookie);
    }
    const tokens = String(cookie).split("~");
    assert.equal(tokens.length, 5, `at most five: ${tokens.length}`);
    for (const t of tokens) assert.match(t, TOKEN_RE);
    assert.equal(tokens[0].split(".")[1], trustedSubject(accounts[5].email), "newest first");
    assert.ok(!tokens.some((t) => t.split(".")[1] === trustedSubject(accounts[0].email)), "the oldest one dropped");
  });
});

describe("4 · untrusted attempts meet a strict identity-wide delay", () => {
  test("after 3 untrusted failures every untrusted attempt waits: 60 s doubling to a 15-minute cap", async () => {
    const victim = await seedProfile();
    const seen: number[] = [];
    for (let n = 0; n < 9; n++) {
      await waitOutStrict(victim.email); // the previous wait elapses
      const r = await wrongOtp(victim.email, ip());
      assert.equal(r.body.error, "invalid-code", `attempt ${n + 1} after the wait is evaluated: ${r.raw}`);
      seen.push(await strictSecs("code", victim.email));
      if (seen[n] > 0) {
        const held = await wrongOtp(victim.email, ip()); // a fresh network, no wait
        assert.equal(held.body.error, "too-many-attempts", held.raw);
        assert.ok(held.body.retryAfter > 0 && held.body.retryAfter <= 15 * 60, `retryAfter ${held.body.retryAfter}`);
      }
    }
    assert.deepEqual(seen.slice(0, 2), [0, 0], `no wait before the third failure: ${seen}`);
    for (let i = 3; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `never shrinks: ${seen}`);
    assert.ok(Math.abs(seen[2] - 60) <= 1, `the third failure arms 60 s: ${seen}`);
    assert.ok(Math.abs(seen[3] - 120) <= 1, `then 120 s: ${seen}`);
    assert.ok(Math.max(...seen) <= 900, `capped at 15 min: ${seen}`);
    assert.ok(seen[seen.length - 1] >= 899, `and reaches the cap: ${seen}`);
  });

  test("rotating IPs does not escape it: 10 fresh networks after 3 failures are all held, the code is not touched", async () => {
    const victim = await seedProfile();
    await freshCode(victim.email, ip());
    for (let i = 0; i < 3; i++) assert.equal((await wrongOtp(victim.email, ip())).body.error, "invalid-code");
    for (let i = 0; i < 10; i++) {
      const r = await wrongOtp(victim.email, ip());
      assert.equal(r.body.error, "too-many-attempts", `fresh network ${i + 1}: ${r.raw}`);
    }
    assert.equal(await codeAttempts(victim.email), 3, "only three guesses ever reached the code");
  });

  test("a parallel burst from many networks gets three evaluations, no more", async () => {
    const victim = await seedProfile();
    await freshCode(victim.email, ip());
    const out = await Promise.all(Array.from({ length: 12 }, () => wrongOtp(victim.email, ip())));
    assert.ok(out.every((r) => ["invalid-code", "too-many-attempts"].includes(r.body.error)), JSON.stringify(out.map((r) => r.body)));
    assert.equal(await codeAttempts(victim.email), 3, "the identity-wide count is atomic");
  });

  test("sign-in and reset share the strict count (they guess the same code)", async () => {
    const victim = await withPassword();
    for (let i = 0; i < 3; i++) await wrongOtp(victim.email, ip());
    const home = ip();
    const code = await freshCode(victim.email, home, "password");
    const r = await reset(victim.email, code, home);
    assert.equal(r.body.error, "too-many-attempts", r.raw);
    await waitOutStrict(victim.email);
    assert.equal((await reset(victim.email, code, home)).body.ok, true, "after the wait the right code resets");
  });

  test("passwords: 3 untrusted failures, then the right password waits — and succeeds after the wait", async () => {
    const victim = await withPassword();
    for (let i = 0; i < 3; i++) assert.equal((await pwLogin(victim.email, WRONG_PW, ip())).body.error, "invalid-credentials");
    const held = await pwLogin(victim.email, STRONG, ip());
    assert.equal(held.body.error, "too-many-attempts", held.raw);
    assert.ok(held.body.retryAfter > 0 && held.body.retryAfter <= 60, `retryAfter ${held.body.retryAfter}`);
    await waitOutStrict(victim.email);
    assert.equal((await pwLogin(victim.email, STRONG, ip())).body.ok, true, "correct credentials after the wait succeed");
  });

  test("an unknown address is held exactly like an account (no oracle)", async () => {
    const real = (await withPassword()).email;
    const ghost = fxSignupEmail();
    const answers = (address: string) => async () => {
      const out: string[] = [];
      for (let i = 0; i < 5; i++) out.push(String((await pwLogin(address, WRONG_PW, ip())).body.error));
      for (let i = 0; i < 5; i++) out.push(String((await wrongOtp(address, ip())).body.error));
      return out;
    };
    const a = await answers(real)();
    const b = await answers(ghost)();
    assert.deepEqual(a, b);
    assert.deepEqual(a.slice(3, 5), ["too-many-attempts", "too-many-attempts"]);
  });
});

describe("4 · a trusted browser keeps the lenient path", () => {
  test("during an attack, the owner's trusted browser signs in from a fresh IP — a stranger's fresh IP is held", async () => {
    const victim = await seedProfile();
    const tb = await trust(victim.email);
    for (let i = 0; i < 8; i++) await wrongOtp(victim.email, ip()); // the attack, from many networks
    assert.ok((await strictSecs("code", victim.email)) > 0, "the strict wait is armed");

    const home = ip();
    const code = await freshCode(victim.email, home);
    assert.equal((await otp(victim.email, code, ip())).body.error, "too-many-attempts", "a stranger's fresh network is held");
    assert.equal((await wrongOtp(victim.email, home, tb)).body.error, "invalid-code", "the owner's typo is evaluated, not held");
    const ok = await otp(victim.email, code, home, tb);
    assert.equal(ok.body.ok, true, `the owner signs in: ${ok.raw}`);
  });

  test("passwords: the trusted owner signs in from a fresh IP while untrusted networks are held", async () => {
    const victim = await withPassword();
    const tb = String((await pwLogin(victim.email, STRONG, ip())).body.trustedBrowser.token);
    for (let i = 0; i < 6; i++) await pwLogin(victim.email, WRONG_PW, ip());
    assert.equal((await pwLogin(victim.email, STRONG, ip())).body.error, "too-many-attempts");
    const ok = await pwLogin(victim.email, STRONG, ip(), tb);
    assert.equal(ok.body.ok, true, ok.raw);
  });

  test("a token for account A gives nothing on account B", async () => {
    const a = await seedProfile();
    const b = await seedProfile();
    const tbA = await trust(a.email);
    for (let i = 0; i < 3; i++) await wrongOtp(b.email, ip());
    const r = await wrongOtp(b.email, ip(), tbA);
    assert.equal(r.body.error, "too-many-attempts", r.raw);
  });

  test("a tampered or expired token is untrusted", async () => {
    const victim = await seedProfile();
    const tb = await trust(victim.email);
    for (let i = 0; i < 3; i++) await wrongOtp(victim.email, ip());

    const last = tb.slice(-1) === "0" ? "1" : "0";
    const tampered = tb.slice(0, -1) + last;
    assert.equal((await wrongOtp(victim.email, ip(), tampered)).body.error, "too-many-attempts", "tampered MAC");
    const [v, subj, iat, mac] = tb.split(".");
    const moved = [v, subj, String(Number(iat) + 1000), mac].join(".");
    assert.equal((await wrongOtp(victim.email, ip(), moved)).body.error, "too-many-attempts", "moved issue time");

    const old = issueTrustedToken(victim.id, victim.email, 0, Date.now() - TRUSTED_TOKEN_TTL_MS - 60_000);
    assert.match(old, TOKEN_RE);
    assert.equal((await wrongOtp(victim.email, ip(), old)).body.error, "too-many-attempts", "expired");
    const fresh = issueTrustedToken(victim.id, victim.email, 0, Date.now() - 60_000);
    assert.equal((await wrongOtp(victim.email, ip(), fresh)).body.error, "invalid-code", "control: a valid one is trusted");
  });

  test("« Se déconnecter partout » and a password reset retire older tokens; logout does not", async () => {
    const victim = await withPassword();
    const tb = await trust(victim.email);
    for (let i = 0; i < 3; i++) await wrongOtp(victim.email, ip());

    // Plain logout: the token marks the device, not the session.
    const session = await login(victim.id);
    await req("/auth/logout", ip(), {}, null, session);
    assert.equal((await wrongOtp(victim.email, ip(), tb)).body.error, "invalid-code", "still trusted after logout");

    // Logout everywhere: retired.
    const s2 = await login(victim.id);
    assert.equal((await req("/auth/logout-all", ip(), {}, null, s2)).body.ok, true);
    assert.equal((await wrongOtp(victim.email, ip(), tb)).body.error, "too-many-attempts", "retired by logout-all");

    // A reset retires every older token and hands this browser a new one.
    const tb2 = issueTrustedToken(victim.id, victim.email, 1, Date.now());
    assert.equal((await wrongOtp(victim.email, ip(), tb2)).body.error, "invalid-code", "a token of the current epoch is trusted");
    await waitOutStrict(victim.email);
    const home = ip();
    const code = await freshCode(victim.email, home, "password");
    const r = await reset(victim.email, code, home, tb2);
    assert.equal(r.body.ok, true, r.raw);
    await waitOutAll(victim.email);
    for (let i = 0; i < 3; i++) await wrongOtp(victim.email, ip());
    assert.equal((await wrongOtp(victim.email, ip(), tb2)).body.error, "too-many-attempts", "retired by the reset");
    assert.equal((await wrongOtp(victim.email, ip(), r.body.trustedBrowser.token)).body.error, "invalid-code", "the reset's own token is trusted");
  });
});
