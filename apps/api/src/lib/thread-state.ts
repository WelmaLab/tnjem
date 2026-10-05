import { eq, sql as raw, bookings, classes, messageThreads, tutors } from "@tnajem/db";
import { THREAD_CLOSE_DAYS, type ThreadState } from "@tnajem/shared";
import { db } from "../db";

/* threadState — THE ONE PLACE that decides whether a conversation is open
   (phase-a lane L1, A2; CEO report finding 2).

   Sending used to be refused only when the booking was cancelled, so a thread
   outlived everything else: a tutor could keep writing to a minor through a
   months-old class, after the parent withdrew consent, after either account was
   blocked. POST /threads/:id/messages now asks this function and sends only on
   "open". The thread views call it too, so the UI can show the closed banner.

   One query, evaluated at the moment of asking and on the SERVER's clock — so a
   withdrawal or a block closes the thread on the very next send, with no job to
   run and nothing to back-fill. Reasons, most serious first:

     blocked            either profile has blocked_at (0019), or the tutor's
                        storefront is suspended (set with a block, and on erasure)
     consent-withdrawn  the student's consent is withdrawn (0023) and none stands.
                        A withdrawn consent is "no consent everywhere"; this is
                        where messaging starts agreeing with booking.
     booking-cancelled  the seat was given up (the rule that was already here)
     class-ended        THREAD_CLOSE_DAYS (FOUNDER default 7) after start + duration

   CLOSED IS NOT DELETED: reading and reporting do not consult this.

   student-space-v1 · G: bookingState(bookingId) gives the same verdict for a
   booking before its thread exists (the merged conversation's first send). */
/** The four verdicts as SQL over the pair's two profiles. Shared by threadState (the
    thread's own participant columns) and bookingState (the booking's two people,
    before any thread row exists), so the two can never disagree. */
function verdictColumns(tutorProfileId: Pair, studentProfileId: Pair) {
  return {
    bookingStatus: bookings.status,
    blocked: raw<boolean>`(
      ${tutors.suspendedAt} is not null
      or exists (
        select 1 from profiles p
        where p.blocked_at is not null
          and p.id in (${tutorProfileId}, ${studentProfileId})
      )
    )`,
    consentWithdrawn: raw<boolean>`(
      exists (
        select 1 from consents k
        where k.minor_id = ${studentProfileId} and k.withdrawn_at is not null
      )
      and not exists (
        select 1 from consents k
        where k.minor_id = ${studentProfileId} and k.withdrawn_at is null
      )
    )`,
    ended: raw<boolean>`(
      ${classes.scheduledAt}
        + make_interval(mins => coalesce(${classes.durationMin}, 90))
        + make_interval(days => ${THREAD_CLOSE_DAYS}::int)
      <= now()
    )`,
  };
}
type Pair = typeof messageThreads.tutorProfileId | typeof messageThreads.studentProfileId | typeof bookings.studentId | typeof tutors.profileId;

function verdict(row: { bookingStatus: string | null; blocked: boolean; consentWithdrawn: boolean; ended: boolean } | undefined): ThreadState {
  /* No row: the booking or the class is gone. Nothing to send into — the same
     answer the cancelled-booking check gave before this function existed. */
  if (!row) return "closed:booking-cancelled";
  if (row.blocked) return "closed:blocked";
  if (row.consentWithdrawn) return "closed:consent-withdrawn";
  if (row.bookingStatus === "cancelled") return "closed:booking-cancelled";
  if (row.ended) return "closed:class-ended";
  return "open";
}

export async function threadState(threadId: string): Promise<ThreadState> {
  const [row] = await db
    .select(verdictColumns(messageThreads.tutorProfileId, messageThreads.studentProfileId))
    .from(messageThreads)
    .innerJoin(bookings, eq(bookings.id, messageThreads.bookingId))
    .innerJoin(classes, eq(classes.id, messageThreads.classId))
    .innerJoin(tutors, eq(tutors.id, classes.tutorId))
    .where(eq(messageThreads.id, threadId))
    .limit(1);
  return verdict(row);
}

/* student-space-v1 · G — the SAME verdict for a booking whose thread may not exist
   yet. The merged conversation (one per student–prof pair) writes into the pair's
   most recent non-cancelled booking and creates that booking's thread row on the
   first send — only when this says "open", so a closed booking never grows a
   thread because someone pressed Envoyer. The two people are the booking's: the
   class's tutor and the booking's student. */
export async function bookingState(bookingId: string): Promise<ThreadState> {
  const [row] = await db
    .select(verdictColumns(tutors.profileId, bookings.studentId))
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .innerJoin(tutors, eq(tutors.id, classes.tutorId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  return verdict(row);
}
