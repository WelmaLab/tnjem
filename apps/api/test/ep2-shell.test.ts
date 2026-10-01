import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App,
} from "./support/fx";

/* espace prof v2 · shell (phase 1) — the tutor space endpoints, through the real
   handlers: the shell payload, contract C2 (link shared, set once), « Mes élèves »
   (first names only, opaque keys, the caller's own students), the unread messages
   count (own threads only, cleared by opening the thread), the owner preview and
   the anonymous /{slug} visibility. */

let app: App;
const profiles: string[] = [];

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
    await sql`delete from rate_limits where key in ${sql(profiles.flatMap((p) => [`msg:send:${p}`, `link-shared:${p}`]))}`;
  }
  await stopApp(app);
});

async function tutor(opts: Parameters<typeof seedTutor>[0] = {}) {
  const t = await seedTutor(opts);
  profiles.push(t.profileId);
  return { ...t, cookie: await login(t.profileId) };
}

async function student(fullName = "Amine Ben Salah") {
  const s = await seedProfile({ role: "student", birthYear: 1995, fullName });
  profiles.push(s.id);
  return { ...s, cookie: await login(s.id) };
}

describe("GET /tutor/shell", () => {
  test("no session, or a student: null", async () => {
    assert.equal((await call(app, "GET", "/tutor/shell", null)).body, null);
    const s = await student();
    assert.equal((await call(app, "GET", "/tutor/shell", s.cookie)).body, null);
  });

  test("a tutor gets their own name, status, slug and the pilot plan", async () => {
    const t = await tutor({ status: "pending", fullName: "Walid Tester" });
    const res = await call(app, "GET", "/tutor/shell", t.cookie);
    assert.equal(res.body.name, "Walid Tester", res.raw);
    assert.equal(res.body.initials, "WT");
    assert.equal(res.body.status, "pending");
    assert.equal(res.body.slug, t.slug);
    assert.equal(res.body.hasStorefront, true);
    assert.deepEqual(res.body.plan, { code: "pilot", isPilot: true }, "payments are off and nothing is granted");
  });

  test("a tutor with no storefront yet is a draft with no slug", async () => {
    const p = await seedProfile({ role: "tutor", fullName: "Nour Prof" });
    profiles.push(p.id);
    const res = await call(app, "GET", "/tutor/shell", await login(p.id));
    assert.equal(res.body.hasStorefront, false, res.raw);
    assert.equal(res.body.status, "draft");
    assert.equal(res.body.slug, null);
    assert.equal(res.body.name, "Nour Prof");
  });
});

describe("POST /tutor/link-shared — contract C2", () => {
  test("refuses a guest and a student; a tutor with no page has nothing to share", async () => {
    assert.deepEqual((await call(app, "POST", "/tutor/link-shared", null, {})).body, { ok: false, error: "not-authenticated" });
    const s = await student();
    assert.deepEqual((await call(app, "POST", "/tutor/link-shared", s.cookie, {})).body, { ok: false, error: "not-a-tutor" });
    const p = await seedProfile({ role: "tutor" });
    profiles.push(p.id);
    assert.deepEqual((await call(app, "POST", "/tutor/link-shared", await login(p.id), {})).body, { ok: false, error: "no-storefront" });
  });

  test("sets link_shared_at ONCE: a second call succeeds and does not move it", async () => {
    const t = await tutor({ status: "draft" });
    const before = await call(app, "GET", "/dashboard", t.cookie);
    assert.equal(before.body.linkShared, false, before.raw);

    const first = await call(app, "POST", "/tutor/link-shared", t.cookie, {});
    assert.deepEqual(first.body, { ok: true, already: false }, first.raw);
    const [{ link_shared_at: stamp }] = await sql<{ link_shared_at: Date | string | null }[]>`select link_shared_at from tutors where id = ${t.id}`;
    assert.ok(stamp, "stamped");

    const second = await call(app, "POST", "/tutor/link-shared", t.cookie, {});
    assert.deepEqual(second.body, { ok: true, already: true }, second.raw);
    const [{ link_shared_at: again }] = await sql<{ link_shared_at: Date | string | null }[]>`select link_shared_at from tutors where id = ${t.id}`;
    assert.equal(new Date(again ?? 0).getTime(), new Date(stamp ?? 0).getTime(), "idempotent: the first stamp stays");

    assert.equal((await call(app, "GET", "/dashboard", t.cookie)).body.linkShared, true);
    assert.equal((await call(app, "GET", "/profile/onboarding", t.cookie)).body.linkShared, true);
  });

  test("only ever stamps the CALLER's own page", async () => {
    const mine = await tutor();
    const other = await tutor();
    await call(app, "POST", "/tutor/link-shared", mine.cookie, { tutorId: other.id, slug: other.slug });
    const [o] = await sql<{ link_shared_at: Date | null }[]>`select link_shared_at from tutors where id = ${other.id}`;
    assert.equal(o.link_shared_at, null, "a body naming someone else changes nothing for them");
  });
});

