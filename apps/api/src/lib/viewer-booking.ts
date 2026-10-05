import { and, asc, eq, sql as raw, bookings, classes } from "@tnajem/db";
import {
  classWhen,
  isClassOver,
  lateCancelRetainedTnd,
  movedAfterBooking,
  type ViewerBooking,
} from "@tnajem/shared";
import { db } from "../db";

/* THE VIEWER'S OWN SEATS — student-space-v1 · H1.

   Live test: a student who had booked opened the prof's page and the class page and
   was offered « Réserver la séance » again. Both pages are ISR-cached and anonymous,
   so they learn the seat in the browser, from the session: GET /classes/:id →
   `viewer_booking` (the class page) and GET /student/booked?tutor=<slug> (the
   storefront). Both read it here.

   A seat counts while it is live (not cancelled) on a class that was not cancelled
   and has not ENDED (start + duration, classEndMs — a class in progress is the one
   the student is about to join). The price fields feed the cancel confirmation the
   same figure GET /student/dashboard gives, which POST /bookings/cancel applies. */

/** End of the class, in SQL, exactly as classEndMs() computes it (≤ 0 or NULL → 90 min). */
const CLASS_END = raw`(${classes.scheduledAt} + (case when ${classes.durationMin} > 0 then ${classes.durationMin} else 90 end) * interval '1 minute')`;

export async function viewerBookings(
  studentId: string,
  scope: { tutorId: string } | { classId: string },
  now: number = Date.now(),
): Promise<ViewerBooking[]> {
  const rows = await seatRows(studentId, scope, now);
  return rows
    .filter((r) => !isClassOver({ scheduledAt: r.scheduledAt, durationMin: r.durationMin, status: r.status }, now))
    .map((r): ViewerBooking => {
      const d = new Date(r.scheduledAt);
      return {
        bookingId: r.bookingId,
        classId: r.classId,
        title: r.title,
        ...classWhen(d), // starts_at + Tunis day/month/time
        duration_min: r.durationMin ?? 90,
        phase: now >= d.getTime() ? "live" : "upcoming",
        isFree: Boolean(r.isFree),
        bookedAt: new Date(r.bookedAt).getTime(),
        lateCancelRetainedTnd: lateCancelRetainedTnd({
          amountTnd: r.isFree || r.subscriptionId ? 0 : Number(r.bookedPriceTnd ?? r.priceTnd ?? 0),
          waived: movedAfterBooking(r.bookedAt, r.rescheduledAt),
        }),
      };
    });
}

function seatRows(studentId: string, scope: { tutorId: string } | { classId: string }, now: number) {
  return db
    .select({
      bookingId: bookings.id,
      isFree: bookings.isFree,
      bookedPriceTnd: bookings.priceTnd,
      subscriptionId: bookings.subscriptionId,
      bookedAt: bookings.createdAt,
      classId: classes.id,
      title: classes.title,
      scheduledAt: classes.scheduledAt,
      durationMin: classes.durationMin,
      status: classes.status,
      priceTnd: classes.priceTnd,
      rescheduledAt: classes.rescheduledAt,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        eq(bookings.studentId, studentId),
        "tutorId" in scope ? eq(classes.tutorId, scope.tutorId) : eq(classes.id, scope.classId),
        raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
        raw`coalesce(${classes.status}, 'scheduled') not in ('cancelled', 'done')`,
        // ISO string + a cast: a raw Date parameter does not serialise through the driver.
        raw`${CLASS_END} > ${new Date(now).toISOString()}::timestamptz`,
      ),
    )
    .orderBy(asc(classes.scheduledAt))
    .limit(50);
}
