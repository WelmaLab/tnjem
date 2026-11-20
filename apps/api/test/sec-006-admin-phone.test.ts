import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startApp, stopApp, seedProfile, login, call, sql, otpVerify, fxClientIp, cleanupIp, type App } from "./support/fx";

/* VULN-006 — under OTP_CHANNEL=sms, an unverified, user-written phone number was
   both a sign-in identity and an admin identity.

     • Admin is now a DATABASE fact (profiles.admin_granted_at, 0046), granted by an
       operator CLI. No env allow-list (ADMIN_EMAILS / ADMIN_PHONES) grants anything.
     • A phone written through the profile / storefront forms is stored UNVERIFIED
       (profiles.phone_verified_at stays null), and under sms those forms cannot set
       or change it at all (`phone-locked`): only an SMS proof at sign-in sets it.
     • Sign-in by phone matches a VERIFIED phone only. A profile that merely typed the
       number loses it to the person who proves it, and never receives their session. */

let app: App;
const ip = fxClientIp();
const ADMIN_PHONE = "+21620000000";
const phones: string[] = [ADMIN_PHONE];
const randomPhone = () => {
  const p = `+2162${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, "0")}`;
  phones.push(p);
  return p;
};

const saved = {
  OTP_CHANNEL: process.env.OTP_CHANNEL,
  ADMIN_PHONES: process.env.ADMIN_PHONES,
  ADMIN_EMAILS: process.env.ADMIN_EMAILS,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

before(async () => {
  app = await startApp();
});
afterEach(restoreEnv);
after(async () => {
  restoreEnv();
  // Profiles an SMS sign-up created carry no fx-tagged e-mail: remove them by number.
  await sql`delete from sessions where profile_id in (select id from profiles where phone in ${sql(phones)} and email is null)`;
  await sql`delete from profiles where phone in ${sql(phones)} and email is null`;
  await sql`update profiles set phone = null where phone in ${sql(phones)}`;
  await cleanupIp(ip);
  await stopApp(app);
});

/** The profile id a session token belongs to. */
async function profileOf(token: string): Promise<string | null> {
  const me = await call(app, "GET", "/me", `tnajem_session=${token}`);
  return me.body?.id ?? null;
}

describe("VULN-006 (a) — a typed phone is never an admin identity", () => {
  test("sms + ADMIN_PHONES: writing the admin's number on a student profile grants nothing", async () => {
    process.env.OTP_CHANNEL = "sms";
    process.env.ADMIN_PHONES = ADMIN_PHONE;
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);

    const w = await call(app, "POST", "/profile/student", cookie, { fullName: "Test User", phone: ADMIN_PHONE });

    const me = await call(app, "GET", "/me", cookie);
    assert.equal(me.body?.isAdmin, false, me.raw);
    const q = await call(app, "GET", "/admin/verifications", cookie);
    assert.equal(q.body?.admin, false, q.raw);
    const f = await call(app, "POST", "/admin/accounts/find", cookie, { email: student.email });
    assert.equal(f.body?.error, "forbidden", f.raw);

    assert.equal(w.body?.ok, false, `the write must be refused under sms: ${w.raw}`);
    assert.equal(w.body?.error, "phone-locked", w.raw);
  });
});

describe("VULN-006 (b) — ADMIN_EMAILS no longer grants admin", () => {
  test("email channel, the student's own address in ADMIN_EMAILS: not an admin", async () => {
    process.env.OTP_CHANNEL = "email";
    const student = await seedProfile({ role: "student" });
    process.env.ADMIN_EMAILS = student.email;
    const cookie = await login(student.id);

    const me = await call(app, "GET", "/me", cookie);
    assert.equal(me.body?.isAdmin, false, me.raw);
    const q = await call(app, "GET", "/admin/verifications", cookie);
    assert.equal(q.body?.admin, false, q.raw);
  });
});

describe("VULN-006 (c) — admin_granted_at is the one source of admin", () => {
  test("a profile with admin_granted_at set is an admin, whatever the env says", async () => {
    process.env.OTP_CHANNEL = "email";
    process.env.ADMIN_EMAILS = "";
    delete process.env.ADMIN_PHONES;
    const admin = await seedProfile({ role: "tutor" });
    await sql`update profiles set admin_granted_at = now() where id = ${admin.id}`;
    const cookie = await login(admin.id);

    const me = await call(app, "GET", "/me", cookie);
    assert.equal(me.body?.isAdmin, true, me.raw);
    const q = await call(app, "GET", "/admin/verifications", cookie);
    assert.equal(q.body?.ok, true, q.raw);
    assert.equal(q.body?.admin, true, q.raw);

    // Revoked → refused on the very next request (the session reloads the profile).
    await sql`update profiles set admin_granted_at = null where id = ${admin.id}`;
    const again = await call(app, "GET", "/admin/verifications", cookie);
    assert.equal(again.body?.admin, false, again.raw);
  });

  test("an admin cannot be blocked from the accounts page", async () => {
    process.env.OTP_CHANNEL = "email";
    const admin = await seedProfile({ role: "tutor" });
    const other = await seedProfile({ role: "tutor" });
    await sql`update profiles set admin_granted_at = now() where id in ${sql([admin.id, other.id])}`;
    const cookie = await login(admin.id);
    const found = await call(app, "POST", "/admin/accounts/find", cookie, { email: other.email });
    assert.equal(found.body?.account?.isAdmin, true, found.raw);
    const b = await call(app, "POST", "/admin/accounts/block", cookie, { profileId: other.id, reason: "test reason" });
    assert.equal(b.body?.error, "cannot-block-admin", b.raw);
  });
});

