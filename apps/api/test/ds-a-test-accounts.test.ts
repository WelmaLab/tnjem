import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App, type Tutor } from "./support/fx";
import { getHomeTutors } from "../src/lib/home-tutors";

/* december-sprint · A (D11) — TEST ACCOUNTS.

   A tutor marked is_test (0043, from /admin/accounts) is absent from every public
   list — Explore and its search, the home card, the sitemap refs, the signed-in
   student's suggestions — while its storefront and class reads keep answering (the
   web adds robots noindex from `is_test` / `tutor_is_test`). The switch is admin-only
   and every change is in admin_actions.

   Parallel files share one database, so every list assertion is about the rows this
   file seeded (by id or slug), never about a total. */

let app: App;
let adminCookie: string;
let testTutor: Tutor;
let control: Tutor;
let testClassId: string;
const SUBJECT = `ds-a-subject-${randomBytes(3).toString("hex")}`; // unique: no other file's suggestions can match it
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL };

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.ADMIN_EMAILS = admin.email;
  process.env.OTP_CHANNEL = "email";
  adminCookie = await login(admin.id);

  control = await seedTutor({ fullName: "Control Tutor" });
  testTutor = await seedTutor({ fullName: "Walid Tester" }); // newest: without the filter it would come first
  await sql`update tutors set subject = ${SUBJECT} where id in ${sql([control.id, testTutor.id])}`;
  await sql`update tutors set is_test = true where id = ${testTutor.id}`;
  testClassId = (await seedClass({ tutorId: testTutor.id, hoursFromNow: 72 })).id;
});

after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await stopApp(app); // audit rows stay (0031: append-only)
});

describe("D11 · a test tutor is in no public list", () => {
  test("Explore and its search", async () => {
    const all = await call(app, "GET", "/tutors/explore", null);
    assert.equal(all.status, 200);
    assert.ok(!all.body.some((t: { slug: string }) => t.slug === testTutor.slug), "not in the unfiltered list");

    const bySubject = await call(app, "GET", `/tutors/explore?subject=${encodeURIComponent(SUBJECT)}`, null);
    const slugs = bySubject.body.map((t: { slug: string }) => t.slug);
    assert.ok(slugs.includes(control.slug), "the control tutor is found");
    assert.ok(!slugs.includes(testTutor.slug), "the test tutor is not");

    const bySlug = await call(app, "GET", `/tutors/explore?q=${encodeURIComponent(testTutor.slug)}`, null);
    assert.deepEqual(bySlug.body, [], "not even when searched by its own slug");
  });

  test("the home card (GET /tutors/home and its function)", async () => {
    const home = await call(app, "GET", "/tutors/home", null);
    assert.ok(!home.body.some((t: { slug: string }) => t.slug === testTutor.slug));
    const narrowed = await getHomeTutors({ restrictTo: [testTutor.id, control.id] });
    assert.deepEqual(narrowed.map((t) => t.slug), [control.slug]);
  });

  test("the sitemap refs (GET /tutors/public-refs) — the same predicate", async () => {
    const refs = await call(app, "GET", "/tutors/public-refs", null);
    const slugs = refs.body.map((r: { slug: string }) => r.slug);
    assert.ok(slugs.includes(control.slug));
    assert.ok(!slugs.includes(testTutor.slug));
  });

  test("the signed-in student's suggestions", async () => {
    const student = await seedProfile({ role: "student" });
    await sql`update profiles set subjects = ${SUBJECT} where id = ${student.id}`;
    const res = await call(app, "GET", "/student/home", await login(student.id));
    assert.equal(res.body.ok, true);
    const ids = res.body.suggestions.map((t: { id: string }) => t.id);
    assert.ok(ids.includes(control.id), "the matching control tutor is suggested");
    assert.ok(!ids.includes(testTutor.id), "the matching test tutor is not");
  });
});

