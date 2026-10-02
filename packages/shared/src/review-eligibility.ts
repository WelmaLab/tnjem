/* WHO MAY REVIEW A CLASS — one rule, two callers (espace prof v2 · phase 7).

   POST /reviews refuses a review, and the review-prompt cron decides whom to ASK
   for one. If those two drifted, the email would invite students the API then
   turns away — or the API would accept reviews nobody was meant to write.

   "ATTENDED", AS THE PRODUCT CAN KNOW IT: Tnajem records no presence (the room is
   a Jitsi/Meet link a student can open straight from « Mes cours »), so the
   existing rule stands — the student held a live booking (not cancelled) on a
   class that was not cancelled and has ENDED (start + duration, ./live.ts). A
   student who cancelled, or whose class was called off, never qualifies.

   The error codes are the ones POST /reviews already returned, unchanged, so no
   screen has to learn a new one. Pure. */

import { classEndMs } from "./live";

export type ReviewGateInput = {
  /** null/undefined = no booking at all. */
  bookingStatus: string | null | undefined;
  classStatus?: string | null;
  scheduledAt: Date | string | number;
  durationMin?: number | null;
};

export type ReviewGate =
  | { ok: true }
  | { ok: false; error: "not-booked" | "class-not-started" | "class-not-ended" };

export function reviewEligibility(input: ReviewGateInput, now: number = Date.now()): ReviewGate {
  if (input.bookingStatus === null || input.bookingStatus === undefined) return { ok: false, error: "not-booked" };
  if (input.bookingStatus === "cancelled") return { ok: false, error: "not-booked" };
  // A called-off class cancels its bookings too; checked anyway so the rule holds by itself.
  if (input.classStatus === "cancelled") return { ok: false, error: "not-booked" };
  if (new Date(input.scheduledAt).getTime() > now) return { ok: false, error: "class-not-started" };
  if (classEndMs({ scheduledAt: input.scheduledAt, durationMin: input.durationMin }) > now) {
    return { ok: false, error: "class-not-ended" };
  }
  return { ok: true };
}

/** The review prompt goes out this long after the class ENDS. */
export const REVIEW_PROMPT_DELAY_MS = 2 * 60 * 60 * 1000;
/** …and not for a class older than this: switching the job on must not mail
    every student about every class they ever took. */
export const REVIEW_PROMPT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
