import type { FastifyRequest } from "fastify";
import { and, eq, isNull, profiles, consents, tutors } from "@tnajem/db";
import { otpChannel, OTP_RESEND_COOLDOWN_SEC, OTP_TTL_SEC, type OtpChannel } from "@tnajem/shared/auth-core";
import { normalizeEmail, normalizePhone, isValidEmail, isValidPhone, isAdult } from "@tnajem/shared";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { smsEnabled, sendSms } from "@tnajem/shared/sms";
import { db } from "../db";
import { IS_PROD } from "../env";
import { checkRateLimit, ipBucket } from "./rate-limit";
import { guardCheck, guardFailure, type AttemptGuard } from "./attempt-guard";
import { createOtp, otpCooldownRemaining, verifyOtpCode } from "./otp";
import { OTP_MAIL, type OtpPurpose } from "./otp-copy";

/* espace prof v2 · phase 2 — the pieces of sign-in that more than one route needs.

   Moved out of routes/auth.ts, comments and all, when passwords arrived: a code now
   also proves the mailbox for « Mot de passe oublié » and for creating a password
   from Réglages (routes/passwords.ts), and a password sign-in ends in exactly the
   same post-login answer as a code sign-in. One copy of each, so the two ways in
   cannot drift apart. */

/** The client address, as forwarded by the web app. Fastify resolves this through
    trustProxy, which trusts SPECIFIC hops only — see env.ts. Never an authz
    input; it is a throttle key. */
export function clientIp(req: FastifyRequest): string {
  return ipBucket(req.ip);
}

/* Normalise, then validate, then use the NORMALISED value — never the raw input.
   normalizeEmail lower-cases, which is what stops "Sam@x.com" and "sam@x.com"
   becoming two accounts against a case-sensitive unique index. */
export function resolveIdentity(raw: string): { channel: OtpChannel; id: string; ok: boolean } {
  const channel = otpChannel();
  const id = channel === "email" ? normalizeEmail(raw) : normalizePhone(raw);
  return { channel, id, ok: channel === "email" ? isValidEmail(id) : isValidPhone(id) };
}

/** The profiles column the ACTIVE channel signs in with. */
export function identityColumn(channel: OtpChannel) {
  return channel === "email" ? profiles.email : profiles.phone;
}

export type SendCodeResult =
  | { ok: true; devCode?: string; resendAfter: number; expiresIn: number }
  | { ok: false; error: "too-soon"; retryAfter: number }
  | { ok: false; error: "send-failed" };

/** Mint and deliver a code to an already-normalised, already-valid identity. */
export async function sendCode(req: FastifyRequest, id: string, locale: string | undefined, purpose: OtpPurpose = "login"): Promise<SendCodeResult> {
  const timing = { resendAfter: OTP_RESEND_COOLDOWN_SEC, expiresIn: OTP_TTL_SEC };

  /* Anti-abuse, two layers:
       1. per-IP — the per-identity cooldown below is keyed on a value the
          ATTACKER supplies, so alone it stops nothing: rotate the address and
          you can send unlimited messages. On SMS that was a direct billing
          drain and an SMS-bombing service pointed at arbitrary Tunisians from
          our sender id. Email is cheaper but not consequence-free: the
          equivalent abuse is mail-bombing a stranger's inbox from our domain,
          which is how a sending domain earns a spam reputation and stops
          delivering for everyone.
       2. per-identity cooldown — protects one victim from repeat messages. */
  const ip = await checkRateLimit(`otp:req:ip:${clientIp(req)}`, 10, 10 * 60_000);
  if (!ip.ok) return { ok: false, error: "too-soon", retryAfter: ip.retryAfter };

  const wait = await otpCooldownRemaining(id);
  if (wait > 0) return { ok: false, error: "too-soon", retryAfter: wait };

  // createOtp re-checks the cooldown under an advisory lock and returns null if
  // a concurrent call already minted a code for this identity.
  const code = await createOtp(id);
  if (!code) return { ok: false, error: "too-soon", retryAfter: 60 };

  const m = OTP_MAIL[locale === "ar" ? "ar" : "fr"];

  /* Production posture: the code is NEVER returned to the client when a
     provider is configured. If delivery fails, surface a retryable error — do
     not fall through and leak it. */
  if (otpChannel() === "email") {
    if (mailEnabled()) {
      const sent = await sendMail(id, m.subject(code, purpose), m.body(code, purpose));
      return sent ? { ok: true, ...timing } : { ok: false, error: "send-failed" };
    }
  } else if (smsEnabled()) {
    const sent = await sendSms(id, m.sms(code));
    return sent ? { ok: true, ...timing } : { ok: false, error: "send-failed" };
  }

  /* No provider configured. Two very different situations, and conflating them
     was an account-takeover hole: this used to return the OTP unconditionally,
     gated only on mailEnabled()/smsEnabled(). Those are env-PRESENCE checks, so
     a production deploy shipped without MAIL_* became an oracle — type any
     stranger's address, read their login code off the screen, own the account.
     Fail closed in production; keep the on-screen code for local dev only. */
  if (IS_PROD) {
    req.log.error(
      "requestOtp: no OTP provider configured in production — refusing to return " +
        "the code. Set MAIL_HOST/MAIL_USER/MAIL_PASS/MAIL_FROM_ADDRESS (or TWILIO_* " +
        "with OTP_CHANNEL=sms). Nobody can sign in until this is fixed.",
    );
    return { ok: false, error: "send-failed" };
  }
  return { ok: true, devCode: code, ...timing };
}

