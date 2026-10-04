"use server";
/* Cookies only. Everything that decides identity now lives in apps/api — see the
   header of lib/auth.ts. */
import {
  destroySession, setDemoCookie, setRoleHint, adoptSession,
  OTP_RESEND_COOLDOWN_SEC, OTP_TTL_SEC,
} from "@/lib/auth";
import { demoClasses, demoEnabled } from "@/lib/demo";
import { revalidateTutor, revalidatePublicTutors } from "@/lib/cache";
import { call, callAnonymous, callMultipart } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import { paymentsEnabled, tutorBalanceTnd } from "@tnajem/shared/payments";
import { liveRoomUrl } from "@tnajem/shared/live";
import {
  vText, vOptionalText, vInt, vPrice, vFutureDate, vOptionalUrl, vSlug, vRating, vPhone,
  vUuid, isUuid, safeFileName, vBirthYear, isMinorBirthYear, vOptionalPhone,
} from "@tnajem/shared";
import type {
  DashboardData, DashboardBooking, StudentDashboard, ClassItem, TutorVerification, PendingTutor,
  ExploreTutor, TutorReviews, NotificationItem, NotificationKind, DashboardResult,
  StudentLevel, Role, OnboardingState,
  MessageThreadSummary, MessageThreadDetail, MaterialItem, GuardianChild,
  AdminReport, AdminTakedown, PendingAvatar,
} from "@tnajem/shared";
import { STUDENT_LEVELS, parseStudentProfile } from "@tnajem/shared";
import type { Me, AdminAccount } from "@tnajem/shared";

type DocKind = "id_front" | "id_back" | "selfie" | "diploma" | "certificate" | "role_proof" | "other";

/* Read once. Every "may we leak this to the client?" decision in this file keys off
   it, and a single named constant is easier to audit than scattered string compares. */
const IS_PROD = process.env.NODE_ENV === "production";

/* Server actions = the write/auth path. Callable from client components.
   In demo mode (no API_URL, dev only) they degrade gracefully so the UI still works.
   Every input goes through lib/validation.ts — actions are a public surface. */

export type ActionResult = { ok: boolean; demo?: boolean; slug?: string; error?: string };

/* publicName and initials moved to @tnajem/shared (validation.ts) when the tutors
   domain was ported. They are NOT re-declared here: publicName is a security
   boundary, not formatting -- it is what keeps a reviewer's full name off a
   public, unauthenticated page -- and two copies of a security boundary that
   nothing forces to agree is precisely the bug that had the admin allowlist tested
   in one place and running in another. */

/* recomputeTutorStats moved to apps/api/src/lib/stats.ts. It ran INSIDE the
   transactions of reserveSeat, cancelBooking and createReview, so it had to move
   before them — splitting it across processes would have broken the transaction
   they share and resurrected the lost-update race. All three are ported now, so
   the web copy is dead and is deleted rather than left to drift. */


/* ---------- Auth (OTP) ----------

   THE CODE GOES TO AN EMAIL ADDRESS. It used to be an SMS, and the SMS path is
   still right here, live and compiling, behind otpChannel() — set OTP_CHANNEL=sms
   and phone login is back with no code change. It is not commented out on purpose:
   commented code is invisible to tsc and to the audit gates, so it silently rots.

   WHY WE MOVED: every SMS costs money, and reliable delivery to Tunisian numbers
   needs a registered alphanumeric sender ID. Until that exists smsEnabled() is
   false and this action only ever returns the code on-screen in dev — meaning a
   real deploy had no working login at all. */

/* The email itself. Kept next to the SMS wording it replaces, and localised:
   sending a French email to someone using the Arabic site is a small betrayal of
   the only bilingual promise the product makes. Plain text — a six-digit code
   needs no layout, and text-only bodies are the least likely to be held back by a
   spam filter, which for an OTP is the whole product. */
/* OTP_MAIL moved to apps/api/src/lib/otp-copy.ts with the sender. */

/* `resendAfter` / `expiresIn` (seconds) travel with every successful send so the
   login screens can count down the cooldown and the code's life WITHOUT keeping
   their own copy of either constant — see the note on them in lib/auth.ts. */
export async function requestOtp(input: { identifier: string; locale?: string; purpose?: "login" | "password" /* espace prof v2 · auth: the e-mail's wording */ }):
  Promise<{
    ok: boolean; devCode?: string; demo?: boolean; error?: string; retryAfter?: number;
    resendAfter?: number; expiresIn?: number;
  }> {
  if (demoFallback) {
    /* Demo mode (no API_URL, dev only) — the UI-audit harness and local preview. The
       sentinel code is still withheld in production: a prod deploy that lost its
       backend must degrade to "can't sign in", never to "sign in as anyone".
       Kept on the WEB side because it exists to keep `next build` and the audit
       harness working without a backend; apps/api asserts its own config at boot. */
    return IS_PROD
      ? { ok: false, error: "send-failed" }
      : { ok: true, demo: true, devCode: "000000", resendAfter: OTP_RESEND_COOLDOWN_SEC, expiresIn: OTP_TTL_SEC };
  }
  // PORTED to apps/api (POST /auth/otp/request). Rate limits, the advisory-locked
  // mint and delivery all live there now.
  return call("/auth/otp/request", input);
}

