import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App } from "./support/fx";
import { setMailDeliveryForTests } from "../src/lib/booking-mail";
import { runReminders } from "../src/lib/reminders";

/* espace prof v2 · pro (P7) — POST /cron/reminders and the run behind it.

   24 h and 1 h reminders (student per booking, tutor per class), the review prompt
   2 h after an ATTENDED class, each sent exactly once, re-sent only when the class
   moved or the seat was re-booked, retried after a failed send — and nothing at all
   without a mail provider. Other test files share the database, so every assertion
   is about this file's own addresses. */

type Sent = { to: string; subject: string; text: string };
const outbox: Sent[] = [];
const failFor = new Set<string>();
const classIds: string[] = [];
let app: App;

function captureMail() {
  setMailDeliveryForTests(async (to, subject, text) => {
    if (failFor.has(to)) return false;
    outbox.push({ to, subject, text });
    return true;
  });
}

before(async () => {
  app = await startApp();
  captureMail();
});
after(async () => {
  setMailDeliveryForTests(null);
  if (classIds.length) await sql`delete from reviews where class_id in ${sql(classIds)}`;
  await stopApp(app);
});
beforeEach(() => {
  outbox.length = 0;
  failFor.clear();
});

const MIN = 60_000;
const H = 60 * MIN;
const mine = (email: string) => outbox.filter((m) => m.to === email);

async function scenario(opts: {
  startsInMin: number;
  durationMin?: number;
  bookedHoursAgo?: number;
  classCreatedHoursAgo?: number;
  bookingStatus?: "reserved" | "cancelled" | "attended";
  classStatus?: string;
}) {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Mohamed Ben Ali", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id });
  const klass = await seedClass({
    tutorId: tutor.id,
    at: new Date(Date.now() + opts.startsInMin * MIN),
    durationMin: opts.durationMin ?? 90,
    status: opts.classStatus,
  });
  classIds.push(klass.id);
  await sql`update classes set created_at = now() - make_interval(hours => ${opts.classCreatedHoursAgo ?? 72}) where id = ${klass.id}`;
  const student = await seedProfile({ role: "student", fullName: "Sami T" });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, status: opts.bookingStatus });
  await sql`update bookings set created_at = now() - make_interval(hours => ${opts.bookedHoursAgo ?? 72}) where id = ${booking.id}`;
  return { tutorProfile, tutor, klass, student, booking };
}

describe("ep2 · /cron/reminders — authentication", () => {
  test("503 without CRON_SECRET, 401 with a wrong bearer, 200 with the right one", async () => {
    const saved = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      assert.equal((await app.inject({ method: "POST", url: "/cron/reminders" })).statusCode, 503);
      process.env.CRON_SECRET = "ep2-test-secret-0123456789";
      assert.equal((await app.inject({ method: "POST", url: "/cron/reminders", headers: { authorization: "Bearer nope" } })).statusCode, 401);
      assert.equal((await app.inject({ method: "POST", url: "/cron/reminders" })).statusCode, 401);
      const ok = await app.inject({ method: "GET", url: "/cron/reminders", headers: { authorization: "Bearer ep2-test-secret-0123456789" } });
      assert.equal(ok.statusCode, 200, ok.body);
      const body = JSON.parse(ok.body);
      assert.equal(body.ok, true);
      assert.equal(body.mail, true);
      for (const k of ["student24h", "student1h", "tutor24h", "tutor1h", "reviewPrompts", "skipped", "failed"]) {
        assert.equal(typeof body[k], "number", k);
      }
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
  });
});

