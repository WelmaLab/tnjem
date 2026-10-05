import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { contactFieldPaths } from "@tnajem/shared";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App,
} from "./support/fx";

/* student-space-v1 · G — ONE CONVERSATION PER (STUDENT, PROF) PAIR, through the real
   handlers (apps/api/src/routes/messages.ts → lib/conversations.ts).

   The data model is unchanged (one thread per booking, the gate booking-based); what
   is proven here is the merged READ, the pair-level WRITE (the most recent
   non-cancelled booking, its thread created on first send), the empty-state fix
   (every booking pair listed even with 0 messages) and — above all — that a caller
   only ever reaches their own pairs. */

let app: App;
const profiles: string[] = [];
const DAY = 86_400_000;

before(async () => {
  app = await startApp();
});

after(async () => {
  if (profiles.length) {
    await sql`delete from messages where thread_id in (
                select id from message_threads
                where tutor_profile_id in ${sql(profiles)} or student_profile_id in ${sql(profiles)})`;
    await sql`delete from message_threads
              where tutor_profile_id in ${sql(profiles)} or student_profile_id in ${sql(profiles)}`;
    await sql`delete from contact_leak_flags where profile_id in ${sql(profiles)}`;
    await sql`delete from notifications where profile_id in ${sql(profiles)}`;
    await sql`delete from rate_limits where key in ${sql(profiles.map((p) => `msg:send:${p}`))}`;
  }
  await stopApp(app);
});

async function tutorWith(opts: { status?: "draft" | "verified"; name?: string } = {}) {
  const tutor = await seedTutor({ status: opts.status ?? "verified", fullName: opts.name ?? "Walid Trabelsi" });
  profiles.push(tutor.profileId);
  return { ...tutor, cookie: await login(tutor.profileId) };
}

async function studentWith(opts: { name?: string; birthYear?: number } = {}) {
  const s = await seedProfile({ role: "student", birthYear: opts.birthYear ?? 1995, fullName: opts.name ?? "Amine Karoui" });
  profiles.push(s.id);
  return { ...s, cookie: await login(s.id) };
}

const list = (cookie: string) => call(app, "GET", "/conversations", cookie);
const open = (cookie: string, withId: string) => call(app, "GET", `/conversations/${withId}`, cookie);
const write = (cookie: string, withId: string, body = "Bonjour, une question ?") =>
  call(app, "POST", `/conversations/${withId}/messages`, cookie, { body });

async function threadsOf(bookingId: string): Promise<{ id: string }[]> {
  return sql<{ id: string }[]>`select id from message_threads where booking_id = ${bookingId}`;
}