export async function verifyOtp(input: { identifier: string; code: string; role?: "tutor" | "student"; locale?: string; birthYear?: number; birthMonth?: number /* phase-a lane L2 (A24) */ }):
  Promise<{
    ok: boolean; role?: string; needsConsent?: boolean; created?: boolean; roleMismatch?: boolean; needsProfile?: boolean; hasStorefront?: boolean; error?: string; retryAfter?: number;
    // espace prof v2 · auth (phase 2): ask for a password next — and the grant that lets that one step set it.
    needsPassword?: boolean; promptPassword?: boolean; passwordGrant?: string;
  }> {
  if (demoFallback) {
    await setDemoCookie(input.role === "tutor" ? "tutor" : "student");
    const demoRole = input.role ?? "student";
    // Demo mode mirrors the real gate: a student is a minor unless they gave an
    // adult birth year, in which case consent is skipped.
    const demoMinor = input.role === "student" && isMinorBirthYear(vBirthYear(input.birthYear));
    // Demo has no stored profile, so every run looks like a fresh signup that still
    // needs the welcome screen — which is exactly what we want to be able to audit.
    return {
      ok: true, role: demoRole, needsConsent: demoMinor,
      created: true, roleMismatch: false, needsProfile: demoRole === "student",
    };
  }

  /* PORTED to apps/api (POST /auth/otp/verify). Everything that decides identity
     — normalisation, the two throttles, code verification, profile creation, the
     consent gate — runs there.

     The COOKIES stay here, and must. apps/api is talking to this server, not to
     the browser, so it returns the token it minted and we write it. The role hint
     is web-only by design: it is a forgeable UI hint that decides one nav link,
     and the API has no business knowing it exists. */
  const res = await call<{
    ok: boolean; role?: string; needsConsent?: boolean; created?: boolean;
    roleMismatch?: boolean; needsProfile?: boolean; hasStorefront?: boolean;
    error?: string; retryAfter?: number;
    needsPassword?: boolean; promptPassword?: boolean; passwordGrant?: string; // espace prof v2 · auth
    session?: { token: string; expiresAt: string };
  }>("/auth/otp/verify", input);

  if (res.ok && res.session) {
    await adoptSession(res.session.token, new Date(res.session.expiresAt), res.role);
  }
  const { session: _session, ...rest } = res;
  return rest;
}

export async function logout(): Promise<{ ok: boolean }> {
  /* The API deletes the row; this clears the cookies. Both halves matter: a
     cleared cookie with a live row means anyone holding the token is still signed
     in, and a deleted row with a live cookie means the browser keeps sending a
     token that no longer resolves. destroySession() does the cookie half. */
  if (!demoFallback) {
    try {
      await call("/auth/logout");
    } catch {
      /* An API outage must not strand someone signed in on this browser. Clearing
         the cookie is the half we can always do; the row expires on its own and
         is swept by the purge. */
    }
  }
  await destroySession();
  return { ok: true };
}

/** Sign out of every device, this one included. */
export async function logoutEverywhere(): Promise<{ ok: boolean; error?: string }> {
  if (demoFallback) {
    await destroySession();
    return { ok: true };
  }
  const res = await call<{ ok: boolean; error?: string }>("/auth/logout-all");
  /* The cookie goes whatever the API said: the user asked to be signed out, and a
     failed call must not leave this browser signed in. */
  await destroySession();
  return { ok: res.ok, error: res.error };
}

export async function saveConsent(input: {
  guardianName: string;
  guardianPhone?: string; // phase-a lane L5 (A18.2): optional, no longer collected by the form
  /* Step 14: the parent's OWN login identity, and what turns this legal record
     into a linked account. Login is e-mail OTP, so an address is the only
     identifier that can ever resolve to one — the phone never could. */
  guardianEmail: string;
}): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  // PORTED to apps/api (POST /consent). One consent row per minor, updated in place.
  return call<ActionResult>("/consent", input);
}

/* ---------- Role: the one and only student → tutor upgrade ----------

   This is the ONLY place in the codebase that writes `profiles.role = 'tutor'`
   after signup. createTutor() used to do it as a side effect of saving a name; see
   the ROLE GATE comment there for why that was the whole problem.

   Three things it insists on, in order:

     1. AN EXPLICIT CONFIRMATION. `confirm` is not ceremony — it is the difference
        between a role change the user asked for and one that happened to them. The
        /onboarding/upgrade screen is what sets it.

     2. THE CURRENT ROLE IS `student`. A tutor calling this is a no-op success
        (idempotent, so a double-submit or a stale tab cannot fail); anything else
        is refused rather than coerced.

     3. THE USER IS AN ADULT. A tutor is ID-verified and then teaches children, so a
        minor must never hold the role. Age is only ever known for students (we
        collect a birth year at student signup and nowhere else), and it fails safe:
        an unknown age is NOT waved through — the caller is asked for it and it is
        persisted here. isMinorBirthYear treats null as minor, so the refusal below
        catches both "too young" and "still unknown after we asked".

   Role changes must also refresh ROLE_HINT_COOKIE or <SiteHeader> renders the old
   role for the rest of the session's 30 days — hence setRoleHint(). */
