import {
  and, asc, desc, eq, gt, inArray, isNull, or, sql as raw,
  bookings, classes, messages, messageThreads, profiles, tutors,
} from "@tnajem/db";
import {
  initials,
  isAdult,
  messageBodyText,
  messagePreview,
  publicTutorName,
  shownThreadState,
  type ConversationClass,
  type ConversationDetail,
  type ConversationRole,
  type ConversationState,
  type ConversationSummary,
  type ThreadState,
  type ThreadStateShown,
} from "@tnajem/shared";
import { db } from "../db";
import { onSaleClassSql } from "./class-sale";
import { visibleMessageBody } from "./moderation-hide";
import { bookingState } from "./thread-state";

/* student-space-v1 · G — ONE CONVERSATION PER (STUDENT, PROF) PAIR, read off the
   per-booking threads (contract C2; the DTOs are in @tnajem/shared conversations.ts).

   NOTHING ABOUT THE GATE CHANGES. message_threads stays one row per booking, a pair
   exists only through a booking, and a message is written into ONE booking's thread
   — the pair's most recent non-cancelled booking (by class end) — after the same
   verdict threadState gives (bookingState: blocked, consent withdrawn, cancelled,
   ended THREAD_CLOSE_DAYS ago). There is still no way to reach someone you have no
   booking with.

   THE EMPTY-STATE FIX: the list is built from BOOKINGS, not threads, so a pair with
   a seat and no message yet is listed (« Écris le premier message »). Threads are
   NOT created at booking time (routes/bookings.ts is untouched, old bookings need
   no backfill): the first send creates the row.

   OWNERSHIP: every query is scoped by the caller — a student's own bookings, or the
   bookings on the caller's own classes — and a thread is read only where the
   caller is its participant (the same columns participantIn checks). */

export type Viewer = { uid: string; role: ConversationRole; tutorId: string | null; locale: string | null };

/** The caller as a conversation reader: students and tutors only. A tutor with no
    storefront has no classes, so no pairs (tutorId null). */
export async function viewerOf(profile: { id: string; role: string; locale: string | null }): Promise<Viewer | null> {
  if (profile.role === "student") return { uid: profile.id, role: "student", tutorId: null, locale: profile.locale };
  if (profile.role !== "tutor") return null;
  const [t] = await db.select({ id: tutors.id }).from(tutors).where(eq(tutors.profileId, profile.id)).limit(1);
  return { uid: profile.id, role: "tutor", tutorId: t?.id ?? null, locale: profile.locale };
}

type PairRow = Awaited<ReturnType<typeof pairRows>>[number];

/** Every booking of the caller's pairs (optionally one pair), with its thread if
    one exists AND the caller is its participant. */
async function pairRows(v: Viewer, withId?: string) {
  const readCol = v.role === "tutor" ? messageThreads.tutorReadAt : messageThreads.studentReadAt;
  const participantCol = v.role === "tutor" ? messageThreads.tutorProfileId : messageThreads.studentProfileId;
  const scope =
    v.role === "student"
      ? and(eq(bookings.studentId, v.uid), withId ? eq(tutors.id, withId) : undefined)
      : v.tutorId
        ? and(eq(classes.tutorId, v.tutorId), withId ? eq(bookings.studentId, withId) : undefined)
        : null;
  if (!scope) return [];
  return db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      bookedAt: bookings.createdAt,
      classId: classes.id,
      classTitle: classes.title,
      classStatus: classes.status,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      tutorId: tutors.id,
      tutorProfileId: tutors.profileId,
      tutorName: tutors.fullName,
      tutorSubject: tutors.subject,
      studentId: bookings.studentId,
      studentName: profiles.fullName,
      studentBirthYear: profiles.birthYear,
      studentBirthMonth: profiles.birthMonth,
      threadId: messageThreads.id,
      threadMinor: messageThreads.studentIsMinor,
      lastMessageAt: messageThreads.lastMessageAt,
      readAt: readCol,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .innerJoin(profiles, eq(bookings.studentId, profiles.id))
    .leftJoin(messageThreads, and(eq(messageThreads.bookingId, bookings.id), eq(participantCol, v.uid)))
    .where(scope)
    .orderBy(desc(classes.scheduledAt))
    .limit(2000);
}

