import argon2 from "argon2";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, like, ne, or, profiles, rateLimits, sessions, sql as raw } from "@tnajem/db";
import { authSecret, safeEq, sessionTokenHash } from "@tnajem/shared/auth-core";
import { formatNumericDate, normalizePassword, tunisClock, PASSWORD_MAX_LENGTH, type PasswordProblem } from "@tnajem/shared";
import { passwordProblem } from "@tnajem/shared/password-check";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { logEvent } from "@tnajem/shared/observability";
import { db } from "../db";
import { auditAdmin } from "./audit";
import { peekRateLimit, rateLimitInProcess, rlSubject, type RateLimitResult } from "./rate-limit";
import { PASSWORD_MAIL, type PasswordEvent } from "./password-copy";

/* espace prof v2 · phase 2 — PASSWORDS. Everything that touches one lives here.

   ── STORAGE ──────────────────────────────────────────────────────────────────
   argon2id with the OWASP Password Storage Cheat Sheet's first configuration:
   m = 19 MiB, t = 2, p = 1 (≈ 20 ms here). The PHC string carries its own salt and
   parameters, so raising them later only needs needsRehash() on the next login.
   The plaintext exists in this process for the length of one request: it is never
   stored (a CHECK on profiles.password_hash refuses anything but "$argon2id$…"),
   never logged (lib/logging.ts REDACT_PATHS + observability's scrubber list
   "password", "currentPassword", "newPassword") and never echoed in a response.

   ── WHAT A LOGIN MUST NOT REVEAL ─────────────────────────────────────────────
   Whether an address has an account, and whether that account has a password.
   So an unknown address and a password-less account still pay for one argon2
   verify (against DUMMY_HASH, same parameters) and get the same answer as a wrong
   password; and the lockout counter is keyed on the SUBMITTED address, account or
   not, so being locked out is no oracle either. */

export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/* Computed once at boot, never from a real password. A verify against it costs what
   a real verify costs, which is the whole point. */
const DUMMY_HASH: Promise<string> = argon2.hash(randomBytes(24).toString("hex"), ARGON2_OPTIONS);
DUMMY_HASH.catch(() => {}); // a failure resurfaces (and is handled) on first use

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(normalizePassword(password), ARGON2_OPTIONS);
}

/** True only for the right password. A missing hash still costs one verify. */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  const pw = normalizePassword(password);
  try {
    if (!hash) {
      await argon2.verify(await DUMMY_HASH, pw);
      return false;
    }
    return await argon2.verify(hash, pw);
  } catch {
    return false; // a malformed hash is a refusal, never a 500
  }
}

export function passwordNeedsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}

/* ── The policy, as Zod ──────────────────────────────────────────────────────
   A NEW password (sign-up, change, reset) goes through newPasswordSchema: the
   length and common-password rules from @tnajem/shared/password-check. A policy
   refusal is a domain answer — { ok:false, error:"weak-password", reason } with a
   200 — because it is shown on the field; a body of the wrong SHAPE is a 400. */
const RAW_CAP = PASSWORD_MAX_LENGTH * 4; // UTF-16 units, before NFKC: never normalise megabytes

export const newPasswordSchema = z.string().superRefine((pw, ctx) => {
  const reason: PasswordProblem | null = pw.length > RAW_CAP ? "too-long" : passwordProblem(pw);
  if (reason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: reason, params: { passwordPolicy: reason } });
});

/** A password someone already has: any non-empty string. No policy — it is theirs. */
export const currentPasswordSchema = z.string().min(1).max(RAW_CAP);

/** The policy reason inside a failed parse, when that is why it failed. */
export function weakPasswordReason(error: z.ZodError): PasswordProblem | null {
  for (const issue of error.issues) {
    const reason = (issue as { params?: { passwordPolicy?: PasswordProblem } }).params?.passwordPolicy;
    if (reason) return reason;
  }
  return null;
}

/* ── The "you just proved your mailbox" grant ─────────────────────────────────
   A code sign-in consumes the code. Asking for a SECOND code to then create a
   password (the sign-up step, the one-time prompt) would be absurd, so the verify
   that proved the mailbox hands back a short-lived grant: an HMAC over the profile
   id and the issue time. /auth/password/set accepts it in place of a code, only
   for an account that has NO password yet, and only with a session for that same
   profile. Stateless; single-use in effect, because once a password exists the
   grant no longer opens anything. */