export type ProveCodeResult =
  | { ok: true }
  | { ok: false; error: "too-many-attempts"; retryAfter: number }
  | { ok: false; error: "invalid-code" };

/* ── The code-guessing guards (lib/attempt-guard.ts, VULN-001) ─────────────────
   One per flow, with its own key prefix, so attacking sign-in never delays a reset
   and the other way round.
     pair  10 failures for (address, IP) in 15 min → that network waits 15 min
     delay past 5 failures for the address (any IP) in 15 min, 2 s doubling to 60 s
   otp_codes.attempts still caps guesses at 5 PER CODE (otp.ts) — that is what
   bounds guessing one code; these bound the rate around it. */
const CODE_PAIR = { max: 10, windowMs: 15 * 60_000 };
const CODE_DELAY = { free: 5, baseSec: 2, capSec: 60, windowMs: 15 * 60_000, cleanPairFailures: 2 };
export const CODE_GUARDS = {
  login: { prefix: "otp:vfy", pair: CODE_PAIR, delay: CODE_DELAY },
  reset: { prefix: "reset:vfy", pair: CODE_PAIR, delay: CODE_DELAY },
} satisfies Record<string, AttemptGuard>;
/** Every attempt from one IP, across addresses, per flow: 30 / 15 min. */
export const CODE_IP_BUDGET = { max: 30, windowMs: 15 * 60_000 };
export type CodeScope = keyof typeof CODE_GUARDS;

/** Check — and CONSUME — a code for an already-normalised identity, inside the
    brute-force guards. Every route that accepts a code goes through here. `scope`
    picks the counters: « Mot de passe oublié » counts apart from sign-in. */
export async function proveCode(req: FastifyRequest, id: string, code: string, scope: CodeScope = "login"): Promise<ProveCodeResult> {
  /* Being HELD BACK is reported distinctly as "too-many-attempts". That is a fact
     about the CALLER (this network, or this address's recent failures), and it is
     given for any identity, account or not, so it reveals nothing about whether an
     account exists. Expiry, by contrast, stays folded into "invalid-code" — telling
     a caller their code "expired" would confirm one had been issued, which is
     exactly the enumeration oracle this opacity exists to prevent.

     It used to be a 10-failures-per-ADDRESS budget from any IP: a stranger could
     spend it and the owner's correct code was refused everywhere (VULN-001). Now the
     address-wide count only slows networks that have themselves failed; see
     attempt-guard.ts. Only a wrong code counts there; the per-IP budget still
     counts every attempt: it is about the host. The keys hold a keyed hash, never
     the address. */
  const guard = CODE_GUARDS[scope];
  const ip = clientIp(req);
  const held = await guardCheck(guard, id, ip);
  if (!held.ok) return { ok: false, error: "too-many-attempts", retryAfter: held.retryAfter };
  const perIp = await checkRateLimit(`${guard.prefix}:ip:${ip}`, CODE_IP_BUDGET.max, CODE_IP_BUDGET.windowMs);
  if (!perIp.ok) return { ok: false, error: "too-many-attempts", retryAfter: perIp.retryAfter };

  const valid = await verifyOtpCode(id, (code || "").trim());
  if (!valid) {
    await guardFailure(guard, id, ip);
    return { ok: false, error: "invalid-code" };
  }
  return { ok: true };
}

/** What the web needs to decide where a freshly signed-in person goes
    (apps/web/lib/auth-destination.ts). The same answer whichever way they got in. */
export async function postLoginState(profile: {
  id: string;
  role: string;
  fullName: string | null;
  birthYear: number | null;
  birthMonth: number | null;
}): Promise<{ needsConsent: boolean; needsProfile: boolean; hasStorefront: boolean }> {
  let needsConsent = false;
  /* Guardian consent is a MINORS-only requirement (INPDP). Adults skip it;
     unknown age fails safe (isAdult treats a missing month or year as a minor),
     matching reserveSeat's gate. phase-a lane L2 (A24): month-aware. */
  if (profile.role === "student" && !isAdult(profile.birthYear, profile.birthMonth)) {
    const [c] = await db
      .select({ id: consents.id })
      .from(consents)
      .where(and(eq(consents.minorId, profile.id), isNull(consents.withdrawnAt)))
      .limit(1);
    needsConsent = !c;
  }

  /* A student with no name yet still owes us the welcome screen. Checked on
     EVERY login, not just the first, so a student who skipped it (the skip link
     exists so onboarding can never cost a booking) is asked again next time. */
  const needsProfile = profile.role === "student" && !profile.fullName;

  /* Does this tutor already have a storefront? Without it, postAuthDestination
     could only ever send tutors to /onboarding, so a tutor publishing for
     months landed on "create your page" at every single login. One indexed
     lookup, and only for tutors. */
  let hasStorefront = false;
  if (profile.role === "tutor") {
    const [mine] = await db
      .select({ id: tutors.id })
      .from(tutors)
      .where(eq(tutors.profileId, profile.id))
      .limit(1);
    hasStorefront = Boolean(mine);
  }

  return { needsConsent, needsProfile, hasStorefront };
}