describe("GET /tutor/students — « Mes élèves »", () => {
  test("one row per student, FIRST NAME only, an opaque key, status from their bookings", async () => {
    const t = await tutor();
    const upcoming = await seedClass({ tutorId: t.id, hoursFromNow: 48 });
    const past = await seedClass({ tutorId: t.id, hoursFromNow: -72 });
    const amine = await student("Amine Ben Salah");
    const sarra = await student("Sarra Trabelsi");
    const rim = await student("Rim Jaziri");
    await seedBooking({ classId: upcoming.id, studentId: amine.id });
    await seedBooking({ classId: past.id, studentId: amine.id, status: "attended" });
    await seedBooking({ classId: past.id, studentId: sarra.id, status: "attended" });
    await seedBooking({ classId: upcoming.id, studentId: rim.id, status: "cancelled" });

    const res = await call(app, "GET", "/tutor/students", t.cookie);
    assert.equal(res.body.length, 3, res.raw);
    const [first, second, third] = res.body;
    assert.equal(first.name, "Amine", "a class coming up sorts first");
    assert.equal(first.status, "upcoming");
    assert.equal(first.bookings.length, 2, "both of Amine's bookings are his history");
    assert.deepEqual(first.relations, ["booked"]);
    assert.equal(second.name, "Sarra");
    assert.equal(second.status, "past");
    assert.equal(third.name, "Rim");
    assert.equal(third.status, "cancelled");

    for (const id of [amine.id, sarra.id, rim.id]) assert.ok(!res.raw.includes(id), "no profile id leaves the API");
    for (const surname of ["Ben Salah", "Trabelsi", "Jaziri"]) assert.ok(!res.raw.includes(surname), "no surname");
    assert.ok(!res.raw.includes("@tnajem.invalid"), "no e-mail");
    assert.notEqual(first.key, amine.id);
  });

  test("the same student has a DIFFERENT key on another tutor's list", async () => {
    const a = await tutor();
    const b = await tutor();
    const s = await student("Yosra Ammar");
    await seedBooking({ classId: (await seedClass({ tutorId: a.id })).id, studentId: s.id });
    await seedBooking({ classId: (await seedClass({ tutorId: b.id })).id, studentId: s.id });
    const ka = (await call(app, "GET", "/tutor/students", a.cookie)).body[0].key;
    const kb = (await call(app, "GET", "/tutor/students", b.cookie)).body[0].key;
    assert.notEqual(ka, kb);
  });

  test("a tutor sees only their own students; a student gets null", async () => {
    const a = await tutor();
    const b = await tutor();
    const s = await student();
    await seedBooking({ classId: (await seedClass({ tutorId: b.id })).id, studentId: s.id });
    assert.deepEqual((await call(app, "GET", "/tutor/students", a.cookie)).body, []);
    assert.equal((await call(app, "GET", "/tutor/students", s.cookie)).body, null);
  });
});

