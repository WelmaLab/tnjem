import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { effectiveClassStatus, isClassOver } from "@tnajem/shared";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App } from "./support/fx";
import { markEndedClassesDone } from "../src/lib/class-done";

/* student-space-v1 · H2 — classes never became "done" (contract C7).

   Live test: « testing right now » (4 Oct 11:30, 90 min) was still `scheduled` the
   next day. Two halves to the fix, both proven here:

     • every read path derives the state from start + duration (classEndMs) — so a
       class reads `done` the minute it ends, BEFORE any cron has run;
     • /cron/reminders moves ended `scheduled` rows to `done`: idempotent, cancelled
       and in-progress classes untouched, and the bookings keep their status (no
       attendance is ever marked — Tnajem does not record presence).

   Other test files share the database (and the sweep is global), so every assertion
   is about this file's own rows. */

const MIN = 60_000;
const SECRET = "ssv1-h-test-secret-0123456789";
let app: App;

before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

const statusOf = async (id: string) =>
  (await sql<{ status: string | null }[]>`select status from classes where id = ${id}`)[0]?.status;
const bookingStatusOf = async (id: string) =>
  (await sql<{ status: string | null }[]>`select status from bookings where id = ${id}`)[0]?.status;

/** A class that started `startedMinAgo` minutes ago (negative: in the future). */
async function classStarted(tutorId: string, startedMinAgo: number, durationMin = 90, status?: string) {
  return seedClass({ tutorId, at: new Date(Date.now() - startedMinAgo * MIN), durationMin, status });
}

describe("isClassOver / effectiveClassStatus — the one rule (pure)", () => {
  const start = Date.parse("2026-10-04T10:30:00.000Z"); // 11:30 in Tunis
  const row = (status: string | null = "scheduled", durationMin: number | null = 90) => ({ scheduledAt: start, durationMin, status });

  test("over exactly at start + duration, not a millisecond before", () => {
    assert.equal(isClassOver(row(), start + 90 * MIN - 1), false);
    assert.equal(isClassOver(row(), start + 90 * MIN), true);
    assert.equal(effectiveClassStatus(row(), start + 89 * MIN), "scheduled");
    assert.equal(effectiveClassStatus(row(), start + 90 * MIN), "done");
    assert.equal(effectiveClassStatus(row(), start + 24 * 60 * MIN), "done", "the live-test case: the next day");
  });

  test("the class's own duration; missing or non-positive → 90 min (classEndMs)", () => {
    assert.equal(effectiveClassStatus(row("scheduled", 45), start + 45 * MIN), "done");
    assert.equal(effectiveClassStatus(row("scheduled", null), start + 89 * MIN), "scheduled");
    assert.equal(effectiveClassStatus(row("scheduled", 0), start + 90 * MIN), "done");
  });

  test("cancelled stays cancelled; a NULL status reads as scheduled; done stays done", () => {
    assert.equal(effectiveClassStatus(row("cancelled"), start + 3 * 24 * 60 * MIN), "cancelled");
    assert.equal(isClassOver(row("cancelled"), start + 3 * 24 * 60 * MIN), false);
    assert.equal(effectiveClassStatus(row(null), start - MIN), "scheduled");
    assert.equal(effectiveClassStatus(row(null), start + 90 * MIN), "done");
    assert.equal(effectiveClassStatus(row("done"), start + 90 * MIN), "done");
  });
});

