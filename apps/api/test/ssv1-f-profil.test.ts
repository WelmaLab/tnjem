import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedTutor, seedProfile, login, call, sql, type App } from "./support/fx";

/* student-space-v1 · F — Profil › Moi saves through POST /profile/student: the SAME
   endpoint and validator (parseStudentProfile) as the welcome screen. New here:
   `phoneClear` — the student emptied the field on purpose, so the number goes; without
   it an empty phone keeps the stored one, as the welcome screen always did. Level and
   subjects feed Accueil's suggestions (GET /student/home). */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

const save = (cookie: string | null, body: Record<string, unknown>) => call(app, "POST", "/profile/student", cookie, body);

describe("F · Profil › Moi", () => {
  test("name, level, subjects (as codes) and phone are saved; the same validation as onboarding", async () => {
    const s = await seedProfile({ role: "student" });
    const cookie = await login(s.id);
    assert.deepEqual((await save(cookie, { fullName: "Ahmed Malek", level: "bac", subjects: ["Maths", "physique"], phone: "97 029 699" })).body, { ok: true });
    const [p] = await sql<{ full_name: string; level: string; subjects: string; phone: string }[]>`select full_name, level, subjects, phone from profiles where id = ${s.id}`;
    assert.deepEqual(p, { full_name: "Ahmed Malek", level: "bac", subjects: "math,physique", phone: "+21697029699" });

    assert.deepEqual((await save(cookie, { fullName: "A", level: "bac", subjects: [] })).body.ok, false, "a 1-letter name is refused, as on the welcome screen");
    assert.deepEqual((await save(cookie, { fullName: "Ahmed Malek", level: "maternelle" })).body, { ok: false, error: "invalid-level" });
    assert.deepEqual((await save(cookie, { fullName: "Ahmed Malek", phone: "12" })).body.ok, false, "a half-typed number is refused");
  });

  test("an emptied phone: kept without phoneClear (welcome), removed with it (Profil)", async () => {
    const s = await seedProfile({ role: "student" });
    const cookie = await login(s.id);
    await save(cookie, { fullName: "Sarra Ben Ali", phone: "+216 22 333 444" });
    await save(cookie, { fullName: "Sarra Ben Ali", phone: null });
    let [p] = await sql<{ phone: string | null }[]>`select phone from profiles where id = ${s.id}`;
    assert.equal(p.phone, "+21622333444", "the welcome screen never wipes a number on file");
    assert.deepEqual((await save(cookie, { fullName: "Sarra Ben Ali", phone: null, phoneClear: true })).body, { ok: true });
    [p] = await sql<{ phone: string | null }[]>`select phone from profiles where id = ${s.id}`;
    assert.equal(p.phone, null);
  });

  test("a number another account holds is a clear refusal; a tutor cannot write a student profile", async () => {
    const a = await seedProfile({ role: "student" });
    const b = await seedProfile({ role: "student" });
    await save(await login(a.id), { fullName: "Amine A", phone: "+216 55 111 222" });
    assert.deepEqual((await save(await login(b.id), { fullName: "Bilel B", phone: "55 111 222" })).body, { ok: false, error: "phone-unavailable" });
    const tutor = await seedTutor();
    assert.deepEqual((await save(await login(tutor.profileId), { fullName: "Prof X" })).body, { ok: false, error: "not-a-student" });
  });

  test("level and subjects feed Accueil's suggestions", async () => {
    const t = await seedTutor({ fullName: "Nadia Gharbi" });
    await sql`update tutors set subject = 'svt', levels = '{college}' where id = ${t.id}`;
    const s = await seedProfile({ role: "student" });
    const cookie = await login(s.id);
    await save(cookie, { fullName: "Youssef Amri", level: "college", subjects: ["svt"] });
    const home = await call(app, "GET", "/student/home", cookie);
    assert.equal(home.body.suggestionsMatched, true);
    assert.equal(home.body.suggestions[0].id, t.id);
  });
});
