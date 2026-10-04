/* CANCELLATION — 48 hours free, 40% retained after that. One definition.
   (live-fixes-3 · C: and always free within 15 minutes of booking, unless the class
   starts in less than 15 minutes — see CANCEL_GRACE_MS below.)

   ══════════════════════════════════════════════════════════════════════════════
   THIS IS A BEHAVIOUR CHANGE, AND IT LOOSENS A RULE.
   ══════════════════════════════════════════════════════════════════════════════
   Before this file, cancelBooking REFUSED inside 24 hours: `too-late`, no seat
   released, no record kept, and the student was told to go message their tutor.
   That is worse for everyone — the seat stayed locked to someone who was not
   coming, so the tutor could not resell it and the class ran a head short.

   Now a late cancellation SUCCEEDS. The seat goes back in the pool immediately
   and 40% of what the seat was worth is recorded as retained for the tutor. Late
   cancellation is newly possible, not newly punished.

   ══════════════════════════════════════════════════════════════════════════════
   NOTHING IS CHARGED. PAYMENTS ARE OFF.
   ══════════════════════════════════════════════════════════════════════════════
   Tnajem processes no money (packages/shared/src/payments.ts — paymentsEnabled()
   is false unless PAYMENTS_ENABLED === "1"). The ledger records what WOULD be
   retained so the rule is auditable from day one and so there is a real history
   when payments do open. No UI built on these numbers may imply that a student
   was, is, or will be debited today. Every screen that shows a retained amount
   must also say that nothing is taken during the pilot — see the copy in
   apps/web/app/[locale]/student/page.tsx and Terms §7.

   The `paymentsEnabled` column on the ledger exists exactly so that a future
   reader can tell a "would have been" row from a real one. Do not drop it. */

import {
  CANCEL_FREE_WINDOW_HOURS, LATE_CANCEL_RETAINED_PCT,
  CANCEL_GRACE_MINUTES, CANCEL_GRACE_MIN_LEAD_MINUTES, // live-fixes-3 · C
} from "./legal";

/** Free-cancellation window (48 hours, up from 24) and the share of a seat's value
    retained on a late cancellation. Both are Terms §7 values: they live in ./legal. */
export { CANCEL_FREE_WINDOW_HOURS, LATE_CANCEL_RETAINED_PCT };
export const CANCEL_FREE_WINDOW_MS = CANCEL_FREE_WINDOW_HOURS * 60 * 60 * 1000;

/* ── live-fixes-3 · C — THE 15-MINUTE GRACE AFTER BOOKING ───────────────────────

   Live case, 4 Oct 2026: a student booked a class 30 h away, cancelled 30 seconds
   later, and 40 % was recorded as retained for the tutor — while every page says
   « Sans engagement ». A seat held for half a minute blocked nothing for anyone.

   THE RULE: a cancellation within CANCEL_GRACE_MINUTES of the booking is free,
   whatever the time to the class, UNLESS the class starts in less than
   CANCEL_GRACE_MIN_LEAD_MINUTES at the moment of cancelling (a seat taken and
   dropped at the last minute does cost the tutor the seat). Otherwise the 48 h /
   40 % rule applies unchanged. Both boundaries are inclusive — the tie goes to the
   student, like the 48 h one: 15:00 after booking is free, 15:01 is not; exactly
   15:00 before the start still gets the grace, 14:59 does not.

   `bookedAt` is bookings.created_at — written by Postgres, reset by a re-booking
   (A8) — NEVER a client-supplied time. Like the 48 h window, every caller in
   apps/api passes the server's clock. */
export const CANCEL_GRACE_MS = CANCEL_GRACE_MINUTES * 60 * 1000;
export const CANCEL_GRACE_MIN_LEAD_MS = CANCEL_GRACE_MIN_LEAD_MINUTES * 60 * 1000;

/** The ledger's `reason` when the grace is what made a late cancellation free. */
export const BOOKING_GRACE_REASON = "booking-grace";

