import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedTutor, seedClass, seedProfile, seedBooking, backdateBooking, login, call, sql, type App,
} from "./support/fx";

/* student-space-v1 · C — Mes cours (GET /student/classes, GET /student/classes/:bookingId).

   Tabs from start + duration, whatever classes.status says (C7); who cancelled, and
   the late note only for the student's own late cancel; « offerte » / « couverte par
   l'abonnement » / a price; the detail: this class's fiches under the ONE rule, the
   review state, « Réserver la prochaine ». Another student's booking is a not-found. */

let app: App;
const materialIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (materialIds.length) await sql`delete from materials where id in ${sql(materialIds)}`;
  await stopApp(app);
});

type Row = { bookingId: string; classId: string; state: string; cancelledBy: string | null; lateCancel: { retainedTnd: number } | null; price: { kind: string; tnd: number } };
const ids = (rows: Row[]) => rows.map((r) => r.classId);

describe("C · who may ask", () => {
  test("signed out → not-authenticated; a tutor → not-a-student", async () => {
    assert.deepEqual((await call(app, "GET", "/student/classes", null)).body, { ok: false, error: "not-authenticated" });
    const tutor = await seedTutor();
    assert.deepEqual((await call(app, "GET", "/student/classes", await login(tutor.profileId))).body, { ok: false, error: "not-a-student" });
    assert.deepEqual((await call(app, "GET", "/student/classes/00000000-0000-4000-8000-000000000000", await login(tutor.profileId))).body, { ok: false, error: "not-a-student" });
  });
});

describe("C · the three tabs", () => {
  test("À venir (live included) · Passées (from the end, whatever the status) · Annulées (who, and the late note)", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    const upcoming = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const live = await seedClass({ tutorId: tutor.id, hoursFromNow: -0.5, durationMin: 90 });
    const endedButScheduled = await seedClass({ tutorId: tutor.id, hoursFromNow: -26, durationMin: 90 }); // classes.status still 'scheduled'
    const done = await seedClass({ tutorId: tutor.id, hoursFromNow: -24 * 8, status: "done" });
    for (const k of [upcoming, live, endedButScheduled, done]) await seedBooking({ classId: k.id, studentId: student.id });

    // Cancelled by me, late (booked an hour ago, class in 20 h): the ledger notes 16 TND (40 % of 40).
    const lateK = await seedClass({ tutorId: tutor.id, hoursFromNow: 20 });
    const lateB = await call(app, "POST", "/bookings", cookie, { classId: lateK.id });
    assert.equal(lateB.body.ok, true);
    const [lb] = await sql<{ id: string }[]>`select id from bookings where class_id = ${lateK.id} and student_id = ${student.id}`;
    await backdateBooking(lb.id);
    assert.equal((await call(app, "POST", "/bookings/cancel", cookie, { bookingId: lb.id })).body.late, true);
    // Cancelled by me inside the 15-minute grace: no late note.
    const graceK = await seedClass({ tutorId: tutor.id, hoursFromNow: 21 });
    await call(app, "POST", "/bookings", cookie, { classId: graceK.id });
    const [gb] = await sql<{ id: string }[]>`select id from bookings where class_id = ${graceK.id} and student_id = ${student.id}`;
    await call(app, "POST", "/bookings/cancel", cookie, { bookingId: gb.id });
    // Cancelled by the prof: the whole class.
    const profK = await seedClass({ tutorId: tutor.id, hoursFromNow: 100 });
    await seedBooking({ classId: profK.id, studentId: student.id });
    assert.equal((await call(app, "POST", `/classes/${profK.id}/cancel`, await login(tutor.profileId), {})).body.ok, true);

    const res = await call(app, "GET", "/student/classes", cookie);
    assert.equal(res.body.ok, true);
    assert.deepEqual(ids(res.body.ahead), [live.id, upcoming.id], "live first, then the soonest");
    assert.deepEqual(res.body.ahead.map((r: Row) => r.state), ["live", "upcoming"]);
    assert.deepEqual(ids(res.body.past), [endedButScheduled.id, done.id], "past from start + duration (C7), latest first");
    assert.ok(res.body.past.every((r: Row) => r.state === "past"));
    const cancelled = res.body.cancelled as Row[];
    const by = (k: { id: string }) => cancelled.find((r) => r.classId === k.id)!;
    assert.equal(by(lateK).cancelledBy, "student");
    assert.deepEqual(by(lateK).lateCancel, { retainedTnd: 16, paymentsEnabled: false });
    assert.equal(by(graceK).cancelledBy, "student");
    assert.equal(by(graceK).lateCancel, null, "inside the 15-minute grace: not a late cancellation");
    assert.equal(by(profK).cancelledBy, "tutor");
    assert.equal(by(profK).lateCancel, null);
    assert.doesNotMatch(res.raw, /attended|Suivie|replay/i, "no attendance, no recording");
  });

  test("the price: a price, « offerte » (free first), « couverte par l'abonnement »", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const paid = await seedClass({ tutorId: tutor.id, hoursFromNow: 50 });
    const free = await seedClass({ tutorId: tutor.id, hoursFromNow: 51 });
    const covered = await seedClass({ tutorId: tutor.id, hoursFromNow: 52 });
    await seedBooking({ classId: paid.id, studentId: student.id });
    await seedBooking({ classId: free.id, studentId: student.id, isFree: true });
    const [offer] = await sql<{ id: string }[]>`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'Pack', 4, 100) returning id`;
    const [sub] = await sql<{ id: string }[]>`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end)
      values (${offer.id}, ${tutor.id}, ${student.id}, 'active', 4, 100, now() - interval '1 day', now() + interval '29 days') returning id`;
    const b = await seedBooking({ classId: covered.id, studentId: student.id });
    await sql`update bookings set subscription_id = ${sub.id} where id = ${b.id}`;
    const res = await call(app, "GET", "/student/classes", await login(student.id));
    const kind = (k: { id: string }) => (res.body.ahead as Row[]).find((r) => r.classId === k.id)!.price;
    assert.deepEqual(kind(paid), { kind: "paid", tnd: 40 });
    assert.deepEqual(kind(free), { kind: "free", tnd: 0 });
    assert.deepEqual(kind(covered), { kind: "subscription", tnd: 0 });
  });
});