const endMs = (r: Pick<PairRow, "scheduledAt" | "durationMin">) =>
  new Date(r.scheduledAt).getTime() + (r.durationMin ?? 90) * 60_000;

const isLive = (r: Pick<PairRow, "bookingStatus" | "classStatus">) =>
  r.bookingStatus !== "cancelled" && r.classStatus !== "cancelled";

/** The pair's key from the caller's side: the OTHER person. */
const keyOf = (v: Viewer, r: Pick<PairRow, "tutorId" | "studentId">) => (v.role === "student" ? r.tutorId : r.studentId);

function nameOf(v: Viewer, r: Pick<PairRow, "tutorName" | "studentName">): string | null {
  // C8: a prof is « Walid T. »; a student, to a prof, is first name + initial too.
  return publicTutorName(v.role === "student" ? r.tutorName : r.studentName);
}

function minorOf(rows: PairRow[]): boolean {
  if (rows.some((r) => r.threadMinor)) return true;
  const r = rows[0];
  return r ? !isAdult(r.studentBirthYear ?? null, r.studentBirthMonth ?? null) : false;
}

/** The other side's unread messages, per thread (hidden ones are not counted —
    the same rule as GET /messages/unread-count). */
async function unreadByThread(v: Viewer, threadIds: string[]): Promise<Map<string, number>> {
  if (threadIds.length === 0) return new Map();
  const readCol = v.role === "tutor" ? messageThreads.tutorReadAt : messageThreads.studentReadAt;
  const rows = await db
    .select({ threadId: messages.threadId, n: raw<number>`count(*)::int` })
    .from(messages)
    .innerJoin(messageThreads, eq(messages.threadId, messageThreads.id))
    .where(
      and(
        inArray(messages.threadId, threadIds),
        isNull(messages.hiddenAt),
        raw`${messages.senderProfileId} is distinct from ${v.uid}`,
        or(isNull(readCol), gt(messages.createdAt, readCol)),
      ),
    )
    .groupBy(messages.threadId);
  return new Map(rows.map((r) => [r.threadId, r.n]));
}

/* ── the list ─────────────────────────────────────────────────────────────── */

export async function listConversations(v: Viewer): Promise<ConversationSummary[]> {
  const rows = await pairRows(v);
  const pairs = new Map<string, PairRow[]>();
  for (const r of rows) {
    const k = keyOf(v, r);
    pairs.set(k, [...(pairs.get(k) ?? []), r]);
  }
  /* Listed: a pair with a seat that still stands, or with a conversation already
     had (a cancelled seat's history stays readable). A pair whose only booking was
     cancelled before anyone wrote has nothing to show and nothing to write into. */
  for (const [k, rs] of pairs) {
    if (!rs.some((r) => isLive(r) || r.threadId)) pairs.delete(k);
  }

  const threadIds = [...pairs.values()].flat().map((r) => r.threadId).filter((x): x is string => Boolean(x));
  const unread = await unreadByThread(v, threadIds);
  const lastByThread = new Map<string, { body: string; at: Date; mine: boolean }>();
  if (threadIds.length) {
    const last = await db
      .selectDistinctOn([messages.threadId], {
        threadId: messages.threadId,
        body: visibleMessageBody(v.locale),
        sender: messages.senderProfileId,
        at: messages.createdAt,
      })
      .from(messages)
      .where(inArray(messages.threadId, threadIds))
      .orderBy(messages.threadId, desc(messages.createdAt));
    for (const m of last) lastByThread.set(m.threadId, { body: m.body, at: new Date(m.at), mine: m.sender === v.uid });
  }

  const out: ConversationSummary[] = [];
  for (const [withId, rs] of pairs) {
    const head = rs[0];
    const name = nameOf(v, head);
    let last: { body: string; at: Date; mine: boolean } | null = null;
    for (const r of rs) {
      const m = r.threadId ? lastByThread.get(r.threadId) : undefined;
      if (m && (!last || m.at > last.at)) last = m;
    }
    const newestBooking = Math.max(...rs.map((r) => new Date(r.bookedAt).getTime()));
    out.push({
      withId,
      withName: name,
      initials: name ? initials(name) : "?",
      subject: v.role === "student" ? head.tutorSubject : null,
      iAm: v.role,
      studentIsMinor: minorOf(rs),
      last: last
        ? { body: messagePreview(messageBodyText(last.body)), at: last.at.toISOString(), mine: last.mine }
        : null,
      activityAt: new Date(last ? last.at.getTime() : newestBooking).toISOString(),
      unread: rs.reduce((n, r) => n + (r.threadId ? unread.get(r.threadId) ?? 0 : 0), 0),
    });
  }
  out.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
  return out;
}

