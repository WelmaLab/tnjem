import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, gt, profiles, sessions } from "@tnajem/db";
import { otpChannel, SESSION_IDLE_DAYS, sessionTokenHash } from "@tnajem/shared/auth-core";
import { db } from "../db";
import { createSession, getSession } from "../lib/session";
import { checkRateLimit, rlSubject } from "../lib/rate-limit";
import { clientIp, identityColumn, postLoginState, proveCode, resolveIdentity, sendCode } from "../lib/auth-flow";
import {
  clearPasswordFailures,
  currentPasswordSchema,
  newPasswordSchema,
  passwordGrantValid,
  passwordLockout,
  recordPasswordFailure,
  sendPasswordNotice,
  storePassword,
  upgradeHashIfNeeded,
  verifyPassword,
  weakPasswordReason,
} from "../lib/password";

/* espace prof v2 · phase 2 — accounts with a password.

   A password is created at sign-up; sign-in works with the password OR a code (the
   code routes in auth.ts are unchanged and stay a complete way in). Every rule is
   enforced HERE; the web only reflects it.

     POST /auth/account-status   { identifier }                 → { ok, exists, hasPassword }
     POST /auth/password/login   { identifier, password }       → session, or the generic refusal
     POST /auth/password/set     { password, grant? | code? }   first password (session)
     POST /auth/password/change  { currentPassword, newPassword } (session)
     POST /auth/password/code    { locale? }                    a code to one's own address (session)
     POST /auth/password/reset   { identifier, code, password } « Mot de passe oublié »
     GET  /auth/security                                          password state + active sessions

   Every input is Zod-parsed; a body of the wrong shape is a 400, a refused password
   is { ok:false, error:"weak-password", reason } (shown on the field). Every route is
   rate-limited. Set, change and reset each write an audit row in the same
   transaction, revoke every OTHER session, and e-mail the account. */

const IDENTIFIER = z.string().max(320);
const CODE = z.string().max(16);
const LOCALE = z.string().max(5).optional();

/** The one answer a failed password sign-in gets — unknown address, account with no
    password and wrong password alike. Byte-identical on purpose (ep2-passwords.test.ts). */
const INVALID_CREDENTIALS = { ok: false, error: "invalid-credentials" } as const;

const statusBody = z.object({ identifier: IDENTIFIER });
const loginBody = z.object({ identifier: IDENTIFIER, password: currentPasswordSchema, locale: LOCALE });
const setBody = z.object({ password: newPasswordSchema, grant: z.string().max(128).optional(), code: CODE.optional() });
const changeBody = z.object({ currentPassword: currentPasswordSchema, newPassword: newPasswordSchema });
const codeBody = z.object({ locale: LOCALE });
const resetBody = z.object({ identifier: IDENTIFIER, code: CODE, password: newPasswordSchema, locale: LOCALE });

/** A refused body: the password policy is a domain answer, anything else a 400. */
function refusal(error: z.ZodError): { status: 200; body: { ok: false; error: "weak-password"; reason: string } } | { status: 400; body: { error: "bad-request" } } {
  const reason = weakPasswordReason(error);
  return reason
    ? { status: 200, body: { ok: false, error: "weak-password", reason } }
    : { status: 400, body: { error: "bad-request" } };
}

/** The identity this account signs in with under the active channel. */
function signInIdentity(p: { email: string | null; phone: string | null }): string | null {
  return otpChannel() === "email" ? p.email : p.phone;
}

