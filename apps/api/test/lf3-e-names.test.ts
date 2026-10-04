import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App } from "./support/fx";

/* live-fixes-3 · E — NAMES. In the live class the class page, the checkout and the
   prof's own live lobby said « walid tester »: GET /classes/:id gave the OWNER their
   full, stored name, and those three pages are about naming the tutor to others.
   Now that read is « Walid T. » (publicTutorName, capitalised) for every reader —
   signed out, a student, a booked student and the owner — and the surname never
   leaves the server on it. What is about the tutor THEMSELF keeps the full name:
   GET /dashboard (the shell's greeting, Réglages). Nothing stored changes. */

const STORED = "walid tester";
const SHOWN = "Walid T.";

let app: App;
let tutor: { id: string; slug: string; profileId: string };
let klass: { id: string };
let student: { id: string };
let booked: { id: string };

before(async () => {
  app = await startApp();
  const me = await seedProfile({ role: "tutor", fullName: STORED });
  tutor = await seedTutor({ profileId: me.id, fullName: STORED });
  klass = await seedClass({ tutorId: tutor.id });
  student = await seedProfile({ role: "student", birthYear: 1995 });
  booked = await seedProfile({ role: "student", birthYear: 1995 });
  await seedBooking({ classId: klass.id, studentId: booked.id });
});

after(async () => {
  await stopApp(app);
});

describe("live-fixes-3 · E · GET /classes/:id names the tutor « Walid T. » to everyone", () => {
  for (const who of ["anonymous", "student", "booked student", "owner"] as const) {
    test(who, async () => {
      const cookie =
        who === "anonymous" ? null
        : who === "student" ? await login(student.id)
        : who === "booked student" ? await login(booked.id)
        : await login(tutor.profileId);
      const res = await call(app, "GET", `/classes/${klass.id}`, cookie);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.tutor_name, SHOWN, res.raw);
      assert.equal(/tester/i.test(res.raw), false, `${who}: the surname left the server: ${res.raw.slice(0, 300)}`);
    });
  }
});

describe("live-fixes-3 · E · what is about the tutor themself is unchanged", () => {
  test("GET /dashboard still greets the owner by their own name; the stored name is untouched", async () => {
    const res = await call(app, "GET", "/dashboard", await login(tutor.profileId));
    assert.equal(res.body.name, STORED, res.raw);
    const [row] = await sql<{ full_name: string }[]>`select full_name from tutors where id = ${tutor.id}`;
    assert.equal(row.full_name, STORED);
  });
});