export async function becomeTutor(input: { confirm: boolean; birthYear?: number; birthMonth?: number /* phase-a lane L2 (A14) */ }): Promise<ActionResult> {
  if (!input?.confirm) return { ok: false, error: "not-confirmed" };

  if (demoFallback) {
    await setDemoCookie("tutor"); // demo has no profile row; the cookie IS the state
    return { ok: true, demo: true };
  }

  /* PORTED to apps/api (POST /profile/become-tutor). The rate limit, the age rule
     and the role write all live there.

     setRoleHint stays HERE: it writes a cookie on the browser, which the API
     cannot do, and it is a forgeable UI hint the API has no business knowing
     about. The endpoint returns the new role so we know when to set it. */
  const res = await call<ActionResult & { role?: string; session?: { token: string; expiresAt: string } }>(
    "/profile/become-tutor",
    input,
  );
  /* The API rotated the session on the role change: the old token is already dead,
     so the cookie MUST be replaced here or the next request is signed out. */
  if (res.ok && res.session) await adoptSession(res.session.token, new Date(res.session.expiresAt), res.role);
  else if (res.ok && res.role) await setRoleHint(res.role);
  return { ok: res.ok, error: res.error };
}

export async function saveStudentProfile(
  input: { fullName: string; level?: string | null; subjects?: string[]; phone?: string | null },
): Promise<ActionResult> {
  /* Validation runs BEFORE the demo short-circuit, exactly as it always has, so
     the ui-audit harness can exercise the error states with no database. It uses
     parseStudentProfile from @tnajem/shared — the SAME function the API handler
     calls, not a copy. */
  if (demoFallback) {
    const check = parseStudentProfile(input);
    return check.ok ? { ok: true, demo: true } : { ok: false, error: check.error };
  }
  // PORTED to apps/api (POST /profile/student).
  return call<ActionResult>("/profile/student", input);
}

export async function getMe(): Promise<Me | null> {
  return call<Me | null>("/me", undefined, "GET");
}

/* ---------- Tutor storefront (bound to the signed-in user) ---------- */
export async function createTutor(input: { name: string; subject: string; bio: string; slug: string; phone?: string | null; levels?: string[] }): Promise<ActionResult> { // phase-a lane L5 (A18.7): + levels
  if (demoFallback) {
    /* Demo mode still validates the slug so the audit harness can exercise the
       reserved/taken states. vSlug is the same function the API calls. */
    const slug = vSlug(input.slug);
    return slug.ok ? { ok: true, demo: true, slug: slug.value } : { ok: false, error: slug.error };
  }
  /* PORTED to apps/api (POST /tutors). The role gate, the WRITE-ONCE slug rule and
     the collision check all live there.

     call() replays the `revalidate` envelope the endpoint returns — revalidateTag
     only works inside a Next request scope, so cache busting cannot move to the
     API. See apps/web/lib/api.ts rule 4. */
  return call<ActionResult>("/tutors", input);
}

/** The tutor's own opt-in for the free first session.

    Off by default and off for every tutor today — see
    packages/db/sql/0008_free_first_session_optin.sql. Until this exists nobody
    can turn it back on, which would make the policy change "removed" rather than
    "opt-in".

    call() replays the `revalidate` envelope, which matters more here than
    anywhere else in this file: the flag decides whether an ISR-cached public page
    says "Première séance offerte". Without the bust, turning it OFF leaves the
    claim up for the rest of the cache window. */
export async function setFreeFirstSession(enabled: boolean): Promise<ActionResult & { enabled?: boolean }> {
  if (demoFallback) return { ok: true, demo: true, enabled };
  return call<ActionResult & { enabled?: boolean }>("/tutors/free-first-session", { enabled });
}

/** The signed-in student's OWN editable profile, for prefilling /student/welcome. */
export async function getStudentPrefill(): Promise<
  { fullName: string | null; level: string | null; subjects: string | null; phone: string | null } | null
> {
  if (demoFallback) return null;
  return call("/profile/student/prefill", undefined, "GET");
}

export async function getOnboardingState(): Promise<OnboardingState | null> {
  if (demoFallback) return null;
  // PORTED to apps/api (GET /profile/onboarding).
  return call<OnboardingState | null>("/profile/onboarding", undefined, "GET");
}

export async function createClass(input: {
  title: string; description?: string; scheduledAt: string;
  durationMin: number; priceTnd: number; seats: number; isFreeFirst: boolean;
  meetUrl?: string; whiteboardUrl?: string; quizUrl?: string;
  level?: string | null; // phase-a lane L5 (A18.7)
}): Promise<ActionResult & { limit?: number; planCode?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  /* PORTED to apps/api (POST /classes). The validators, the verification gate and
     the insert all live there; call() replays the revalidate envelope.

     Step 16: `plan-limit-classes` comes back with the LIMIT attached so the form
     can name the number instead of saying "not allowed". */
  return call<ActionResult & { limit?: number; planCode?: string }>("/classes", input);
}