describe("read paths report `done` after the end — before the cron runs", () => {
  test("GET /classes/:id", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 91);
    const inProgress = await classStarted(tutor.id, 30);
    const cancelled = await classStarted(tutor.id, 200, 90, "cancelled");
    const ahead = await classStarted(tutor.id, -60);
    const student = await seedProfile({ role: "student" });
    await seedBooking({ classId: ended.id, studentId: student.id });
    const cookie = await login(student.id);

    for (const [k, want] of [[ended, "done"], [inProgress, "scheduled"], [ahead, "scheduled"]] as const) {
      const res = await call(app, "GET", `/classes/${k.id}`, cookie);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.status, want, res.raw);
    }
    // A cancelled class of a verified tutor is still readable to a guest; it stays cancelled.
    const c = await call(app, "GET", `/classes/${cancelled.id}`, null);
    assert.equal(c.body.status, "cancelled", c.raw);
    assert.equal(await statusOf(ended.id), "scheduled", "the row itself is untouched — this is derivation, not the sweep");
  });

  test("GET /student/dashboard — past once the class ENDS (was: start + 2 h, whatever the duration)", async () => {
    const tutor = await seedTutor({});
    const short = await classStarted(tutor.id, 60, 45); // ended 15 min ago — the old rule kept it upcoming
    const long = await classStarted(tutor.id, 150, 180); // still on — the old rule moved it to past
    const ahead = await classStarted(tutor.id, -120);
    const student = await seedProfile({ role: "student" });
    for (const k of [short, long, ahead]) await seedBooking({ classId: k.id, studentId: student.id });

    const res = await call(app, "GET", "/student/dashboard", await login(student.id));
    assert.equal(res.status, 200, res.raw);
    const up = new Map(res.body.upcoming.map((i: { classId: string; status: string }) => [i.classId, i.status]));
    const past = new Map(res.body.past.map((i: { classId: string; status: string }) => [i.classId, i.status]));
    assert.equal(past.get(short.id), "done", res.raw);
    assert.equal(up.has(short.id), false);
    assert.equal(up.get(long.id), "scheduled", "a 3-hour class in its 150th minute is still the one to join");
    assert.equal(up.get(ahead.id), "scheduled");
  });

  test("GET /dashboard (the tutor's classes) — status and phase agree", async () => {
    const owner = await seedProfile({ role: "tutor" });
    const tutor = await seedTutor({ profileId: owner.id });
    const ended = await classStarted(tutor.id, 100);
    const inProgress = await classStarted(tutor.id, 10);
    const res = await call(app, "GET", "/dashboard", await login(owner.id));
    assert.equal(res.status, 200, res.raw);
    const byId = new Map(res.body.classes.map((k: { id: string; status: string; phase: string }) => [k.id, k]));
    assert.deepEqual(
      (({ status, phase }) => ({ status, phase }))(byId.get(ended.id) as { status: string; phase: string }),
      { status: "done", phase: "done" },
    );
    assert.deepEqual(
      (({ status, phase }) => ({ status, phase }))(byId.get(inProgress.id) as { status: string; phase: string }),
      { status: "scheduled", phase: "live" },
    );
  });

  test("GET /tutor/students — a student whose class is on right now is « upcoming », not « past »", async () => {
    const owner = await seedProfile({ role: "tutor" });
    const tutor = await seedTutor({ profileId: owner.id });
    const onNow = await classStarted(tutor.id, 20);
    const done = await classStarted(tutor.id, 120);
    const a = await seedProfile({ role: "student", fullName: "Amel Onnow" });
    const b = await seedProfile({ role: "student", fullName: "Bilel Ended" });
    await seedBooking({ classId: onNow.id, studentId: a.id });
    await seedBooking({ classId: done.id, studentId: b.id });
    const res = await call(app, "GET", "/tutor/students", await login(owner.id));
    assert.equal(res.status, 200, res.raw);
    const byName = new Map(res.body.map((s: { name: string; status: string }) => [s.name, s.status]));
    assert.equal(byName.get("Amel"), "upcoming", res.raw);
    assert.equal(byName.get("Bilel"), "past", res.raw);
  });
});