describe("GET /messages/unread-count", () => {
  async function pair() {
    const t = await tutor();
    const s = await student();
    const booking = await seedBooking({ classId: (await seedClass({ tutorId: t.id })).id, studentId: s.id });
    const opened = await call(app, "POST", "/threads", s.cookie, { bookingId: booking.id });
    assert.equal(opened.body?.ok, true, opened.raw);
    return { t, s, threadId: opened.body.threadId as string };
  }

  test("counts the other side's messages, never the caller's own; opening the thread clears it", async () => {
    const { t, s, threadId } = await pair();
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", t.cookie)).body, { count: 0 });

    await call(app, "POST", `/threads/${threadId}/messages`, s.cookie, { body: "Bonjour" });
    await call(app, "POST", `/threads/${threadId}/messages`, s.cookie, { body: "À jeudi" });
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", t.cookie)).body, { count: 2 });
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", s.cookie)).body, { count: 0 }, "the sender has nothing unread");

    const read = await call(app, "GET", `/threads/${threadId}`, t.cookie);
    assert.equal(read.body?.messages?.length, 2, read.raw);
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", t.cookie)).body, { count: 0 }, "opened = read");

    await call(app, "POST", `/threads/${threadId}/messages`, t.cookie, { body: "Avec plaisir" });
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", t.cookie)).body, { count: 0 }, "my own reply is not unread");
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", s.cookie)).body, { count: 1 });
  });

  test("scoped to the caller's own threads; a hidden message does not count; a guest gets 0", async () => {
    const one = await pair();
    const two = await pair();
    await call(app, "POST", `/threads/${two.threadId}/messages`, two.s.cookie, { body: "Pas pour toi" });
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", one.t.cookie)).body, { count: 0 }, "someone else's thread");

    const sent = await call(app, "POST", `/threads/${one.threadId}/messages`, one.s.cookie, { body: "Bonjour" });
    await sql`update messages set hidden_at = now() where id = ${sent.body.id}`;
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", one.t.cookie)).body, { count: 0 }, "hidden by moderation");
    assert.deepEqual((await call(app, "GET", "/messages/unread-count", null)).body, { count: 0 });
  });
});

describe("GET /tutor/preview — the owner preview", () => {
  test("the owner gets their own page whatever its status; nobody else gets anything", async () => {
    const t = await tutor({ status: "draft", fullName: "Walid Tester" });
    await seedClass({ tutorId: t.id });
    const res = await call(app, "GET", "/tutor/preview", t.cookie);
    assert.equal(res.body.status, "draft", res.raw);
    assert.equal(res.body.storefront.tutor.slug, t.slug);
    assert.equal(res.body.storefront.tutor.full_name, "Walid T.", "built exactly as the public page would show it");
    assert.equal(res.body.storefront.tutor.verified, false);
    assert.equal(res.body.storefront.classes.length, 1);

    assert.equal((await call(app, "GET", "/tutor/preview", null)).body, null);
    const s = await student();
    assert.equal((await call(app, "GET", "/tutor/preview", s.cookie)).body, null);
  });
});

describe("GET /tutors/:slug/visibility — what /{slug} shows (anonymous)", () => {
  test("verified → public · draft/pending → coming-soon · rejected, suspended or unknown → missing", async () => {
    const v = await tutor({ status: "verified" });
    const d = await tutor({ status: "draft" });
    const p = await tutor({ status: "pending" });
    const r = await tutor({ status: "rejected" });
    const blocked = await tutor({ status: "pending" });
    await sql`update tutors set suspended_at = now() where id = ${blocked.id}`;
    const vis = async (slug: string) => (await call(app, "GET", `/tutors/${slug}/visibility`, null)).body.visibility;
    assert.equal(await vis(v.slug), "public");
    assert.equal(await vis(d.slug), "coming-soon");
    assert.equal(await vis(p.slug), "coming-soon");
    assert.equal(await vis(r.slug), "missing");
    assert.equal(await vis(blocked.slug), "missing");
    assert.equal(await vis("nobody-has-this-slug"), "missing");
  });

  test("it says nothing more than the visibility: no name, no bio, no id", async () => {
    const d = await tutor({ status: "draft", fullName: "Secret Person" });
    const res = await call(app, "GET", `/tutors/${d.slug}/visibility`, null);
    assert.deepEqual(res.body, { visibility: "coming-soon" });
    assert.ok(!res.raw.includes("Secret"));
  });
});