export async function createPack(input: { title: string; meta?: string; priceTnd: number; materialId?: string }): Promise<ActionResult> { // live-fixes-1 · B: + materialId (the fiche's file)
  if (demoFallback) return { ok: true, demo: true };
  // PORTED to apps/api (POST /packs).
  return call<ActionResult>("/packs", input);
}

/* ---------- Dashboard (real data for the signed-in tutor) ----------
   Returns null in demo mode or when signed out → the dashboard then shows
   its demo preview. Otherwise returns the tutor's real storefront + classes. */
export async function getDashboard(): Promise<DashboardResult> {
  if (demoFallback) return null;
  // PORTED to apps/api (GET /dashboard).
  return call<DashboardResult>("/dashboard", undefined, "GET");
}

/* ---------- Booking (student reserves a seat — free first session) ----------
   Payment-free for the pilot: reserves a seat and decrements availability.
   Idempotent — re-booking the same class returns { already: true }. */
export async function reserveSeat(input: { classId: string }):
  Promise<{ ok: boolean; demo?: boolean; already?: boolean; error?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  /* PORTED to apps/api (POST /bookings).

     The atomic seat claim, the guardian-consent gate, the verification gate, the
     rate limit and the post-commit notifications all moved together — as did
     recomputeTutorStats, which runs INSIDE that transaction. Splitting them across
     processes would have resurrected the lost-update race.

     call() replays the revalidate envelope: seats_left just moved and the
     storefront caches it for 60s, so a class the cache still shows as "3 places"
     is how a student reaches the checkout of a sold-out session. */
  return call<{ ok: boolean; already?: boolean; error?: string }>("/bookings", input);
}

/* ---------- Cancellation (student) ----------
   48 HOURS FREE, 40% RETAINED AFTER THAT. The rule lives in
   @tnajem/shared/cancellation.ts and is enforced against SERVER time in
   apps/api; this is the proxy.

   A LATE CANCELLATION NOW SUCCEEDS. The old rule refused inside 24h ("too-late")
   and the seat stayed locked to someone who was not coming, so the tutor could
   not resell it. The seat is released either way now; what changes is that 40%
   of the seat's value is RECORDED as retained.

   ⚠ RECORDED, NOT CHARGED. Payments are off. `retainedTnd` is what would be
   retained, and `paymentsEnabled` comes back false so the UI can say so without
   guessing. Never render a retained amount without the "nothing is taken during
   the pilot" line beside it. */
export type CancelResult = ActionResult & {
  late?: boolean;
  amountTnd?: number;
  retainedTnd?: number;
  retainedPct?: number;
  paymentsEnabled?: boolean;
};

export async function cancelBooking(input: { bookingId: string }): Promise<CancelResult> {
  if (demoFallback) return { ok: true, demo: true, late: false, retainedTnd: 0, paymentsEnabled: false };
  /* PORTED to apps/api (POST /bookings/cancel). The window, the seat release
     (atomic — the status flip is the WHERE guard, so only one writer can
     decrement), the ledger insert in the same transaction, and the IDOR check on
     booking ownership all live there. */
  return call<CancelResult>("/bookings/cancel", input);
}

/* ---------- Student dashboard (real reservations) ----------
   Returns null in demo mode / signed out → the student page shows demo data. */
export async function getStudentDashboard(): Promise<StudentDashboard | null> {
  if (demoFallback) return null;
  // PORTED to apps/api (GET /student/dashboard).
  return call<StudentDashboard | null>("/student/dashboard", undefined, "GET");
}

/* ---------- Single class read (for class detail / checkout / live) ----------
   Demo mode → demo class; real mode → the row by id, or null if missing. */
export async function getClass(id: string): Promise<ClassItem | null> {
  if (demoFallback) return demoEnabled ? (demoClasses().find((c) => c.id === id) ?? null) : null;
  /* PORTED to apps/api (GET /classes/:id).

     call(), not callAnonymous: the entitlement check needs the session — meet_url
     ships ONLY to the owning tutor or a student with a live booking, and it is the
     only thing protecting a live room full of minors.

     This is safe to make session-dependent because getClass is invoked from CLIENT
     components only. If anyone ever renders it from a server component on a cached
     route, the entitlement decision gets baked into cached HTML. That invariant is
     currently held by convention; e2e asserts the anonymous case. The one server
     caller, app/[locale]/checkout/page.tsx (live-fixes-3 · A4), is force-dynamic and
     only reads viewer_is_owner to redirect — it renders nothing from the payload. */
  return call<ClassItem | null>(`/classes/${encodeURIComponent(id)}`, undefined, "GET");
}