/** The last instant (ms) this booking's grace still applies: CANCEL_GRACE_MINUTES
    after the booking, cut short so it never reaches into the last
    CANCEL_GRACE_MIN_LEAD_MINUTES before the start. NaN when either date is
    unparseable — and NaN is never ≥ now, so a bad date never means "free". */
export function bookingGraceEndsAt(input: { bookedAt: Date | string | number; scheduledAt: Date | string | number }): number {
  const booked = new Date(input.bookedAt).getTime();
  const start = new Date(input.scheduledAt).getTime();
  return Math.min(booked + CANCEL_GRACE_MS, start - CANCEL_GRACE_MIN_LEAD_MS);
}

/** Is a cancellation made at `now` inside this booking's grace? */
export function withinBookingGrace(input: {
  bookedAt: Date | string | number;
  scheduledAt: Date | string | number;
  now?: number;
}): boolean {
  return (input.now ?? Date.now()) <= bookingGraceEndsAt(input);
}

/** Until when (ms) a cancellation of this booking is FREE under the whole rule: the
    later of the 48 h deadline and the end of the grace. What the confirm box says
    ("gratuite jusqu'à 18:32"). A free seat or a waived one retains nothing anyway;
    this is about the rule, not the amount. */
export function freeCancellationUntil(input: { bookedAt: Date | string | number; scheduledAt: Date | string | number }): number {
  const start = new Date(input.scheduledAt).getTime();
  return Math.max(start - CANCEL_FREE_WINDOW_MS, bookingGraceEndsAt(input));
}

export type CancellationOutcome = {
  /** True when the cancellation lands inside the 48-hour window. */
  late: boolean;
  /** live-fixes-3 · C: true when the 15-minute grace after booking is what made a
      LATE cancellation free. Reported beside `late`, never instead of it — like
      `waived`, the ledger keeps the facts and says why nothing was retained. */
  grace: boolean;
  /** Milliseconds between the cancellation and the class start. Negative if the
      class has already started — see the note on that case below. */
  msBeforeStart: number;
  /** 0 or LATE_CANCEL_RETAINED_PCT. Stored on the ledger row so a rate change
      later cannot silently rewrite history. */
  retainedPct: number;
  /** What the seat was worth. 0 for a free first session. */
  amountTnd: number;
  retainedTnd: number;
  releasedTnd: number;
};

/** Round to the centime — `classes.price_tnd` is numeric(7,2), so anything finer
    would not survive the round trip and the ledger would stop balancing. */
