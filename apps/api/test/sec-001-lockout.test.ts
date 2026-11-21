import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { rlSubject } from "../src/lib/rate-limit";
import { hashPassword } from "../src/lib/password";
import { issueTrustedToken } from "../src/lib/trusted-browser";
import { startApp, stopApp, seedProfile, sql, fxClientIp, fxSignupEmail, cleanupIp, type App, type Res } from "./support/fx";

/* VULN-001 — targeted lockout (security audit, Nov 2026).

   A stranger could lock a chosen person out of code sign-in AND « Mot de passe
   oublié » by sending 10 wrong codes for their address every 15 minutes, and out of
   password sign-in from every network by sending 20 wrong passwords an hour from a
   few hosts. Every budget keyed on the address alone was a lock anyone could turn.

   What must hold now (founder's requirements):
     • failures alone never hard-lock an address: the real owner's correct code or
       password, from another network, still gets in;
     • a single attacker network is still stopped by its (address, IP) budget;
     • repeated failures across networks slow the address down with a growing wait,
       capped at a minute — a delay, never a lock;
     • reset and sign-in count separately.

   Every request carries its own private client address (fxClientIp), as in
   ep2-passwords.test.ts: the rate_limits table is shared with every test file.

   VULN-001 follow-up: what this file pins is now the LENIENT path — the one a browser
   holding a valid trusted-browser token for the address meets (`tb`, minted here with
   issueTrustedToken as a sign-in would). The OWNER signs in from such a browser; a
   stranger's attempts carry none and also meet the strict identity-wide delay
   (sec-001b-trusted-browser.test.ts), which is why the owner here is the trusted one
   and why the lenient mechanics are driven from trusted browsers. */

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

