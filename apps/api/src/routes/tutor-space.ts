import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  and, desc, eq, gt, isNull, or, sql as raw,
  bookings, classes, messages, messageThreads, profiles, tutors,
} from "@tnajem/db";
import {
  effectivePlan,
  initials,
  publicDisplayName,
  publicInitials,
  studentStatusOf,
  type Storefront,
  type TutorShell,
  type TutorStudent,
  type TutorStudentBooking,
  type TutorVerifStatus,
  type TutorVisibility,
} from "@tnajem/shared";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { planStateForTutor } from "../lib/entitlements";
import { getOwnerPreviewData, tutorVisibility } from "../lib/storefront";

/* espace prof v2 · shell — the tutor's own space (phase 1).

     GET  /tutor/shell              the AppShell: name, plan, verification status
     POST /tutor/link-shared        contract C2: the owner copied/shared their link (idempotent)
     GET  /tutor/students           « Mes élèves »: everyone who booked, first names only
     GET  /tutor/preview            the owner preview of their own page, any status
     GET  /messages/unread-count    the shell's messages badge, for either role
     GET  /tutors/:slug/visibility  PUBLIC, anonymous: what /{slug} shows

   Every route but the last is the CALLER's own data: the tutor row is always found
   by the session's profile id, never by anything in the request, so there is no id
   here for anyone to swap. The last one is anonymous and feeds the ISR-cached
   storefront through callAnonymous — it must never read the session (see the header
   of routes/tutors.ts). */

/** The caller's tutor row, or null. Role first: a student never reaches the query. */
async function myTutor(profileId: string) {
  const [mine] = await db
    .select({
      id: tutors.id,
      slug: tutors.slug,
      fullName: tutors.fullName,
      status: tutors.status,
      linkSharedAt: tutors.linkSharedAt,
    })
    .from(tutors)
    .where(eq(tutors.profileId, profileId))
    .limit(1);
  return mine ?? null;
}

/* An opaque, per-tutor handle for a student. NOT the profile id: « Mes élèves » is a
   counterparty surface (Step 8), and an id that is the same on every tutor's screen
   would let two tutors correlate a child across their lists. Hashing with the tutor
   id makes the handle useless anywhere else. */
function studentKey(tutorId: string, studentId: string): string {
  return createHash("sha256").update(`${tutorId}:${studentId}`).digest("base64url").slice(0, 16);
}