export async function passwordRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /auth/account-status ────────────────────────────────────────────
     THE ENUMERATION TRADE-OFF, accepted by the spec (ESPACE_PROF_V2 Phase 2 §2).
     Sign-up must be able to say « Tu as déjà un compte — connecte-toi » before a
     code is spent, and /auth must know whether to show a password field. So this
     answers "does this address have an account, and a password?" to anyone who
     asks — the oracle verifyOtp was careful never to be. What bounds it: 20 asks
     per 10 minutes per IP (an IPv6 /64 counts as one, rate-limit.ts::ipBucket) and
     10 per 10 minutes per address, i.e. ~2,900 addresses a day from one host. It
     answers those two booleans and nothing else: no role, no name, no "blocked". */
  app.post("/auth/account-status", async (req, reply) => {
    const parsed = statusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const { channel, id, ok } = resolveIdentity(parsed.data.identifier);
    if (!ok) return { ok: false, error: channel === "email" ? "invalid-email" : "invalid-phone" };

    const perIp = await checkRateLimit(`acct:status:ip:${clientIp(req)}`, 20, 10 * 60_000);
    if (!perIp.ok) return { ok: false, error: "too-many-attempts", retryAfter: perIp.retryAfter };
    const perId = await checkRateLimit(`acct:status:id:${rlSubject(id)}`, 10, 10 * 60_000);
    if (!perId.ok) return { ok: false, error: "too-many-attempts", retryAfter: perId.retryAfter };

    const [p] = await db
      .select({ hash: profiles.passwordHash })
      .from(profiles)
      .where(eq(identityColumn(channel), id))
      .limit(1);
    return { ok: true, exists: Boolean(p), hasPassword: Boolean(p?.hash) };
  });

  /* ── POST /auth/password/login ────────────────────────────────────────────
     One answer for every failure that could tell an address apart: unknown,
     password-less and wrong-password all get INVALID_CREDENTIALS after one argon2
     verify (lib/password.ts's dummy hash for the first two). Locked — 5 failures in
     a row for this ADDRESS, account or not, or from this IP — is "too-many-attempts":
     a fact about the caller, given whether or not the address has an account. */
  app.post("/auth/password/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;
    const { channel, id, ok } = resolveIdentity(input.identifier);
    if (!ok) return INVALID_CREDENTIALS;
    const ip = clientIp(req);

    // Every attempt from one host, success or not: bounds the hashing work a host can ask for.
    const tries = await checkRateLimit(`pw:try:ip:${ip}`, 30, 15 * 60_000);
    if (!tries.ok) return { ok: false, error: "too-many-attempts", retryAfter: tries.retryAfter };
    const lock = await passwordLockout(id, ip);
    if (!lock.ok) return { ok: false, error: "too-many-attempts", retryAfter: lock.retryAfter };

    const [profile] = await db.select().from(profiles).where(eq(identityColumn(channel), id)).limit(1);
    const good = await verifyPassword(profile?.passwordHash, input.password);
    if (!profile || !profile.passwordHash || !good) {
      await recordPasswordFailure(id, ip);
      return INVALID_CREDENTIALS;
    }
    await clearPasswordFailures(id);

    // After the password is proven, like the code path: this answer only reaches the owner.
    if (profile.blockedAt) return { ok: false, error: "account-blocked" };

    await upgradeHashIfNeeded(profile.id, profile.passwordHash, input.password);
    const { token, expiresAt } = await createSession(profile.id);
    const state = await postLoginState(profile);
    return {
      ok: true,
      role: profile.role,
      ...state,
      // For the web to set the cookie (auth.ts header). Redacted in logs.
      session: { token, expiresAt: expiresAt.toISOString() },
    };
  });

  /* ── POST /auth/password/set — the FIRST password ─────────────────────────
     Needs a session AND fresh proof of the mailbox: the grant a code sign-in just
     returned (sign-up step, one-time prompt), or a code from /auth/password/code
     (Réglages › Sécurité). A session alone is not enough — a stolen or forgotten
     session must not be able to add a password and turn borrowed access into
     permanent access. Refused once a password exists: that is /change. */
  app.post("/auth/password/set", async (req, reply) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const parsed = setBody.safeParse(req.body);
    if (!parsed.success) {
      const r = refusal(parsed.error);
      return reply.code(r.status).send(r.body);
    }
    const input = parsed.data;
    const me = session.profile;

    const limit = await checkRateLimit(`pw:set:${me.id}`, 10, 15 * 60_000);
    if (!limit.ok) return { ok: false, error: "too-many-attempts", retryAfter: limit.retryAfter };

    const [p] = await db
      .select({ hash: profiles.passwordHash, email: profiles.email, phone: profiles.phone, locale: profiles.locale })
      .from(profiles)
      .where(eq(profiles.id, me.id))
      .limit(1);
    if (!p) return { ok: false, error: "not-authenticated" };
    if (p.hash) return { ok: false, error: "has-password" };

    let proven = passwordGrantValid(me.id, input.grant);
    if (!proven && input.code) {
      const ident = signInIdentity(p);
      if (!ident) return { ok: false, error: "invalid-code" };
      const proof = await proveCode(req, ident, input.code);
      if (!proof.ok) return proof;
      proven = true;
    }
    if (!proven) return { ok: false, error: input.grant ? "grant-expired" : "proof-required" };

    const stored = await storePassword({ profileId: me.id, password: input.password, event: "set", expect: null, keepToken: session.token });
    if (!stored.ok) return { ok: false, error: "has-password" };
    sendPasswordNotice(p, "set");
    return { ok: true, ended: stored.ended };
  });

  /* ── POST /auth/password/change ───────────────────────────────────────────
     The current password, under the same lockout as sign-in (the account's
     address and this IP), so a session cannot be used to guess it at leisure. */
  app.post("/auth/password/change", async (req, reply) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const parsed = changeBody.safeParse(req.body);
    if (!parsed.success) {
      const r = refusal(parsed.error);
      return reply.code(r.status).send(r.body);
    }
    const input = parsed.data;
    const me = session.profile;
    const ip = clientIp(req);

    const [p] = await db
      .select({ hash: profiles.passwordHash, email: profiles.email, phone: profiles.phone, locale: profiles.locale })
      .from(profiles)
      .where(eq(profiles.id, me.id))
      .limit(1);
    if (!p) return { ok: false, error: "not-authenticated" };
    if (!p.hash) return { ok: false, error: "no-password" };

    const lockKey = signInIdentity(p) ?? me.id;
    const lock = await passwordLockout(lockKey, ip);
    if (!lock.ok) return { ok: false, error: "too-many-attempts", retryAfter: lock.retryAfter };
    if (!(await verifyPassword(p.hash, input.currentPassword))) {
      await recordPasswordFailure(lockKey, ip);
      return { ok: false, error: "wrong-password" };
    }
    await clearPasswordFailures(lockKey);

    const stored = await storePassword({ profileId: me.id, password: input.newPassword, event: "change", expect: p.hash, keepToken: session.token });
    if (!stored.ok) return { ok: false, error: "conflict" };
    sendPasswordNotice(p, "change");
    return { ok: true, ended: stored.ended };
  });

  /* ── POST /auth/password/code — a code to one's OWN address ───────────────
     For Réglages › Sécurité, to create a first password. The address comes from
     the session, never from the body. Same throttles as /auth/otp/request. */
  app.post("/auth/password/code", async (req, reply) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const parsed = codeBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    const [p] = await db
      .select({ hash: profiles.passwordHash, email: profiles.email, phone: profiles.phone, locale: profiles.locale })
      .from(profiles)
      .where(eq(profiles.id, session.profile.id))
      .limit(1);
    if (!p) return { ok: false, error: "not-authenticated" };
    if (p.hash) return { ok: false, error: "has-password" };
    const ident = signInIdentity(p);
    if (!ident) return { ok: false, error: "send-failed" };
    return sendCode(req, ident, parsed.data.locale ?? p.locale ?? undefined, "password");
  });

  /* ── POST /auth/password/reset — « Mot de passe oublié » ──────────────────
     A code proves the mailbox (the SAME budget as a code sign-in: proveCode), then
     the new password replaces whatever was there and EVERY session ends — this
     device arrives with none and gets a fresh one. The policy is checked before
     the code is spent, so a refused password does not burn it. A reset also lifts
     the account's lockout: whoever just read the mailbox is its owner. */
  app.post("/auth/password/reset", async (req, reply) => {
    const parsed = resetBody.safeParse(req.body);
    if (!parsed.success) {
      const r = refusal(parsed.error);
      return reply.code(r.status).send(r.body);
    }
    const input = parsed.data;
    const { channel, id, ok } = resolveIdentity(input.identifier);
    if (!ok) return { ok: false, error: "invalid-code" };

    const proof = await proveCode(req, id, input.code);
    if (!proof.ok) return proof;

    // The code is proven, so these answers only ever reach the mailbox's owner.
    const [profile] = await db.select().from(profiles).where(eq(identityColumn(channel), id)).limit(1);
    if (!profile) return { ok: false, error: "no-account" };
    if (profile.blockedAt) return { ok: false, error: "account-blocked" };

    const stored = await storePassword({ profileId: profile.id, password: input.password, event: "reset", expect: profile.passwordHash ?? null });
    if (!stored.ok) return { ok: false, error: "conflict" };
    await clearPasswordFailures(id);
    sendPasswordNotice(profile, "reset");

    const { token, expiresAt } = await createSession(profile.id);
    const state = await postLoginState(profile);
    return {
      ok: true,
      role: profile.role,
      ...state,
      ended: stored.ended,
      session: { token, expiresAt: expiresAt.toISOString() },
    };
  });

  /* ── GET /auth/security — Réglages › Sécurité ─────────────────────────────
     What is ALREADY stored, and nothing more: no IP, no user agent, no device
     name — the sessions table has never held those, and this does not start.
     Each live session is its dates and whether it is this one. No token hash. */
  app.get("/auth/security", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const me = session.profile;
    const limit = await checkRateLimit(`auth:security:${me.id}`, 60, 10 * 60_000);
    if (!limit.ok) return { ok: false, error: "too-many-attempts", retryAfter: limit.retryAfter };

    const [p] = await db
      .select({ hash: profiles.passwordHash, setAt: profiles.passwordSetAt })
      .from(profiles)
      .where(eq(profiles.id, me.id))
      .limit(1);
    // The same three clocks getSession enforces, so the list never shows a dead session.
    const rows = await db
      .select({ tokenHash: sessions.tokenHash, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(
        and(
          eq(sessions.profileId, me.id),
          gt(sessions.expiresAt, new Date()),
          gt(sessions.lastSeenAt, new Date(Date.now() - SESSION_IDLE_DAYS * 86_400_000)),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
    const mine = sessionTokenHash(session.token);
    return {
      ok: true,
      password: { set: Boolean(p?.hash), setAt: p?.setAt ? new Date(p.setAt).toISOString() : null },
      sessions: rows.map((r) => ({
        current: r.tokenHash === mine,
        createdAt: new Date(r.createdAt).toISOString(),
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
        expiresAt: new Date(r.expiresAt).toISOString(),
      })),
    };
  });
}