describe("VULN-006 (d) — no account pre-hijack through a typed phone", () => {
  test("sms: a profile cannot write (or change) a phone number", async () => {
    process.env.OTP_CHANNEL = "sms";
    const victimPhone = randomPhone();
    const attacker = await seedProfile({ role: "student" });
    const cookie = await login(attacker.id);
    const w = await call(app, "POST", "/profile/student", cookie, { fullName: "Atta Cker", phone: victimPhone });
    assert.equal(w.body?.error, "phone-locked", w.raw);
    const [row] = await sql<{ phone: string | null }[]>`select phone from profiles where id = ${attacker.id}`;
    assert.equal(row.phone, null);
  });

  test("sms: a tutor's storefront form cannot write a phone number either", async () => {
    process.env.OTP_CHANNEL = "sms";
    const tutor = await seedProfile({ role: "tutor" });
    const cookie = await login(tutor.id);
    const w = await call(app, "POST", "/tutors", cookie, {
      slug: `sec006-${randomBytes(4).toString("hex")}`,
      name: "Prof Test",
      subject: "Maths",
      bio: "",
      phone: randomPhone(),
    });
    assert.equal(w.body?.error, "phone-locked", w.raw);
  });

  test("sms: whoever proves the number gets their OWN account, never the unverified holder's", async () => {
    process.env.OTP_CHANNEL = "sms";
    const phone = randomPhone();
    // A number typed on a profile before this fix (or as a contact under e-mail sign-in): unverified.
    const holder = await seedProfile({ role: "student" });
    await sql`update profiles set phone = ${phone} where id = ${holder.id}`;

    // Plain sign-in: the typed number is not an account.
    const signIn = await otpVerify(app, ip, { identifier: phone });
    assert.equal(signIn.body?.ok, false, signIn.raw);
    assert.equal(signIn.body?.error, "no-account", signIn.raw);

    // Sign-up: the prover gets a fresh profile and the number; the holder loses it.
    const signUp = await otpVerify(app, ip, { identifier: phone, role: "student", birthYear: 1990, birthMonth: 1 });
    assert.equal(signUp.body?.ok, true, signUp.raw);
    assert.equal(signUp.body?.created, true, signUp.raw);
    const proverId = await profileOf(signUp.body.session.token);
    assert.ok(proverId, signUp.raw);
    assert.notEqual(proverId, holder.id, "the SMS signer must never land in the unverified holder's account");

    const [h] = await sql<{ phone: string | null }[]>`select phone from profiles where id = ${holder.id}`;
    assert.equal(h.phone, null, "the unverified holder loses the number to its proven owner");
    const [p] = await sql<{ phone: string | null; verified: Date | null }[]>`
      select phone, phone_verified_at as verified from profiles where id = ${proverId}`;
    assert.equal(p.phone, phone);
    assert.ok(p.verified, "the SMS proof marks the number verified");

    // And the verified owner signs in to the same account next time.
    const again = await otpVerify(app, ip, { identifier: phone });
    assert.equal(again.body?.ok, true, again.raw);
    assert.equal(await profileOf(again.body.session.token), proverId);
  });

  test("sms: password reset by phone never reaches an unverified holder", async () => {
    process.env.OTP_CHANNEL = "sms";
    const phone = randomPhone();
    const holder = await seedProfile({ role: "student" });
    await sql`update profiles set phone = ${phone} where id = ${holder.id}`;
    const status = await app.inject({ method: "POST", url: "/auth/account-status", payload: { identifier: phone }, remoteAddress: ip });
    assert.equal(JSON.parse(status.body).exists, false, status.body);

    const reqd = await app.inject({ method: "POST", url: "/auth/otp/request", payload: { identifier: phone, locale: "fr" }, remoteAddress: ip });
    const code = String(JSON.parse(reqd.body).devCode);
    const reset = await app.inject({
      method: "POST",
      url: "/auth/password/reset",
      payload: { identifier: phone, code, password: "Une-phrase-longue-42", locale: "fr" },
      remoteAddress: ip,
    });
    const body = JSON.parse(reset.body);
    assert.equal(body.ok, false, reset.body);
    assert.equal(body.error, "no-account", reset.body);
  });
});