/* ===================== Tutor verification =====================
   All of it moved to apps/api/src/routes/admin.ts: the storage paths, the size
   and document caps, the MIME allow-list, the magic-byte sniffing and the
   admin gate. Uploads and the admin queue moved TOGETHER because they share
   STORAGE_DIR, the same path-containment check and the same allowlist —
   splitting them would have shipped a document route whose gate lived in the
   other half. */

export async function submitVerification(formData: FormData):
  Promise<{ ok: boolean; demo?: boolean; error?: string; retryAfter?: number }> {
  if (demoFallback) return { ok: true, demo: true };

  /* PORTED to apps/api (POST /verification). Magic-byte sniffing, the size and
     document caps, the rate limit, safeFileName and the URL allow-list all moved
     with it.

     The FormData is handed STRAIGHT to fetch — never buffered here. The action
     already holds up to 6 x 8 MB in this process; buffering again in the proxy
     would double peak memory on the same box for no benefit. undici sets the
     multipart boundary itself, which is why no content-type is set: a hand-written
     multipart header without a boundary is the classic failure here. */
  return callMultipart<{ ok: boolean; error?: string; retryAfter?: number }>(
    "/verification",
    formData,
  );
}

export async function getMyVerification(): Promise<TutorVerification | null> {
  if (demoFallback) return null;
  // PORTED to apps/api (GET /verification/mine).
  return call<TutorVerification | null>("/verification/mine", undefined, "GET");
}

export async function getPendingVerifications():
  Promise<{ ok: boolean; admin: boolean; items: PendingTutor[] }> {
  if (demoFallback) return { ok: false, admin: false, items: [] };
  // PORTED to apps/api (GET /admin/verifications). requireAdmin lives there and
  // fails closed on an unconfigured allowlist.
  return call<{ ok: boolean; admin: boolean; items: PendingTutor[] }>(
    "/admin/verifications",
    undefined,
    "GET",
  );
}

/** submittedAt: the version of the application the admin reviewed (the queue item's). */
export async function approveTutor(input: {
  tutorId: string;
  submittedAt: string | null;
  pendingName?: string | null; // phase-a lane L4 (A26): the rename the admin reviewed
}): Promise<{ ok: boolean; error?: string }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  /* PORTED to apps/api (POST /admin/verifications/approve). Self-approval refusal
     and the "must be pending" gate moved with it; call() replays the revalidate
     envelope so the tutor's page and the sitemap go live immediately. */
  try {
    return await call<{ ok: boolean; error?: string }>("/admin/verifications/approve", input);
  } catch (e) {
    // phase-a lane L4 (A15): 422 = no Décret 2015-1619 declaration for this round.
    if ((e as { status?: number }).status === 422) return { ok: false, error: "declaration-missing" };
    throw e;
  }
}

export async function rejectTutor(input: { tutorId: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  /* PORTED to apps/api (POST /admin/verifications/reject).

     The revalidation replayed by call() is a COMPLIANCE control here, not a UX
     nicety: without it the page of a tutor we have just rejected keeps being
     served for up to 60s and advertised in the sitemap for up to an hour. */
  return call<{ ok: boolean; error?: string }>("/admin/verifications/reject", input);
}

/* ---------- Plans and entitlements (Step 16) ----------

   The GRANT is manual and admin-only, because payments are off: there is no
   checkout to proxy. These forward the cookie like every other action; the
   allowlist check, the audit line and the transaction all live in apps/api. */
export type AdminPlanRow = {
  tutorId: string;
  slug: string;
  fullName: string;
  status: string;
  planCode: string;
  maxClasses: number | null;
  exploreBoost: number;
  granted: boolean;
  expiresAt: string | null;
  note: string | null;
  openClasses: number;
};

export async function getAdminPlans():
  Promise<{ ok: boolean; admin: boolean; paymentsEnabled?: boolean; items: AdminPlanRow[] }> {
  if (demoFallback) return { ok: false, admin: false, items: [] };
  return call<{ ok: boolean; admin: boolean; paymentsEnabled?: boolean; items: AdminPlanRow[] }>(
    "/admin/plans",
    undefined,
    "GET",
  );
}

export async function grantPlan(input: {
  tutorId: string; planCode: string; months?: number; note?: string;
}): Promise<ActionResult & { planCode?: string; expiresAt?: string | null }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  /* The revalidate envelope replayed by call() matters here: a granted plan
     changes /explore ordering and the tutor's cached storefront. A grant that
     does not show up for an hour reads as a grant that did not work. */
  return call<ActionResult & { planCode?: string; expiresAt?: string | null }>(
    "/admin/subscriptions",
    input,
  );
}