describe("the sweep: ended `scheduled` → `done`", () => {
  test("moves exactly the ended scheduled classes; cancelled, in-progress, future and `live` rows untouched", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 24 * 60); // the live-test case: yesterday
    const short = await classStarted(tutor.id, 31, 30); // its OWN duration, not 90
    const zero = await classStarted(tutor.id, 91, 0); // non-positive duration → 90 min
    const legacyNull = await classStarted(tutor.id, 300);
    await sql`update classes set status = null where id = ${legacyNull.id}`;
    const inProgress = await classStarted(tutor.id, 60, 90);
    const zeroOn = await classStarted(tutor.id, 60, 0); // 90 min, so still on
    const future = await classStarted(tutor.id, -120);
    const cancelled = await classStarted(tutor.id, 24 * 60, 90, "cancelled");
    const live = await classStarted(tutor.id, 24 * 60, 90, "live");

    const student = await seedProfile({ role: "student" });
    const seat = await seedBooking({ classId: ended.id, studentId: student.id });
    const paidSeat = await seedBooking({ classId: short.id, studentId: student.id, status: "paid" });
    const cancelledSeat = await seedBooking({ classId: zero.id, studentId: student.id, status: "cancelled" });

    const moved = await markEndedClassesDone();
    assert.ok(moved >= 4, `at least this file's four ended classes (moved ${moved})`);

    for (const k of [ended, short, zero, legacyNull]) assert.equal(await statusOf(k.id), "done", k.title);
    for (const k of [inProgress, zeroOn, future]) assert.equal(await statusOf(k.id), "scheduled", k.title);
    assert.equal(await statusOf(cancelled.id), "cancelled");
    assert.equal(await statusOf(live.id), "live", "`live` is never written by the app; a hand-set row is left alone");

    // The bookings do not follow: no `attended` (we track no presence), statuses unchanged.
    assert.equal(await bookingStatusOf(seat.id), "reserved");
    assert.equal(await bookingStatusOf(paidSeat.id), "paid");
    assert.equal(await bookingStatusOf(cancelledSeat.id), "cancelled");
  });

  test("idempotent: a second run changes none of this file's rows", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 200);
    await markEndedClassesDone();
    assert.equal(await statusOf(ended.id), "done");
    const before = await sql`select id, status, scheduled_at from classes where tutor_id = ${tutor.id} order by id`;
    await markEndedClassesDone();
    const after = await sql`select id, status, scheduled_at from classes where tutor_id = ${tutor.id} order by id`;
    assert.deepEqual(after, before);
    // And the moved row is not matched again: its status is no longer `scheduled`.
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from classes where id = ${ended.id} and coalesce(status, 'scheduled') = 'scheduled'`;
    assert.equal(n, 0);
  });

  test("a class read `done` before the sweep reads the same after it", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 95);
    const before = await call(app, "GET", `/classes/${ended.id}`, null);
    await markEndedClassesDone();
    const after = await call(app, "GET", `/classes/${ended.id}`, null);
    assert.equal(before.body.status, "done");
    assert.equal(after.body.status, "done");
  });

  test("/cron/reminders runs it — with or without a mail provider — and reports the count", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 120);
    const saved = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = SECRET;
      const unauth = await app.inject({ method: "POST", url: "/cron/reminders" });
      assert.equal(unauth.statusCode, 401);
      assert.equal(await statusOf(ended.id), "scheduled", "a rejected caller moves nothing");

      const res = await app.inject({ method: "POST", url: "/cron/reminders", headers: { authorization: `Bearer ${SECRET}` } });
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(typeof body.classesDone, "number");
      assert.ok(!body.failedJobs.includes("class-done"), res.body);
      assert.equal(await statusOf(ended.id), "done");

      const again = await app.inject({ method: "GET", url: "/cron/reminders", headers: { authorization: `Bearer ${SECRET}` } });
      assert.equal(again.statusCode, 200, again.body);
      assert.equal(await statusOf(ended.id), "done");
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
  });

  test("a `done` class can still be reviewed by its booked student (the gate is time-based)", async () => {
    const tutor = await seedTutor({});
    const ended = await classStarted(tutor.id, 150);
    const student = await seedProfile({ role: "student" });
    await seedBooking({ classId: ended.id, studentId: student.id });
    await markEndedClassesDone();
    assert.equal(await statusOf(ended.id), "done");
    const res = await call(app, "POST", "/reviews", await login(student.id), { classId: ended.id, rating: 5 });
    assert.equal(res.body.ok, true, res.raw);
    await sql`delete from reviews where class_id = ${ended.id}`;
  });
});
