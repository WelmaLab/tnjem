import {
  and, desc, eq, gt, inArray, isNull, sql as raw,
  bookings, cancellations, classes, materials, profiles, tutorFollows, tutors,
} from "@tnajem/db";
import {
  BOOKING_GRACE_REASON, ficheType, initialsOfName, lateCancelRetainedTnd,
  movedAfterBooking, publicTutorName, sortLevels,
  type StudentClassRow, type StudentFiche, type StudentTutorRef,
} from "@tnajem/shared";
import { classEndMs } from "@tnajem/shared/live";
import { db } from "../db";
import { canReadWith, materialAccessContext, type MaterialAccessContext } from "./material-access";

/* THE STUDENT SPACE'S READS (student-space-v1 · pages). routes/student-space.ts
   answers with these; each one is the student's OWN data, read by profile id from
   the session — never an id from the request.

   WHERE A BOOKING STANDS (contract C7): from the class's start + duration
   (classEndMs), whatever classes.status says — a class still `scheduled` the day
   after is past. Cancelled = the booking or the class was cancelled; who did it is
   the cancellation ledger's last row for that booking.

   WHICH FICHES: the materials of the student's profs (followed, or any booking)
   that the ONE access rule lets them open (lib/material-access.ts, contract C6).
   Not every public material on the platform: « Mes fiches » is what THEIR profs
   shared. */

const MAX_BOOKINGS = 500;
const MAX_MATERIALS = 400;

type TutorCols = { id: string; slug: string; fullName: string; subject: string; levels: string[] | null; status: string | null };

export function tutorRef(t: TutorCols): StudentTutorRef {
  const name = publicTutorName(t.fullName) ?? "";
  return {
    id: t.id,
    slug: t.slug,
    name,
    initials: initialsOfName(name),
    subject: t.subject ?? "",
    levels: sortLevels(t.levels ?? []),
    verified: t.status === "verified",
  };
}

const tutorCols = {
  id: tutors.id,
  slug: tutors.slug,
  fullName: tutors.fullName,
  subject: tutors.subject,
  levels: tutors.levels,
  status: tutors.status,
};

