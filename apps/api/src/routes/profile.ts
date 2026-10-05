import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, classes, profiles, tutors, sql as raw } from "@tnajem/db";
import {
  isAdult, // phase-a lane L2 (A14)
  vBirthMonth, // phase-a lane L2 (A14)
  vBirthYear,
  parseStudentProfile,
  type OnboardingState,
} from "@tnajem/shared";
import { sortLevels } from "@tnajem/shared"; // phase-a lane L5 (A18.7)
import { db } from "../db";
import { checkRateLimit } from "../lib/rate-limit";
import { isUniqueViolation } from "../lib/db-errors";
import { getSession, rotateSession } from "../lib/session";

/* profile — becomeTutor, saveStudentProfile, getOnboardingState.

   Ported from apps/web/app/actions.ts. Every refusal is HTTP 200 with
   { ok:false, error }, per the convention in @tnajem/shared/contracts: the client
   branches on these strings and a status code would break that. */

const becomeTutorBody = z.object({
  confirm: z.boolean(),
  birthYear: z.number().optional(),
  birthMonth: z.number().optional(), // phase-a lane L2 (A14)
});

const studentProfileBody = z.object({
  fullName: z.string(),
  level: z.string().nullable().optional(),
  subjects: z.array(z.string()).optional(),
  phone: z.string().nullable().optional(),
  /* student-space-v1 · F (Profil › Moi): the student emptied the field on purpose, so the
     number on file goes. Without it an empty phone keeps the stored one (the welcome screen). */
  phoneClear: z.boolean().optional(),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  /* ── POST /profile/become-tutor ─────────────────────────────────────────── */
  app.post("/profile/become-tutor", async (req, reply) => {
    const parsed = becomeTutorBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });
    const input = parsed.data;

    if (!input.confirm) return { ok: false, error: "not-confirmed" };

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (session.profile.role === "tutor") return { ok: true, role: "tutor" }; // idempotent
    if (session.profile.role !== "student") return { ok: false, error: "not-eligible" };

    // A role change is a privileged write on a public surface. Cheap ceiling.
    const rl = await checkRateLimit(`role:upgrade:${session.profile.id}`, 5, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    /* Age. Prefer what is already on file — a student cannot re-declare
       themselves older to get the role, exactly as verifyOtp only ever fills an
       UNKNOWN age. */
    /* phase-a lane L2 (A14): month + year, the same fail-safe isAdult() as
       /signup/prof. Each part is taken from input ONLY when unknown on file, both
       are validated before anything is written, and a missing part is asked for
       ("age-required") — never assumed. */
    const needYear = session.profile.birthYear == null;
    const needMonth = session.profile.birthMonth == null;
    const birthYear = needYear ? vBirthYear(input.birthYear) : session.profile.birthYear;
    const birthMonth = needMonth ? vBirthMonth(input.birthMonth) : session.profile.birthMonth;
    if (birthYear == null || birthMonth == null) return { ok: false, error: "age-required" };
    if (needYear || needMonth) {
      await db.update(profiles).set({ birthYear, birthMonth }).where(eq(profiles.id, session.profile.id));
    }
    if (!isAdult(birthYear, birthMonth)) return { ok: false, error: "minor-cannot-teach" };

    await db.update(profiles).set({ role: "tutor" }).where(eq(profiles.id, session.profile.id));

    /* A privilege change gets a fresh session: the student's token is deleted and a
       new one minted (lib/session.ts rotateSession). The web replaces the cookie
       from `session`, exactly as after an OTP verify — redacted in logs. */
    const rotated = await rotateSession(session.token, session.profile.id);

    /* The web sets the role-hint cookie from this. It is a forgeable UI hint that
       only decides which nav link renders, so it stays entirely on the web side —
       but the web needs to be TOLD the role changed, hence returning it. */
    return { ok: true, role: "tutor", session: { token: rotated.token, expiresAt: rotated.expiresAt.toISOString() } };
  });

  /* ── POST /profile/student ──────────────────────────────────────────────── */
  app.post("/profile/student", async (req, reply) => {
    const parsed = studentProfileBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad-request" });

    // ONE validator, shared with the web's demo-mode branch — see profile-input.ts.
    const check = parseStudentProfile(parsed.data);
    if (!check.ok) return { ok: false, error: check.error };
    const v = check.value;

    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    // Symmetric with createTutor's gate: the student screen writes a student profile.
    if (session.profile.role !== "student") return { ok: false, error: "not-a-student" };

    /* Throttled: each submit can probe whether a phone number is already on another
       account (profiles.phone is unique). */
    const rl = await checkRateLimit(`profile:write:${session.profile.id}`, 20, 60 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    try {
      await db
        .update(profiles)
        .set({
          fullName: v.fullName,
          level: v.level,
          subjects: v.subjects.length ? v.subjects.join(",") : null,
          // Never null out a number already on file just because this submit omitted it.
          ...(v.phone ? { phone: v.phone } : parsed.data.phoneClear ? { phone: null } : {}),
        })
        .where(eq(profiles.id, session.profile.id));
    } catch (e) {
      /* Another account holds this number. An answer, not a 500 — the 500 logged the
         number and the name, and failed the whole form. */
      if (isUniqueViolation(e)) return { ok: false, error: "phone-unavailable" };
      throw e;
    }

    return { ok: true };
  });

  /* ── GET /profile/student/prefill ────────────────────────────────────────
     The student's OWN editable profile, for prefilling /student/welcome.

     A separate endpoint rather than widening GET /session, which page guards call
     on several routes on every request. A guard only needs "who is this, what
     role, are they a minor?" — giving it phone and level would push contact data
     through a hot path for no reason, right before Step 8 closes contact
     exchange. This is unambiguously SELF data: it returns the caller's own row
     and nobody else's. */
  app.get("/profile/student/prefill", async (req) => {
    const session = await getSession(req);
    if (!session) return null;
    const [p] = await db
      .select({
        fullName: profiles.fullName,
        level: profiles.level,
        subjects: profiles.subjects,
        phone: profiles.phone,
      })
      .from(profiles)
      .where(eq(profiles.id, session.profile.id))
      .limit(1);
    return p ?? null;
  });

  /* ── GET /profile/onboarding ────────────────────────────────────────────── */
  app.get("/profile/onboarding", async (req): Promise<OnboardingState | null> => {
    const session = await getSession(req);
    if (!session || session.profile.role !== "tutor") return null;

    const [mine] = await db
      .select({
        id: tutors.id,
        slug: tutors.slug,
        fullName: tutors.fullName,
        pendingFullName: tutors.pendingFullName, // phase-a lane L4 (A26)
        subject: tutors.subject,
        bio: tutors.bio,
        status: tutors.status,
        offersFreeFirstSession: tutors.offersFreeFirstSession,
        levels: tutors.levels, // phase-a lane L5 (A18.7)
        avatarStatus: tutors.avatarStatus, // espace prof v2 · shell: the photo step
        linkSharedAt: tutors.linkSharedAt, // espace prof v2 · shell (0036): the share step
      })
      .from(tutors)
      .where(eq(tutors.profileId, session.profile.id))
      .limit(1);

    /* The contact phone lives on the PROFILE, not the storefront, so it pre-fills
       even before a tutor has created their page. */
    const contactPhone = session.profile.phone ?? "";

    if (!mine) {
      return {
        hasStorefront: false,
        status: "draft",
        hasClass: false,
        hasSlug: false,
        draft: contactPhone
          ? { fullName: "", subject: "", bio: "", slug: "", phone: contactPhone }
          : null,
        offersFreeFirstSession: false,
      };
    }

    // count(*) rather than fetching rows: the ladder only asks "any classes yet?".
    const [cnt] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(classes)
      .where(eq(classes.tutorId, mine.id));

    return {
      hasStorefront: true,
      status: mine.status,
      hasClass: (cnt?.n ?? 0) > 0,
      hasSlug: Boolean(mine.slug),
      draft: {
        /* phase-a lane L4 (A26): the name the tutor ASKED for, while it is under
           review — else re-saving the form for a bio typo would silently withdraw it. */
        fullName: mine.pendingFullName ?? mine.fullName ?? "",
        subject: mine.subject ?? "",
        bio: mine.bio ?? "",
        slug: mine.slug ?? "",
        phone: contactPhone,
      },
      offersFreeFirstSession: mine.offersFreeFirstSession,
      levels: sortLevels(mine.levels), // phase-a lane L5 (A18.7)
      avatarStatus: mine.avatarStatus ?? null, // espace prof v2 · shell
      linkShared: Boolean(mine.linkSharedAt),
    };
  });
}