describe("ep2 · reminders — 24 h and 1 h", () => {
  test("24 h: the student and the tutor are each reminded ONCE", async () => {
    const f = await scenario({ startsInMin: 20 * 60 });
    await runReminders();
    const s = mine(f.student.email);
    assert.equal(s.length, 1, JSON.stringify(outbox.map((m) => m.subject)));
    assert.match(s[0].subject, /^Rappel : « FX Class /);
    assert.ok(s[0].text.includes(`/fr/live/${f.klass.id}`));
    assert.ok(s[0].text.includes("Tu peux annuler"), "the 24 h reminder offers the cancel path");
    const t = mine(f.tutorProfile.email);
    assert.equal(t.length, 1);
    assert.ok(t[0].text.includes("1 élève inscrit."), t[0].text);

    await runReminders();
    assert.equal(mine(f.student.email).length, 1, "idempotent");
    assert.equal(mine(f.tutorProfile.email).length, 1, "idempotent");
  });

  test("1 h: a class starting in 40 minutes", async () => {
    const f = await scenario({ startsInMin: 40 });
    await runReminders();
    const s = mine(f.student.email);
    assert.equal(s.length, 1);
    assert.ok(s[0].text.includes("Ta séance commence bientôt."), s[0].text);
    assert.equal(mine(f.tutorProfile.email).length, 1);
    const [row] = await sql<{ r1: Date | null; r24: Date | null }[]>`
      select reminder_1h_sent_at as r1, reminder_24h_sent_at as r24 from bookings where id = ${f.booking.id}`;
    assert.ok(row.r1, "1 h marker set");
    assert.equal(row.r24, null, "a missed 24 h reminder is not sent 40 minutes before");
  });

  test("a seat booked 2 h ago gets no '24 h' reminder (the confirmation just went out)", async () => {
    const f = await scenario({ startsInMin: 20 * 60, bookedHoursAgo: 2 });
    await runReminders();
    assert.equal(mine(f.student.email).length, 0);
  });

  test("nothing for a cancelled booking, and no tutor reminder for a class nobody holds", async () => {
    const f = await scenario({ startsInMin: 20 * 60, bookingStatus: "cancelled" });
    await runReminders();
    assert.equal(mine(f.student.email).length, 0);
    assert.equal(mine(f.tutorProfile.email).length, 0);
  });

  test("nothing for a cancelled class, or one not yet in a window", async () => {
    const a = await scenario({ startsInMin: 20 * 60, classStatus: "cancelled" });
    const b = await scenario({ startsInMin: 30 * 60 });
    await runReminders();
    assert.equal(mine(a.student.email).length + mine(b.student.email).length, 0);
  });

  test("a class MOVED after the reminder is reminded again (the old marker is stale)", async () => {
    const f = await scenario({ startsInMin: 20 * 60 });
    await runReminders();
    assert.equal(mine(f.student.email).length, 1);
    await new Promise((r) => setTimeout(r, 20));
    await sql`update classes set scheduled_at = scheduled_at + interval '2 hours', rescheduled_at = now() where id = ${f.klass.id}`;
    await runReminders();
    assert.equal(mine(f.student.email).length, 2);
    assert.equal(mine(f.tutorProfile.email).length, 2);
  });

  test("a failed send puts the marker back; the next run retries", async () => {
    const f = await scenario({ startsInMin: 20 * 60 });
    failFor.add(f.student.email);
    const run = await runReminders();
    assert.ok(run.failed >= 1);
    const [row] = await sql<{ r24: Date | null }[]>`select reminder_24h_sent_at as r24 from bookings where id = ${f.booking.id}`;
    assert.equal(row.r24, null, "marker restored");
    failFor.clear();
    await runReminders();
    assert.equal(mine(f.student.email).length, 1);
  });

  test("two overlapping runs send one email", async () => {
    const f = await scenario({ startsInMin: 20 * 60 });
    await Promise.all([runReminders(), runReminders()]);
    assert.equal(mine(f.student.email).length, 1);
    assert.equal(mine(f.tutorProfile.email).length, 1);
  });
});

