import { and, asc, eq, gt, isNull, lte, sql as raw, bookings, classes, tutors } from "@tnajem/db";
import { REVIEW_PROMPT_DELAY_MS, REVIEW_PROMPT_MAX_AGE_MS, reviewEligibility } from "@tnajem/shared";
import { logEvent } from "@tnajem/shared/observability";
import { db } from "../db";
import { BOOKING_MAIL } from "./booking-mail-copy";
import {
  deliverTo, mailClass, mailDeliveryAvailable, mailLinks, recipientOf, type SendResult,
} from "./booking-mail";

/* THE REMINDER RUN — POST /cron/reminders (espace prof v2 · phase 7).

   Every few minutes (DEPLOY.md §7). Five independent sweeps; one failing never
   stops the others:

     student 24 h   classes starting in (1 h, 24 h], seat booked ≥ 24 h ahead
     student 1 h    classes starting in (0, 1 h],   seat booked ≥ 1 h ahead
     tutor 24 h/1 h the same windows, ONE email per class with ≥ 1 live booking
     review prompt  classes that ENDED 2 h to 7 days ago, for students who attended
                    (@tnajem/shared reviewEligibility — the rule POST /reviews applies)
                    and have not reviewed yet

   "Booked ahead" keeps a reminder from landing a minute after the confirmation:
   whoever books 3 h before gets the confirmation and the 1 h reminder, not a
   "demain" one. A run that comes late (the cron was down) still sends what is due,
   and nothing that is no longer due — a missed 24 h reminder is not sent 30 minutes
   before the start, the 1 h one is.

   EXACTLY ONCE, under overlap: each email is CLAIMED by a conditional UPDATE of its
   marker (0039) before it is sent; a second run's UPDATE matches nothing. A marker
   older than the booking (re-booked) or the class's last move is stale and counts as
   unsent. A failed send puts the marker back, so the next run retries while it is
   still due. Skipped by the recipient's preference, or no address on file: claimed
   and counted, never retried.

   No mail provider configured: the run does nothing and claims nothing. */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const LIVE_BOOKING = raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`;
const CLASS_RUNS = raw`coalesce(${classes.status}, 'scheduled') not in ('cancelled', 'done')`;

export type ReminderRun = {
  mail: boolean;
  student24h: number;
  student1h: number;
  tutor24h: number;
  tutor1h: number;
  reviewPrompts: number;
  skipped: number;
  failed: number;
  failedJobs: string[];
};

type Step = "24h" | "1h";
const LEAD: Record<Step, number> = { "24h": DAY, "1h": HOUR };

function tally(run: ReminderRun, res: SendResult, key: "student24h" | "student1h" | "tutor24h" | "tutor1h" | "reviewPrompts") {
  if (res === "sent") run[key] += 1;
  else if (res === "skipped") run.skipped += 1;
  else run.failed += 1;
}

/* ── student reminders ───────────────────────────────────────────────────── */

async function studentReminders(step: Step, now: Date, limit: number, run: ReminderRun): Promise<void> {
  const marker = step === "24h" ? bookings.reminder24hSentAt : bookings.reminder1hSentAt;
  const lower = step === "24h" ? new Date(now.getTime() + HOUR) : now;
  const upper = new Date(now.getTime() + LEAD[step]);
  const lead = `${LEAD[step] / 1000} seconds`;
  // Unsent, or sent about a booking/time that no longer exists.
  const due = raw`(${marker} is null or ${marker} < greatest(${bookings.createdAt}, coalesce(${classes.rescheduledAt}, ${bookings.createdAt})))`;

  const rows = await db
    .select({
      bookingId: bookings.id,
      studentId: bookings.studentId,
      previous: marker,
      classId: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      tutorFullName: tutors.fullName,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(
      and(
        LIVE_BOOKING,
        CLASS_RUNS,
        isNull(tutors.suspendedAt),
        gt(classes.scheduledAt, lower),
        lte(classes.scheduledAt, upper),
        raw`${bookings.createdAt} <= ${classes.scheduledAt} - ${lead}::interval`,
        due,
      ),
    )
    .orderBy(asc(classes.scheduledAt))
    .limit(limit);

  for (const r of rows) {
    const claimedAt = new Date(now);
    const [won] = await db
      .update(bookings)
      .set(step === "24h" ? { reminder24hSentAt: claimedAt } : { reminder1hSentAt: claimedAt })
      .where(
        and(
          eq(bookings.id, r.bookingId),
          raw`(${marker} is null or ${marker} < greatest(${bookings.createdAt}, coalesce((select c.rescheduled_at from classes c where c.id = ${bookings.classId}), ${bookings.createdAt})))`,
        ),
      )
      .returning({ id: bookings.id });
    if (!won) continue; // another run took it

    const s = await recipientOf(r.studentId);
    const res: SendResult = s
      ? await deliverTo(s, "reminders", (unsubscribeUrl) =>
          BOOKING_MAIL[s.locale].studentReminder({
            first: s.first,
            cls: mailClass(r, r.tutorFullName),
            step,
            liveUrl: mailLinks.live(s.locale, r.classId),
            spaceUrl: mailLinks.studentSpace(s.locale),
            unsubscribeUrl,
          }),
        )
      : "skipped";
    if (res === "failed") {
      await db
        .update(bookings)
        .set(step === "24h" ? { reminder24hSentAt: r.previous } : { reminder1hSentAt: r.previous })
        .where(and(eq(bookings.id, r.bookingId), eq(marker, claimedAt)));
    }
    tally(run, res, step === "24h" ? "student24h" : "student1h");
  }
}

/* ── tutor reminders: one per class ──────────────────────────────────────── */

async function tutorReminders(step: Step, now: Date, limit: number, run: ReminderRun): Promise<void> {
  const marker = step === "24h" ? classes.tutorReminder24hSentAt : classes.tutorReminder1hSentAt;
  const lower = step === "24h" ? new Date(now.getTime() + HOUR) : now;
  const upper = new Date(now.getTime() + LEAD[step]);
  const lead = `${LEAD[step] / 1000} seconds`;
  const booked = raw<number>`(select count(*)::int from bookings b where b.class_id = ${classes.id} and coalesce(b.status, 'reserved') <> 'cancelled')`;
  const due = raw`(${marker} is null or ${marker} < coalesce(${classes.rescheduledAt}, ${classes.createdAt}))`;

  const rows = await db
    .select({
      classId: classes.id,
      previous: marker,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      tutorFullName: tutors.fullName,
      tutorProfileId: tutors.profileId,
      booked,
    })
    .from(classes)
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(
      and(
        CLASS_RUNS,
        isNull(tutors.suspendedAt),
        gt(classes.scheduledAt, lower),
        lte(classes.scheduledAt, upper),
        raw`${classes.createdAt} <= ${classes.scheduledAt} - ${lead}::interval`,
        raw`${booked} > 0`,
        due,
      ),
    )
    .orderBy(asc(classes.scheduledAt))
    .limit(limit);

  for (const r of rows) {
    const claimedAt = new Date(now);
    const [won] = await db
      .update(classes)
      .set(step === "24h" ? { tutorReminder24hSentAt: claimedAt } : { tutorReminder1hSentAt: claimedAt })
      .where(and(eq(classes.id, r.classId), due))
      .returning({ id: classes.id });
    if (!won) continue;

    const t = await recipientOf(r.tutorProfileId);
    const res: SendResult = t
      ? await deliverTo(t, "reminders", (unsubscribeUrl) =>
          BOOKING_MAIL[t.locale].tutorReminder({
            first: t.first,
            cls: mailClass(r, r.tutorFullName),
            step,
            booked: Number(r.booked),
            liveUrl: mailLinks.live(t.locale, r.classId),
            dashboardUrl: mailLinks.tutorClasses(t.locale),
            unsubscribeUrl,
          }),
        )
      : "skipped";
    if (res === "failed") {
      await db
        .update(classes)
        .set(step === "24h" ? { tutorReminder24hSentAt: r.previous } : { tutorReminder1hSentAt: r.previous })
        .where(and(eq(classes.id, r.classId), eq(marker, claimedAt)));
    }
    tally(run, res, step === "24h" ? "tutor24h" : "tutor1h");
  }
}

/* ── the after-class review prompt ───────────────────────────────────────── */

async function reviewPrompts(now: Date, limit: number, run: ReminderRun): Promise<void> {
  // The class END, as classEndMs() computes it: a missing or non-positive duration counts as 90 min.
  const end = raw`(${classes.scheduledAt} + (case when ${classes.durationMin} > 0 then ${classes.durationMin} else 90 end) * interval '1 minute')`;
  const notReviewed = raw`not exists (select 1 from reviews r where r.student_id = ${bookings.studentId} and r.class_id = ${classes.id})`;

  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingStatus: bookings.status,
      studentId: bookings.studentId,
      classId: classes.id,
      classStatus: classes.status,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      tutorFullName: tutors.fullName,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .innerJoin(tutors, eq(classes.tutorId, tutors.id))
    .where(
      and(
        LIVE_BOOKING,
        raw`coalesce(${classes.status}, 'scheduled') <> 'cancelled'`,
        isNull(tutors.suspendedAt),
        isNull(bookings.reviewPromptSentAt),
        // ISO strings + a cast: a raw Date parameter does not serialise through the driver.
        raw`${end} <= ${new Date(now.getTime() - REVIEW_PROMPT_DELAY_MS).toISOString()}::timestamptz`,
        raw`${end} >= ${new Date(now.getTime() - REVIEW_PROMPT_MAX_AGE_MS).toISOString()}::timestamptz`,
        notReviewed,
      ),
    )
    .orderBy(asc(classes.scheduledAt))
    .limit(limit);

  for (const r of rows) {
    // The same rule POST /reviews enforces — the prompt never invites a refusal.
    const gate = reviewEligibility(
      { bookingStatus: r.bookingStatus ?? "reserved", classStatus: r.classStatus, scheduledAt: r.scheduledAt, durationMin: r.durationMin },
      now.getTime(),
    );
    if (!gate.ok) continue;

    const claimedAt = new Date(now);
    const [won] = await db
      .update(bookings)
      .set({ reviewPromptSentAt: claimedAt })
      .where(and(eq(bookings.id, r.bookingId), isNull(bookings.reviewPromptSentAt)))
      .returning({ id: bookings.id });
    if (!won) continue;

    const s = await recipientOf(r.studentId);
    const res: SendResult = s
      ? await deliverTo(s, "reminders", (unsubscribeUrl) =>
          BOOKING_MAIL[s.locale].reviewPrompt({
            first: s.first,
            cls: mailClass(r, r.tutorFullName),
            reviewUrl: mailLinks.studentSpace(s.locale),
            unsubscribeUrl,
          }),
        )
      : "skipped";
    if (res === "failed") {
      await db
        .update(bookings)
        .set({ reviewPromptSentAt: null })
        .where(and(eq(bookings.id, r.bookingId), eq(bookings.reviewPromptSentAt, claimedAt)));
    }
    tally(run, res, "reviewPrompts");
  }
}

/* ── the run ─────────────────────────────────────────────────────────────── */

export async function runReminders(opts: { now?: Date; limit?: number } = {}): Promise<ReminderRun> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 200;
  const run: ReminderRun = {
    mail: mailDeliveryAvailable(),
    student24h: 0,
    student1h: 0,
    tutor24h: 0,
    tutor1h: 0,
    reviewPrompts: 0,
    skipped: 0,
    failed: 0,
    failedJobs: [],
  };
  if (!run.mail) return run;

  const jobs: [string, () => Promise<void>][] = [
    ["student-1h", () => studentReminders("1h", now, limit, run)],
    ["student-24h", () => studentReminders("24h", now, limit, run)],
    ["tutor-1h", () => tutorReminders("1h", now, limit, run)],
    ["tutor-24h", () => tutorReminders("24h", now, limit, run)],
    ["review-prompt", () => reviewPrompts(now, limit, run)],
  ];
  for (const [name, job] of jobs) {
    try {
      await job();
    } catch (e) {
      run.failedJobs.push(name);
      logEvent("error", "reminder_job_failed", { job: name, detail: (e as { code?: string }).code ?? (e as Error).name });
    }
  }
  return run;
}
