import { and, eq, gt, lte, sql as raw, studentSubscriptions } from "@tnajem/db";
import type { db as appDb } from "../db";

/* SUBSCRIBER SEATS — Espace prof v2 · Phase 5 A · contract C7.

   "A subscriber gets an automatic seat in the teacher's classes, up to their
   monthly quota. Use the existing booking logic and add a subscription_id on the
   booking." Read as: while a subscription is ACTIVE, a booking its student makes in
   that teacher's class is COVERED by it — the seat is part of the month already
   agreed — as long as the quota is not used up for the month that class falls in;
   beyond the quota it is an ordinary booking. The seat itself is claimed by the
   ordinary atomic seat claim (routes/bookings.ts): covered or not, a seat is a
   seat, and nobody oversells.

   THE MONTH WINDOWS. Month k of a subscription is [period_start + k months,
   period_start + (k+1) months), computed by Postgres (interval '1 month' knows
   month lengths). A renewal extends period_end by a month, so the windows stay
   aligned; "sessions per month" is counted per window, from the classes' own
   dates, cancelled bookings excluded (cancelling gives the session back).

   RACE-SAFE: the quota check-then-claim runs under pg_advisory_xact_lock keyed on
   the subscription, taken in the booking transaction BEFORE any row lock (after
   the free-first lock, which comes first in every booking transaction), so two
   simultaneous bookings by one subscriber cannot both take the last session. */

type Tx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];
type Q = Pick<typeof appDb, "select" | "execute">;
type SubRow = typeof studentSubscriptions.$inferSelect;

/** Covered, non-cancelled bookings of `subscriptionId` in the month window containing `at`. */
export async function sessionsUsedInWindow(q: Q, subscriptionId: string, periodStart: Date | string, at: Date | string): Promise<number> {
  const rows = (await q.execute(raw`
    select count(*)::int as n
      from bookings b
      join classes c on c.id = b.class_id
      cross join lateral (
        select ${new Date(periodStart).toISOString()}::timestamptz + k * interval '1 month' as ws,
               ${new Date(periodStart).toISOString()}::timestamptz + (k + 1) * interval '1 month' as we
          from generate_series(0, 120) k
         where ${new Date(periodStart).toISOString()}::timestamptz + k * interval '1 month' <= ${new Date(at).toISOString()}::timestamptz
           and ${new Date(at).toISOString()}::timestamptz < ${new Date(periodStart).toISOString()}::timestamptz + (k + 1) * interval '1 month'
         limit 1
      ) w
     where b.subscription_id = ${subscriptionId}
       and coalesce(b.status, 'reserved') <> 'cancelled'
       and c.scheduled_at >= w.ws and c.scheduled_at < w.we`)) as unknown as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/** The active subscription that covers a seat in this tutor's class at `classAt`,
    or null (none, not active, the class is outside the paid period, or the month's
    quota is used). Takes the subscription's advisory lock — call inside the booking
    transaction. */
export async function coveringSubscription(tx: Tx, studentId: string, tutorId: string, classAt: Date): Promise<SubRow | null> {
  const [sub] = await tx
    .select()
    .from(studentSubscriptions)
    .where(and(
      eq(studentSubscriptions.studentProfileId, studentId),
      eq(studentSubscriptions.tutorId, tutorId),
      eq(studentSubscriptions.status, "active"),
      lte(studentSubscriptions.periodStart, classAt),
      gt(studentSubscriptions.periodEnd, classAt),
    ))
    .limit(1);
  if (!sub || !sub.periodStart) return null;
  await tx.execute(raw`select pg_advisory_xact_lock(hashtextextended(${`sub-seat:${sub.id}`}, 0))`);
  const used = await sessionsUsedInWindow(tx, sub.id, sub.periodStart, classAt);
  return used < sub.sessionsPerMonth ? sub : null;
}