describe("ep2 · the review prompt — attended only, 2 h after the end", () => {
  test("ended 3 h ago with a live booking → asked once", async () => {
    const f = await scenario({ startsInMin: -(90 + 180), durationMin: 90 });
    await runReminders();
    const s = mine(f.student.email);
    assert.equal(s.length, 1);
    assert.match(s[0].subject, /^Comment s'est passée « FX Class /);
    assert.ok(s[0].text.includes("/fr/student"));
    await runReminders();
    assert.equal(mine(f.student.email).length, 1, "idempotent");
  });

  test("not for a cancelled booking, a cancelled class, a class that ended 1 h ago or 10 days ago", async () => {
    const cancelledSeat = await scenario({ startsInMin: -(90 + 180), bookingStatus: "cancelled" });
    const cancelledClass = await scenario({ startsInMin: -(90 + 180), classStatus: "cancelled" });
    const tooSoon = await scenario({ startsInMin: -(90 + 60) });
    const tooOld = await scenario({ startsInMin: -(10 * 24 * 60) });
    await runReminders();
    for (const f of [cancelledSeat, cancelledClass, tooSoon, tooOld]) {
      assert.equal(mine(f.student.email).length, 0, f.klass.id);
    }
  });

  test("not when the student already reviewed", async () => {
    const f = await scenario({ startsInMin: -(90 + 180) });
    await sql`insert into reviews (tutor_id, student_id, class_id, rating, text)
              values (${f.tutor.id}, ${f.student.id}, ${f.klass.id}, 5, 'fx')`;
    await runReminders();
    assert.equal(mine(f.student.email).length, 0);
  });

  test("the prompt only goes to students POST /reviews would accept", async () => {
    const f = await scenario({ startsInMin: -(90 + 180) });
    await runReminders();
    assert.equal(mine(f.student.email).length, 1);
    // The same student can in fact review: the shared rule agrees with the prompt.
    const res = await call(app, "POST", "/reviews", await login(f.student.id), { classId: f.klass.id, rating: 5 });
    assert.equal(res.body.ok, true, res.raw);
  });
});

describe("ep2 · reminders — each email asks its own switch (C5)", () => {
  test("'reminders' off: no 24 h reminder and no review prompt for that person — 'bookings' does not matter", async () => {
    const soon = await scenario({ startsInMin: 20 * 60 });
    const past = await scenario({ startsInMin: -(90 + 180) });
    for (const id of [soon.student.id, past.student.id]) {
      await sql`insert into notification_prefs (profile_id, reminders, bookings) values (${id}, false, true)`;
    }
    // The tutor turned BOOKINGS off, not reminders: their class reminder still goes.
    await sql`insert into notification_prefs (profile_id, bookings) values (${soon.tutorProfile.id}, false)`;
    const run = await runReminders();
    assert.equal(mine(soon.student.email).length, 0);
    assert.equal(mine(past.student.email).length, 0);
    assert.equal(mine(soon.tutorProfile.email).length, 1, "the tutor's reminder follows 'reminders', not 'bookings'");
    assert.ok(run.skipped >= 2);
    // Skipped by preference = claimed: never retried on the next run.
    const [row] = await sql<{ r24: Date | null }[]>`select reminder_24h_sent_at as r24 from bookings where id = ${soon.booking.id}`;
    assert.ok(row.r24);
  });

  test("'bookings' off does not stop a reminder", async () => {
    const f = await scenario({ startsInMin: 40 });
    await sql`insert into notification_prefs (profile_id, bookings) values (${f.student.id}, false)`;
    await runReminders();
    assert.equal(mine(f.student.email).length, 1);
  });
});

describe("ep2 · reminders — no provider", () => {
  test("nothing sent and nothing claimed when mail is not configured", async () => {
    const f = await scenario({ startsInMin: 20 * 60 });
    setMailDeliveryForTests(null);
    try {
      const run = await runReminders();
      assert.equal(run.mail, false);
      const [row] = await sql<{ r24: Date | null }[]>`select reminder_24h_sent_at as r24 from bookings where id = ${f.booking.id}`;
      assert.equal(row.r24, null);
    } finally {
      captureMail();
    }
  });
});
