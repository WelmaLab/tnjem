import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import * as shared from "@tnajem/shared";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App, type Res } from "./support/fx";

/* A23 · TUTOR NAMES: FIRST NAME + INITIAL (decision D1, finding 17).

   Students saw a tutor's full name on the storefront, Explore, search, checkout,
   the class page, their dashboard and their notifications. The rule is now
   "Mohamed B.", and it is applied ON THE API: the last name is never sent to a
   student-facing endpoint at all, so no client can render it. The tutor still
   sees their own full name, and so do admins. */

const FULL = "Mohamed Ben Ali";
const SURNAME = "Ben Ali";
const SHOWN = "Mohamed B.";

let app: App;
let tutor: { id: string; slug: string; profileId: string };
let klass: { id: string; title: string };
let student: { id: string };
let studentCookie: string;
const threadIds: string[] = [];

before(async () => {
  app = await startApp();
  tutor = await seedTutor({ fullName: FULL });
  await sql`update profiles set full_name = ${FULL} where id = ${tutor.profileId}`;
  klass = await seedClass({ tutorId: tutor.id });
  student = await seedProfile({ role: "student", birthYear: 1995 });
  studentCookie = await login(student.id);
  // Booking through the API is what writes the student's notification.
  const booked = await call(app, "POST", "/bookings", studentCookie, { classId: klass.id });
  assert.equal(booked.body.ok, true, booked.raw);
});

after(async () => {
  if (threadIds.length) await sql`delete from message_threads where id in ${sql(threadIds)}`;
  await sql`delete from notifications where profile_id in ${sql([student.id, tutor.profileId])}`;
  await stopApp(app);
});

function noSurname(label: string, res: Res) {
  assert.equal(res.status, 200, `${label}: ${res.raw}`);
  assert.equal(res.raw.includes(SURNAME), false, `${label} sends the last name: ${res.raw.slice(0, 400)}`);
}

/* Read off the namespace, not a named import: before the helper existed a named
   import failed the whole file at link time and hid every endpoint result below. */
type NameFn = (first: string | null | undefined, last?: string | null) => string | null;
const publicTutorName: NameFn = (first, last) => {
  const fn = (shared as unknown as { publicTutorName?: NameFn }).publicTutorName;
  assert.equal(typeof fn, "function", "@tnajem/shared exports publicTutorName");
  return fn!(first, last);
};

describe("publicTutorName", () => {
  test("first name + initial, from a full name or from (first, last)", () => {
    assert.equal(publicTutorName(FULL), SHOWN);
    assert.equal(publicTutorName("Mohamed", "Ben Ali"), SHOWN);
    assert.equal(publicTutorName("Sami Bouzid"), "Sami B.");
    assert.equal(publicTutorName("ليلى بن عمر"), "ليلى ب.");
  });
  test("a single name stays as it is; nothing becomes null", () => {
    assert.equal(publicTutorName("Sami"), "Sami");
    assert.equal(publicTutorName("  "), null);
    assert.equal(publicTutorName(null), null);
  });
  test("idempotent, so a masked name can be masked again safely", () => {
    assert.equal(publicTutorName(SHOWN), SHOWN);
  });
  test("never carries a contact detail through the first token", () => {
    assert.equal(publicTutorName("Mohamed+21620123456 Ben Ali"), SHOWN);
  });
});

describe("A23 · no student-facing endpoint sends the tutor's last name", () => {
  test("storefront (anonymous)", async () => {
    const res = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    noSurname("storefront", res);
    assert.equal(res.body.tutor.full_name, SHOWN);
    assert.ok(res.body.classes.every((c: { tutor_name: string }) => c.tutor_name === SHOWN), res.raw);
    assert.equal(res.body.tutor.avatar_initials, "MB", "the monogram comes from the shown name");
  });

  test("Explore, and search results", async () => {
    const all = await call(app, "GET", "/tutors/explore", null);
    noSurname("explore", all);
    const search = await call(app, "GET", `/tutors/explore?q=${encodeURIComponent("Mohamed")}`, null);
    noSurname("explore?q=", search);
    const row = search.body.find((t: { slug: string }) => t.slug === tutor.slug);
    assert.equal(row?.full_name, SHOWN, search.raw);
    // What a student reads is what a student can search for (the class page does too).
    const byShown = await call(app, "GET", `/tutors/explore?q=${encodeURIComponent(SHOWN)}`, null);
    noSurname("explore?q=<shown name>", byShown);
    assert.ok(byShown.body.some((t: { slug: string }) => t.slug === tutor.slug), byShown.raw);
  });

  test("reviews, materials and the sitemap refs", async () => {
    noSurname("reviews", await call(app, "GET", `/tutors/${tutor.slug}/reviews`, null));
    noSurname("materials", await call(app, "GET", `/tutors/${tutor.slug}/materials`, null));
    noSurname("public-refs", await call(app, "GET", "/tutors/public-refs", null));
  });

  test("class page and checkout (GET /classes/:id), anonymous and as the booked student", async () => {
    const anon = await call(app, "GET", `/classes/${klass.id}`, null);
    noSurname("class (anonymous)", anon);
    assert.equal(anon.body.tutor_name, SHOWN);
    const mine = await call(app, "GET", `/classes/${klass.id}`, studentCookie);
    noSurname("class (student)", mine);
    assert.equal(mine.body.tutor_name, SHOWN);
  });

  test("student dashboard", async () => {
    const res = await call(app, "GET", "/student/dashboard", studentCookie);
    noSurname("student dashboard", res);
    const item = [...res.body.upcoming, ...res.body.past].find((i: { classId: string }) => i.classId === klass.id);
    assert.equal(item?.tutorName, SHOWN, res.raw);
  });

  test("notifications (the in-app booking confirmation)", async () => {
    const res = await call(app, "GET", "/notifications", studentCookie);
    noSurname("notifications", res);
    assert.ok(res.raw.includes(SHOWN), `the confirmation names the tutor as "${SHOWN}": ${res.raw}`);
  });

  test("messaging threads", async () => {
    const [bk] = await sql<{ id: string }[]>`select id from bookings where class_id = ${klass.id} and student_id = ${student.id}`;
    const opened = await call(app, "POST", "/threads", studentCookie, { bookingId: bk.id });
    if (opened.body?.threadId) threadIds.push(opened.body.threadId);
    noSurname("threads", await call(app, "GET", "/threads", studentCookie));
  });
});

describe("A23 · the tutor still sees their own full name", () => {
  /* live-fixes-3 · E: GET /classes/:id feeds the class page, the checkout and the live
     lobby — pages that name the tutor to OTHERS — so the owner gets the public name
     there too (« walid tester » on their own class page was the bug). Their own full
     name stays on what is about them: GET /dashboard (and Réglages). */
  test("GET /dashboard as the owner; GET /classes/:id gives the owner the public name", async () => {
    const cookie = await login(tutor.profileId);
    const cls = await call(app, "GET", `/classes/${klass.id}`, cookie);
    assert.equal(cls.body.tutor_name, SHOWN, cls.raw);
    const dash = await call(app, "GET", "/dashboard", cookie);
    assert.equal(dash.body.name, FULL, dash.raw);
  });
});
