import { and, eq, sql as raw, bookings, cancellations, classes, notify } from "@tnajem/db";
import { cancellationOutcome, notificationWhen } from "@tnajem/shared";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { recomputeTutorStats } from "./stats";
import { releasePromotionUse } from "./promotions"; // espace prof v2 · growth (P5)

/* CANCEL A CLASS FOR EVERYONE WHO BOOKED IT — the one implementation.

   Used when the TUTOR calls a class off (POST /classes/:id/cancel) and when an
   ADMIN blocks the tutor's account with "cancel upcoming classes"
   (routes/admin-accounts.ts). Both mean the same thing to a student — the class
   will not happen and they owe nothing — so both must move the same rows the same
   way.

   100% RELEASE, ALWAYS. Retaining a share of a seat the student still wanted
   would be charging them for someone else's decision. The ledger records this as
   `waived` rather than pretending the cancellation was early — see the note on
   that flag in @tnajem/shared/cancellation.ts.

   The class status, every booking, the seat count and the ledger rows move in
   ONE transaction. A half-cancelled class — status flipped, students still
   holding seats — is worse than not cancelling at all: they would turn up. */

export type CancellableClass = {
  id: string;
  title: string;
  scheduledAt: Date | string;
  priceTnd: string | number | null;
  tutorId: string;
};

export async function cancelClassForEveryone(
  c: CancellableClass,
  opts: {
    actor: "tutor" | "system";
    actorProfileId: string | null;
    reason: string;
    /** The student notification body, given the class title and its Tunis-time label. */
    notifyBody: (title: string, whenLabel: string) => string;
  },
): Promise<number> {
  /* Read the live bookings BEFORE the transaction, so the notifications after it
     know who to tell. notify() does I/O and must never run inside a write tx. */
  const live = await db
    .select({
      id: bookings.id, studentId: bookings.studentId, isFree: bookings.isFree,
      // espace prof v2 · growth (P5): the seat's own price, its cover and its promotion.
      bookedPriceTnd: bookings.priceTnd, subscriptionId: bookings.subscriptionId, promotionId: bookings.promotionId,
    })
    .from(bookings)
    .where(and(eq(bookings.classId, c.id), raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`));

  const now = Date.now();
  await db.transaction(async (tx) => {
    await tx
      .update(classes)
      /* Seats to zero rather than decremented per booking: the class is gone, so
         there is no arithmetic left to get wrong. */
      .set({ status: "cancelled", seatsTaken: 0 })
      .where(eq(classes.id, c.id));

    await tx
      .update(bookings)
      .set({ status: "cancelled" })
      .where(and(eq(bookings.classId, c.id), raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`));

    for (const b of live) {
      const outcome = cancellationOutcome({
        scheduledAt: c.scheduledAt,
        amountTnd: b.isFree || b.subscriptionId ? 0 : Number(b.bookedPriceTnd ?? c.priceTnd ?? 0), // espace prof v2 · growth (P5)
        now,
        waived: true, // the student did not make this decision — they owe nothing
      });
      if (b.promotionId) await releasePromotionUse(tx, b.promotionId); // espace prof v2 · growth (P5): the use goes back
      await tx
        .insert(cancellations)
        .values({
          bookingId: b.id,
          classId: c.id,
          actorProfileId: opts.actorProfileId,
          actor: opts.actor,
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
    }

    await recomputeTutorStats(c.tutorId, tx);
  });

  const whenLabel = notificationWhen(c.scheduledAt); // Tunis time, stored in the body
  for (const b of live) {
    await notify(db, b.studentId, {
      kind: "booking_cancelled",
      title: "Séance annulée",
      body: opts.notifyBody(c.title, whenLabel),
      href: "/student",
    });
  }
  return live.length;
}