/* ── one conversation ─────────────────────────────────────────────────────── */

/** The booking a message goes into: the pair's most recent non-cancelled booking,
    by class END (the last to close under THREAD_CLOSE_DAYS). */
function targetOf(rows: PairRow[]): PairRow | null {
  return rows.filter(isLive).sort((a, b) => endMs(b) - endMs(a))[0] ?? null;
}

/** What the composer may do, from the target booking's verdict. A seat that ended
    or was cancelled reads « réserve une séance » (booking again reopens it); a
    block or a withdrawn consent is a plain « fermée », never explained. */
function composerState(target: PairRow | null, state: ThreadState | null): { state: ConversationState; reason: ThreadStateShown | null } {
  if (!target || !state) return { state: "no-open-booking", reason: null };
  if (state === "open") return { state: "open", reason: null };
  if (state === "closed:class-ended" || state === "closed:booking-cancelled") {
    return { state: "no-open-booking", reason: shownThreadState(state) };
  }
  return { state: "closed", reason: shownThreadState(state) };
}

/** A prof a student may open a conversation with even without a booking: public. */
async function publicTutor(tutorId: string) {
  const [t] = await db
    .select({
      id: tutors.id, slug: tutors.slug, fullName: tutors.fullName, subject: tutors.subject,
      status: tutors.status, suspendedAt: tutors.suspendedAt, erasedAt: tutors.erasedAt,
    })
    .from(tutors)
    .where(eq(tutors.id, tutorId))
    .limit(1);
  if (!t) return { row: null, isPublic: false };
  return { row: t, isPublic: t.status === "verified" && !t.suspendedAt && !t.erasedAt };
}

async function nextOnSale(tutorId: string): Promise<ConversationClass | null> {
  const [c] = await db
    .select({ id: classes.id, title: classes.title, scheduledAt: classes.scheduledAt })
    .from(classes)
    .where(and(eq(classes.tutorId, tutorId), onSaleClassSql))
    .orderBy(asc(classes.scheduledAt))
    .limit(1);
  return c ? { classId: c.id, title: c.title, startsAt: new Date(c.scheduledAt).toISOString(), booked: false } : null;
}

