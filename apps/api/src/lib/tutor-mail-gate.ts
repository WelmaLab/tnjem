import { and, asc, eq, inArray, isNull, sql as raw, tutorMailDigest as d } from "@tnajem/db";
import { db } from "../db";

/* VULN-002 — THE TUTOR'S BOOKING-MAIL WINDOW (0047, tutor_mail_digest).

   A book → cancel loop used to e-mail the tutor on every event. Now:

     • The FIRST booking/cancellation e-mail to a tutor goes out at once: a tutor
       must learn of a booking promptly. It opens a window of TUTOR_MAIL_WINDOW_MS.
     • Every further event inside the window is QUEUED (a row with mailed_at null).
     • When the window closes, the queue goes out as ONE digest e-mail, sent by
       the /cron/reminders run (every 10 minutes in production) or, sooner, by the
       tutor's next event — whichever comes first. A digest opens a new window too,
       so a tutor gets at most one booking e-mail per window, however busy.

   Every decision runs under a per-tutor advisory lock, so two simultaneous events
   cannot both decide they are "the first". Only the decision is locked: the mail
   is sent after the commit (booking-mail.ts), never inside the transaction.

   This file only reads and writes rows. Sending lives in booking-mail.ts. */

/** 10 minutes: long enough that a loop (re-booking one class waits 10 minutes
    itself, routes/bookings.ts) yields one e-mail per window, short enough that a
    tutor hears about a second booking within ~20 minutes at worst (the window plus
    one cron period). */
export const TUTOR_MAIL_WINDOW_MS = 10 * 60_000;

/** Sent rows are only needed for the window check; a week is far beyond it. */
const KEEP_MAILED_MS = 7 * 24 * 60 * 60_000;

export type TutorMailEvent = {
  tutorProfileId: string;
  studentId: string | null;
  classId: string;
  event: "booked" | "cancelled";
  late: boolean;
};

/** "immediate": send this event's own e-mail now (the row is already marked sent).
    "queued": the window is open; it waits for the digest.
    "flush": the window has closed with events still queued; this event joined them
    and the caller sends the digest now (sendTutorDigest). */
export type Gate = { decision: "immediate" | "queued" | "flush"; rowId: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const lockTutor = (tx: Tx, tutorProfileId: string) =>
  tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`tutor-mail:${tutorProfileId}`}, 0))`);

const windowOpen = raw<boolean>`coalesce(max(${d.mailedAt}) > now() - ${TUTOR_MAIL_WINDOW_MS} * interval '1 millisecond', false)`;

export async function gateTutorMail(ev: TutorMailEvent): Promise<Gate> {
  return db.transaction(async (tx) => {
    await lockTutor(tx, ev.tutorProfileId);
    const [st] = await tx
      .select({ open: windowOpen, queued: raw<number>`(count(*) filter (where ${d.mailedAt} is null))::int` })
      .from(d)
      .where(eq(d.tutorProfileId, ev.tutorProfileId));
    const open = Boolean(st?.open);
    const queued = Number(st?.queued ?? 0);
    const immediate = !open && queued === 0;
    const [row] = await tx
      .insert(d)
      .values({ ...ev, immediate, mailedAt: immediate ? raw`now()` : null })
      .returning({ id: d.id });
    return { decision: immediate ? "immediate" : open ? "queued" : "flush", rowId: row.id };
  });
}

/** The immediate e-mail failed to send: the event goes back to the queue, so the
    next digest carries it instead of it being lost. */
export async function requeueTutorMail(rowId: string): Promise<void> {
  await db.update(d).set({ mailedAt: null, immediate: false }).where(eq(d.id, rowId));
}

export type ClaimedEvent = { id: string; studentId: string | null; classId: string; event: string; late: boolean };

/** Claims this tutor's queue for one digest — only once the window has closed.
    The claim (mailed_at = now()) is what opens the next window. */
export async function claimTutorDigest(tutorProfileId: string): Promise<ClaimedEvent[]> {
  return db.transaction(async (tx) => {
    await lockTutor(tx, tutorProfileId);
    const [st] = await tx.select({ open: windowOpen }).from(d).where(eq(d.tutorProfileId, tutorProfileId));
    if (st?.open) return [];
    const claimed = await tx
      .update(d)
      .set({ mailedAt: raw`now()` })
      .where(and(eq(d.tutorProfileId, tutorProfileId), isNull(d.mailedAt)))
      .returning({ id: d.id, studentId: d.studentId, classId: d.classId, event: d.event, late: d.late, createdAt: d.createdAt });
    return claimed
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(({ createdAt: _c, ...rest }) => rest);
  });
}

/** The digest failed to send: back in the queue for the next run. */
export async function unclaimTutorDigest(ids: string[]): Promise<void> {
  if (ids.length) await db.update(d).set({ mailedAt: null }).where(inArray(d.id, ids));
}

/** Tutors whose window has closed with events still queued (the cron's work list). */
export async function tutorsWithDueDigests(limit: number): Promise<string[]> {
  const rows = await db
    .select({ tutorProfileId: d.tutorProfileId })
    .from(d)
    .groupBy(d.tutorProfileId)
    .having(raw`count(*) filter (where ${d.mailedAt} is null) > 0 and not ${windowOpen}`)
    .orderBy(asc(raw`min(${d.createdAt})`))
    .limit(limit);
  return rows.map((r) => r.tutorProfileId);
}

/** Rows sent long ago carry nothing the window still needs. */
export async function purgeMailedTutorEvents(): Promise<void> {
  await db.delete(d).where(raw`${d.mailedAt} < now() - ${KEEP_MAILED_MS} * interval '1 millisecond'`);
}
