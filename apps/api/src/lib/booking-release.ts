import { and, eq, gt, sql as raw, bookings, cancellations, classes } from "@tnajem/db";
import { cancellationOutcome } from "@tnajem/shared";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { rotateRoomToken } from "./room-rotation";
import { recomputeTutorStats } from "./stats";
import { releasePromotionUse } from "./promotions"; // espace prof v2 · growth (P5)

/* RELEASING SOMEONE'S UPCOMING SEATS WHEN THEY DID NOT CHOOSE TO CANCEL.

   Two callers, one rule: an admin blocking an account, and a guardian withdrawing
   consent for a minor. In both, the student did not decide to cancel, so the
   cancellation is WAIVED (nothing retained), the seat goes back on sale, the
   ledger records why, and the room link rotates so the released seat does not keep
   a way into the room. Extracted from routes/admin-accounts.ts so the second
   caller cannot drift from the first. */

export type ReleasableBooking = {
  id: string;
  classId: string;
  isFree: boolean | null;
  scheduledAt: Date;
  priceTnd: string | null;
  tutorId: string;
  // espace prof v2 · growth (P5): the seat's own price, its cover and its promotion.
  bookedPriceTnd?: string | null;
  subscriptionId?: string | null;
  promotionId?: string | null;
};

/** A student's upcoming, non-cancelled bookings on classes that will still run. */
export async function upcomingBookingsOf(studentId: string): Promise<ReleasableBooking[]> {
  return db
    .select({
      id: bookings.id,
      classId: classes.id,
      isFree: bookings.isFree,
      scheduledAt: classes.scheduledAt,
      priceTnd: classes.priceTnd,
      tutorId: classes.tutorId,
      bookedPriceTnd: bookings.priceTnd, // espace prof v2 · growth (P5)
      subscriptionId: bookings.subscriptionId,
      promotionId: bookings.promotionId,
    })
    .from(bookings)
    .innerJoin(classes, eq(bookings.classId, classes.id))
    .where(
      and(
        eq(bookings.studentId, studentId),
        raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
        gt(classes.scheduledAt, new Date()),
        raw`coalesce(${classes.status}, 'scheduled') not in ('cancelled', 'done')`,
      ),
    );
}

export async function releaseBookings(
  rows: ReleasableBooking[],
  opts: { actorProfileId: string; reason: string },
): Promise<{ released: number; releasedRows: ReleasableBooking[] }> {
  const now = Date.now();
  const touchedTutors = new Set<string>();
  const releasedRows: ReleasableBooking[] = [];
  for (const b of rows) {
    const released = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(bookings)
        .set({ status: "cancelled" })
        .where(and(eq(bookings.id, b.id), raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`))
        .returning({ id: bookings.id });
      if (!row) return false;
      await tx
        .update(classes)
        .set({ seatsTaken: raw`greatest(coalesce(${classes.seatsTaken}, 0) - 1, 0)` })
        .where(eq(classes.id, b.classId));
      await rotateRoomToken(tx, b.classId);
      const outcome = cancellationOutcome({
        scheduledAt: b.scheduledAt,
        amountTnd: b.isFree || b.subscriptionId ? 0 : Number(b.bookedPriceTnd ?? b.priceTnd ?? 0), // espace prof v2 · growth (P5)
        now,
        waived: true,
      });
      if (b.promotionId) await releasePromotionUse(tx, b.promotionId); // espace prof v2 · growth (P5)
      await tx
        .insert(cancellations)
        .values({
          bookingId: b.id,
          classId: b.classId,
          actorProfileId: opts.actorProfileId,
          actor: "system",
          hoursBeforeStart: (outcome.msBeforeStart / 3_600_000).toFixed(2),
          late: outcome.late,
          amountTnd: outcome.amountTnd.toFixed(2),
          retainedTnd: outcome.retainedTnd.toFixed(2),
          releasedTnd: outcome.releasedTnd.toFixed(2),
          retainedPct: outcome.retainedPct.toFixed(3),
          paymentsEnabled: paymentsEnabled(),
          reason: opts.reason,
        })
        .onConflictDoNothing();
      return true;
    });
    if (released) {
      releasedRows.push(b);
      touchedTutors.add(b.tutorId);
    }
  }
  for (const tutorId of touchedTutors) await recomputeTutorStats(tutorId, db);
  return { released: releasedRows.length, releasedRows };
}