export const PASSWORD_GRANT_TTL_MS = 30 * 60_000;

function grantMac(profileId: string, issuedAt: number): string {
  return createHmac("sha256", authSecret()).update(`tnajem:pw-grant:v1:${profileId}:${issuedAt}`).digest("hex");
}

export function issuePasswordGrant(profileId: string, now = Date.now()): string {
  return `${now}.${grantMac(profileId, now)}`;
}

export function passwordGrantValid(profileId: string, grant: string | undefined | null, now = Date.now()): boolean {
  if (!grant) return false;
  const m = /^(\d{10,16})\.([0-9a-f]{64})$/.exec(grant);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  if (!(issuedAt <= now && now - issuedAt <= PASSWORD_GRANT_TTL_MS)) return false;
  return safeEq(m[2], grantMac(profileId, issuedAt));
}

/* ── Lockout: three budgets, all counting FAILURES only (a success is no attack) ──
     pair     (address, IP)  5 failures → that pair waits 15 minutes
     ip       one IP         50 failures in 15 minutes, across every address
     account  one address    20 failures in an hour, across every IP
   The PAIR is the lock a person meets. It used to be "5 per address" and "5 per IP"
   separately, and on a Tunisian mobile network hundreds of people share one IP: a
   single bad actor locked password login for all of them for 15 minutes. Now a
   wrong-password streak only stops that address on that network. The two caps are
   what stop the attacks the pair alone would let through: one host spraying many
   addresses (ip), and many hosts guessing one address (account).

   The address goes in as a keyed hash, like every identity key, and is counted
   whether or not it has an account, so being locked out is no oracle. A budget's
   window is extended when it fills, so the wait runs from the failure that filled
   it — a plain fixed window would lock for whatever was left of a window opened by
   the FIRST failure, possibly seconds. While locked, attempts are refused before
   any hashing and are not counted, so the lock cannot be stretched by hammering. */
type FailureBudget = { max: number; windowMs: number };
export const PASSWORD_PAIR_BUDGET: FailureBudget = { max: 5, windowMs: 15 * 60_000 };
export const PASSWORD_IP_BUDGET: FailureBudget = { max: 50, windowMs: 15 * 60_000 };
export const PASSWORD_ACCOUNT_BUDGET: FailureBudget = { max: 20, windowMs: 60 * 60_000 };

/* The pair key ENDS in the IP (test cleanup and every per-IP key do), and starts
   with the account's prefix, so a reset can lift every pair of one address. */
const pairPrefix = (identifier: string) => `pw:fail:pair:${rlSubject(identifier)}:`;
export const passwordFailKeys = (identifier: string, ip: string) => ({
  pair: `${pairPrefix(identifier)}${ip}`,
  ip: `pw:fail:ip:${ip}`,
  account: `pw:fail:id:${rlSubject(identifier)}`,
});

export async function passwordLockout(identifier: string, ip: string): Promise<RateLimitResult> {
  const keys = passwordFailKeys(identifier, ip);
  const checks = await Promise.all([
    peekRateLimit(keys.pair, PASSWORD_PAIR_BUDGET.max),
    peekRateLimit(keys.ip, PASSWORD_IP_BUDGET.max),
    peekRateLimit(keys.account, PASSWORD_ACCOUNT_BUDGET.max),
  ]);
  if (checks.every((c) => c.ok)) return { ok: true, retryAfter: 0 };
  return { ok: false, retryAfter: Math.max(...checks.map((c) => c.retryAfter)) };
}

