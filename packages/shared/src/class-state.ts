/* WHEN A CLASS IS OVER — student-space-v1 · H2 (contract C7).

   Live test, 5 Oct: « testing right now » (4 Oct 11:30, 90 min) was still
   `scheduled` the next day. Nothing ever moved a class to `done`, and the read
   paths that reported `classes.status` as-is told every screen it had not
   happened yet.

   One rule now, for every read path: a class is over when `now` reaches its END
   (start + duration, classEndMs — the same instant the review gate and the live
   room use) and it was not cancelled — whatever the stored status says. The
   /cron/reminders sweep (apps/api/src/lib/class-done.ts) also writes `done` to the
   row afterwards, but no screen waits for it. Pure module. */
import { classEndMs } from "./live";
import type { ClassStatus } from "./class-time";

type ClassRowLike = {
  scheduledAt: Date | string | number;
  durationMin?: number | null;
  status?: string | null;
};

/** Ended and not cancelled: start + duration has passed. */
export function isClassOver(cls: ClassRowLike, now: number = Date.now()): boolean {
  if (cls.status === "cancelled") return false;
  if (cls.status === "done") return true;
  const end = classEndMs(cls);
  return Number.isFinite(end) && now >= end;
}

/** The status a read path REPORTS: `done` once the class has ended (cancelled stays
    cancelled), else the stored one (NULL is the column default, `scheduled`). */
export function effectiveClassStatus(cls: ClassRowLike, now: number = Date.now()): ClassStatus {
  const stored = (cls.status ?? "scheduled") as ClassStatus;
  if (stored === "cancelled") return "cancelled";
  return isClassOver(cls, now) ? "done" : stored;
}

/* « TU ES INSCRIT À CETTE SÉANCE » — student-space-v1 · H1.

   The signed-in student's own live seat on a class, for the storefront and the class
   page, which are ISR-cached and so can only learn it in the browser, after
   hydration: GET /classes/:id → `viewer_booking`, GET /student/booked?tutor=<slug>.
   Only seats on a class that has not ENDED and was not cancelled; `phase` says
   whether it is still to come or on right now. Everything the cancel confirmation
   states (the 48 h window, the 15-minute grace, the figure a late cancel retains)
   rides along, so the panel says what POST /bookings/cancel will do. */
export type ViewerBooking = {
  bookingId: string;
  classId: string;
  title: string;
  /** ISO 8601 start; day/month/time are its Tunis wall-clock parts (classWhen). */
  starts_at: string;
  day: string;
  month: string;
  time: string;
  duration_min: number;
  phase: "upcoming" | "live";
  isFree: boolean;
  /** epoch ms of bookings.created_at — the 15-minute grace is measured from it. */
  bookedAt: number;
  /** TND a late cancel of this seat would retain (0: free, covered, or moved after booking). */
  lateCancelRetainedTnd: number;
};
