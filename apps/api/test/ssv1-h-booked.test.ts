import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App } from "./support/fx";

/* student-space-v1 · H1 — « Tu es inscrit à cette séance », not « Réserver » again.

   Live test: a student who had booked opened the prof's page and the class page and
   was offered « Réserver la séance ». Both pages are ISR-cached and anonymous, so the
   seat is learnt in the browser, from the session:

     • GET /classes/:id → viewer_booking   (the class page — the read it already makes)
     • GET /student/booked?tutor=<slug>    (the storefront — NEW, students only, C9)

   Only the caller's own live seats, on classes that have not ended, with what the
   cancel confirmation needs. A guest, a non-booked student and the owner get nothing. */

const MIN = 60_000;
let app: App;

before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

describe("GET /classes/:id → viewer_booking", () => {
  test("the booked student gets their seat; a guest, a stranger and the owner get null", async () => {
    const owner = await seedProfile({ role: "tutor" });
    const tutor = await seedTutor({ profileId: owner.id });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 9 });
    const student = await seedProfile({ role: "student" });
    const seat = await seedBooking({ classId: klass.id, studentId: student.id });
    const stranger = await seedProfile({ role: "student" });

    const mine = await call(app, "GET", `/classes/${klass.id}`, await login(student.id));
    assert.equal(mine.status, 200, mine.raw);
    const vb = mine.body.viewer_booking;
    assert.equal(vb.bookingId, seat.id, mine.raw);
    assert.equal(vb.classId, klass.id);
    assert.equal(vb.phase, "upcoming");
    assert.equal(vb.duration_min, 90);
    assert.equal(typeof vb.bookedAt, "number");
    assert.equal(vb.lateCancelRetainedTnd, 16, "40 % of the 40 TND seat — the figure POST /bookings/cancel would retain");
    assert.ok(vb.starts_at && vb.day && vb.month && vb.time, mine.raw);

    for (const [who, cookie] of [
      ["a guest", null],
      ["a non-booked student", await login(stranger.id)],
      ["the owner", await login(owner.id)],
    ] as const) {
      const res = await call(app, "GET", `/classes/${klass.id}`, cookie);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.viewer_booking, null, `${who}: ${res.raw}`);
    }
  });

  test("live now → phase live; cancelled seat, cancelled class or ended class → null", async () => {
    const tutor = await seedTutor({});
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);

    const onNow = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 10 * MIN), durationMin: 60 });
    await seedBooking({ classId: onNow.id, studentId: student.id });
    assert.equal((await call(app, "GET", `/classes/${onNow.id}`, cookie)).body.viewer_booking?.phase, "live");

    const cancelledSeat = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    await seedBooking({ classId: cancelledSeat.id, studentId: student.id, status: "cancelled" });
    assert.equal((await call(app, "GET", `/classes/${cancelledSeat.id}`, cookie)).body.viewer_booking, null);

    const calledOff = await seedClass({ tutorId: tutor.id, hoursFromNow: 30, status: "cancelled" });
    await seedBooking({ classId: calledOff.id, studentId: student.id });
    assert.equal((await call(app, "GET", `/classes/${calledOff.id}`, cookie)).body.viewer_booking, null);

    const ended = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 61 * MIN), durationMin: 60 });
    await seedBooking({ classId: ended.id, studentId: student.id });
    assert.equal((await call(app, "GET", `/classes/${ended.id}`, cookie)).body.viewer_booking, null);
  });

  test("a free seat retains nothing on a late cancel", async () => {
    const tutor = await seedTutor({ offersFreeFirstSession: true });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 5, isFreeFirst: true });
    const student = await seedProfile({ role: "student" });
    await seedBooking({ classId: klass.id, studentId: student.id, isFree: true });
    const res = await call(app, "GET", `/classes/${klass.id}`, await login(student.id));
    assert.equal(res.body.viewer_booking.isFree, true, res.raw);
    assert.equal(res.body.viewer_booking.lateCancelRetainedTnd, 0);
  });
});

describe("GET /student/booked?tutor=<slug>", () => {
  test("session + role: a guest and a tutor are refused; an unknown slug is not-found", async () => {
    const tutor = await seedTutor({});
    assert.deepEqual((await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, null)).body, { ok: false, error: "not-authenticated" });
    const otherTutor = await seedTutor({});
    assert.deepEqual(
      (await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, await login(otherTutor.profileId))).body,
      { ok: false, error: "students-only" },
    );
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    assert.deepEqual((await call(app, "GET", "/student/booked?tutor=nobody-here-xyz", cookie)).body, { ok: false, error: "not-found" });
    assert.deepEqual((await call(app, "GET", "/student/booked", cookie)).body, { ok: false, error: "not-found" });
  });

  test("the caller's own live seats with THIS tutor, soonest first — live included, ended/cancelled/others excluded", async () => {
    const tutor = await seedTutor({});
    const elsewhere = await seedTutor({});
    const student = await seedProfile({ role: "student" });
    const other = await seedProfile({ role: "student" });

    const later = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    const soon = await seedClass({ tutorId: tutor.id, hoursFromNow: 9 });
    const onNow = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 5 * MIN), durationMin: 90 });
    const ended = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 100 * MIN), durationMin: 90 });
    const dropped = await seedClass({ tutorId: tutor.id, hoursFromNow: 20 });
    const notMine = await seedClass({ tutorId: tutor.id, hoursFromNow: 12 });
    const otherTutorClass = await seedClass({ tutorId: elsewhere.id, hoursFromNow: 6 });

    for (const k of [later, soon, onNow, ended, otherTutorClass]) await seedBooking({ classId: k.id, studentId: student.id });
    await seedBooking({ classId: dropped.id, studentId: student.id, status: "cancelled" });
    await seedBooking({ classId: notMine.id, studentId: other.id });

    const res = await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, await login(student.id));
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.ok, true, res.raw);
    const got = res.body.bookings.map((b: { classId: string; phase: string }) => [b.classId, b.phase]);
    assert.deepEqual(got, [[onNow.id, "live"], [soon.id, "upcoming"], [later.id, "upcoming"]]);
  });

  test("never another student's seat, and nothing after the class ends", async () => {
    const tutor = await seedTutor({});
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 3 });
    const a = await seedProfile({ role: "student" });
    const b = await seedProfile({ role: "student" });
    await seedBooking({ classId: klass.id, studentId: a.id });
    const asB = await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, await login(b.id));
    assert.deepEqual(asB.body, { ok: true, bookings: [] });

    await sql`update classes set scheduled_at = now() - interval '2 hours' where id = ${klass.id}`;
    const asA = await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, await login(a.id));
    assert.deepEqual(asA.body, { ok: true, bookings: [] }, "a 90-minute class that started 2 h ago is over");
  });

  test("rate-limited like its neighbours (60 / min per student)", async () => {
    const tutor = await seedTutor({});
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    let last: unknown = null;
    for (let i = 0; i < 61; i++) last = (await call(app, "GET", `/student/booked?tutor=${tutor.slug}`, cookie)).body;
    assert.deepEqual(last, { ok: false, error: "too-many-requests" });
    await sql`delete from rate_limits where key like ${`booked:${student.id}%`}`;
  });
});
