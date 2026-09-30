import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, eq, isNull, profiles, consents, tutors } from "@tnajem/db";
import {
  otpChannel,
  OTP_RESEND_COOLDOWN_SEC,
  OTP_TTL_SEC,
} from "@tnajem/shared/auth-core";
import {
  normalizeEmail,
  normalizePhone,
  isValidEmail,
  isValidPhone,
  vBirthYear,
  TERMS_VERSION,
  // phase-a lane L2 (A24)
  vBirthMonth,
  isAdult,
  minorsAllowed,
} from "@tnajem/shared";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { smsEnabled, sendSms } from "@tnajem/shared/sms";
import { db } from "../db";
import { IS_PROD } from "../env";
import { checkRateLimit, ipBucket, peekRateLimit, rlSubject } from "../lib/rate-limit";
import { createOtp, otpCooldownRemaining, verifyOtpCode } from "../lib/otp";
import { createSession, destroyProfileSessions, destroySession, getSession } from "../lib/session";
import { OTP_MAIL } from "../lib/otp-copy";

/* auth-write. Ported from apps/web/app/actions.ts, branch for branch.

   ── WHY THE SESSION TOKEN COMES BACK IN THE BODY ────────────────────────────
   These endpoints mint a session, and the cookie has to end up on the BROWSER,
   not on the web server that proxied the call. Two options existed: pass
   Set-Cookie through the proxy, or return the token and let the web set it.

   The body wins for now. It keeps the cookie attributes in exactly ONE place
   (apps/web/lib/auth.ts::createSession) rather than requiring a Set-Cookie parser
   that must faithfully round-trip httpOnly/sameSite/secure/expires/path — a
   mismatch on any of those produces two cookies and an intermittently
   logged-out user. The token crosses the web→api hop in a body, which is the
   same trust boundary the cookie itself crosses, so it is no new exposure —
   PROVIDED that body is never logged. lib/logging.ts redacts `token`.

   At Step 5, when the browser talks to api.tnajem.com directly, the API will set
   cookies itself and Set-Cookie pass-through becomes the natural design.

   ROLE_HINT_COOKIE stays 100% on the web side. It is a forgeable UI hint that
   only decides which nav link renders; the API must not know it exists. */

const requestOtpBody = z.object({
  identifier: z.string(),
  locale: z.string().optional(),
});

const verifyOtpBody = z.object({
  identifier: z.string(),
  code: z.string(),
  role: z.enum(["tutor", "student"]).optional(),
  locale: z.string().optional(),
  birthYear: z.number().optional(),
  birthMonth: z.number().optional(), // phase-a lane L2 (A24)
});

/** The client address, as forwarded by the web app. Fastify resolves this through
    trustProxy, which trusts SPECIFIC hops only — see env.ts. Never an authz
    input; it is a throttle key. */