describe("D11 · a test tutor stays reachable by link", () => {
  test("the storefront answers, flagged is_test (the page adds noindex)", async () => {
    const sf = await call(app, "GET", `/tutors/${testTutor.slug}/storefront`, null);
    assert.equal(sf.status, 200);
    assert.equal(sf.body.tutor.slug, testTutor.slug);
    assert.equal(sf.body.tutor.is_test, true);
    assert.ok(sf.body.classes.some((c: { id: string }) => c.id === testClassId));
    const ctl = await call(app, "GET", `/tutors/${control.slug}/storefront`, null);
    assert.equal(ctl.body.tutor.is_test, false);
  });

  test("the class page read answers, flagged tutor_is_test", async () => {
    const res = await call(app, "GET", `/classes/${testClassId}`, null);
    assert.equal(res.body.id, testClassId);
    assert.equal(res.body.tutor_is_test, true);
    assert.equal(res.body.tutor_slug, testTutor.slug, "its link back to the storefront still works");
  });
});

describe("D11 · POST /admin/accounts/test — admin only, audited", () => {
  test("refused to a non-admin: the tutor themselves, a student, a visitor", async () => {
    const t = await seedTutor();
    const student = await seedProfile({ role: "student" });
    for (const cookie of [await login(t.profileId), await login(student.id), null]) {
      const res = await call(app, "POST", "/admin/accounts/test", cookie, { profileId: t.profileId, isTest: true });
      assert.deepEqual(res.body, { ok: false, error: "forbidden" });
    }
    const [row] = await sql<{ is_test: boolean }[]>`select is_test from tutors where id = ${t.id}`;
    assert.equal(row.is_test, false, "nothing changed");
  });

  test("a bad body is a 400; a profile with no tutor row is an answer", async () => {
    const bad = await call(app, "POST", "/admin/accounts/test", adminCookie, { profileId: "x", isTest: "yes" });
    assert.equal(bad.status, 400);
    const student = await seedProfile({ role: "student" });
    const none = await call(app, "POST", "/admin/accounts/test", adminCookie, { profileId: student.id, isTest: true });
    assert.deepEqual(none.body, { ok: false, error: "not-a-tutor" });
  });

  test("mark → listed nowhere, shown on the admin card, one audit row; unmark → back", async () => {
    const t = await seedTutor();
    const [p] = await sql<{ email: string }[]>`select email from profiles where id = ${t.profileId}`;

    const before = await call(app, "POST", "/admin/accounts/find", adminCookie, { email: p.email });
    assert.equal(before.body.account.tutor.isTest, false);

    const mark = await call(app, "POST", "/admin/accounts/test", adminCookie, { profileId: t.profileId, isTest: true });
    assert.equal(mark.body.ok, true);
    assert.deepEqual(mark.body.revalidate, { tutors: [t.slug], publicTutors: true });
    const found = await call(app, "POST", "/admin/accounts/find", adminCookie, { email: p.email });
    assert.equal(found.body.account.tutor.isTest, true);
    const refs = await call(app, "GET", "/tutors/public-refs", null);
    assert.ok(!refs.body.some((r: { slug: string }) => r.slug === t.slug));

    const again = await call(app, "POST", "/admin/accounts/test", adminCookie, { profileId: t.profileId, isTest: true });
    assert.deepEqual(again.body, { ok: true, already: true, isTest: true });

    const unmark = await call(app, "POST", "/admin/accounts/test", adminCookie, { profileId: t.profileId, isTest: false });
    assert.equal(unmark.body.ok, true);
    const refs2 = await call(app, "GET", "/tutors/public-refs", null);
    assert.ok(refs2.body.some((r: { slug: string }) => r.slug === t.slug));

    const audit = await sql<{ action: string }[]>`
      select action from admin_actions where subject_kind = 'tutor' and subject_id = ${t.id} order by created_at, id`;
    assert.deepEqual(audit.map((r) => r.action), ["account.test.mark", "account.test.unmark"], "one row per change, none for the no-op");
  });
});