async function countFailure(key: string, { max, windowMs }: FailureBudget): Promise<void> {
  try {
    await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt: raw`now() + ${windowMs} * interval '1 millisecond'` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: raw`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: raw`case when ${rateLimits.resetAt} <= now() or ${rateLimits.count} + 1 >= ${max}
                            then now() + ${windowMs} * interval '1 millisecond'
                            else ${rateLimits.resetAt} end`,
        },
      });
  } catch (e) {
    // The code only (see rate-limit.ts): the key's parameters must not reach a log.
    console.error("[tnajem-api] password lockout write failed — in-process fallback:", (e as { code?: string }).code ?? (e as Error).name);
    rateLimitInProcess(key, max, windowMs);
  }
}

export async function recordPasswordFailure(identifier: string, ip: string): Promise<void> {
  const keys = passwordFailKeys(identifier, ip);
  await Promise.all([
    countFailure(keys.pair, PASSWORD_PAIR_BUDGET),
    countFailure(keys.ip, PASSWORD_IP_BUDGET),
    countFailure(keys.account, PASSWORD_ACCOUNT_BUDGET),
  ]);
}

/** After a success: THIS pair's streak only. The IP cap stays (clearing it would let
    one host interleave its own logins between guesses at other addresses), and so
    does the account's hourly count (the owner signing in must not hand guessers
    elsewhere a fresh budget). */
export async function clearPasswordFailures(identifier: string, ip: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, passwordFailKeys(identifier, ip).pair));
}

/** After a reset, which proved the mailbox: everything that was holding this ADDRESS
    back — its hourly count and its pair with every IP. The per-IP caps stay. */
export async function liftPasswordLockout(identifier: string): Promise<void> {
  await db
    .delete(rateLimits)
    .where(or(eq(rateLimits.key, passwordFailKeys(identifier, "").account), like(rateLimits.key, `${pairPrefix(identifier)}%`)));
}

/* ── Writing a password ───────────────────────────────────────────────────────
   One transaction: the hash, the date, every OTHER session revoked (all of them for
   a reset, which arrives with none), and the audit row — no audit row, no change
   (lib/audit.ts). `expect` is the hash the caller saw: the update only lands if it
   is still there, so two concurrent changes cannot silently overwrite each other. */
export type StoreResult = { ok: true; ended: number } | { ok: false; error: "conflict" };

export async function storePassword(opts: {
  profileId: string;
  password: string;
  event: PasswordEvent;
  expect: string | null;
  keepToken?: string;
}): Promise<StoreResult> {
  const hash = await hashPassword(opts.password);
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(profiles)
      .set({ passwordHash: hash, passwordSetAt: new Date() })
      .where(and(eq(profiles.id, opts.profileId), opts.expect === null ? isNull(profiles.passwordHash) : eq(profiles.passwordHash, opts.expect)))
      .returning({ id: profiles.id });
    if (!updated.length) return { ok: false, error: "conflict" } as const;

    const ended = await tx
      .delete(sessions)
      .where(
        opts.keepToken
          ? and(eq(sessions.profileId, opts.profileId), ne(sessions.tokenHash, sessionTokenHash(opts.keepToken)))
          : eq(sessions.profileId, opts.profileId),
      )
      .returning({ profileId: sessions.profileId });

    await auditAdmin(null, `account.password.${opts.event}`, { kind: "profile", id: opts.profileId }, null, tx);
    return { ok: true, ended: ended.length } as const;
  });
}

/** Re-hash on a successful login when the parameters have moved. Best-effort. */
export async function upgradeHashIfNeeded(profileId: string, hash: string, password: string): Promise<void> {
  if (!passwordNeedsRehash(hash)) return;
  try {
    const fresh = await hashPassword(password);
    await db.update(profiles).set({ passwordHash: fresh }).where(and(eq(profiles.id, profileId), eq(profiles.passwordHash, hash)));
  } catch (e) {
    console.error("[tnajem-api] password rehash failed:", (e as { code?: string }).code ?? (e as Error).name);
  }
}

/* ── The notice ───────────────────────────────────────────────────────────────
   Every set, change and reset tells the mailbox, in the account's language — the
   one signal a person whose password was changed by someone else will see. Not
   awaited: a slow SMTP server must not hold the response, and a failure is logged
   as an event (sendMail never throws). No provider configured (dev, tests) → no-op. */
export function sendPasswordNotice(to: { email: string | null; locale: string | null }, event: PasswordEvent): void {
  if (!to.email || !mailEnabled()) return;
  const m = PASSWORD_MAIL[to.locale === "ar" ? "ar" : "fr"];
  const now = new Date();
  void sendMail(to.email, m.subject(event), m.body(event, formatNumericDate(now), tunisClock(now))).then((sent) => {
    if (!sent) logEvent("warn", "password_notice_not_sent", { event });
  });
}