function clientIp(req: FastifyRequest): string {
  return ipBucket(req.ip);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /auth/otp/request ─────────────────────────────────────────────── */
  app.post("/auth/otp/request", async (req, reply) => {
    const parsed = requestOtpBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    const timing = { resendAfter: OTP_RESEND_COOLDOWN_SEC, expiresIn: OTP_TTL_SEC };

    /* Normalise, then validate, then use the NORMALISED value — never the raw
       input. normalizeEmail lower-cases, which is what stops "Sam@x.com" and
       "sam@x.com" becoming two accounts against a case-sensitive unique index. */
    const channel = otpChannel();
    const id = channel === "email" ? normalizeEmail(input.identifier) : normalizePhone(input.identifier);
    const idOk = channel === "email" ? isValidEmail(id) : isValidPhone(id);
    if (!idOk) {
      return { ok: false, error: channel === "email" ? "invalid-email" : "invalid-phone" };
    }

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

    const m = OTP_MAIL[input.locale === "ar" ? "ar" : "fr"];

    /* Production posture: the code is NEVER returned to the client when a
       provider is configured. If delivery fails, surface a retryable error — do
       not fall through and leak it. */
    if (channel === "email") {
      if (mailEnabled()) {
        const sent = await sendMail(id, m.subject(code), m.body(code));
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
  });

  /* ── POST /auth/otp/verify ──────────────────────────────────────────────── */
  app.post("/auth/otp/verify", async (req, reply) => {
    const parsed = verifyOtpBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    /* Same normalise-then-validate order as request, and the same channel. An
       invalid identity is reported as "invalid-code", NOT "invalid-email": this
       endpoint must not become an oracle that distinguishes a malformed address
       from a wrong code. */
    const channel = otpChannel();
    const id = channel === "email" ? normalizeEmail(input.identifier) : normalizePhone(input.identifier);
    const idOk = channel === "email" ? isValidEmail(id) : isValidPhone(id);
    if (!idOk) return { ok: false, error: "invalid-code" };

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

    const valid = await verifyOtpCode(id, (input.code || "").trim());
    if (!valid) {
      await checkRateLimit(idKey, 10, 15 * 60_000);
      return { ok: false, error: "invalid-code" };
    }

    /* role and locale are pgEnum/text columns on a public surface: an arbitrary
       string would reach Postgres and blow up as "invalid input value for enum
       user_role" — a 500 by input. Pin both to the allowed set.

       role is OPTIONAL and its absence is MEANINGFUL: /auth is SIGN IN and sends
       none; /signup/{prof,eleve} send a fixed one. A caller with no role can
       never create an account (see the no-account branch), which is what keeps
       the signup screens the only place a profile is born. */
    const requestedRole = input.role === "tutor" ? "tutor" : input.role === "student" ? "student" : null;
    const locale = input.locale === "ar" ? "ar" : "fr";
    /* Self-reported at signup. phase-a lane L2 (A24, A14): month + year, and for
       BOTH roles — a student's drives the adult-only pilot and the consent gate; a
       tutor's is the 18+ rule, because /signup/prof used to ask no age at all and
       only the manual ID review stood between a 16-year-old and a storefront. */
    const birthYear = requestedRole ? vBirthYear(input.birthYear) : null;
    // A year alone passes a December-born 17-year-old as 18 from January.
    const birthMonth = requestedRole ? vBirthMonth(input.birthMonth) : null;

    /* Look the account up by the identity column the ACTIVE channel owns. Under
       OTP_CHANNEL=sms that is profiles.phone; under email, profiles.email. Both
       are nullable-and-unique, so the channels coexist without either forcing a
       value on the other. */
    const idColumn = channel === "email" ? profiles.email : profiles.phone;
    let [profile] = await db.select().from(profiles).where(eq(idColumn, id)).limit(1);
    let created = false;

    if (!profile) {
      /* No account, and the caller did not say which kind to create — someone
         typed an address into SIGN IN that has never signed up. We refuse rather
         than quietly minting a student profile they never asked for.

         The code has already been CONSUMED at this point (verifyOtpCode deletes
         on success), so they need a fresh one to sign up. That is deliberate: the
         alternative is checking whether the identity has an account BEFORE they
         prove they own it, which is a user-enumeration oracle. One extra message
         on a rare path beats letting anyone probe who is on the platform. */
      if (!requestedRole) return { ok: false, error: "no-account" };
      /* phase-a lane L2 (A24) — THE ADULT-ONLY PILOT (D6), on EVERY sign-up path.
         The signup form's "J'ai déjà un code" link skips the send step, and the
         birth date used to be optional here, so an account could be born with no
         age at all. Month and year are both required, and while ALLOW_MINORS is
         off a minor gets no account. Checked after the code is proven, for the
         reason given above: an answer about an account only reaches its owner. */
      if (birthYear == null || birthMonth == null) return { ok: false, error: "birth-date-required" };
      // phase-a lane L2 (A14): a tutor teaches children — 18+, whatever ALLOW_MINORS says.
      if (requestedRole === "tutor" && !isAdult(birthYear, birthMonth)) return { ok: false, error: "minor-cannot-teach" };
      if (requestedRole === "student" && !minorsAllowed() && !isAdult(birthYear, birthMonth)) {
        return { ok: false, error: "adults-only" };
      }
      // Only the ACTIVE channel's column is written. The other stays null until
      // the user supplies it — the phone is an optional CONTACT collected during
      // onboarding, not a login credential.
      const identity = channel === "email" ? { email: id } : { phone: id };
      /* ON CONFLICT DO NOTHING, then read. A concurrent request that also owns this
         identity may have created the profile a moment ago; the unique index turns
         that into a no-op here instead of an unhandled 500 (it used to be one). */
      const [inserted] = await db
        .insert(profiles)
        /* The terms this account is created under (0023). The signup screen says that
           creating the account accepts them, with links: this is the record of it. */
        .values({ ...identity, role: requestedRole, locale, birthYear, birthMonth, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        profile = inserted;
        created = true;
      } else {
        [profile] = await db.select().from(profiles).where(eq(idColumn, id)).limit(1);
        if (!profile) return { ok: false, error: "invalid-code" };
      }
    } else if (profile.role === "student" && profile.birthYear == null && birthYear != null) {
      /* One-time fill of an UNKNOWN age: lets a student who predates this field
         set it. Never overwrites a known value, so a minor cannot re-auth
         claiming to be an adult to escape consent — the gate only ever relaxes
         from a real, on-file birth year. */
      await db.update(profiles).set({ birthYear }).where(eq(profiles.id, profile.id));
      profile = { ...profile, birthYear };
    }
    /* phase-a lane L2 (A24): the same one-time fill for an UNKNOWN birth month
       (every account created before 0025 has none), and only alongside the birth
       year already on file — so it can complete a date, never move one. */
    if (!created && profile.role === "student" && profile.birthMonth == null && birthMonth != null && profile.birthYear === birthYear) {
      await db.update(profiles).set({ birthMonth }).where(eq(profiles.id, profile.id));
      profile = { ...profile, birthMonth };
    }
    // NOTE: an existing profile's role is deliberately NOT overwritten from input
    // — otherwise anyone could flip their own role by re-authenticating.

    /* A BLOCKED ACCOUNT CANNOT SIGN IN. Checked after the code is proven, so this
       answer only ever reaches the person who owns the address — it is not an
       oracle for whether someone else's account is blocked. */
    if (profile.blockedAt) return { ok: false, error: "account-blocked" };

    const { token, expiresAt } = await createSession(profile.id);

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

    /* The requested role differed from the one on file. We still sign them in —
       they proved they own the identity — but the caller must SAY so rather than
       redirect somewhere that silently contradicts what they just tapped. */
    const roleMismatch = !created && requestedRole != null && profile.role !== requestedRole;

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

    return {
      ok: true,
      role: profile.role,
      needsConsent,
      created,
      roleMismatch,
      needsProfile,
      hasStorefront,
      // For the web to set the cookie — see the header. Redacted in logs.
      session: { token, expiresAt: expiresAt.toISOString() },
    };
  });

  /* ── POST /auth/logout-all — every device, this one included ───────────── */
  app.post("/auth/logout-all", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    const ended = await destroyProfileSessions(session.profile.id);
    return { ok: true, ended };
  });

  /* ── POST /auth/logout ──────────────────────────────────────────────────── */
  app.post("/auth/logout", async (req) => {
    const session = await getSession(req);
    if (session) await destroySession(session.token);
    // The web clears BOTH cookies; the role hint is not this service's business.
    return { ok: true };
  });
}