async function req(url: string, from: string, body: Record<string, unknown>, tb?: string): Promise<Res> {
  if (typeof body.identifier === "string") addresses.add(body.identifier.toLowerCase());
  const res = await app.inject({ method: "POST", url, payload: body, remoteAddress: from, ...(tb ? { cookies: { tnajem_tb: tb } } : {}) });
  let parsed: any = null;
  try {
    parsed = res.body ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { status: res.statusCode, body: parsed, raw: res.body };
}

/** Request a code (dev posture: no mail provider → the code comes back). */
async function devCode(address: string, from: string, purpose?: "password"): Promise<string> {
  for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
  const r = await req("/auth/otp/request", from, { identifier: address, locale: "fr", ...(purpose ? { purpose } : {}) });
  assert.equal(r.body?.ok, true, r.raw);
  return String(r.body.devCode);
}

const wrongOtp = (address: string, from: string, tb?: string) => req("/auth/otp/verify", from, { identifier: address, code: "000000" }, tb);
const wrongReset = (address: string, from: string, tb?: string) =>
  req("/auth/password/reset", from, { identifier: address, code: "000000", password: NEW_PW }, tb);
const pwLogin = (address: string, password: string, from: string, tb?: string) =>
  req("/auth/password/login", from, { identifier: address, password, locale: "fr" }, tb);
/** The owner's browser: a trusted-browser token for this account, as a sign-in hands out. */
const trustedBy = (p: { id: string; email: string }) => issueTrustedToken(p.id, p.email, 0);

/** A seeded account with a password on file. */
async function withPassword(): Promise<{ email: string; id: string }> {
  const p = await seedProfile({ role: "tutor" });
  await sql`update profiles set password_hash = ${await hashPassword(STRONG)}, password_set_at = now() where id = ${p.id}`;
  return p;
}

/** "Wait out" every progressive delay on this address: the test's clock hook is the
    reset_at of its rows, moved by hand like ep2-passwords.test.ts does. `%gate:` takes
    the strict untrusted wait (`:sgate:`) as well as the lenient one (`:gate:`). */
async function waitOutDelays(address: string): Promise<void> {
  await sql`update rate_limits set reset_at = now() - interval '1 second'
            where key like ${`%gate:${rlSubject(address)}`}`;
}
/** Only the strict untrusted wait elapses: for tests that measure the lenient counters
    with browsers that hold no token. */
async function waitOutStrict(address: string): Promise<void> {
  await sql`update rate_limits set reset_at = now() - interval '1 second'
            where key like ${`%:sgate:${rlSubject(address)}`}`;
}

/** Seconds left on this address's gate in one scope, or 0. */
async function gateSecs(prefix: string, address: string): Promise<number> {
  const [r] = await sql<{ secs: number }[]>`
    select greatest(0, ceil(extract(epoch from reset_at - now())))::int as secs
    from rate_limits where key = ${`${prefix}:gate:${rlSubject(address)}`} and reset_at > now()`;
  return r?.secs ?? 0;
}

before(async () => {
  app = await startApp();
});

after(async () => {
  for (const a of ips) await cleanupIp(a);
  for (const address of addresses) await sql`delete from rate_limits where key like ${`%:${rlSubject(address)}`}`;
  await stopApp(app);
});

describe("VULN-001 · a stranger's wrong codes cannot lock the owner out", () => {
  test("(a) 10 wrong codes from attacker IP A; the owner's real code from IP B signs in", async () => {
    const victim = await seedProfile({ role: "tutor" });
    const attacker = ip();
    for (let i = 0; i < 10; i++) {
      const r = await wrongOtp(victim.email, attacker);
      assert.ok(["invalid-code", "too-many-attempts"].includes(r.body.error), r.raw);
    }
    const home = ip();
    const code = await devCode(victim.email, home);
    const v = await req("/auth/otp/verify", home, { identifier: victim.email, code }, trustedBy(victim));
    assert.equal(v.body.ok, true, `the owner's correct code from another IP must succeed: ${v.raw}`);
  });

  test("(b) attacks on login AND reset from IP A; the owner's reset from IP B succeeds", async () => {
    const victim = await withPassword();
    const attacker = ip();
    for (let i = 0; i < 10; i++) await wrongOtp(victim.email, attacker);
    for (let i = 0; i < 10; i++) await wrongReset(victim.email, attacker);
    for (let i = 0; i < 6; i++) await pwLogin(victim.email, WRONG_PW, attacker);

    const home = ip();
    const code = await devCode(victim.email, home, "password");
    const r = await req("/auth/password/reset", home, { identifier: victim.email, code, password: NEW_PW, locale: "fr" }, trustedBy(victim));
    assert.equal(r.body.ok, true, `the owner's reset from another IP must succeed: ${r.raw}`);
    assert.equal((await pwLogin(victim.email, NEW_PW, ip())).body.ok, true, "and the new password works");
  });

  test("(b2) reset and sign-in count separately: a flood of one never delays the other", async () => {
    // The lenient counters, so trusted browsers throughout (the strict untrusted count is
    // shared by sign-in and reset on purpose: sec-001b-trusted-browser.test.ts).
    const victim = await withPassword();
    const tb = trustedBy(victim);
    // Flood code SIGN-IN from many networks until its delay is armed.
    for (let n = 0; n < 6; n++) {
      const h = ip();
      await wrongOtp(victim.email, h, tb);
      await wrongOtp(victim.email, h, tb);
    }
    assert.ok((await gateSecs("otp:vfy", victim.email)) > 0, "sign-in's delay is armed");
    assert.equal(await gateSecs("reset:vfy", victim.email), 0, "reset's is not");

    // The owner typed two wrong codes from home (their IP is now "dirty" on sign-in)…
    const home = ip();
    await wrongOtp(victim.email, home, tb);
    await wrongOtp(victim.email, home, tb);
    assert.equal((await wrongOtp(victim.email, home, tb)).body.error, "too-many-attempts", "sign-in waits from home");
    // …and « Mot de passe oublié » from that same home network is not delayed at all.
    const code = await devCode(victim.email, home, "password");
    const r = await req("/auth/password/reset", home, { identifier: victim.email, code, password: NEW_PW }, tb);
    assert.equal(r.body.ok, true, r.raw);

    // The other way round: a flood of wrong RESET codes does not delay code sign-in.
    const other = await seedProfile({ role: "student" });
    const otb = trustedBy(other);
    for (let n = 0; n < 6; n++) {
      const h = ip();
      await wrongReset(other.email, h, otb);
      await wrongReset(other.email, h, otb);
    }
    assert.ok((await gateSecs("reset:vfy", other.email)) > 0, "reset's delay is armed");
    const dirty = ip();
    await wrongOtp(other.email, dirty, otb);
    await wrongOtp(other.email, dirty, otb);
    const c = await devCode(other.email, dirty);
    assert.equal((await req("/auth/otp/verify", dirty, { identifier: other.email, code: c }, otb)).body.ok, true);
  });
});

describe("VULN-001 · passwords: a progressive delay replaces the account-wide lock", () => {
  test("(c) 24 wrong passwords over 6 attacker IPs; the right one from a 7th IP signs in", async () => {
    const victim = await withPassword();
    const hosts = Array.from({ length: 6 }, ip);
    for (const h of hosts) for (let i = 0; i < 4; i++) await pwLogin(victim.email, WRONG_PW, h);

    const ok = await pwLogin(victim.email, STRONG, ip(), trustedBy(victim));
    assert.equal(ok.body.ok, true, `the owner signs in from a fresh network: ${ok.raw}`);
  });

  test("(c2) a network that already failed waits at most 60 s, then the right password succeeds", async () => {
    const victim = await withPassword();
    const tb = trustedBy(victim); // the lenient delay is what trusted browsers meet
    for (const h of Array.from({ length: 6 }, ip)) for (let i = 0; i < 4; i++) await pwLogin(victim.email, WRONG_PW, h, tb);

    // The owner mistypes twice at home: their network is now behind the delay.
    const home = ip();
    await pwLogin(victim.email, WRONG_PW, home, tb);
    await pwLogin(victim.email, WRONG_PW, home, tb);
    const waiting = await pwLogin(victim.email, STRONG, home, tb);
    assert.equal(waiting.body.error, "too-many-attempts", waiting.raw);
    assert.ok(waiting.body.retryAfter >= 1 && waiting.body.retryAfter <= 60, `retryAfter ${waiting.body.retryAfter}s is a short delay`);

    await waitOutDelays(victim.email); // the wait elapses
    const ok = await pwLogin(victim.email, STRONG, home, tb);
    assert.equal(ok.body.ok, true, `after the wait the right password succeeds: ${ok.raw}`);
  });

  test("the delay grows with failures and is capped at 60 s — for any address, account or not", async () => {
    for (const address of [(await withPassword()).email, fxSignupEmail()]) {
      const seen: number[] = [];
      for (let n = 0; n < 7; n++) {
        const h = ip();
        for (let i = 0; i < 2; i++) {
          await waitOutStrict(address); // no token here: the strict wait elapses, this measures the lenient one
          await pwLogin(address, WRONG_PW, h);
          seen.push(await gateSecs("pw:fail", address));
        }
      }
      const armed = seen.filter((s) => s > 0);
      assert.ok(armed.length >= 5, `the delay arms: ${seen}`);
      for (let i = 1; i < armed.length; i++) assert.ok(armed[i] >= armed[i - 1], `never shrinks: ${seen}`);
      assert.ok(armed[armed.length - 1] > armed[0], `it grows: ${seen}`);
      assert.ok(Math.max(...seen) <= 60, `capped at 60 s: ${seen}`);
      assert.equal(armed[armed.length - 1], 60, `and reaches the cap: ${seen}`);
    }
  });

  test("the code delay grows and is capped at 60 s too", async () => {
    const address = (await seedProfile()).email;
    const seen: number[] = [];
    for (let n = 0; n < 7; n++) {
      const h = ip();
      for (let i = 0; i < 2; i++) {
        await waitOutStrict(address);
        await wrongOtp(address, h);
        seen.push(await gateSecs("otp:vfy", address));
      }
    }
    const armed = seen.filter((s) => s > 0);
    assert.ok(armed.length >= 5, `the delay arms: ${seen}`);
    assert.ok(armed[armed.length - 1] > armed[0] && Math.max(...seen) === 60, `grows to a 60 s cap: ${seen}`);
  });
});

describe("VULN-001 · one attacker network is still stopped by its (address, IP) budget", () => {
  test("(d) codes: past 10 failures one IP is refused for ~15 min even after the delays; another IP is not", async () => {
    const victim = await seedProfile();
    const attacker = ip();
    for (let i = 0; i < 10; i++) {
      await waitOutDelays(victim.email);
      assert.equal((await wrongOtp(victim.email, attacker)).body.error, "invalid-code", `failure ${i + 1} is evaluated`);
    }
    await waitOutDelays(victim.email);
    const code = await devCode(victim.email, ip());
    const stopped = await req("/auth/otp/verify", attacker, { identifier: victim.email, code });
    assert.equal(stopped.body.error, "too-many-attempts", stopped.raw);
    assert.ok(stopped.body.retryAfter > 14 * 60 && stopped.body.retryAfter <= 15 * 60, `retryAfter ${stopped.body.retryAfter}s ≈ 15 min`);
    const home = ip();
    assert.equal((await req("/auth/otp/verify", home, { identifier: victim.email, code })).body.ok, true, "the owner's network is not");
  });

  test("(d) passwords: 5 failures stop that pair for ~15 min even after the delays; another IP is not", async () => {
    const victim = await withPassword();
    const attacker = ip();
    for (let i = 0; i < 5; i++) {
      await waitOutDelays(victim.email);
      assert.equal((await pwLogin(victim.email, WRONG_PW, attacker)).body.error, "invalid-credentials");
    }
    await waitOutDelays(victim.email);
    const stopped = await pwLogin(victim.email, STRONG, attacker);
    assert.equal(stopped.body.error, "too-many-attempts", stopped.raw);
    assert.ok(stopped.body.retryAfter > 14 * 60, `retryAfter ${stopped.body.retryAfter}s ≈ 15 min`);
    assert.equal((await pwLogin(victim.email, STRONG, ip())).body.ok, true);
  });
});