describe("C · the detail", () => {
  test("its fiches only (the one rule), the review state, « Réserver la prochaine »; another student's booking is not-found", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const stranger = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -30 });
    const other = await seedClass({ tutorId: tutor.id, hoursFromNow: -60 });
    const bookedNext = await seedClass({ tutorId: tutor.id, hoursFromNow: 24 });
    await seedClass({ tutorId: tutor.id, hoursFromNow: 30, seats: 1, seatsTaken: 1 });
    const open = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    const pb = await seedBooking({ classId: past.id, studentId: student.id });
    await seedBooking({ classId: other.id, studentId: student.id });
    const nb = await seedBooking({ classId: bookedNext.id, studentId: student.id });

    const mk = async (classId: string | null, visibility: string, title: string) => {
      const [m] = await sql<{ id: string }[]>`insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id)
        values (${tutor.id}, ${classId}, 'youtube', ${visibility}, ${title}, 'dQw4w9WgXcQ') returning id`;
      materialIds.push(m.id);
      return m.id;
    };
    const mine = await mk(past.id, "students", "Corrigé — série 3");
    const otherClass = await mk(other.id, "students", "Autre séance");
    const privateOne = await mk(past.id, "private", "Privé");
    const library = await mk(null, "students", "Tous mes élèves");

    let res = await call(app, "GET", `/student/classes/${pb.id}`, cookie);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.fiches.map((f: { id: string }) => f.id), [mine], "THIS class's fiches the student may open — not another class's, not a private one, not the library");
    for (const id of [otherClass, privateOne, library]) assert.ok(!res.raw.includes(id));
    assert.equal(res.body.row.fiches, 1);
    assert.equal(res.body.review, null);
    assert.equal(res.body.reviewBlock, null, "a past class can be reviewed");
    assert.equal(res.body.nextClass.classId, open.id, "the next class with a seat that I have not booked — not my booked one, not the full one");

    // The review flow (POST /reviews) — and the detail shows it.
    assert.equal((await call(app, "POST", "/reviews", cookie, { classId: past.id, rating: 4, text: "Très clair." })).body.ok, true);
    res = await call(app, "GET", `/student/classes/${pb.id}`, cookie);
    assert.deepEqual(res.body.review, { rating: 4, text: "Très clair." });

    const up = await call(app, "GET", `/student/classes/${nb.id}`, cookie);
    assert.equal(up.body.reviewBlock, "class-not-started");
    assert.equal(up.body.row.state, "upcoming");

    assert.deepEqual((await call(app, "GET", `/student/classes/${pb.id}`, await login(stranger.id))).body, { ok: false, error: "not-found" }, "someone else's booking");
    assert.deepEqual((await call(app, "GET", "/student/classes/not-a-uuid", cookie)).body, { ok: false, error: "not-found" });
  });
});
