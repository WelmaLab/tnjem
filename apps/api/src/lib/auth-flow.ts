import type { FastifyRequest } from "fastify";
import { and, eq, isNull, profiles, consents, tutors } from "@tnajem/db";
import { otpChannel, OTP_RESEND_COOLDOWN_SEC, OTP_TTL_SEC, type OtpChannel } from "@tnajem/shared/auth-core";
import { normalizeEmail, normalizePhone, isValidEmail, isValidPhone, isAdult } from "@tnajem/shared";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { smsEnabled, sendSms } from "@tnajem/shared/sms";
import { db } from "../db";
import { IS_PROD } from "../env";
import { checkRateLimit, ipBucket, peekRateLimit, rlSubject } from "./rate-limit";
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

/** Check — and CONSUME — a code for an already-normalised identity, inside the
    shared brute-force budget. Every route that accepts a code goes through here, so
    « Mot de passe oublié » cannot become a second, separate guessing budget. */
export async function proveCode(req: FastifyRequest, id: string, code: string): Promise<ProveCodeResult> {
  /* Brute-force budget. otp_codes.attempts caps guesses at 5 PER CODE, but that
     counter is reset by every new code — and requesting one only costs a 60s
     cooldown. So the pre-existing ceiling was really "5 guesses per minute,
     forever, per identity" against a 6-digit space. Two throttles close it:
       • per-identity: 10 guesses / 15 min — with the 5-per-code cap this leaves
         an attacker ~960 guesses/day against 1,000,000 codes (about 0.1%/day).
       • per-IP: stops one host farming many identities in parallel.

     Being THROTTLED is reported distinctly as "too-many-attempts". That is a
     fact about the CALLER, not the account: it is returned for any identity
     once the budget is spent, so it reveals nothing about whether an account
     exists. Expiry, by contrast, stays folded into "invalid-code" — telling a
     caller their code "expired" would confirm one had been issued, which is
     exactly the enumeration oracle this opacity exists to prevent. */
  /* ONLY A WRONG CODE SPENDS THE PER-IDENTITY BUDGET. It used to be spent by every
     attempt, a person's own correct one included; brute force is made of failures,
     so counting successes bought nothing. The key holds a keyed hash, never the
     address. The per-IP budget still counts every attempt: it is about the host. */
  const idKey = `otp:vfy:id:${rlSubject(id)}`;
  const perId = await peekRateLimit(idKey, 10);
  if (!perId.ok) return { ok: false, error: "too-many-attempts", retryAfter: perId.retryAfter };
  const perIp = await checkRateLimit(`otp:vfy:ip:${clientIp(req)}`, 30, 15 * 60_000);
  if (!perIp.ok) return { ok: false, error: "too-many-attempts", retryAfter: perIp.retryAfter };

  const valid = await verifyOtpCode(id, (code || "").trim());
  if (!valid) {
    await checkRateLimit(idKey, 10, 15 * 60_000);
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
