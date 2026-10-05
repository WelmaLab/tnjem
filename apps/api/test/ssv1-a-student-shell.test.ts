import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App,
} from "./support/fx";
import {
  STUDENT_NAV, STUDENT_TABS, studentActiveKey, studentCrumbs, studentDeepLink,
} from "@tnajem/shared";

/* student-space-v1 · A — the student shell.

   GET /student/shell through the real handler: session + role (a guest, a tutor and a
   guardian get null), the caller's own name, and the « Mes cours » badge — upcoming =
   a seat still held on a class that has not ENDED (start + duration, contract C7),
   whatever classes.status says, and nobody cancelled. Then the rate limit, and the
   pure table the shell draws from (packages/shared/src/student-shell.ts): sidebar,
   tabs, active item, breadcrumbs and the old-deep-link map of the bell. */

let app: App;
const profiles: string[] = [];

before(async () => {
  app = await startApp();
});

after(async () => {
  if (profiles.length) {
    await sql`delete from rate_limits where key in ${sql(profiles.map((p) => `student-shell:${p}`))}`;
  }
  await stopApp(app);
});

async function student(fullName = "Ahmed Malek") {
  const s = await seedProfile({ role: "student", birthYear: 1995, fullName });
  profiles.push(s.id);
  return { ...s, cookie: await login(s.id) };
}

const HOUR = 3600_000;

describe("GET /student/shell — who may read it", () => {
  test("no session: null", async () => {
    const res = await call(app, "GET", "/student/shell", null);
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body, null);
  });

  test("a tutor and a guardian: null — it is not their shell", async () => {
    const t = await seedTutor({ status: "verified" });
    profiles.push(t.profileId);
    assert.equal((await call(app, "GET", "/student/shell", await login(t.profileId))).body, null);
    const g = await seedProfile({ role: "guardian", birthYear: 1980 });
    profiles.push(g.id);
    assert.equal((await call(app, "GET", "/student/shell", await login(g.id))).body, null);
  });

  test("a student gets their own name, initials and the pilot line (payments are off)", async () => {
    const s = await student("Ahmed Malek");
    const res = await call(app, "GET", "/student/shell", s.cookie);
    assert.equal(res.status, 200, res.raw);
    assert.deepEqual(res.body, { name: "Ahmed Malek", initials: "AM", upcoming: 0, pilot: true });
    // Nothing about anybody else, and no contact data.
    assert.ok(!/@|\+216|email|phone/i.test(res.raw), res.raw);
  });
});

describe("GET /student/shell — the upcoming count", () => {
  test("counts held seats on classes that have not ended; not cancelled ones, not ended ones, not someone else's", async () => {
    const s = await student();
    const other = await student("Sarra Mejri");
    const t = await seedTutor({ status: "verified" });
    profiles.push(t.profileId);

    // Counted: two future classes, and one in progress (started 30 min ago, 90 min long).
    const a = await seedClass({ tutorId: t.id, hoursFromNow: 48 });
    const b = await seedClass({ tutorId: t.id, hoursFromNow: 2 });
    const live = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 0.5 * HOUR), durationMin: 90 });
    await seedBooking({ classId: a.id, studentId: s.id });
    await seedBooking({ classId: b.id, studentId: s.id, status: "paid" });
    await seedBooking({ classId: live.id, studentId: s.id });

    // Not counted: the student cancelled; the prof cancelled the class; the class ENDED
    // (still « scheduled » in the table — C7 derives the state from start + duration);
    // a 30-minute class that started 45 minutes ago; another student's seat.
    const c = await seedClass({ tutorId: t.id, hoursFromNow: 24 });
    await seedBooking({ classId: c.id, studentId: s.id, status: "cancelled" });
    const d = await seedClass({ tutorId: t.id, hoursFromNow: 24, status: "cancelled" });
    await seedBooking({ classId: d.id, studentId: s.id });
    const ended = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 3 * HOUR), durationMin: 90 });
    await seedBooking({ classId: ended.id, studentId: s.id });
    const short = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 0.75 * HOUR), durationMin: 30 });
    await seedBooking({ classId: short.id, studentId: s.id });
    await seedBooking({ classId: a.id, studentId: other.id });

    const res = await call(app, "GET", "/student/shell", s.cookie);
    assert.equal(res.body.upcoming, 3, res.raw);
    assert.equal((await call(app, "GET", "/student/shell", other.cookie)).body.upcoming, 1);
  });

  test("a class with no duration counts with the default 90 minutes (classEndMs)", async () => {
    const s = await student();
    const t = await seedTutor({ status: "verified" });
    profiles.push(t.profileId);
    const k = await seedClass({ tutorId: t.id, at: new Date(Date.now() - 1 * HOUR) });
    await sql`update classes set duration_min = null where id = ${k.id}`;
    await seedBooking({ classId: k.id, studentId: s.id });
    assert.equal((await call(app, "GET", "/student/shell", s.cookie)).body.upcoming, 1, "1 h into a 90-minute class");
    await sql`update classes set scheduled_at = now() - interval '2 hours' where id = ${k.id}`;
    assert.equal((await call(app, "GET", "/student/shell", s.cookie)).body.upcoming, 0, "2 h after the start: ended");
  });
});

