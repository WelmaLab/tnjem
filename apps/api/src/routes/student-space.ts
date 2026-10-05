import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, gt, inArray, isNull, ne, sql as raw, classes, profiles, reviews, tutors } from "@tnajem/db";
import {
  displayName, isUuid, priceWithPromotion, studentToLevel, subjectCodeFrom,
  type StudentClassDetail, type StudentClasses, type StudentProfCard, type StudentProfs,
  type StudentHome, type StudentHomeProf, type StudentOpenClass, type StudentTutorRef, type StudentWeekItem,
} from "@tnajem/shared";
import { db } from "../db";
import { getSession, type Session } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { materialAccessContext } from "../lib/material-access";
import { livePublicPromotions } from "../lib/promotions";
import {
  bookableNextClass, followedTutorIds, lastSeenFiches, nextClassOf, splitBookings, studentBookings, studentFiches,
  studentSubscriptionRows, studentTutorIds, tutorRef, tutorRefs,
} from "../lib/student-space";

/* THE STUDENT SPACE — student-space-v1 · pages (letters B–F of STUDENT_SPACE_V1.md).

     GET /student/home        Accueil: the next class, this week, my profs, new fiches,
                              and — when there is nothing at all — suggested profs
     GET /student/profs       Mes profs: followed ∪ had-a-class, + « Abonnements mensuels »
     GET /student/classes     Mes cours: every booking, by tab (À venir · Passées · Annulées)
     GET /student/classes/:bookingId
                              one booking: its fiches, my review, the prof's next class

   EVERY ROUTE: a session (else not-authenticated), the STUDENT role (a tutor or a
   guardian gets not-a-student — the web layout already sends a tutor to /dashboard),
   and a per-student budget, like their neighbours' writes. Everything is read from
   the session's own profile id, never from an id in the request. Refusals are HTTP
   200 with { ok:false, error } (@tnajem/shared/contracts). */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Reads: generous — a page view is one call; the shell's badge asks on each navigation. */
const READ_BUDGET = { max: 600, windowMs: 10 * 60_000 };

type Gate = { ok: true; session: Session } | { ok: false; error: "not-authenticated" | "not-a-student" | "too-many-requests" };

/** Session + student role + the read budget. */
export async function studentGate(req: FastifyRequest, budget: { key: string; max: number; windowMs: number } | null = null): Promise<Gate> {
  const session = await getSession(req);
  if (!session) return { ok: false, error: "not-authenticated" };
  if (session.profile.role !== "student") return { ok: false, error: "not-a-student" };
  const b = budget ?? { key: "read", ...READ_BUDGET };
  const rl = await checkRateLimit(`student-space:${b.key}:${session.profile.id}`, b.max, b.windowMs);
  if (!rl.ok) return { ok: false, error: "too-many-requests" };
  return { ok: true, session };
}

/** Up to 3 verified profs for a student with nothing yet: matching their level and
    subjects (Profil) when any match, else the newest verified. */
