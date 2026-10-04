import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App } from "./support/fx";
import { backdateBooking } from "./support/fx"; // live-fixes-3 · C

/* phase-a lane L3 (A6) — the free first session is given ONCE per student per tutor (D2).

   is_free on a booking was isEffectivelyFreeFirst(tutor toggle, class flag) and
   nothing else, so every free-first class was free for every student, as often as
   they booked it. The rule now also requires that the student holds no other free
   booking with this tutor that is not cancelled — and a free seat the STUDENT
   cancelled late is spent. The entitlement comes back when the tutor cancels, or
   when the student cancels 48h or more before. Race-safe: two simultaneous bookings
   by one student with one tutor yield at most one free seat. */

let app: App;
const classIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (classIds.length) await sql`delete from cancellations where class_id in ${sql(classIds)}`;
  await stopApp(app);
});

async function freeTutor() {
  return seedTutor({ offersFreeFirstSession: true });
}
async function freeClass(tutorId: string, hoursFromNow = 72) {
  const k = await seedClass({ tutorId, isFreeFirst: true, hoursFromNow });
  classIds.push(k.id);
  return k;
}
async function student() {
  const s = await seedProfile({ role: "student", birthYear: 1990 });
  return { ...s, cookie: await login(s.id) };
}
async function book(cookie: string, classId: string) {
  const res = await call(app, "POST", "/bookings", cookie, { classId });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true, res.raw);
  return res;
}
async function booking(classId: string, studentId: string) {
  const [row] = await sql<{ id: string; is_free: boolean; status: string }[]>`
    select id, is_free, status from bookings where class_id = ${classId} and student_id = ${studentId}`;
  return row;
}

describe("A6 · the free first session: once per student per tutor", () => {
  test("a second free-first booking with the same tutor is NOT free", async () => {
    const tutor = await freeTutor();
    const a = await freeClass(tutor.id);
    const b = await freeClass(tutor.id, 96);
    const s = await student();

    await book(s.cookie, a.id);
    await book(s.cookie, b.id);
    assert.equal((await booking(a.id, s.id)).is_free, true, "the first one is free");
    assert.equal((await booking(b.id, s.id)).is_free, false, "the second one is not");
  });

  test("the entitlement is per tutor: another tutor's first session is still free", async () => {
    const t1 = await freeTutor();
    const t2 = await freeTutor();
    const a = await freeClass(t1.id);
    const b = await freeClass(t2.id);
    const s = await student();
    await book(s.cookie, a.id);
    await book(s.cookie, b.id);
    assert.equal((await booking(a.id, s.id)).is_free, true);
    assert.equal((await booking(b.id, s.id)).is_free, true);
  });

  test("CONCURRENCY: 2 parallel bookings, same student, two free classes of one tutor → exactly one free", async () => {
    for (let round = 0; round < 5; round++) {
      const tutor = await freeTutor();
      const a = await freeClass(tutor.id);
      const b = await freeClass(tutor.id, 96);
      const s = await student();

      const [ra, rb] = await Promise.all([
        call(app, "POST", "/bookings", s.cookie, { classId: a.id }),
        call(app, "POST", "/bookings", s.cookie, { classId: b.id }),
      ]);
      assert.equal(ra.body.ok, true, ra.raw);
      assert.equal(rb.body.ok, true, rb.raw);

      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from bookings
         where student_id = ${s.id} and class_id in (${a.id}, ${b.id}) and is_free`;
      assert.equal(n, 1, `round ${round}: exactly one free seat, got ${n}`);
    }
  });

  test("the TUTOR cancels the free session → the entitlement comes back", async () => {
    const tutor = await freeTutor();
    const a = await freeClass(tutor.id);
    const b = await freeClass(tutor.id, 96);
    const s = await student();
    await book(s.cookie, a.id);

    const tutorCookie = await login(tutor.profileId);
    const cancelled = await call(app, "POST", `/classes/${a.id}/cancel`, tutorCookie, {});
    assert.equal(cancelled.body.ok, true, cancelled.raw);

    await book(s.cookie, b.id);
    assert.equal((await booking(b.id, s.id)).is_free, true);
  });

  test("the STUDENT cancels 48h or more before → the entitlement comes back", async () => {
    const tutor = await freeTutor();
    const a = await freeClass(tutor.id, 72);
    const b = await freeClass(tutor.id, 96);
    const s = await student();
    await book(s.cookie, a.id);
    const res = await call(app, "POST", "/bookings/cancel", s.cookie, { bookingId: (await booking(a.id, s.id)).id });
    assert.equal(res.body.late, false, res.raw);

    await book(s.cookie, b.id);
    assert.equal((await booking(b.id, s.id)).is_free, true);
  });

  test("the STUDENT cancels late → the free session is spent (for another class AND for a re-booking)", async () => {
    const tutor = await freeTutor();
    const a = await freeClass(tutor.id, 24);
    const b = await freeClass(tutor.id, 96);
    const s = await student();
    await book(s.cookie, a.id);
    assert.equal((await booking(a.id, s.id)).is_free, true);
    await backdateBooking((await booking(a.id, s.id)).id); // live-fixes-3 · C: outside the 15-minute grace
    const res = await call(app, "POST", "/bookings/cancel", s.cookie, { bookingId: (await booking(a.id, s.id)).id });
    assert.equal(res.body.late, true, res.raw);

    await book(s.cookie, b.id);
    assert.equal((await booking(b.id, s.id)).is_free, false, "another class of the same tutor");

    await call(app, "POST", "/bookings/cancel", s.cookie, { bookingId: (await booking(b.id, s.id)).id });
    await book(s.cookie, a.id);
    assert.equal((await booking(a.id, s.id)).is_free, false, "re-booking the late-cancelled class");
  });

  test("a late cancel WAIVED because the tutor moved the class does not spend it", async () => {
    const tutor = await freeTutor();
    const a = await freeClass(tutor.id, 72);
    const b = await freeClass(tutor.id, 96);
    const s = await student();
    await book(s.cookie, a.id);
    await sql`update classes set scheduled_at = now() + interval '24 hours', rescheduled_at = now() where id = ${a.id}`;
    const res = await call(app, "POST", "/bookings/cancel", s.cookie, { bookingId: (await booking(a.id, s.id)).id });
    assert.equal(res.body.late, true, res.raw);

    await book(s.cookie, b.id);
    assert.equal((await booking(b.id, s.id)).is_free, true);
  });
});
