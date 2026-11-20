import argon2 from "argon2";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull, like, ne, or, profiles, rateLimits, sessions } from "@tnajem/db";
import { authSecret, safeEq, sessionTokenHash } from "@tnajem/shared/auth-core";
import { formatNumericDate, normalizePassword, tunisClock, PASSWORD_MAX_LENGTH, type PasswordProblem } from "@tnajem/shared";
import { passwordProblem } from "@tnajem/shared/password-check";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { logEvent } from "@tnajem/shared/observability";
import { db } from "../db";
import { auditAdmin } from "./audit";
import { peekRateLimit, rlSubject } from "./rate-limit";
import {
  countFailure,
  guardCheck,
  guardFailure,
  guardKeys,
  strictEnter,
  UNTRUSTED_DELAY,
  type AttemptGuard,
  type FailureBudget,
  type ProgressiveDelay,
  type StrictPass,
} from "./attempt-guard";
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
   password; and the lockout and delay counters are keyed on the SUBMITTED address, account or
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

/* ── Lockout and delay: all counting FAILURES only (a success is no attack) ──────
     pair     (address, IP)  5 failures → that pair waits 15 minutes
     ip       one IP         50 failures in 15 minutes, across every address
     delay    one address    past 5 failures in an hour from any IP, a wait of 2 s
                             doubling to 60 s for the networks that have failed
                             (lib/attempt-guard.ts) — never a refusal
   The PAIR is the lock a person meets. It used to be "5 per address" and "5 per IP"
   separately, and on a Tunisian mobile network hundreds of people share one IP: a
   single bad actor locked password login for all of them for 15 minutes. Now a
   wrong-password streak only stops that address on that network. The IP cap stops
   one host spraying many addresses.

   Many hosts guessing one address used to meet an ACCOUNT cap — 20 failures an hour
   locked the address everywhere — and that was a lock any stranger could turn on the
   owner (VULN-001). It is now the progressive delay: a network that has not failed
   for the address is never held, so the owner on their own network still gets in,
   and a network that has waits at most a minute.

   The address goes in as a keyed hash, like every identity key, and is counted
   whether or not it has an account, so being held back is no oracle. A pair's window
   is extended when it fills, so the wait runs from the failure that filled it. While
   held back, attempts are refused before any hashing and are not counted, so the
   wait cannot be stretched by hammering.

   VULN-001 follow-up: those are the LENIENT rules, kept for a browser holding a
   valid trusted-browser token for the address (lib/trusted-browser.ts). Every other
   attempt also meets the strict identity-wide delay (attempt-guard.ts): past 3
   untrusted attempts in 24 h, one at a time, 60 s doubling to 15 minutes. */
export const PASSWORD_PAIR_BUDGET: FailureBudget = { max: 5, windowMs: 15 * 60_000 };
export const PASSWORD_IP_BUDGET: FailureBudget = { max: 50, windowMs: 15 * 60_000 };
export const PASSWORD_DELAY: ProgressiveDelay = { free: 5, baseSec: 2, capSec: 60, windowMs: 60 * 60_000, cleanPairFailures: 2 };
const PASSWORD_GUARD: AttemptGuard = { prefix: "pw:fail", pair: PASSWORD_PAIR_BUDGET, delay: PASSWORD_DELAY, strict: UNTRUSTED_DELAY };

/* The pair key ENDS in the IP (test cleanup and every per-IP key do), and starts
   with the account's prefix, so a reset can lift every pair of one address. */
const pairPrefix = (identifier: string) => `pw:fail:pair:${rlSubject(identifier)}:`;
export const passwordFailKeys = (identifier: string, ip: string) => {
  const g = guardKeys(PASSWORD_GUARD.prefix, identifier, ip);
  return { pair: g.pair, ip: `pw:fail:ip:${ip}`, account: g.id, gate: g.gate, untrusted: g.sid, untrustedGate: g.sgate };
};

/** May this attempt be evaluated? When it may, it has also been RESERVED against the
    strict delay (untrusted browsers): call `succeeded()` on the right password. */
export async function passwordLockout(identifier: string, ip: string, trusted = false): Promise<StrictPass | { ok: false; retryAfter: number }> {
  const [perIp, held] = await Promise.all([
    peekRateLimit(passwordFailKeys(identifier, ip).ip, PASSWORD_IP_BUDGET.max),
    guardCheck(PASSWORD_GUARD, identifier, ip, trusted),
  ]);
  if (!perIp.ok || !held.ok) return { ok: false, retryAfter: Math.max(perIp.retryAfter, held.retryAfter) };
  return strictEnter(PASSWORD_GUARD, identifier, trusted);
}

export async function recordPasswordFailure(identifier: string, ip: string): Promise<void> {
  await Promise.all([
    countFailure(passwordFailKeys(identifier, ip).ip, PASSWORD_IP_BUDGET),
    guardFailure(PASSWORD_GUARD, identifier, ip),
  ]);
}

/** After a success: THIS pair's streak only. The IP cap stays (clearing it would let
    one host interleave its own logins between guesses at other addresses), and so
    does the address's count (the owner signing in must not hand guessers elsewhere
    a fresh run of undelayed tries). */
export async function clearPasswordFailures(identifier: string, ip: string): Promise<void> {
  await db.delete(rateLimits).where(eq(rateLimits.key, passwordFailKeys(identifier, ip).pair));
}

/** After a reset, which proved the mailbox: everything that was holding this ADDRESS
    back from password sign-in — its counts, its waits (lenient and strict) and its
    pair with every IP. The per-IP caps stay. */
export async function liftPasswordLockout(identifier: string): Promise<void> {
  const k = passwordFailKeys(identifier, "");
  await db
    .delete(rateLimits)
    .where(
      or(
        eq(rateLimits.key, k.account),
        eq(rateLimits.key, k.gate),
        eq(rateLimits.key, k.untrusted),
        eq(rateLimits.key, k.untrustedGate),
        like(rateLimits.key, `${pairPrefix(identifier)}%`),
      ),
    );
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