async function suggestedTutors(uid: string): Promise<{ list: StudentTutorRef[]; matched: boolean }> {
  const [p] = await db.select({ level: profiles.level, subjects: profiles.subjects }).from(profiles).where(eq(profiles.id, uid)).limit(1);
  const rows = await db
    .select({ id: tutors.id, slug: tutors.slug, fullName: tutors.fullName, subject: tutors.subject, levels: tutors.levels, status: tutors.status })
    .from(tutors)
    .where(and(
      eq(tutors.status, "verified"),
      isNull(tutors.suspendedAt),
      isNull(tutors.erasedAt),
      raw`coalesce(${tutors.profileId}::text, '') <> ${uid}`,
    ))
    .orderBy(desc(tutors.createdAt))
    .limit(200);
  const level = studentToLevel(p?.level ?? null);
  const subjects = new Set((p?.subjects ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const scored = rows
    .map((t, i) => {
      const code = subjectCodeFrom(t.subject);
      const s = (level && (t.levels ?? []).includes(level) ? 1 : 0) + (subjects.size && ((code && subjects.has(code)) || subjects.has(t.subject)) ? 1 : 0);
      return { t, s, i };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i);
  if (scored.length) return { list: scored.slice(0, 3).map((x) => tutorRef(x.t)), matched: true };
  return { list: rows.slice(0, 3).map(tutorRef), matched: false };
}

export async function studentSpaceRoutes(app: FastifyInstance): Promise<void> {
  /* ── GET /student/home — Accueil (letter B) ───────────────────────────────── */
  app.get("/student/home", async (req) => {
    const gate = await studentGate(req);
    if (!gate.ok) return gate;
    const uid = gate.session.profile.id;
    const now = Date.now();

    const [access, followed, lastSeen] = await Promise.all([materialAccessContext(uid), followedTutorIds(uid), lastSeenFiches(uid)]);
    const rows = await studentBookings(uid, now, access);
    const { ahead } = splitBookings(rows);
    const next = ahead[0] ?? null;

    // « Cette semaine »: my other seats, and the open classes of the profs I follow.
    const horizon = now + WEEK_MS;
    const week: StudentWeekItem[] = ahead
      .filter((r) => r !== next && Date.parse(r.startsAt) < horizon)
      .map((row) => ({ kind: "booked" as const, row }));
    if (followed.length) {
      const mine = new Set(rows.filter((r) => r.state !== "cancelled").map((r) => r.classId));
      const open = await db
        .select({
          id: classes.id, title: classes.title, scheduledAt: classes.scheduledAt, durationMin: classes.durationMin,
          priceTnd: classes.priceTnd, seats: classes.seats, seatsTaken: classes.seatsTaken,
          tutor: { id: tutors.id, slug: tutors.slug, fullName: tutors.fullName, subject: tutors.subject, levels: tutors.levels, status: tutors.status },
        })
        .from(classes)
        .innerJoin(tutors, eq(tutors.id, classes.tutorId))
        .where(and(
          inArray(classes.tutorId, followed),
          eq(tutors.status, "verified"),
          isNull(tutors.suspendedAt),
          ne(classes.status, "cancelled"),
          gt(classes.scheduledAt, new Date(now)),
          raw`${classes.scheduledAt} < ${new Date(horizon).toISOString()}::timestamptz`,
        ))
        .orderBy(classes.scheduledAt)
        .limit(20);
      const promos = await livePublicPromotions(db, [...new Set(open.map((k) => k.tutor.id))]);
      for (const k of open) {
        const seatsLeft = Math.max(0, (k.seats ?? 0) - (k.seatsTaken ?? 0));
        if (mine.has(k.id) || seatsLeft <= 0) continue;
        const quote = priceWithPromotion(
          { kind: "class", id: k.id, priceTnd: Number(k.priceTnd ?? 0) },
          promos.filter((p) => p.tutorId === k.tutor.id),
        );
        const item: StudentOpenClass = {
          classId: k.id,
          title: k.title,
          tutor: tutorRef(k.tutor),
          startsAt: new Date(k.scheduledAt).toISOString(),
          durationMin: k.durationMin ?? 90,
          priceTnd: quote.finalTnd,
          seatsLeft,
        };
        week.push({ kind: "open", open: item });
      }
    }
    const at = (w: StudentWeekItem) => (w.kind === "booked" ? w.row.startsAt : w.open.startsAt);
    week.sort((a, b) => at(a).localeCompare(at(b)));

    // « Mes profs » and « Nouvelles fiches ».
    const profIds = await studentTutorIds(uid, rows, followed);
    const fiches = await studentFiches(uid, profIds, { lastSeen, access });
    const refs = new Map<string, StudentTutorRef>(rows.map((r) => [r.tutor.id, r.tutor]));
    const missing = profIds.filter((id) => !refs.has(id));
    for (const [id, ref] of await tutorRefs(missing)) refs.set(id, ref);
    const shownIds = profIds.filter((id) => refs.has(id));
    const nextOf = await nextClassOf(shownIds.slice(0, 3));
    const followedSet = new Set(followed);
    const profs: StudentHomeProf[] = shownIds.slice(0, 3).map((id) => ({
      tutor: refs.get(id)!,
      following: followedSet.has(id),
      nextClass: nextOf.get(id) ?? null,
      newFiches: fiches.filter((f) => f.tutor.id === id && f.isNew).length,
    }));

    const nothing = rows.length === 0 && followed.length === 0;
    const suggestions = nothing ? await suggestedTutors(uid) : null;

    const body: StudentHome = {
      firstName: displayName((gate.session.profile.fullName ?? "").trim().split(/\s+/)[0] ?? ""),
      next,
      week: week.slice(0, 6),
      profs,
      profsTotal: shownIds.length,
      newFiches: fiches.slice(0, 3),
      suggestions: suggestions?.list ?? null,
      suggestionsMatched: suggestions?.matched ?? false,
    };
    return { ok: true, ...body };
  });

  /* ── GET /student/profs — Mes profs (letter D) ─────────────────────────────── */
  app.get("/student/profs", async (req) => {
    const gate = await studentGate(req);
    if (!gate.ok) return gate;
    const uid = gate.session.profile.id;
    const [access, followed, lastSeen] = await Promise.all([materialAccessContext(uid), followedTutorIds(uid), lastSeenFiches(uid)]);
    const rows = await studentBookings(uid, Date.now(), access);
    const profIds = await studentTutorIds(uid, rows, followed);
    const refs = new Map<string, StudentTutorRef>(rows.map((r) => [r.tutor.id, r.tutor]));
    for (const [id, ref] of await tutorRefs(profIds.filter((id) => !refs.has(id)))) refs.set(id, ref);
    const shown = profIds.filter((id) => refs.has(id));
    const [fiches, nextOf, subscriptions] = await Promise.all([
      studentFiches(uid, shown, { lastSeen, access }),
      nextClassOf(shown),
      studentSubscriptionRows(uid),
    ]);
    const followedSet = new Set(followed);
    const mineAhead = new Set(rows.filter((r) => r.state === "upcoming" || r.state === "live").map((r) => r.classId));
    const profs: StudentProfCard[] = shown.map((id) => {
      const next = nextOf.get(id) ?? null;
      return {
        tutor: refs.get(id)!,
        following: followedSet.has(id),
        nextClass: next,
        nextClassBooked: Boolean(next && mineAhead.has(next.classId)),
        taken: rows.filter((r) => r.tutor.id === id && r.state === "past").length,
        fiches: fiches.filter((f) => f.tutor.id === id).length,
        newFiches: fiches.filter((f) => f.tutor.id === id && f.isNew).length,
      };
    });
    const body: StudentProfs = { profs, subscriptions };
    return { ok: true, ...body };
  });

  /* ── GET /student/classes — Mes cours (letter C) ──────────────────────────── */
  app.get("/student/classes", async (req) => {
    const gate = await studentGate(req);
    if (!gate.ok) return gate;
    const { ahead, past, cancelled } = splitBookings(await studentBookings(gate.session.profile.id));
    const body: StudentClasses = { ahead, past, cancelled };
    return { ok: true, ...body };
  });

  /* ── GET /student/classes/:bookingId — one booking (the detail panel) ──────── */
  app.get<{ Params: { bookingId: string } }>("/student/classes/:bookingId", async (req) => {
    const gate = await studentGate(req);
    if (!gate.ok) return gate;
    const uid = gate.session.profile.id;
    // Someone else's booking id answers exactly like an unknown one: no probing.
    if (!isUuid(req.params.bookingId)) return { ok: false, error: "not-found" };
    const access = await materialAccessContext(uid);
    const row = (await studentBookings(uid, Date.now(), access)).find((r) => r.bookingId === req.params.bookingId);
    if (!row) return { ok: false, error: "not-found" };

    const [fiches, mine, nextClass] = await Promise.all([
      studentFiches(uid, [row.tutor.id], { lastSeen: await lastSeenFiches(uid), access }),
      db.select({ rating: reviews.rating, text: reviews.text })
        .from(reviews)
        .where(and(eq(reviews.studentId, uid), eq(reviews.classId, row.classId)))
        .limit(1),
      bookableNextClass(uid, row.tutor.id),
    ]);
    /* Who may review: the same rule POST /reviews applies (review-eligibility.ts), read
       from the state this row already derived from start + duration. */
    const reviewBlock: StudentClassDetail["reviewBlock"] =
      row.state === "cancelled" ? "not-booked" : row.state === "upcoming" ? "class-not-started" : row.state === "live" ? "class-not-ended" : null;
    const body: StudentClassDetail = {
      row,
      fiches: fiches.filter((f) => f.origin.kind === "class" && f.origin.classId === row.classId),
      review: mine[0] ? { rating: mine[0].rating, text: mine[0].text ?? null } : null,
      reviewBlock,
      nextClass,
    };
    return { ok: true, ...body };
  });
}