/** Every booking of the student (cancelled ones too), newest class first, with its state. */
export async function studentBookings(uid: string, now = Date.now(), access?: MaterialAccessContext): Promise<StudentClassRow[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      isFree: bookings.isFree,
      bookedPriceTnd: bookings.priceTnd,
      subscriptionId: bookings.subscriptionId,
      bookedAt: bookings.createdAt,
      classId: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      classStatus: classes.status,
      priceTnd: classes.priceTnd,
      rescheduledAt: classes.rescheduledAt,
      tutor: tutorCols,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(eq(bookings.studentId, uid))
    .orderBy(desc(classes.scheduledAt))
    .limit(MAX_BOOKINGS);
  if (rows.length === 0) return [];

  // Who cancelled, and whether it was late: the ledger's LAST row per booking (0026: one row per cancellation).
  const cancelledIds = rows
    .filter((r) => r.bookingStatus === "cancelled" || r.classStatus === "cancelled")
    .map((r) => r.bookingId);
  const ledger = new Map<string, { actor: string; late: boolean; retainedTnd: number; paymentsEnabled: boolean; reason: string | null }>();
  if (cancelledIds.length) {
    const lrows = await db
      .select({
        bookingId: cancellations.bookingId,
        actor: cancellations.actor,
        late: cancellations.late,
        retainedTnd: cancellations.retainedTnd,
        paymentsEnabled: cancellations.paymentsEnabled,
        reason: cancellations.reason,
      })
      .from(cancellations)
      .where(inArray(cancellations.bookingId, cancelledIds))
      .orderBy(desc(cancellations.cancelledAt));
    for (const l of lrows) {
      if (l.bookingId && !ledger.has(l.bookingId)) {
        ledger.set(l.bookingId, { actor: l.actor, late: l.late, retainedTnd: Number(l.retainedTnd), paymentsEnabled: l.paymentsEnabled, reason: l.reason });
      }
    }
  }

  // How many fiches of each class the student may open — the ONE rule.
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const ctx = access ?? (await materialAccessContext(uid));
  const mrows = await db
    .select({ classId: materials.classId, tutorId: materials.tutorId, visibility: materials.visibility, removedAt: materials.removedAt })
    .from(materials)
    .where(and(inArray(materials.classId, classIds), isNull(materials.removedAt)))
    .limit(MAX_MATERIALS);
  const fichesOf = new Map<string, number>();
  for (const m of mrows) {
    if (m.classId && canReadWith(m, ctx)) fichesOf.set(m.classId, (fichesOf.get(m.classId) ?? 0) + 1);
  }

  return rows.map((r) => {
    const start = new Date(r.scheduledAt);
    const durationMin = r.durationMin ?? 90;
    const end = classEndMs({ scheduledAt: start, durationMin });
    const cancelled = r.bookingStatus === "cancelled" || r.classStatus === "cancelled";
    const state: StudentClassRow["state"] = cancelled ? "cancelled" : now >= end ? "past" : now >= start.getTime() ? "live" : "upcoming";
    const l = cancelled ? ledger.get(r.bookingId) : undefined;
    const cancelledBy: StudentClassRow["cancelledBy"] = !cancelled
      ? null
      : l
        ? (l.actor as "student" | "tutor" | "system")
        : r.classStatus === "cancelled" ? "tutor" : "student";
    /* « Annulation tardive » only for the student's own late cancel — not inside the
       15-minute grace, not when the class had been moved after they booked (waived). */
    const lateCancel =
      l && l.actor === "student" && l.late && l.reason !== BOOKING_GRACE_REASON && l.reason !== "class-rescheduled-waiver"
        ? { retainedTnd: l.retainedTnd, paymentsEnabled: l.paymentsEnabled }
        : null;
    const amount = r.isFree || r.subscriptionId ? 0 : Number(r.bookedPriceTnd ?? r.priceTnd ?? 0);
    return {
      bookingId: r.bookingId,
      classId: r.classId,
      title: r.title,
      tutor: tutorRef(r.tutor),
      startsAt: start.toISOString(),
      endsAt: new Date(end).toISOString(),
      durationMin,
      state,
      price: r.isFree
        ? { kind: "free", tnd: 0 }
        : r.subscriptionId
          ? { kind: "subscription", tnd: 0 }
          : { kind: "paid", tnd: Number(r.bookedPriceTnd ?? r.priceTnd ?? 0) },
      cancelledBy,
      lateCancel,
      // The same amount POST /bookings/cancel would use (routes/bookings.ts).
      lateCancelRetainedTnd: lateCancelRetainedTnd({ amountTnd: amount, waived: movedAfterBooking(r.bookedAt, r.rescheduledAt) }),
      bookedAt: new Date(r.bookedAt).getTime(),
      fiches: fichesOf.get(r.classId) ?? 0,
    } satisfies StudentClassRow;
  });
}

/** Upcoming first (soonest first), then past (latest first). Cancelled ones go to their own tab. */
export function splitBookings(rows: StudentClassRow[]) {
  const ahead = rows.filter((r) => r.state === "upcoming" || r.state === "live").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = rows.filter((r) => r.state === "past").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const cancelled = rows.filter((r) => r.state === "cancelled").sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { ahead, past, cancelled };
}

/** The tutors the student follows (not suspended, not erased), newest follow first. */
export async function followedTutorIds(uid: string): Promise<string[]> {
  const rows = await db
    .select({ id: tutors.id })
    .from(tutorFollows)
    .innerJoin(tutors, eq(tutors.id, tutorFollows.tutorId))
    .where(and(eq(tutorFollows.studentProfileId, uid), isNull(tutors.suspendedAt), isNull(tutors.erasedAt)))
    .orderBy(desc(tutorFollows.createdAt))
    .limit(200);
  return rows.map((r) => r.id);
}

/** When the student last opened « Mes fiches » (0042), or null. */
export async function lastSeenFiches(uid: string): Promise<Date | null> {
  const [p] = await db.select({ at: profiles.lastSeenFichesAt }).from(profiles).where(eq(profiles.id, uid)).limit(1);
  return p?.at ? new Date(p.at) : null;
}