export async function revokePlan(input: { tutorId: string; note?: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>("/admin/subscriptions/revoke", input);
}

/* ---------- Explore feed (real, verified tutors only) ----------
   rating/review_count come from the reviews table, price_from from the tutor's
   cheapest published class. Filters: `subject` (chip) + `q` (free text over name,
   subject, level, bio). Demo mode (no API_URL) → null so the Explore page
   keeps its static preview; with a DB, an empty catalogue returns [] — we never
   pass demo tutors off as real ones. */
export async function getExploreTutors(filters?: { subject?: string; q?: string; level?: string }): Promise<ExploreTutor[] | null> { // phase-a lane L5 (A18.7): + level
  /* null → the client renders its static demo preview (DEV ONLY). In production a
     missing DB must never surface fabricated tutors: return [] so /explore shows
     its honest empty state instead. */
  if (demoFallback) return demoEnabled ? null : [];

  /* PORTED to apps/api (GET /tutors/explore).

     callAnonymous, NOT call: this runs during SSR on a cached route. Touching
     cookies() or headers() here would throw inside unstable_cache and silently
     opt the route out of caching outside it. e2e/isr.spec.ts guards that. */
  const qs = new URLSearchParams();
  if (filters?.subject) qs.set("subject", filters.subject);
  if (filters?.q) qs.set("q", filters.q);
  if (filters?.level) qs.set("level", filters.level); // phase-a lane L5 (A18.7)
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return callAnonymous<ExploreTutor[]>(`/tutors/explore${suffix}`);
}

/** A review is MASKED, never rejected, when it carries contact details — losing
    three paragraphs over one line is worse than publishing them without it. The
    flag comes back so the UI can say what happened; silently editing someone's
    words and publishing the result would read as censoring the opinion. */
export type ReviewResult = ActionResult & { masked?: boolean };

export async function createReview(input: { classId: string; rating: number; text?: string }): Promise<ReviewResult> {
  if (demoFallback) return { ok: true, demo: true };
  /* PORTED to apps/api (POST /reviews). The booking check, the "class must have
     started" rule and the insert+recompute transaction all moved together — the
     last caller of the web-side recomputeTutorStats, so that duplicate is gone. */
  return call<ReviewResult>("/reviews", input);
}

/* ---------- Reporting and account deletion (Step 15) ----------
   reportContent takes NO session and works signed out — the person most likely to
   need it is a parent with no login, or someone already driven off the platform
   by whatever they are reporting. */
export async function reportContent(input: {
  subjectKind: "tutor" | "class" | "review" | "message" | "material" | "other";
  subjectId?: string;
  reason: string;
  reporterEmail?: string;
}): Promise<ActionResult & { status?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult & { status?: string }>("/reports", input);
}

export type DeletionState = {
  requested: boolean;
  requestedAt?: string;
  purgeAt?: string;
  graceDays: number;
};

export async function getDeletionState(): Promise<DeletionState | null> {
  if (demoFallback) return { requested: false, graceDays: 30 };
  return call<DeletionState | null>("/account/deletion", undefined, "GET");
}

/** Request deletion. A REQUEST: 30 days in which it can be taken back. */
export async function requestAccountDeletion(): Promise<ActionResult & { graceDays?: number }> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult & { graceDays?: number }>("/account/delete", {});
}

export async function cancelAccountDeletion(): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult>("/account/delete/cancel", {});
}

/* ---------- Parent accounts (Step 14) ----------
   READ-ONLY, and there is deliberately no send/book/cancel here. A guardian
   acting AS their child would put words or money in a minor's name from an
   account the minor does not control, and the audit trail would say the child did
   it. Oversight is not impersonation.

   The link resolves server-side on every read — no invitation, no callback — so
   a parent's first visit already shows their child. */
/** A guardian withdraws consent for their child: no more bookings, upcoming seats released. */
export async function withdrawConsent(childId: string): Promise<ActionResult & { releasedBookings?: number }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult & { releasedBookings?: number }>(`/guardian/children/${encodeURIComponent(childId)}/consent/withdraw`, {});
}

/** A guardian gives consent back (recorded under the current policy version). */
export async function grantConsent(childId: string): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>(`/guardian/children/${encodeURIComponent(childId)}/consent/grant`, {});
}

export async function getMyChildren(): Promise<GuardianChild[] | null> {
  if (demoFallback) return [];
  return call<GuardianChild[] | null>("/guardian/children", undefined, "GET");
}

export async function getChildThreads(childId: string): Promise<MessageThreadSummary[] | null> {
  if (demoFallback) return [];
  if (typeof childId !== "string" || !childId.trim()) return null;
  return call<MessageThreadSummary[] | null>(
    `/guardian/children/${encodeURIComponent(childId)}/threads`,
    undefined,
    "GET",
  );
}

export async function getChildThread(threadId: string): Promise<MessageThreadDetail | null> {
  if (demoFallback) return null;
  if (typeof threadId !== "string" || !threadId.trim()) return null;
  return call<MessageThreadDetail | null>(
    `/guardian/threads/${encodeURIComponent(threadId)}`,
    undefined,
    "GET",
  );
}

/* ---------- Profile photo (Step 13) ----------
   Multipart, so it goes through callMultipart. The response says `pending`, never
   a URL: nothing is published on upload, and a client that received a live URL
   here would be tempted to render it as though it were. */
export async function uploadAvatar(form: FormData): Promise<ActionResult & { status?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  return callMultipart<ActionResult & { status?: string }>("/avatar", form);
}

export async function deleteAvatar(): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult>("/avatar/delete", {});
}

