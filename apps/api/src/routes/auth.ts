import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull, profiles } from "@tnajem/db";
import {
  vBirthYear,
  TERMS_VERSION,
  // phase-a lane L2 (A24)
  vBirthMonth,
  isAdult,
  minorsAllowed,
} from "@tnajem/shared";
import { db } from "../db";
import { createSession, destroyProfileSessions, destroySession, getSession } from "../lib/session";
// espace prof v2 · phase 2: the send / prove / post-login steps are shared with routes/passwords.ts.
import { identityColumn, postLoginState, proveCode, resolveIdentity, sendCode } from "../lib/auth-flow";
import { issuePasswordGrant } from "../lib/password";

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
   only decides which nav link renders; the API must not know it exists.

   espace prof v2 · phase 2 — PASSWORDS. A code is still a complete way in. What
   changed here: the code e-mail can say it is for a password (purpose), and a
   successful verify tells the web whether to ask for a password next —
   needsPassword on a brand-new account (the sign-up step), promptPassword ONCE for
   an older account without one — with the short-lived grant that lets it be set
   without a second code (lib/password.ts). The password routes are in passwords.ts. */

const requestOtpBody = z.object({
  identifier: z.string(),
  locale: z.string().optional(),
  // espace prof v2 · phase 2: only the e-mail's wording depends on it (otp-copy.ts).
  purpose: z.enum(["login", "password"]).optional(),
});

const verifyOtpBody = z.object({
  identifier: z.string(),
  code: z.string(),
  role: z.enum(["tutor", "student"]).optional(),
  locale: z.string().optional(),
  birthYear: z.number().optional(),
  birthMonth: z.number().optional(), // phase-a lane L2 (A24)
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /auth/otp/request ─────────────────────────────────────────────── */
  app.post("/auth/otp/request", async (req, reply) => {
    const parsed = requestOtpBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    const { channel, id, ok } = resolveIdentity(input.identifier);
    if (!ok) {
      return { ok: false, error: channel === "email" ? "invalid-email" : "invalid-phone" };
    }
    // The throttles, the advisory-locked mint and the fail-closed delivery: lib/auth-flow.ts.
    return sendCode(req, id, input.locale, input.purpose ?? "login");
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
    const { channel, id, ok } = resolveIdentity(input.identifier);
    if (!ok) return { ok: false, error: "invalid-code" };

    // The two brute-force throttles and the atomic consume: lib/auth-flow.ts::proveCode.
    const proof = await proveCode(req, id, input.code);
    if (!proof.ok) return proof;

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
    const idColumn = identityColumn(channel);
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
         on a rare path beats letting anyone probe who is on the platform.
         (espace prof v2 · phase 2: POST /auth/account-status now answers that
         question up front, by spec, rate-limited — see passwords.ts. This branch
         stays for the "J'ai déjà un code" path, which skips it.) */
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

    // Consent → welcome → storefront: the same answer a password sign-in gets (auth-flow.ts).
    const { needsConsent, needsProfile, hasStorefront } = await postLoginState(profile);

    /* The requested role differed from the one on file. We still sign them in —
       they proved they own the identity — but the caller must SAY so rather than
       redirect somewhere that silently contradicts what they just tapped. */
    const roleMismatch = !created && requestedRole != null && profile.role !== requestedRole;

    /* espace prof v2 · phase 2 — what to ask next, if anything.
       • a NEW account owes the sign-up's « Crée ton mot de passe » step;
       • an older account with no password is offered one ONCE: the marker is set
         in the same statement that decides, so two tabs cannot both be offered it
         and a closed tab does not mean "offer again". Not on a role mismatch: that
         screen is about which account this is, not about passwords.
       The grant lets that one step set the password without a second code. */
    let needsPassword = false;
    let promptPassword = false;
    if (!profile.passwordHash) {
      if (created) needsPassword = true;
      else if (!roleMismatch) {
        const marked = await db
          .update(profiles)
          .set({ passwordPromptedAt: new Date() })
          .where(and(eq(profiles.id, profile.id), isNull(profiles.passwordPromptedAt), isNull(profiles.passwordHash)))
          .returning({ id: profiles.id });
        promptPassword = marked.length > 0;
      }
    }

    return {
      ok: true,
      role: profile.role,
      needsConsent,
      created,
      roleMismatch,
      needsProfile,
      hasStorefront,
      ...(needsPassword || promptPassword
        ? { needsPassword, promptPassword, passwordGrant: issuePasswordGrant(profile.id) }
        : {}),
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