describe("the list: one entry per pair, even with no message (the empty-state fix)", () => {
  test("two bookings with one prof and one with another: two entries, « Écris le premier message » on both sides", async () => {
    const walid = await tutorWith();
    const sana = await tutorWith({ name: "Sana Ben Ali" });
    const amine = await studentWith();
    const c1 = await seedClass({ tutorId: walid.id, hoursFromNow: 48 });
    const c2 = await seedClass({ tutorId: walid.id, hoursFromNow: 96 });
    const c3 = await seedClass({ tutorId: sana.id, hoursFromNow: 72 });
    for (const c of [c1, c2, c3]) await seedBooking({ classId: c.id, studentId: amine.id });

    const mine = await list(amine.cookie);
    assert.equal(mine.status, 200, mine.raw);
    assert.equal(mine.body.length, 2, "one entry per PROF, not per class");
    const w = mine.body.find((x: { withId: string }) => x.withId === walid.id);
    assert.ok(w, mine.raw);
    assert.equal(w.withName, "Walid T.", "C8: a prof is « Walid T. »");
    assert.equal(w.initials, "WT");
    assert.equal(w.last, null, "no message yet: the UI says « Écris le premier message »");
    assert.equal(w.unread, 0);
    assert.equal(w.iAm, "student");
    assert.equal(w.subject, "Mathématiques");

    // No thread row was created by listing (none at booking time either).
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from message_threads where student_profile_id = ${amine.id}`;
    assert.equal(n.n, 0);

    const theirs = await list(walid.cookie);
    assert.equal(theirs.body.length, 1, "the prof sees ONE conversation with this student");
    assert.equal(theirs.body[0].withId, amine.id, "C2: a tutor addresses the student's profiles.id");
    assert.equal(theirs.body[0].withName, "Amine K.", "C8: a student is first name + initial");
    assert.equal(theirs.body[0].subject, null);
    assert.equal(theirs.body[0].iAm, "tutor");
  });

  test("a pair whose only seat was cancelled before anyone wrote is not listed; with history it is", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    const k = await seedClass({ tutorId: t.id, hoursFromNow: 48 });
    const b = await seedBooking({ classId: k.id, studentId: s.id, status: "cancelled" });
    assert.equal((await list(s.cookie)).body.length, 0);
    assert.equal((await list(t.cookie)).body.length, 0);

    // A conversation that already happened stays readable after the cancellation.
    await sql`update bookings set status = 'reserved' where id = ${b.id}`;
    assert.equal((await write(s.cookie, t.id, "À jeudi")).body.ok, true);
    await sql`update bookings set status = 'cancelled' where id = ${b.id}`;
    const after = await list(s.cookie);
    assert.equal(after.body.length, 1);
    assert.equal(after.body[0].last.body, "À jeudi");
  });

  test("the list never carries the other person's contact details", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    // profiles.phone is unique: a number per run, never a real one.
    const digits = String(Date.now()).slice(-6);
    const phones = [`+21620${digits}`, `+21650${digits}`];
    await sql`update profiles set phone = ${phones[0]} where id = ${t.profileId}`;
    await sql`update profiles set phone = ${phones[1]} where id = ${s.id}`;
    for (const cookie of [s.cookie, t.cookie]) {
      const res = await list(cookie);
      assert.deepEqual(contactFieldPaths(res.body), []);
      for (const p of phones) assert.ok(!res.raw.includes(p.slice(4)), res.raw);
      assert.ok(!res.raw.includes("@tnajem.invalid"), res.raw);
    }
  });
});

describe("the merged conversation", () => {
  test("all of the pair's threads, oldest first, one marker per thread; reading it clears the pair's unread", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    const past = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 2 * DAY) });
    const next = await seedClass({ tutorId: t.id, hoursFromNow: 48 });
    const bPast = await seedBooking({ classId: past.id, studentId: s.id });
    const bNext = await seedBooking({ classId: next.id, studentId: s.id });

    // Two per-booking threads, as the old per-class UI created them.
    const t1 = (await call(app, "POST", "/threads", s.cookie, { bookingId: bPast.id })).body;
    assert.equal(t1.withId, t.id, "POST /threads now names the pair's conversation");
    const t2 = (await call(app, "POST", "/threads", t.cookie, { bookingId: bNext.id })).body;
    assert.equal(t2.withId, s.id);
    assert.equal((await call(app, "POST", `/threads/${t1.threadId}/messages`, t.cookie, { body: "Corrigé ajouté." })).body.ok, true);
    assert.equal((await call(app, "POST", `/threads/${t2.threadId}/messages`, t.cookie, { body: "À mercredi." })).body.ok, true);

    const before = (await list(s.cookie)).body[0];
    assert.equal(before.unread, 2, "unread is summed over the pair's threads");
    assert.equal(before.last.body, "À mercredi.");
    assert.equal(before.last.mine, false);

    const conv = await open(s.cookie, t.id);
    assert.equal(conv.status, 200, conv.raw);
    assert.deepEqual(conv.body.messages.map((m: { body: string }) => m.body), ["Corrigé ajouté.", "À mercredi."]);
    assert.deepEqual(conv.body.messages.map((m: { threadId: string }) => m.threadId), [t1.threadId, t2.threadId]);
    assert.equal(conv.body.threads.length, 2);
    assert.equal(conv.body.threads[0].classTitle, past.title, "threads come oldest class first");
    assert.equal(conv.body.state, "open");
    assert.equal(conv.body.nextClass.classId, next.id, "the header's next class is the student's own seat");
    assert.equal(conv.body.nextClass.booked, true);
    assert.equal(conv.body.withName, "Walid T.");

    assert.equal((await list(s.cookie)).body[0].unread, 0, "opened = read, on every thread of the pair");
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", s.cookie)).body, { count: 0 });
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", t.cookie)).body, { count: 0 });
  });

  test("a send goes to the most recent NON-CANCELLED booking and creates its thread on the first message", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    const soon = await seedClass({ tutorId: t.id, hoursFromNow: 24 });
    const later = await seedClass({ tutorId: t.id, hoursFromNow: 24 * 6 });
    const latest = await seedClass({ tutorId: t.id, hoursFromNow: 24 * 9 });
    await seedBooking({ classId: soon.id, studentId: s.id });
    const bLater = await seedBooking({ classId: later.id, studentId: s.id });
    const bLatest = await seedBooking({ classId: latest.id, studentId: s.id, status: "cancelled" });

    const sent = await write(s.cookie, t.id, "Bonjour Walid");
    assert.equal(sent.body.ok, true, sent.raw);
    const [th] = await threadsOf(bLater.id);
    assert.ok(th, "the thread of the most recent live booking was created");
    assert.equal(sent.body.threadId, th.id);
    assert.equal((await threadsOf(bLatest.id)).length, 0, "a cancelled seat never takes a message");

    // The prof answers from HIS side of the same pair: the same thread.
    const reply = await write(t.cookie, s.id, "Bonjour Amine");
    assert.equal(reply.body.threadId, th.id);

    const conv = await open(t.cookie, s.id);
    assert.deepEqual(conv.body.messages.map((m: { body: string; mine: boolean }) => [m.body, m.mine]), [
      ["Bonjour Walid", false],
      ["Bonjour Amine", true],
    ]);

    // Each side's bell points at ITS conversation with the other.
    const [toTutor] = await sql<{ href: string }[]>`select href from notifications where profile_id = ${t.profileId} and kind = 'message'`;
    assert.equal(toTutor.href, `/messages/with/${s.id}`);
    const [toStudent] = await sql<{ href: string }[]>`select href from notifications where profile_id = ${s.id} and kind = 'message'`;
    assert.equal(toStudent.href, `/messages/with/${t.id}`);
  });

  test("contact details are masked on the merged send, exactly as on the thread send", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    const sent = await write(s.cookie, t.id, "Appelle-moi au 97 029 699");
    assert.equal(sent.body.ok, true, sent.raw);
    assert.equal(sent.body.masked, true);
    assert.ok(!/97\s?029\s?699/.test(sent.body.body), sent.raw);
    const conv = await open(t.cookie, s.id);
    assert.ok(!/97\s?029\s?699/.test(JSON.stringify(conv.body)));
  });

  test("a minor's pair is marked, on both sides", async () => {
    const t = await tutorWith();
    const s = await studentWith({ birthYear: new Date().getFullYear() - 15 });
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    assert.equal((await list(t.cookie)).body[0].studentIsMinor, true);
    assert.equal((await open(s.cookie, t.id)).body.studentIsMinor, true);
  });
});

describe("when nothing is open", () => {
  test("the last class ended THREAD_CLOSE_DAYS ago: « réserve une séance » + his next class; no thread is created", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    const old = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 10 * DAY) });
    const onSale = await seedClass({ tutorId: t.id, hoursFromNow: 72 });
    const b = await seedBooking({ classId: old.id, studentId: s.id });

    const conv = await open(s.cookie, t.id);
    assert.equal(conv.body.state, "no-open-booking");
    assert.equal(conv.body.closedReason, "closed:class-ended");
    assert.equal(conv.body.nextClass.classId, onSale.id, "his next class, to book");
    assert.equal(conv.body.nextClass.booked, false);

    assert.deepEqual((await write(s.cookie, t.id)).body, { ok: false, error: "no-open-booking" });
    assert.deepEqual((await write(t.cookie, s.id)).body, { ok: false, error: "no-open-booking" });
    assert.equal((await threadsOf(b.id)).length, 0, "a closed booking never grows a thread");

    // Booking the next class reopens the SAME conversation.
    await seedBooking({ classId: onSale.id, studentId: s.id });
    assert.equal((await open(s.cookie, t.id)).body.state, "open");
    assert.equal((await write(s.cookie, t.id)).body.ok, true);
  });

  test("a blocked account closes it, without saying why", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    await sql`update profiles set blocked_at = now() where id = ${s.id}`;
    const conv = await open(t.cookie, s.id);
    assert.equal(conv.body.state, "closed");
    assert.equal(conv.body.closedReason, "closed", "the reason (blocked) is never shown");
    assert.deepEqual((await write(t.cookie, s.id)).body, { ok: false, error: "thread-closed" });
  });

  test("a public prof with no booking: the conversation renders, empty, and asks to book", async () => {
    const t = await tutorWith();
    const onSale = await seedClass({ tutorId: t.id, hoursFromNow: 30 });
    const s = await studentWith();
    const conv = await open(s.cookie, t.id);
    assert.equal(conv.status, 200, conv.raw);
    assert.equal(conv.body.state, "no-open-booking");
    assert.deepEqual(conv.body.messages, []);
    assert.equal(conv.body.nextClass.classId, onSale.id);
    assert.equal(conv.body.tutorSlug, t.slug);
    assert.deepEqual((await write(s.cookie, t.id)).body, { ok: false, error: "no-open-booking" });
  });
});

describe("ownership: nobody reads or writes someone else's pair", () => {
  test("a student never sees another student's messages with the same prof", async () => {
    const t = await tutorWith();
    const amine = await studentWith();
    const other = await studentWith({ name: "Sami Ben Salah" });
    const k = await seedClass({ tutorId: t.id });
    await seedBooking({ classId: k.id, studentId: amine.id });
    await seedBooking({ classId: k.id, studentId: other.id });
    assert.equal((await write(t.cookie, amine.id, "Message pour Amine seulement")).body.ok, true);

    const theirs = await open(other.cookie, t.id);
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.body.messages, [], "the same prof, a different pair");
    assert.ok(!theirs.raw.includes("Amine"), theirs.raw);
    assert.equal((await list(other.cookie)).body[0].last, null);
  });

  test("a tutor never reads or writes another tutor's student", async () => {
    const mine = await tutorWith();
    const intruder = await tutorWith({ name: "Karim Intrus" });
    const s = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: mine.id })).id, studentId: s.id });
    assert.equal((await write(s.cookie, mine.id, "Privé")).body.ok, true);

    assert.equal((await open(intruder.cookie, s.id)).body, null);
    assert.deepEqual((await write(intruder.cookie, s.id)).body, { ok: false, error: "not-found" });
    assert.equal((await list(intruder.cookie)).body.length, 0);
  });

  test("a student cannot open a prof who is not public and never taught them", async () => {
    const draft = await tutorWith({ status: "draft" });
    const s = await studentWith();
    assert.equal((await open(s.cookie, draft.id)).body, null);
    assert.deepEqual((await write(s.cookie, draft.id)).body, { ok: false, error: "not-found" });
  });

  test("an id from the wrong side means nothing: a student cannot address a student", async () => {
    const t = await tutorWith();
    const a = await studentWith();
    const b = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: a.id });
    assert.equal((await open(b.cookie, a.id)).body, null);
    assert.deepEqual((await write(b.cookie, a.id)).body, { ok: false, error: "not-found" });
  });

  test("session and role: anonymous, a guardian and a bad id get nothing", async () => {
    const t = await tutorWith();
    const guardian = await seedProfile({ role: "guardian", birthYear: 1980 });
    profiles.push(guardian.id);
    const gCookie = await login(guardian.id);
    assert.equal((await call(app, "GET", "/conversations", null)).body, null);
    assert.equal((await call(app, "GET", `/conversations/${t.id}`, null)).body, null);
    assert.deepEqual((await call(app, "POST", `/conversations/${t.id}/messages`, null, { body: "x" })).body,
      { ok: false, error: "not-authenticated" });
    assert.equal((await list(gCookie)).body, null);
    assert.equal((await open(gCookie, t.id)).body, null);
    assert.deepEqual((await write(gCookie, t.id)).body, { ok: false, error: "not-found" });
    assert.equal((await open(t.cookie, "not-a-uuid")).body, null);
    assert.equal((await call(app, "POST", `/conversations/${t.id}/messages`, t.cookie, {})).status, 400);
  });

  test("the send shares the per-sender ceiling (30 per 10 minutes)", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    await sql`insert into rate_limits (key, count, reset_at)
              values (${`msg:send:${s.id}`}, 30, now() + interval '10 minutes')
              on conflict (key) do update set count = 30, reset_at = now() + interval '10 minutes'`;
    assert.deepEqual((await write(s.cookie, t.id)).body, { ok: false, error: "too-many-requests" });
  });
});

describe("/messages/<threadId> still leads somewhere", () => {
  test("GET /threads/:id/conversation names the pair, per side; a stranger gets nothing", async () => {
    const t = await tutorWith();
    const s = await studentWith();
    const stranger = await studentWith();
    const b = await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    const { threadId } = (await call(app, "POST", "/threads", s.cookie, { bookingId: b.id })).body;
    assert.deepEqual((await call(app, "GET", `/threads/${threadId}/conversation`, s.cookie)).body, { withId: t.id });
    assert.deepEqual((await call(app, "GET", `/threads/${threadId}/conversation`, t.cookie)).body, { withId: s.id });
    assert.equal((await call(app, "GET", `/threads/${threadId}/conversation`, stranger.cookie)).body, null);
    assert.equal((await call(app, "GET", `/threads/not-a-uuid/conversation`, s.cookie)).body, null);
  });
});
