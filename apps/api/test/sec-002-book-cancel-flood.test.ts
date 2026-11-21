import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App } from "./support/fx";
import { setMailDeliveryForTests, settleMail } from "../src/lib/booking-mail";

/* VULN-002 — a book → cancel loop flooded a tutor with mail and notifications.

   An adult student could loop POST /bookings and POST /bookings/cancel on one
   class: every cycle mailed the tutor twice and wrote two notification rows, with
   no ceiling. The fix, proven here through the real routes:
     (a) cancel has a per-minute burst limit (it had none);
     (b) re-booking a class just cancelled is refused for a cooldown, with its own
         error code (`rebook-cooldown`) and a retryAfter;
     (c) the tutor gets at most ONE immediate booking/cancellation e-mail per
         window; the rest are queued and go out as ONE digest when /cron/reminders
         flushes them;
     (d) repeated book/cancel of the same (student, class) does not add one tutor
         notification row per event;
     (e) the daily "booking changes" cap refuses a NEW booking — never a cancel.

   Mail is captured through the test seam, like ep2-booking-mail.test.ts. Every
   assertion is about this file's own rows (other files share the database). */

type Sent = { to: string; subject: string; text: string };
const outbox: Sent[] = [];
const classIds: string[] = [];
const CRON = "sec-002-cron-secret-0123456789abcdef";
let app: App;
let savedCron: string | undefined;

before(async () => {
  app = await startApp();
  setMailDeliveryForTests(async (to, subject, text) => {
    outbox.push({ to, subject, text });
    return true;
  });
  savedCron = process.env.CRON_SECRET;
  process.env.CRON_SECRET = CRON;
});
after(async () => {
  setMailDeliveryForTests(null);
  if (savedCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedCron;
  if (classIds.length) await sql`delete from cancellations where class_id in ${sql(classIds)}`;
  await stopApp(app);
});
beforeEach(() => {
  outbox.length = 0;
});

const mine = (email: string) => outbox.filter((m) => m.to === email);

async function setup(nClasses = 1) {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Mohamed Ben Ali", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id });
  const klasses = [];
  for (let i = 0; i < nClasses; i++) {
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 + i, seats: 5 });
    classIds.push(k.id);
    klasses.push(k);
  }
  const student = await seedProfile({ role: "student", fullName: "Sami Trabelsi", birthYear: 1990 });
  const cookie = await login(student.id);
  return { tutorProfile, tutor, klasses, student, cookie };
}

async function bookingId(classId: string, studentId: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from bookings where class_id = ${classId} and student_id = ${studentId}`;
  return row.id;
}

async function tutorRowsAbout(tutorProfileId: string, studentId: string): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int as n from notifications where profile_id = ${tutorProfileId} and about_profile_id = ${studentId}`;
  return r.n;
}