/* ---------- Tutor-side class lifecycle (Step 11) ----------
   Both are the TUTOR acting on their own class, and both are asymmetric with the
   student's cancel on purpose:

   cancelClass    100% release, always. The student owes nothing for a decision
                  they did not make, and every seat is freed in one transaction.
   rescheduleClass  does NOT cancel anyone. It moves the time and WAIVES the 48h
                  window for everyone who booked the old one — they agreed to an
                  appointment that no longer exists. */
export async function cancelClass(input: { classId: string; reason?: string }): Promise<
  ActionResult & { cancelled?: number; already?: boolean }
> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult & { cancelled?: number; already?: boolean }>(
    `/classes/${encodeURIComponent(input.classId)}/cancel`,
    { reason: input.reason },
  );
}

export async function rescheduleClass(input: { classId: string; scheduledAt: string }): Promise<
  ActionResult & { notified?: number }
> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult & { notified?: number }>(
    `/classes/${encodeURIComponent(input.classId)}/reschedule`,
    { scheduledAt: input.scheduledAt },
  );
}

/* ---------- Materials (Step 10) ----------
   The LIST is filtered per viewer by apps/api, so the mere presence of an item is
   already the access decision. A client never reproduces the rule and therefore
   cannot get it wrong. The bytes are fetched through /api/material/[id], a
   streaming pass-through that also makes no decision of its own.

   getTutorMaterials is SESSION-DEPENDENT, so it is a normal authenticated call
   and NOT part of the anonymous ISR set. Folding it into the cached storefront
   payload would serve one student's entitlements to everybody — see rule 3 in
   lib/api.ts. */
export async function getTutorMaterials(slug: string): Promise<MaterialItem[]> {
  if (demoFallback) return [];
  if (typeof slug !== "string" || !slug.trim()) return [];
  return call<MaterialItem[]>(`/tutors/${encodeURIComponent(slug)}/materials`, undefined, "GET");
}

export async function getMyMaterials(): Promise<MaterialItem[] | null> {
  if (demoFallback) return [];
  return call<MaterialItem[] | null>("/materials/mine", undefined, "GET");
}

/** Upload a file OR attach a YouTube video. Multipart, so it uses the passthrough. */
export async function createMaterial(form: FormData): Promise<ActionResult & { id?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  return callMultipart<ActionResult & { id?: string }>("/materials", form);
}

export async function deleteMaterial(input: { id: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult>(`/materials/${encodeURIComponent(input.id)}/delete`, {});
}

/** File a copyright claim. NO ACCOUNT REQUIRED — a rights-holder is almost never
    a user of this site, and making them sign up to complain is the same as having
    no process. Nothing is removed by filing; a human decides. */
/* ---------- The moderation queue (/admin/moderation) ----------
   Every gate lives in apps/api (requireAdmin); each list answers [] to a non-admin. */
export async function getAdminReports(): Promise<AdminReport[]> {
  if (demoFallback) return [];
  return call<AdminReport[]>("/admin/reports", undefined, "GET");
}
export async function resolveReport(input: { id: string; action: "actioned" | "dismissed"; note?: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>(`/admin/reports/${encodeURIComponent(input.id)}`, { action: input.action, note: input.note });
}
/* phase-a lane L4 (A28): hide a reported message or review (a soft delete, audited,
   reason required) and close the report it answers. */
export async function hideContent(input: { kind: "message" | "review"; id: string; reason: string; reportId?: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>("/admin/moderation/hide", input);
}
export async function getAdminTakedowns(): Promise<AdminTakedown[]> {
  if (demoFallback) return [];
  return call<AdminTakedown[]>("/admin/takedowns", undefined, "GET");
}
export async function resolveTakedown(input: { id: string; uphold: boolean }): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>(`/admin/takedowns/${encodeURIComponent(input.id)}/resolve`, { uphold: input.uphold });
}
export async function getPendingAvatars(): Promise<PendingAvatar[]> {
  if (demoFallback) return [];
  return call<PendingAvatar[]>("/admin/avatars", undefined, "GET");
}
/** Approve or reject THE photo the admin looked at (`version`); a newer upload refuses. */
export async function decideAvatar(input: { tutorId: string; approve: boolean; version: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call<ActionResult>(`/admin/avatars/${encodeURIComponent(input.tutorId)}`, { approve: input.approve, version: input.version });
}

export async function requestTakedown(input: {
  materialId: string;
  claimantName: string;
  claimantEmail: string;
  reason: string;
}): Promise<ActionResult & { status?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  const { materialId, ...body } = input;
  return call<ActionResult & { status?: string }>(
    `/materials/${encodeURIComponent(materialId)}/takedown`,
    body,
  );
}

/* ---------- Messaging (Step 8b) ----------
   The replacement channel for the contact details Step 8 closed. Every thread is
   a BOOKING: there are no cold DMs, and that rule is enforced in apps/api against
   a UNIQUE NOT NULL booking_id, not here.

   Message bodies come back as PLAIN TEXT — markup is stripped server-side before
   storage. Render them as text. Never dangerouslySetInnerHTML: this is the one
   user-authored string in the product that is shown to a DIFFERENT user. */
export async function openThread(input: { bookingId: string }): Promise<ActionResult & { threadId?: string }> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult & { threadId?: string }>("/threads", input);
}

export async function getThreads(): Promise<MessageThreadSummary[] | null> {
  if (demoFallback) return [];
  return call<MessageThreadSummary[] | null>("/threads", undefined, "GET");
}

export async function getThread(threadId: string): Promise<MessageThreadDetail | null> {
  if (demoFallback) return null;
  if (typeof threadId !== "string" || !threadId.trim()) return null;
  return call<MessageThreadDetail | null>(`/threads/${encodeURIComponent(threadId)}`, undefined, "GET");
}

export type SendMessageResult = ActionResult & {
  id?: string;
  body?: string;
  at?: string;
  /** True when contact details were removed. The UI must SAY so — silently
      editing someone's words and delivering the result is a trust problem. */
  masked?: boolean;
};

export async function sendMessage(input: { threadId: string; body: string }): Promise<SendMessageResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<SendMessageResult>(`/threads/${encodeURIComponent(input.threadId)}/messages`, { body: input.body });
}

export async function reportMessage(input: { messageId: string; reason?: string }): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  return call<ActionResult>(`/messages/${encodeURIComponent(input.messageId)}/report`, { reason: input.reason });
}

