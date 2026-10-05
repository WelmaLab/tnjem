import { sql as raw, classes } from "@tnajem/db";
import { db } from "../db";

/* SCHEDULED → DONE — student-space-v1 · H2 (contract C7).

   Live test: « testing right now » (4 Oct 11:30, 90 min) was still `scheduled` the
   next day — nothing ever wrote `done`. Every read path already derives the state
   from start + duration (@tnajem/shared class-state.ts), so no screen waits for this;
   the sweep makes the ROW true as well, for whatever reads the column directly (SQL
   filters, exports, an admin query).

   Run by /cron/reminders (every 10 min), with or without a mail provider. Moves
   only `scheduled` (or a legacy NULL, the column default) whose END — classEndMs:
   start + duration, a missing or non-positive duration counting as 90 min — has
   passed. A cancelled class stays cancelled. `live` is never written by the app;
   a row someone set to it by hand is left alone. Idempotent: a second run matches
   nothing.

   THE BOOKINGS DO NOT FOLLOW. `booking_status` is reserved | paid | attended |
   cancelled; the only "after the class" value, `attended`, would claim the student
   was there, and Tnajem records no presence (the room is a Jitsi/Meet link). A seat
   on an ended class is a past seat by its class's end — the same derivation every
   screen uses — so its row keeps reserved/paid (paid also carries the payment state
   for when payments switch on). No attendance is ever marked. */

const CLASS_END = raw`(${classes.scheduledAt} + (case when ${classes.durationMin} > 0 then ${classes.durationMin} else 90 end) * interval '1 minute')`;

export async function markEndedClassesDone(now: Date = new Date()): Promise<number> {
  const moved = await db
    .update(classes)
    .set({ status: "done" })
    .where(
      raw`coalesce(${classes.status}, 'scheduled') = 'scheduled'
          and ${CLASS_END} <= ${now.toISOString()}::timestamptz`,
    )
    .returning({ id: classes.id });
  return moved.length;
}
