import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App,
} from "./support/fx";
import { backdateBooking } from "./support/fx"; // live-fixes-3 · C

/* phase-a lane L3 (A21) — a cancel message states what was ACTUALLY retained.

   The student screen said "40 % est noté comme retenu" on every late cancel,
   including a free seat (40 % of nothing) and a class the tutor moved after the
   student booked (waived: nothing retained). The API now returns the real share —
   0 whenever nothing is retained — and the dashboard gives each upcoming seat the
   amount a late cancel WOULD retain, so the warning shown before the student
   commits is true as well. The UI half is e2e/cancel-outcome.spec.ts. */

let app: App;
const classIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (classIds.length) await sql`delete from cancellations where class_id in ${sql(classIds)}`;
  await stopApp(app);
});

async function seat(opts: { hoursFromNow: number; isFree?: boolean; movedAfterBooking?: boolean }) {
  const tutor = await seedTutor();
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: opts.movedAfterBooking ? 96 : opts.hoursFromNow });
  classIds.push(klass.id);
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: opts.isFree ?? false });
  // live-fixes-3 · C: a seat booked an hour ago — outside the 15-minute grace after booking.
  await backdateBooking(booking.id);
  await sql`update classes set seats_taken = 1 where id = ${klass.id}`;
  if (opts.movedAfterBooking) {
    await sql`update classes set scheduled_at = now() + ${opts.hoursFromNow} * interval '1 hour',
                                 rescheduled_at = now() + interval '1 second'
              where id = ${klass.id}`;
  }
  return { klass, student, booking, cookie: await login(student.id) };
}

async function dashboardItem(cookie: string, bookingId: string) {
  const res = await call(app, "GET", "/student/dashboard", cookie);
  assert.equal(res.status, 200, res.raw);
  const item = [...res.body.upcoming, ...res.body.past].find((i: { bookingId: string }) => i.bookingId === bookingId);
  assert.ok(item, `booking ${bookingId} on the dashboard: ${res.raw}`);
  return item as { lateCancelRetainedTnd?: number };
}

async function cancel(cookie: string, bookingId: string) {
  const res = await call(app, "POST", "/bookings/cancel", cookie, { bookingId });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true, res.raw);
  return res.body as { late: boolean; retainedTnd: number; retainedPct: number; waived?: boolean; paymentsEnabled: boolean };
}

describe("A21 · the cancel outcome is the real one", () => {
  test("a FREE seat cancelled late: nothing retained, and no 40 % anywhere", async () => {
    const s = await seat({ hoursFromNow: 5, isFree: true });
    const out = await cancel(s.cookie, s.booking.id);
    assert.equal(out.late, true);
    assert.equal(out.retainedTnd, 0);
    assert.equal(out.retainedPct, 0, "no share is retained from a free seat");
    assert.equal(out.paymentsEnabled, false);
  });

  test("a class the tutor MOVED after the booking, cancelled late: waived, nothing retained", async () => {
    const s = await seat({ hoursFromNow: 5, movedAfterBooking: true });
    const out = await cancel(s.cookie, s.booking.id);
    assert.equal(out.late, true);
    assert.equal(out.waived, true);
    assert.equal(out.retainedTnd, 0);
    assert.equal(out.retainedPct, 0);
  });

  test("an EARLY cancel retains nothing", async () => {
    const s = await seat({ hoursFromNow: 72 });
    const out = await cancel(s.cookie, s.booking.id);
    assert.equal(out.late, false);
    assert.equal(out.retainedTnd, 0);
    assert.equal(out.retainedPct, 0);
  });

  test("a PAID seat cancelled late: 40 % of 40 TND is recorded, and said", async () => {
    const s = await seat({ hoursFromNow: 5 });
    const out = await cancel(s.cookie, s.booking.id);
    assert.equal(out.late, true);
    assert.equal(out.retainedTnd, 16);
    assert.equal(out.retainedPct, 0.4);
    assert.equal(out.paymentsEnabled, false, "recorded, not charged");
  });
});

describe("A21 · the warning shown BEFORE a late cancel carries the real figure", () => {
  test("free seat → 0", async () => {
    const s = await seat({ hoursFromNow: 5, isFree: true });
    assert.equal((await dashboardItem(s.cookie, s.booking.id)).lateCancelRetainedTnd, 0);
  });
  test("moved after booking → 0", async () => {
    const s = await seat({ hoursFromNow: 5, movedAfterBooking: true });
    assert.equal((await dashboardItem(s.cookie, s.booking.id)).lateCancelRetainedTnd, 0);
  });
  test("paid seat → 16 (40 % of 40 TND)", async () => {
    const s = await seat({ hoursFromNow: 5 });
    assert.equal((await dashboardItem(s.cookie, s.booking.id)).lateCancelRetainedTnd, 16);
  });
});