function toCentimes(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The whole rule, as a pure function of (start time, now, amount).

    SERVER TIME ONLY. `now` defaults to Date.now() and callers in apps/api never
    pass a client-supplied value: a cancellation deadline that trusts the
    client's clock is not a deadline.

    THE BOUNDARY IS INCLUSIVE: exactly 48h00m00s before the start is still FREE.
    "Tu peux annuler gratuitement jusqu'à 48 heures avant" reads as inclusive to
    a student, and the tie should go to them. 47h59m is late; 48h01m is free.

    A class that has ALREADY STARTED gives a negative msBeforeStart and is late,
    which is the correct answer rather than an error: the endpoint has its own
    rules about what may still be cancelled, and this function's job is only to
    price it. */
export function cancellationOutcome(input: {
  scheduledAt: Date | string | number;
  amountTnd: number;
  now?: number;
  /* WAIVED: retain nothing, whatever the clock says.

     Two cases, both Step 11, and both are "the student did not choose this":
       • the TUTOR cancelled the class — 100% release, always. Retaining a share
         of a seat the student still wanted would be charging them for someone
         else's decision.
       • the tutor MOVED the class after they booked. The student agreed to a
         time that no longer exists, so the 48h window measured against the NEW
         time is meaningless to them.

     `late` is still reported truthfully. The ledger records "this happened three
     hours out AND nothing was retained, because it was waived" rather than
     pretending it was an early cancellation — a ledger that rewrites the facts to
     justify the number is not a ledger. */
  waived?: boolean;
  /* live-fixes-3 · C: when the booking was made (bookings.created_at — server
     time). Without it there is no grace: the rule as it was. */
  bookedAt?: Date | string | number;
}): CancellationOutcome {
  const startsAt = new Date(input.scheduledAt).getTime();
  const now = input.now ?? Date.now();
  const msBeforeStart = startsAt - now;

  /* An unparseable date must not silently become "free to cancel". NaN fails
     every comparison, so state the intent instead of relying on that. */
  const late = Number.isNaN(startsAt) ? true : msBeforeStart < CANCEL_FREE_WINDOW_MS;

  // live-fixes-3 · C: an unparseable bookedAt gives NaN, which is never inside the grace.
  const grace = late && input.bookedAt !== undefined && withinBookingGrace({ bookedAt: input.bookedAt, scheduledAt: input.scheduledAt, now });

  /* Negative or non-finite amounts are nonsense; treat them as zero rather than
     recording a negative retention. */
  const amountTnd = Number.isFinite(input.amountTnd) ? Math.max(0, toCentimes(input.amountTnd)) : 0;

  const retainedPct = late && !input.waived && !grace ? LATE_CANCEL_RETAINED_PCT : 0;
  const retainedTnd = toCentimes(amountTnd * retainedPct);
  /* released is the REMAINDER.

     HONEST NOTE, because the obvious claim here is wrong and I checked: writing
     this as toCentimes(amountTnd * 0.6) instead would give the SAME answer for
     every amount this system can produce. amountTnd is already rounded to
     centimes above, and 0.4 x (a whole number of centimes) never lands on a .5
     fractional part, so the two roundings cannot disagree — verified across
     0-2000 TND. The mutation test that was supposed to prove otherwise passed.

     The remainder form stays anyway, for two reasons that are true: it says
     "what is left" rather than restating the rate, so it cannot drift if
     LATE_CANCEL_RETAINED_PCT changes to something like 1/3 where the equivalence
     does NOT hold; and it survives the pre-rounding above being removed. What
     the test genuinely catches is the version with no rounding at all
     (0.2 + 0.306 = 0.506, not 0.51). */
  const releasedTnd = toCentimes(amountTnd - retainedTnd);

  return { late, grace, msBeforeStart, retainedPct, amountTnd, retainedTnd, releasedTnd };
}

/* ── phase-a lane L3 (A21) — what the student is TOLD ─────────────────────── */

/** The reschedule waiver (Step 11), in one place: the tutor moved the class AFTER
    this booking was made, so the student agreed to a time that no longer exists.
    `bookedAt` is bookings.created_at, which a re-booking resets (A8). */
export function movedAfterBooking(
  bookedAt: Date | string | number,
  rescheduledAt: Date | string | number | null | undefined,
): boolean {
  if (rescheduledAt === null || rescheduledAt === undefined) return false;
  return new Date(bookedAt).getTime() < new Date(rescheduledAt).getTime();
}

/** What a LATE cancellation of this seat would retain — the figure the confirm box
    states BEFORE the student commits. 0 for a free seat (40 % of nothing) and for a
    waived one. Computed by cancellationOutcome itself, never re-derived. */
export function lateCancelRetainedTnd(input: { amountTnd: number; waived: boolean }): number {
  // Zero milliseconds before the start: inside the window by definition.
  return cancellationOutcome({ scheduledAt: 0, now: 0, amountTnd: input.amountTnd, waived: input.waived }).retainedTnd;
}

/** The share ACTUALLY retained: the rate when something was retained, else 0. The
    ledger keeps the rate that applied (retained_pct); a message must not show
    "40 %" beside a retained amount of 0. */
export function retainedShare(outcome: Pick<CancellationOutcome, "retainedTnd" | "retainedPct">): number {
  return outcome.retainedTnd > 0 ? outcome.retainedPct : 0;
}