export async function tutorSpaceRoutes(app: FastifyInstance): Promise<void> {
  /* ── GET /tutor/shell ─────────────────────────────────────────────────────── */
  app.get("/tutor/shell", async (req): Promise<TutorShell | null> => {
    const session = await getSession(req);
    if (!session || session.profile.role !== "tutor") return null;

    const mine = await myTutor(session.profile.id);
    const state = mine ? await planStateForTutor(mine.id) : null;
    const plan = state?.plan ?? effectivePlan(null, paymentsEnabled());
    const name = mine?.fullName ?? session.profile.fullName ?? null;

    return {
      name,
      initials: name ? initials(name) : "?",
      status: (mine?.status ?? "draft") as TutorVerifStatus,
      slug: mine?.slug ?? null,
      hasStorefront: Boolean(mine),
      /* The same sentence as GET /dashboard's plan.isPilot: no grant, payments off. */
      plan: { code: plan.code, isPilot: !paymentsEnabled() && !state?.granted },
    };
  });

  /* ── POST /tutor/link-shared — contract C2 ──────────────────────────────────

     IDEMPOTENT, SET ONCE. The first copy/share/QR by the owner stamps
     tutors.link_shared_at; every later call is a no-op success. The WHERE clause is
     the guard (`link_shared_at is null`), so two taps from a slow phone cannot race
     the stamp forward. Recorded, never announced: nothing public reads it. */
  app.post("/tutor/link-shared", async (req) => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (session.profile.role !== "tutor") return { ok: false, error: "not-a-tutor" };

    /* Cheap and idempotent, but still a write any tutor can trigger in a loop. */
    const rl = await checkRateLimit(`link-shared:${session.profile.id}`, 30, 10 * 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const mine = await myTutor(session.profile.id);
    if (!mine) return { ok: false, error: "no-storefront" };

    await db
      .update(tutors)
      .set({ linkSharedAt: raw`now()` })
      .where(and(eq(tutors.id, mine.id), isNull(tutors.linkSharedAt)));
    return { ok: true, already: Boolean(mine.linkSharedAt) };
  });

  /* ── GET /tutor/students — « Mes élèves » ───────────────────────────────────

     Everyone who booked one of the caller's classes, grouped per student. The
     SAME projection rule as GET /dashboard's bookings: a FIRST NAME and nothing
     else — profiles.phone and profiles.email are not selected, so there is no value
     here to leak. profiles.id is selected only to group and to derive the opaque
     key; it never leaves this function.

     Growth extends the rows (followers in phase 4, subscribers in phase 5) by
     appending to `relations`; the shape already carries students with no booking. */
  app.get("/tutor/students", async (req): Promise<TutorStudent[] | null> => {
    const session = await getSession(req);
    if (!session || session.profile.role !== "tutor") return null;
    const mine = await myTutor(session.profile.id);
    if (!mine) return [];

    const rows = await db
      .select({
        studentId: bookings.studentId,
        studentName: profiles.fullName,
        bookingId: bookings.id,
        classId: classes.id,
        classTitle: classes.title,
        scheduledAt: classes.scheduledAt,
        isFree: bookings.isFree,
        status: bookings.status,
        bookedAt: bookings.createdAt,
      })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .innerJoin(profiles, eq(bookings.studentId, profiles.id))
      .where(eq(classes.tutorId, mine.id))
      .orderBy(desc(classes.scheduledAt))
      .limit(1000);

    const byStudent = new Map<string, { name: string | null; bookings: TutorStudentBooking[] }>();
    for (const r of rows) {
      const entry = byStudent.get(r.studentId) ?? { name: r.studentName, bookings: [] };
      entry.bookings.push({
        bookingId: r.bookingId,
        classId: r.classId,
        classTitle: r.classTitle,
        classTs: new Date(r.scheduledAt).getTime(),
        status: r.status ?? "reserved",
        isFree: Boolean(r.isFree),
        bookedAt: new Date(r.bookedAt).toISOString(),
      });
      byStudent.set(r.studentId, entry);
    }

    const now = Date.now();
    const out: TutorStudent[] = [...byStudent.entries()].map(([studentId, e]) => {
      const booked = e.bookings.map((b) => Date.parse(b.bookedAt));
      return {
        key: studentKey(mine.id, studentId),
        name: publicDisplayName(e.name),
        initials: publicInitials(e.name),
        relations: ["booked"],
        status: studentStatusOf(e.bookings, now),
        since: new Date(Math.min(...booked)).toISOString(),
        lastActivityAt: new Date(Math.max(...booked)).toISOString(),
        bookings: e.bookings,
      };
    });

    /* Students with a class coming up first — they are the ones the tutor is about
       to see — then the most recently active. */
    const rank = (s: TutorStudent) => (s.status === "upcoming" ? 0 : s.status === "past" ? 1 : 2);
    out.sort((a, b) => rank(a) - rank(b) || b.lastActivityAt.localeCompare(a.lastActivityAt));
    return out;
  });

  /* ── GET /tutor/preview — the owner preview (« Aperçu privé ») ──────────────── */
  app.get("/tutor/preview", async (req): Promise<{ storefront: Storefront; status: TutorVerifStatus; suspended: boolean } | null> => {
    const session = await getSession(req);
    if (!session || session.profile.role !== "tutor") return null;
    return getOwnerPreviewData(session.profile.id);
  });

  /* ── GET /messages/unread-count ─────────────────────────────────────────────

     Messages the OTHER side wrote, in threads the caller is a participant of,
     after the caller last opened that thread (0036: tutor_read_at /
     student_read_at, moved by GET /threads/:id). Scoped by the participant columns,
     so a caller can only ever count their own conversations. A message hidden by
     moderation is not counted: the reader would open the thread and find a
     placeholder. Both roles use it; the shell shows it to tutors. */
  app.get("/messages/unread-count", async (req): Promise<{ count: number }> => {
    const session = await getSession(req);
    if (!session) return { count: 0 };
    const uid = session.profile.id;

    const [row] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(messages)
      .innerJoin(messageThreads, eq(messages.threadId, messageThreads.id))
      .where(
        and(
          isNull(messages.hiddenAt),
          raw`${messages.senderProfileId} is distinct from ${uid}`,
          or(
            and(
              eq(messageThreads.tutorProfileId, uid),
              or(isNull(messageThreads.tutorReadAt), gt(messages.createdAt, messageThreads.tutorReadAt)),
            ),
            and(
              eq(messageThreads.studentProfileId, uid),
              or(isNull(messageThreads.studentReadAt), gt(messages.createdAt, messageThreads.studentReadAt)),
            ),
          ),
        ),
      );
    return { count: row?.n ?? 0 };
  });

  /* ── GET /tutors/:slug/visibility — PUBLIC, anonymous ─────────────────────── */
  app.get<{ Params: { slug: string } }>("/tutors/:slug/visibility", async (req): Promise<{ visibility: TutorVisibility }> => {
    const slug = typeof req.params.slug === "string" ? req.params.slug.trim() : "";
    if (!slug) return { visibility: "missing" };
    return { visibility: await tutorVisibility(slug) };
  });
}
