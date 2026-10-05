import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedTutor, seedClass, seedProfile, seedBooking, login, call, sql, type App,
} from "./support/fx";

/* student-space-v1 · D — Mes profs (GET /student/profs).

   The union of the profs the student follows and the profs they had (or hold) a class
   with — not one they only ever cancelled with; each card: next class, classes taken,
   fiches available under the ONE rule, « n nouvelle(s) »; « Abonnements mensuels » only
   from real student_subscriptions rows (offer, seats per month, seats left, renewal,
   status). Names as « Walid T. », nothing else about the prof. */

let app: App;
const materialIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (materialIds.length) await sql`delete from materials where id in ${sql(materialIds)}`;
  await stopApp(app);
});

type Card = { tutor: { id: string; name: string }; following: boolean; nextClass: { classId: string } | null; nextClassBooked: boolean; taken: number; fiches: number; newFiches: number };

describe("D · who may ask", () => {
  test("signed out → not-authenticated; a tutor → not-a-student", async () => {
    assert.deepEqual((await call(app, "GET", "/student/profs", null)).body, { ok: false, error: "not-authenticated" });
    const tutor = await seedTutor();
    assert.deepEqual((await call(app, "GET", "/student/profs", await login(tutor.profileId))).body, { ok: false, error: "not-a-student" });
  });
});

describe("D · the cards", () => {
  test("followed ∪ had-a-class; next class; classes taken; fiches; new ones; never a prof I only cancelled with", async () => {
    const walid = await seedTutor({ fullName: "Walid Trabelsi" });
    const sana = await seedTutor({ fullName: "Sana Ben Salah" });
    const cancelledOnly = await seedTutor();
    const student = await seedProfile({ role: "student" });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${student.id}, ${sana.id})`;

    const p1 = await seedClass({ tutorId: walid.id, hoursFromNow: -48 });
    const p2 = await seedClass({ tutorId: walid.id, hoursFromNow: -24 * 9 });
    const next = await seedClass({ tutorId: walid.id, hoursFromNow: 30 });
    for (const k of [p1, p2, next]) await seedBooking({ classId: k.id, studentId: student.id });
    const sanaNext = await seedClass({ tutorId: sana.id, hoursFromNow: 50 });
    const gone = await seedClass({ tutorId: cancelledOnly.id, hoursFromNow: 40 });
    await seedBooking({ classId: gone.id, studentId: student.id, status: "cancelled" });

    const mk = async (tutorId: string, classId: string | null, visibility: string, ago: number) => {
      const [m] = await sql<{ id: string }[]>`insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id, created_at)
        values (${tutorId}, ${classId}, 'youtube', ${visibility}, 'FX fiche', 'dQw4w9WgXcQ', ${new Date(Date.now() - ago * 3_600_000).toISOString()}) returning id`;
      materialIds.push(m.id);
    };
    await mk(walid.id, p1.id, "students", 30);
    await mk(walid.id, null, "students", 2);
    await mk(walid.id, null, "private", 1);
    await mk(sana.id, null, "public", 1);
    await mk(sana.id, null, "students", 1); // not her student: hidden
    await sql`update profiles set last_seen_fiches_at = now() - interval '10 hours' where id = ${student.id}`;

    const res = await call(app, "GET", "/student/profs", await login(student.id));
    assert.equal(res.body.ok, true);
    const cards = res.body.profs as Card[];
    assert.deepEqual(cards.map((c) => c.tutor.id).sort(), [walid.id, sana.id].sort(), "followed ∪ had-a-class, never a cancelled-only prof");
    const w = cards.find((c) => c.tutor.id === walid.id)!;
    assert.equal(w.tutor.name, "Walid T.");
    assert.equal(w.following, false);
    assert.equal(w.taken, 2, "the past classes, not the one ahead");
    assert.equal(w.nextClass?.classId, next.id);
    assert.equal(w.nextClassBooked, true);
    assert.equal(w.fiches, 2);
    assert.equal(w.newFiches, 1, "added after the last visit to Mes fiches");
    const s = cards.find((c) => c.tutor.id === sana.id)!;
    assert.equal(s.following, true);
    assert.equal(s.taken, 0);
    assert.equal(s.nextClass?.classId, sanaNext.id);
    assert.equal(s.nextClassBooked, false);
    assert.equal(s.fiches, 1, "her public fiche only");
    assert.deepEqual(res.body.subscriptions, [], "no student_subscriptions row → no section");
    assert.doesNotMatch(res.raw, /Trabelsi|Ben Salah|@tnajem\.invalid/);
  });

  test("« Abonnements mensuels »: the offer, seats per month, seats left this month, renewal, status", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const [offer] = await sql<{ id: string }[]>`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'Pack Bac maths', 8, 160) returning id`;
    const [sub] = await sql<{ id: string }[]>`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end)
      values (${offer.id}, ${tutor.id}, ${student.id}, 'active', 8, 160, now() - interval '3 days', now() + interval '27 days') returning id`;
    for (const h of [-24, 48, 72]) {
      const k = await seedClass({ tutorId: tutor.id, hoursFromNow: h });
      const b = await seedBooking({ classId: k.id, studentId: student.id });
      await sql`update bookings set subscription_id = ${sub.id} where id = ${b.id}`;
    }
    const res = await call(app, "GET", "/student/profs", await login(student.id));
    const subs = res.body.subscriptions as { id: string; offerTitle: string; sessionsPerMonth: number; seatsLeft: number | null; renewsAt: string | null; status: string; tutor: { id: string } }[];
    assert.equal(subs.length, 1);
    assert.equal(subs[0].offerTitle, "Pack Bac maths");
    assert.equal(subs[0].sessionsPerMonth, 8);
    assert.equal(subs[0].seatsLeft, 5, "8 − the 3 covered seats of this month");
    assert.equal(subs[0].status, "active");
    assert.ok(subs[0].renewsAt && Date.parse(subs[0].renewsAt) > Date.now());
    assert.equal(subs[0].tutor.id, tutor.id);
  });
});