describe("GET /student/shell — rate limit", () => {
  test("past the budget the read is refused with 429, per profile", async () => {
    const s = await student();
    const other = await student("Nour Ben Ali");
    await sql`insert into rate_limits (key, count, reset_at)
              values (${`student-shell:${s.id}`}, 300, now() + interval '10 minutes')
              on conflict (key) do update set count = 300, reset_at = now() + interval '10 minutes'`;
    const res = await call(app, "GET", "/student/shell", s.cookie);
    assert.equal(res.status, 429, res.raw);
    assert.deepEqual(res.body, { error: "too-many-requests" });
    // Someone else's budget is untouched.
    assert.equal((await call(app, "GET", "/student/shell", other.cookie)).status, 200);
  });
});

describe("the student nav table (packages/shared/src/student-shell.ts)", () => {
  test("sidebar: Accueil · APPRENDRE (Mes cours, Mes profs, Mes fiches) · ÉCHANGER (Messages) · COMPTE (Profil, Aide)", () => {
    assert.deepEqual(
      STUDENT_NAV.map((g) => [g.label?.fr ?? null, g.items.map((i) => `${i.label.fr}=${i.href}`)]),
      [
        [null, ["Accueil=/student"]],
        ["Apprendre", ["Mes cours=/student/cours", "Mes profs=/student/profs", "Mes fiches=/student/fiches"]],
        ["Échanger", ["Messages=/messages"]],
        ["Compte", ["Profil=/account", "Aide=/aide"]],
      ],
    );
    // FR/AR parity: every label has both.
    for (const g of STUDENT_NAV) {
      if (g.label) assert.ok(g.label.fr && g.label.ar, g.key);
      for (const i of g.items) assert.ok(i.label.fr && i.label.ar, i.key);
    }
    // The three badges of the spec, and only those.
    assert.deepEqual(
      STUDENT_NAV.flatMap((g) => g.items).filter((i) => i.badge).map((i) => `${i.key}:${i.badge}`),
      ["courses:upcoming", "fiches:fiches", "messages:messages"],
    );
  });

  test("five phone tabs: Accueil · Cours · Profs · Fiches · Messages (Profil is the avatar)", () => {
    assert.deepEqual(STUDENT_TABS.map((t) => t.label.fr), ["Accueil", "Cours", "Profs", "Fiches", "Messages"]);
    assert.deepEqual(STUDENT_TABS.map((t) => t.label.ar), ["الرئيسية", "حصصي", "أساتذتي", "ملفاتي", "الرسائل"]);
  });

  test("the active item follows the path; Accueil is never a prefix", () => {
    assert.equal(studentActiveKey("/student"), "home");
    assert.equal(studentActiveKey("/student/cours"), "courses");
    assert.equal(studentActiveKey("/student/cours/0b6f9a52-1d5e-4a3e-9d1e-3c2b1a0f9e8d"), "courses");
    assert.equal(studentActiveKey("/student/profs"), "tutors");
    assert.equal(studentActiveKey("/student/fiches"), "fiches");
    assert.equal(studentActiveKey("/messages"), "messages");
    assert.equal(studentActiveKey("/messages/with/abc"), "messages");
    assert.equal(studentActiveKey("/account"), "profile");
    assert.equal(studentActiveKey("/student/welcome"), "home");
    assert.equal(studentActiveKey("/student/nope"), null);
  });

  test("breadcrumbs: « Apprendre › Mes cours », « Accueil », « Compte › Profil », « Mes cours › Séance »", () => {
    assert.deepEqual(studentCrumbs("/student", "fr"), [{ label: "Accueil" }]);
    assert.deepEqual(studentCrumbs("/student/cours", "fr"), [{ label: "Apprendre" }, { label: "Mes cours" }]);
    assert.deepEqual(studentCrumbs("/student/fiches", "ar"), [{ label: "نتعلّم" }, { label: "ملفاتي" }]);
    assert.deepEqual(studentCrumbs("/messages", "fr"), [{ label: "Échanger" }, { label: "Messages" }]);
    assert.deepEqual(studentCrumbs("/account", "fr"), [{ label: "Compte" }, { label: "Profil" }]);
    assert.deepEqual(studentCrumbs("/student/cours/x", "fr"), [{ label: "Mes cours", href: "/student/cours" }, { label: "Séance" }]);
    assert.deepEqual(studentCrumbs("/messages/with/x", "fr"), [{ label: "Messages", href: "/messages" }, { label: "Conversation" }]);
  });

  test("old deep links: a bell row that says /student lands where it meant", () => {
    assert.equal(studentDeepLink("booking_cancelled", "/student"), "/student/cours?tab=annulees");
    assert.equal(studentDeepLink("class_reminder", "/student"), "/student/cours?tab=avenir");
    assert.equal(studentDeepLink("subscription_expired", "/student"), "/student/profs");
    // Everything else is untouched: other hrefs, other kinds, no href.
    assert.equal(studentDeepLink("booking_cancelled", "/dashboard"), "/dashboard");
    assert.equal(studentDeepLink("subscription_expired", "/yassine-math"), "/yassine-math");
    assert.equal(studentDeepLink("message", "/messages/abc"), "/messages/abc");
    assert.equal(studentDeepLink("booking_confirmed", "/student"), "/student");
    assert.equal(studentDeepLink("booking_cancelled", null), null);
  });
});