/** Every fiche of these profs the student may open, newest first. */
export async function studentFiches(
  uid: string,
  tutorIds: readonly string[],
  opts: { lastSeen: Date | null; access?: MaterialAccessContext },
): Promise<StudentFiche[]> {
  const ids = [...new Set(tutorIds)];
  if (ids.length === 0) return [];
  const ctx = opts.access ?? (await materialAccessContext(uid));
  const rows = await db
    .select({
      id: materials.id,
      tutorId: materials.tutorId,
      classId: materials.classId,
      kind: materials.kind,
      visibility: materials.visibility,
      title: materials.title,
      mime: materials.mime,
      sizeBytes: materials.sizeBytes,
      youtubeId: materials.youtubeId,
      removedAt: materials.removedAt,
      createdAt: materials.createdAt,
      classTitle: classes.title,
      classAt: classes.scheduledAt,
      tutor: tutorCols,
    })
    .from(materials)
    .innerJoin(tutors, eq(tutors.id, materials.tutorId))
    .leftJoin(classes, eq(classes.id, materials.classId))
    .where(and(inArray(materials.tutorId, ids), isNull(materials.removedAt), isNull(tutors.erasedAt)))
    .orderBy(desc(materials.createdAt))
    .limit(MAX_MATERIALS);
  const seen = opts.lastSeen?.getTime() ?? null;
  return rows
    .filter((m) => canReadWith(m, ctx))
    .map((m) => ({
      id: m.id,
      title: m.title,
      type: ficheType(m.kind, m.mime),
      sizeBytes: m.sizeBytes ?? null,
      youtubeId: m.kind === "youtube" ? (m.youtubeId ?? null) : null,
      tutor: tutorRef(m.tutor),
      origin:
        m.classId && m.classTitle && m.classAt
          ? { kind: "class" as const, classId: m.classId, classTitle: m.classTitle, startsAt: new Date(m.classAt).toISOString() }
          : { kind: "page" as const },
      createdAt: new Date(m.createdAt).toISOString(),
      isNew: seen === null || new Date(m.createdAt).getTime() > seen,
    }));
}

/** The student's profs: followed ∪ any live (not cancelled) booking. tutors.id, followed first. */
export async function studentTutorIds(uid: string, bookingRows: StudentClassRow[], followed: string[]): Promise<string[]> {
  const booked = bookingRows.filter((r) => r.state !== "cancelled").map((r) => r.tutor.id);
  return [...new Set([...followed, ...booked])];
}

/** Tutor rows by id (public fields only), for profs the student follows but never booked. */
export async function tutorRefs(ids: readonly string[]): Promise<Map<string, StudentTutorRef>> {
  const out = new Map<string, StudentTutorRef>();
  if (ids.length === 0) return out;
  const rows = await db
    .select(tutorCols)
    .from(tutors)
    .where(and(inArray(tutors.id, [...ids]), isNull(tutors.suspendedAt), isNull(tutors.erasedAt)));
  for (const r of rows) out.set(r.id, tutorRef(r));
  return out;
}

/** « Réserver la prochaine »: this prof's next class (not cancelled, not started, a seat
    left) that the student holds no live seat in. */
export async function bookableNextClass(uid: string, tutorId: string): Promise<{ classId: string; title: string; startsAt: string } | null> {
  const rows = await db
    .select({ id: classes.id, title: classes.title, scheduledAt: classes.scheduledAt })
    .from(classes)
    .where(and(
      eq(classes.tutorId, tutorId),
      raw`coalesce(${classes.status}, 'scheduled') <> 'cancelled'`,
      gt(classes.scheduledAt, raw`now()`),
      raw`coalesce(${classes.seatsTaken}, 0) < coalesce(${classes.seats}, 0)`,
      raw`not exists (select 1 from ${bookings} b where b.class_id = ${classes.id} and b.student_id = ${uid}
                      and coalesce(b.status, 'reserved') <> 'cancelled')`,
    ))
    .orderBy(classes.scheduledAt)
    .limit(1);
  const r = rows[0];
  return r ? { classId: r.id, title: r.title, startsAt: new Date(r.scheduledAt).toISOString() } : null;
}

/** Each prof's next class (not cancelled, not started), booked or not. */
export async function nextClassOf(tutorIds: readonly string[]): Promise<Map<string, { classId: string; title: string; startsAt: string }>> {
  const out = new Map<string, { classId: string; title: string; startsAt: string }>();
  if (tutorIds.length === 0) return out;
  const rows = await db
    .select({ id: classes.id, tutorId: classes.tutorId, title: classes.title, scheduledAt: classes.scheduledAt })
    .from(classes)
    .where(and(
      inArray(classes.tutorId, [...tutorIds]),
      raw`coalesce(${classes.status}, 'scheduled') <> 'cancelled'`,
      gt(classes.scheduledAt, raw`now()`),
    ))
    .orderBy(classes.scheduledAt)
    .limit(500);
  for (const r of rows) {
    if (!out.has(r.tutorId)) out.set(r.tutorId, { classId: r.id, title: r.title, startsAt: new Date(r.scheduledAt).toISOString() });
  }
  return out;
}