/** Null = not a conversation this caller may open (same answer for "does not exist"). */
export async function getConversation(v: Viewer, withId: string): Promise<ConversationDetail | null> {
  const rows = await pairRows(v, withId);
  let tutor: Awaited<ReturnType<typeof publicTutor>> | null = null;
  if (v.role === "student") {
    tutor = await publicTutor(withId);
    // Any prof the student may see: a booking with them, or a public page.
    if (!tutor.row || (rows.length === 0 && !tutor.isPublic)) return null;
  } else if (rows.length === 0) {
    return null; // a tutor reads only students who booked one of their classes
  }

  const now = Date.now();
  const booked = rows
    .filter((r) => isLive(r) && endMs(r) > now)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
  let nextClass: ConversationClass | null = booked
    ? { classId: booked.classId, title: booked.classTitle, startsAt: new Date(booked.scheduledAt).toISOString(), booked: true }
    : null;
  if (!nextClass && v.role === "student" && tutor?.isPublic) nextClass = await nextOnSale(withId);

  const target = targetOf(rows);
  const verdict = target ? await bookingState(target.bookingId) : null;
  const { state, reason } = composerState(target, verdict);

  const threadRows = rows.filter((r) => r.threadId);
  const threadIds = threadRows.map((r) => r.threadId as string);
  const msgs = threadIds.length
    ? await db
        .select({
          id: messages.id,
          threadId: messages.threadId,
          senderProfileId: messages.senderProfileId,
          body: visibleMessageBody(v.locale), // moderation-hidden → the placeholder
          masked: messages.masked,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(inArray(messages.threadId, threadIds))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(1000)
    : [];

  /* Opening the conversation reads it: this side's mark moves to now on every
     thread of the pair the caller is a participant of (they are the only ones in
     threadIds), so GET /messages/unread-count drops for the whole pair. */
  if (threadIds.length) {
    await db
      .update(messageThreads)
      .set(v.role === "tutor" ? { tutorReadAt: raw`now()` } : { studentReadAt: raw`now()` })
      .where(inArray(messageThreads.id, threadIds));
  }

  const head = rows[0];
  const name = head ? nameOf(v, head) : publicTutorName(tutor?.row?.fullName ?? null);
  return {
    withId,
    withName: name,
    initials: name ? initials(name) : "?",
    iAm: v.role,
    subject: v.role === "student" ? (tutor?.row?.subject ?? null) : null,
    tutorSlug: v.role === "student" && tutor?.isPublic ? (tutor.row?.slug ?? null) : null,
    studentIsMinor: rows.length ? minorOf(rows) : false,
    nextClass,
    state,
    closedReason: reason,
    threads: threadRows
      .map((r) => ({
        threadId: r.threadId as string,
        classId: r.classId,
        classTitle: r.classTitle,
        classTs: new Date(r.scheduledAt).getTime(),
      }))
      .sort((a, b) => a.classTs - b.classTs),
    messages: msgs.map((m) => ({
      id: m.id,
      threadId: m.threadId,
      mine: m.senderProfileId === v.uid,
      body: messageBodyText(m.body), // phase-a A20: stored escaped, read as typed
      masked: m.masked,
      at: new Date(m.createdAt).toISOString(),
    })),
  };
}

/* ── writing ──────────────────────────────────────────────────────────────── */

export type SendTarget = {
  bookingId: string;
  classId: string;
  classTitle: string;
  tutorId: string;
  tutorProfileId: string | null;
  studentId: string;
};

/** Where a message to this pair goes, or why it cannot go anywhere. */
export async function sendTarget(
  v: Viewer,
  withId: string,
): Promise<{ ok: true; target: SendTarget } | { ok: false; error: "not-found" | "no-open-booking" | "thread-closed" }> {
  const rows = await pairRows(v, withId);
  if (rows.length === 0) {
    // A student may address a public prof: they are told to book, not "not found".
    if (v.role === "student" && (await publicTutor(withId)).isPublic) return { ok: false, error: "no-open-booking" };
    return { ok: false, error: "not-found" };
  }
  const target = targetOf(rows);
  const { state } = composerState(target, target ? await bookingState(target.bookingId) : null);
  if (state === "no-open-booking" || !target) return { ok: false, error: "no-open-booking" };
  if (state === "closed") return { ok: false, error: "thread-closed" };
  return {
    ok: true,
    target: {
      bookingId: target.bookingId,
      classId: target.classId,
      classTitle: target.classTitle,
      tutorId: target.tutorId,
      tutorProfileId: target.tutorProfileId,
      studentId: target.studentId,
    },
  };
}

/** The target booking's thread, created on the first send. onConflictDoNothing on
    the UNIQUE booking_id, then read back — the database decides a double-tap race,
    exactly as POST /threads does. */
export async function ensureThread(t: SendTarget): Promise<string | null> {
  const [student] = await db
    .select({ birthYear: profiles.birthYear, birthMonth: profiles.birthMonth })
    .from(profiles)
    .where(eq(profiles.id, t.studentId))
    .limit(1);
  await db
    .insert(messageThreads)
    .values({
      bookingId: t.bookingId,
      classId: t.classId,
      tutorProfileId: t.tutorProfileId,
      studentProfileId: t.studentId,
      studentIsMinor: !isAdult(student?.birthYear ?? null, student?.birthMonth ?? null),
    })
    .onConflictDoNothing();
  const [thread] = await db
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(eq(messageThreads.bookingId, t.bookingId))
    .limit(1);
  return thread?.id ?? null;
}