/** Reviews for a public storefront. Unknown slug → empty (never throws for a 404 page). */
export async function getTutorReviews(tutorSlug: string): Promise<TutorReviews> {
  const empty: TutorReviews = { items: [], average: 0, count: 0 };
  if (demoFallback) return empty;
  if (typeof tutorSlug !== "string" || !tutorSlug.trim()) return empty;

  /* PORTED to apps/api (GET /tutors/:slug/reviews).

     callAnonymous is MANDATORY here, not a preference: [slug]/page.tsx calls this
     from INSIDE unstable_cache, where Next 14 throws on cookies(). This is also
     the most-shared URL in the product, so a silent cache opt-out here is the
     single most expensive mistake available in Step 4. */
  return callAnonymous<TutorReviews>(`/tutors/${encodeURIComponent(tutorSlug.trim())}/reviews`);
}

export async function getNotifications(locale?: "fr" | "ar"): Promise<NotificationItem[]> {
  if (demoFallback) return [];
  // PORTED to apps/api (GET /notifications). The API renders each row in `locale`
  // (the page's language) — a whitelist, never a string pasted into the path.
  const q = locale === "ar" || locale === "fr" ? `?locale=${locale}` : "";
  return call<NotificationItem[]>(`/notifications${q}`, undefined, "GET");
}

/** Marks the caller's unread notifications as read (all of them, or just `ids`). */
export async function markNotificationsRead(input?: { ids?: string[] }): Promise<ActionResult> {
  if (demoFallback) return { ok: true, demo: true };
  // PORTED to apps/api (POST /notifications/read). Ownership is enforced by the
  // query scope there; ids only ever narrow it.
  return call<ActionResult>("/notifications/read", input ?? {});
}

/* ---------- Live room access ----------
   The live page must not be open to anyone holding the URL: you can join only if
   you booked the class (active booking) or you're the tutor who owns it. */
export async function canJoinClass(classId: string): Promise<{
  canJoin: boolean; role?: "tutor" | "student"; meetUrl?: string; reason?: string;
}> {
  /* Dev demo mode opens the room so the flow is walkable without a DB. In
     PRODUCTION a missing backend must NEVER open a live room to anyone holding the
     URL — demoFallback is false there, so this falls through to the API. */
  if (demoFallback) {
    return demoEnabled
      ? { canJoin: true, role: "student", meetUrl: liveRoomUrl(`demo-${classId}`) } // demo only: no token exists
      : { canJoin: false, reason: "not-found" };
  }
  // PORTED to apps/api (GET /classes/:id/join).
  return call(`/classes/${encodeURIComponent(classId)}/join`, undefined, "GET");
}


/* ---------- Account blocks (admin, production readiness Stage 2) ----------
   PORTED-FIRST: the gate, the refusals and every consequence live in
   apps/api/src/routes/admin-accounts.ts. call() replays the revalidate envelope,
   so a blocked tutor's storefront and sitemap entry go dark immediately. */
export async function findAccount(email: string): Promise<{ ok: boolean; error?: string; account?: AdminAccount | null }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  // In the body, never the query string (proxy logs, history).
  return call("/admin/accounts/find", { email });
}

export async function blockAccount(input: { profileId: string; reason: string; cancelUpcoming: boolean }): Promise<{
  ok: boolean; error?: string; already?: boolean;
  cancelledClasses?: number; cancelledBookings?: number; upcomingClasses?: number; upcomingBookings?: number;
}> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call("/admin/accounts/block", input);
}

export async function unblockAccount(input: { profileId: string }): Promise<{ ok: boolean; error?: string }> {
  if (demoFallback) return { ok: false, error: "forbidden" };
  return call("/admin/accounts/unblock", input);
}
