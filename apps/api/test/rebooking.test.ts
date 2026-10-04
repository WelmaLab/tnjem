import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App } from "./support/fx";
import { backdateBooking } from "./support/fx"; // live-fixes-3 · C

/* phase-a lane L3 (A8) — re-booking a cancelled seat must not reuse the stale row.

   bookings is unique on (class_id, student_id), so re-booking a seat you cancelled
   REACTIVATES the old row. It used to flip only its status back, so:
     (a) is_free kept the value from the first booking, whatever the rules say now;
     (b) created_at kept the FIRST booking time, so a student who re-booked AFTER the
         tutor moved the class was still "waived" as if they had booked the old time;
     (c) the ledger was unique on booking_id, so the second cancellation of the same
         row was silently dropped (onConflictDoNothing) while the screen reported it. */

let app: App;
const classIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  // Ledger rows cascade from classes, but delete them explicitly: they are money rows.
  if (classIds.length) await sql`delete from cancellations where class_id in ${sql(classIds)}`;
  await stopApp(app);
});

async function setup(opts: { hoursFromNow?: number; tutorOffersFree?: boolean; classIsFree?: boolean } = {}) {
  const tutor = await seedTutor({ offersFreeFirstSession: opts.tutorOffersFree ?? false });
  const klass = await seedClass({
    tutorId: tutor.id,
    hoursFromNow: opts.hoursFromNow ?? 72,
    isFreeFirst: opts.classIsFree ?? false,
  });
  classIds.push(klass.id);
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  const cookie = await login(student.id);
  return { tutor, klass, student, cookie };
}

async function book(cookie: string, classId: string) {
  const res = await call(app, "POST", "/bookings", cookie, { classId });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true, res.raw);
  assert.notEqual(res.body.already, true, `expected a fresh booking: ${res.raw}`);
  return res;
}

async function bookingOf(classId: string, studentId: string) {
  const [row] = await sql<{ id: string; is_free: boolean; status: string }[]>`
    select id, is_free, status from bookings where class_id = ${classId} and student_id = ${studentId}`;
  return row;
}

async function cancel(cookie: string, bookingId: string) {
  const res = await call(app, "POST", "/bookings/cancel", cookie, { bookingId });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true, res.raw);
  return res;
}

describe("A8 · re-booking a cancelled seat", () => {
  test("(a) book → cancel → the tutor turns free off → re-book: is_free is now false", async () => {
    const { tutor, klass, student, cookie } = await setup({ tutorOffersFree: true, classIsFree: true });
    await book(cookie, klass.id);
    const first = await bookingOf(klass.id, student.id);
    assert.equal(first.is_free, true, "the first booking is free (tutor opted in, class free-first)");

    await cancel(cookie, first.id);
    await sql`update tutors set offers_free_first_session = false where id = ${tutor.id}`;

    await book(cookie, klass.id);
    const again = await bookingOf(klass.id, student.id);
    assert.equal(again.id, first.id, "the same row is reactivated (unique class/student)");
    assert.equal(again.status, "reserved");
    assert.equal(again.is_free, false, "is_free must follow the CURRENT rules, not the stale row");
  });

  test("(b) book → the class moves → cancel → re-book → a late cancel is judged on the NEW booking time", async () => {
    const { klass, student, cookie } = await setup({ hoursFromNow: 72 });
    await book(cookie, klass.id);
    const bk = await bookingOf(klass.id, student.id);

    // The tutor moves it to 24h from now (inside the 48h window).
    await sql`update classes set scheduled_at = now() + interval '24 hours', rescheduled_at = now()
              where id = ${klass.id}`;

    const waived = await cancel(cookie, bk.id);
    assert.equal(waived.body.late, true);
    assert.equal(waived.body.retainedTnd, 0, "booked the OLD time → the late cancel is waived");

    // Re-booking AFTER the move is choosing the new time.
    await book(cookie, klass.id);
    /* live-fixes-3 · C: outside the 15-minute grace after booking — the move goes back
       further still, so the re-booking is still the one made AFTER it. */
    await sql`update classes set rescheduled_at = now() - interval '2 hours' where id = ${klass.id}`;
    await backdateBooking(bk.id);
    const late = await cancel(cookie, bk.id);
    assert.equal(late.body.late, true);
    assert.equal(late.body.retainedTnd, 16, `re-booked after the move → normal rule (40% of 40): ${late.raw}`);

    const rows = await sql<{ reason: string | null; retained_tnd: string }[]>`
      select reason, retained_tnd from cancellations where booking_id = ${bk.id} order by cancelled_at`;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].reason, "class-rescheduled-waiver");
    assert.equal(rows[1].reason, null);
    assert.equal(Number(rows[1].retained_tnd), 16);
  });

  test("(c) book → late cancel → re-book → late cancel again: TWO ledger rows", async () => {
    const { klass, student, cookie } = await setup({ hoursFromNow: 24 });
    await book(cookie, klass.id);
    const bk = await bookingOf(klass.id, student.id);

    await backdateBooking(bk.id); // live-fixes-3 · C: outside the 15-minute grace after booking
    const one = await cancel(cookie, bk.id);
    assert.equal(one.body.late, true);
    await book(cookie, klass.id);
    await backdateBooking(bk.id); // live-fixes-3 · C
    const two = await cancel(cookie, bk.id);
    assert.equal(two.body.late, true);

    const rows = await sql<{ late: boolean; retained_tnd: string }[]>`
      select late, retained_tnd from cancellations where booking_id = ${bk.id} order by cancelled_at`;
    assert.equal(rows.length, 2, "one ledger row per CANCELLATION, not per booking");
    assert.deepEqual(rows.map((r) => [r.late, Number(r.retained_tnd)]), [[true, 16], [true, 16]]);
  });
});