async function cron() {
  const res = await app.inject({ method: "POST", url: "/cron/reminders", headers: { authorization: `Bearer ${CRON}` } });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

describe("VULN-002 · the book → cancel loop on one class", () => {
  test("cancel is rate limited after the burst; an immediate re-book gets rebook-cooldown; the tutor is not flooded", async () => {
    const f = await setup(1);
    const k = f.klasses[0];
    const N = 15;
    const book: { ok: boolean; error?: string; retryAfter?: number }[] = [];
    const cancel: { ok: boolean; error?: string }[] = [];
    let id: string | null = null;
    for (let i = 0; i < N; i++) {
      const b = await call(app, "POST", "/bookings", f.cookie, { classId: k.id });
      assert.equal(b.status, 200, b.raw);
      book.push(b.body);
      id ??= await bookingId(k.id, f.student.id);
      const c = await call(app, "POST", "/bookings/cancel", f.cookie, { bookingId: id });
      assert.equal(c.status, 200, c.raw);
      cancel.push(c.body);
    }
    await settleMail();

    // (a) the cancel endpoint answers too-many-requests once the burst is spent.
    assert.ok(
      cancel.some((c) => c.ok === false && c.error === "too-many-requests"),
      `cancel was never rate limited in ${N} calls: ${JSON.stringify(cancel)}`,
    );
    assert.equal(cancel[0].ok, true, "the first cancel works");

    // (b) the re-book right after the cancel is refused, with a distinct code and a wait.
    assert.equal(book[0].ok, true, JSON.stringify(book[0]));
    assert.equal(book[1].ok, false, `immediate re-book accepted: ${JSON.stringify(book[1])}`);
    assert.equal(book[1].error, "rebook-cooldown");
    assert.ok(typeof book[1].retryAfter === "number" && book[1].retryAfter > 0, JSON.stringify(book[1]));
    assert.equal(book.filter((b) => b.ok).length, 1, "only one real booking in the loop");

    // The tutor: one immediate mail, not one per event.
    const t = mine(f.tutorProfile.email);
    assert.ok(t.length <= 1, `tutor got ${t.length} mails: ${JSON.stringify(t.map((m) => m.subject))}`);

    // (d) one notification row about this student, however many events.
    assert.ok((await tutorRowsAbout(f.tutorProfile.id, f.student.id)) <= 1, "a row per event");
  });
});

describe("VULN-002 · several classes of one tutor", () => {
  test("one immediate mail per window, the rest queued and sent as ONE digest by the cron flush", async () => {
    const f = await setup(3);
    const [a, b, c] = f.klasses;
    for (const k of [a, b, c]) {
      const r = await call(app, "POST", "/bookings", f.cookie, { classId: k.id });
      assert.equal(r.body.ok, true, r.raw);
    }
    const r = await call(app, "POST", "/bookings/cancel", f.cookie, { bookingId: await bookingId(a.id, f.student.id) });
    assert.equal(r.body.ok, true, r.raw);
    await settleMail();

    // The student still gets every one of their own confirmations.
    assert.equal(mine(f.student.email).length, 4, JSON.stringify(mine(f.student.email).map((m) => m.subject)));

    const immediate = mine(f.tutorProfile.email);
    assert.equal(immediate.length, 1, `tutor got ${immediate.length} immediate mails: ${JSON.stringify(immediate.map((m) => m.subject))}`);
    assert.match(immediate[0].subject, /^Nouvelle réservation/, "the first event still mails at once");

    // (d) per (student, class): a, b, c → three rows, the cancel of a collapses into a's.
    assert.equal(await tutorRowsAbout(f.tutorProfile.id, f.student.id), 3);

    // The window closes (backdated, as the clock would), then the cron flushes.
    await sql`update tutor_mail_digest set created_at = created_at - interval '1 hour',
                                            mailed_at = mailed_at - interval '1 hour'
              where tutor_profile_id = ${f.tutorProfile.id}`;
    outbox.length = 0;
    const run = await cron();
    assert.ok(run.tutorDigests >= 1, JSON.stringify(run));
    const digest = mine(f.tutorProfile.email);
    assert.equal(digest.length, 1, `expected ONE digest, got ${JSON.stringify(digest.map((m) => m.subject))}`);
    assert.match(digest[0].subject, /^Récap/);
    for (const k of [b, c]) assert.ok(digest[0].text.includes(k.title), `digest names ${k.title}:\n${digest[0].text}`);
    assert.ok(digest[0].text.includes(`Sami a annulé sa place pour « ${a.title} »`), digest[0].text);
    assert.equal(digest[0].text.includes("Trabelsi"), false, "first name only");

    // Exactly once.
    outbox.length = 0;
    await cron();
    assert.equal(mine(f.tutorProfile.email).length, 0, "a second flush sends nothing");
  });

  test("a later event after the window flushes the queue opportunistically, without the cron", async () => {
    const f = await setup(3);
    const [a, b, c] = f.klasses;
    await call(app, "POST", "/bookings", f.cookie, { classId: a.id });
    await call(app, "POST", "/bookings", f.cookie, { classId: b.id });
    await settleMail();
    assert.equal(mine(f.tutorProfile.email).length, 1);
    await sql`update tutor_mail_digest set created_at = created_at - interval '1 hour',
                                            mailed_at = mailed_at - interval '1 hour'
              where tutor_profile_id = ${f.tutorProfile.id}`;
    outbox.length = 0;
    await call(app, "POST", "/bookings", f.cookie, { classId: c.id });
    await settleMail();
    const t = mine(f.tutorProfile.email);
    assert.equal(t.length, 1, `one mail: ${JSON.stringify(t.map((m) => m.subject))}`);
    assert.match(t[0].subject, /^Récap/, "the digest carries the queued event and the new one");
    assert.ok(t[0].text.includes(b.title) && t[0].text.includes(c.title), t[0].text);
  });
});

describe("VULN-002 · the daily booking-changes cap", () => {
  test("a new booking past the cap is refused, but cancelling a seat still works", async () => {
    const f = await setup(2);
    const [a, b] = f.klasses;
    const ok = await call(app, "POST", "/bookings", f.cookie, { classId: a.id });
    assert.equal(ok.body.ok, true, ok.raw);

    // The day's budget is spent (as if by many earlier bookings and cancellations).
    await sql`insert into rate_limits (key, count, reset_at)
              values (${`bookchg:day:${f.student.id}`}, 100000, now() + interval '1 day')
              on conflict (key) do update set count = 100000, reset_at = now() + interval '1 day'`;

    const refused = await call(app, "POST", "/bookings", f.cookie, { classId: b.id });
    assert.equal(refused.body.ok, false, `booking past the cap accepted: ${refused.raw}`);
    assert.equal(refused.body.error, "daily-limit");

    const cancel = await call(app, "POST", "/bookings/cancel", f.cookie, { bookingId: await bookingId(a.id, f.student.id) });
    assert.equal(cancel.body.ok, true, `cancel must never be trapped by the daily cap: ${cancel.raw}`);
    await settleMail();
  });
});
