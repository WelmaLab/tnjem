import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedTutor, seedClass, seedProfile, seedBooking, login, call, sql, type App,
} from "./support/fx";

/* student-space-v1 · B — Accueil (GET /student/home).

   The next class (start + duration decides, whatever classes.status says — C7),
   « Cette semaine » (my other seats + the open classes of the profs I follow, at the
   price the checkout opens with), « Mes profs », « Nouvelles fiches » under the ONE
   access rule (lib/material-access.ts — C6), and « Profs pour toi »: always, up to 3
   verified profs matching the student's level and subjects, never one they follow,
   empty when nothing matches — with nothing at all, the newest verified instead.
   Session + student role on every call (C9). */

let app: App;
const materialIds: string[] = [];

before(async () => {
  app = await startApp();
});
after(async () => {
  if (materialIds.length) await sql`delete from materials where id in ${sql(materialIds)}`;
  await stopApp(app);
});

const home = async (cookie: string | null) => call(app, "GET", "/student/home", cookie);

async function seedMaterial(opts: { tutorId: string; classId?: string | null; visibility?: string; title?: string; kind?: "file" | "youtube"; removed?: boolean; createdAt?: Date }): Promise<string> {
  const kind = opts.kind ?? "youtube";
  const [row] = await sql<{ id: string }[]>`
    insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id, mime, file_name, storage_path, removed_at, created_at)
    values (${opts.tutorId}, ${opts.classId ?? null}, ${kind}, ${opts.visibility ?? "students"}, ${opts.title ?? "SSV1 fiche"},
            ${kind === "youtube" ? "dQw4w9WgXcQ" : null}, ${kind === "file" ? "application/pdf" : null},
            ${kind === "file" ? "fiche.pdf" : null}, ${kind === "file" ? "materials/none/fiche.pdf" : null},
            ${opts.removed ? new Date().toISOString() : null}, ${(opts.createdAt ?? new Date()).toISOString()})
    returning id`;
  materialIds.push(row.id);
  return row.id;
}

describe("B · who may ask", () => {
  test("signed out, a tutor and a guardian are refused; a student gets their home", async () => {
    assert.deepEqual((await home(null)).body, { ok: false, error: "not-authenticated" });
    const tutor = await seedTutor();
    assert.deepEqual((await home(await login(tutor.profileId))).body, { ok: false, error: "not-a-student" });
    const guardian = await seedProfile({ role: "guardian" });
    assert.deepEqual((await home(await login(guardian.id))).body, { ok: false, error: "not-a-student" });
    const student = await seedProfile({ role: "student", fullName: "amine karoui" });
    const res = await home(await login(student.id));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.firstName, "Amine", "the first name, as shown (capitalised), never the last name");
  });
});

describe("B · the next class and « Cette semaine »", () => {
  test("next = the class live now or the soonest ahead; a class past its end is never « next », whatever its status", async () => {
    const tutor = await seedTutor({ fullName: "Walid Trabelsi" });
    const student = await seedProfile({ role: "student" });
    const ended = await seedClass({ tutorId: tutor.id, hoursFromNow: -3, durationMin: 90 }); // still `scheduled`
    const soon = await seedClass({ tutorId: tutor.id, hoursFromNow: 9 });
    const later = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    const farAway = await seedClass({ tutorId: tutor.id, hoursFromNow: 24 * 10 });
    for (const k of [ended, soon, later, farAway]) await seedBooking({ classId: k.id, studentId: student.id });
    const cookie = await login(student.id);

    let res = await home(cookie);
    assert.equal(res.body.next.classId, soon.id, "the soonest ahead");
    assert.equal(res.body.next.state, "upcoming");
    assert.equal(res.body.next.tutor.name, "Walid T.", "« Walid T. », never the last name");
    assert.doesNotMatch(res.raw, /Trabelsi|@tnajem\.invalid/, "no last name, no address anywhere in the payload");
    const weekIds = res.body.week.map((w: { kind: string; row?: { classId: string } }) => w.row?.classId);
    assert.deepEqual(weekIds, [later.id], "the OTHER seats of the next 7 days — not the next one, not one in 10 days, not a past one");

    // Live now (started 30 min ago, 90 min long): that one is next.
    const live = await seedClass({ tutorId: tutor.id, hoursFromNow: -0.5, durationMin: 90 });
    await seedBooking({ classId: live.id, studentId: student.id });
    res = await home(cookie);
    assert.equal(res.body.next.classId, live.id);
    assert.equal(res.body.next.state, "live");
  });

  test("a cancelled seat is not next; the open classes of a FOLLOWED prof this week come with their price after the promotion", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const cancelled = await seedClass({ tutorId: tutor.id, hoursFromNow: 5 });
    await seedBooking({ classId: cancelled.id, studentId: student.id, status: "cancelled" });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${student.id}, ${tutor.id})`;
    const open = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 }); // 40 TND
    const full = await seedClass({ tutorId: tutor.id, hoursFromNow: 31, seats: 2, seatsTaken: 2 });
    const nextMonth = await seedClass({ tutorId: tutor.id, hoursFromNow: 24 * 20 });
    await sql`insert into promotions (tutor_id, percent, scope, starts_at, ends_at) values (${tutor.id}, 10, 'all', now() - interval '1 hour', now() + interval '3 days')`;

    const res = await home(await login(student.id));
    assert.equal(res.body.next, null, "the only seat was cancelled");
    const opens = res.body.week.filter((w: { kind: string }) => w.kind === "open").map((w: { open: { classId: string; priceTnd: number; seatsLeft: number } }) => w.open);
    assert.deepEqual(opens.map((o: { classId: string }) => o.classId), [cancelled.id, open.id],
      "the followed prof's open classes this week (a seat I cancelled is open to me again)");
    const o = opens.find((x: { classId: string }) => x.classId === open.id);
    assert.equal(o.priceTnd, 36, "40 TND − 10 % (pricing.ts, the price the checkout opens with)");
    assert.ok(!opens.some((x: { classId: string }) => x.classId === full.id), "a full class is not offered");
    assert.ok(!opens.some((x: { classId: string }) => x.classId === nextMonth.id), "nor one beyond 7 days");
    assert.equal(res.body.nothing, false, "following a prof is not « nothing at all »");
    assert.deepEqual(res.body.suggestions, [], "no level, no subjects: nothing matches, and no « newest » fallback once there is a prof");
  });
});

describe("B · Mes profs and Nouvelles fiches (the ONE access rule)", () => {
  test("only the fiches the student may open; the hero counts its class's fiches; « nouvelle » follows last_seen_fiches_at", async () => {
    const tutor = await seedTutor();
    const followedOnly = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const mine = await seedClass({ tutorId: tutor.id, hoursFromNow: 20 });
    const notMine = await seedClass({ tutorId: tutor.id, hoursFromNow: 40 });
    await seedBooking({ classId: mine.id, studentId: student.id });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${student.id}, ${followedOnly.id})`;

    const forMyClass = await seedMaterial({ tutorId: tutor.id, classId: mine.id, title: "Énoncé — intégrales" });
    const forOtherClass = await seedMaterial({ tutorId: tutor.id, classId: notMine.id, title: "Pas pour moi" });
    const allMyStudents = await seedMaterial({ tutorId: tutor.id, title: "Tous mes élèves", createdAt: new Date(Date.now() - 86_400_000) });
    const privateOne = await seedMaterial({ tutorId: tutor.id, visibility: "private", title: "Privé" });
    const removed = await seedMaterial({ tutorId: tutor.id, classId: mine.id, title: "Retiré", removed: true });
    const publicOfFollowed = await seedMaterial({ tutorId: followedOnly.id, visibility: "public", title: "Fiche publique", createdAt: new Date(Date.now() - 2 * 86_400_000) });
    const studentsOfFollowed = await seedMaterial({ tutorId: followedOnly.id, title: "Pour ses élèves seulement" });

    const cookie = await login(student.id);
    let res = await home(cookie);
    assert.equal(res.body.next.fiches, 1, "the hero counts the fiches of ITS class the student may open");
    const ids = res.body.newFiches.map((f: { id: string }) => f.id);
    assert.deepEqual(ids, [forMyClass, allMyStudents, publicOfFollowed], "newest first, at most 3, only what the rule allows");
    for (const hidden of [forOtherClass, privateOne, removed, studentsOfFollowed]) assert.ok(!ids.includes(hidden));
    assert.equal(res.body.newFiches[0].origin.kind, "class");
    assert.equal(res.body.newFiches[0].origin.classId, mine.id);
    assert.equal(res.body.newFiches[2].origin.kind, "page");

    // Each listed fiche, the file endpoint's rule says yes; each hidden one, no.
    for (const id of [forMyClass, allMyStudents, publicOfFollowed]) {
      const [m] = await sql<{ tutor_id: string; visibility: string; class_id: string | null; removed_at: Date | null }[]>`select tutor_id, visibility, class_id, removed_at from materials where id = ${id}`;
      const { canRead } = await import("../src/lib/material-access");
      assert.equal(await canRead({ tutorId: m.tutor_id, visibility: m.visibility, classId: m.class_id, removedAt: m.removed_at }, student.id), true);
    }
    for (const id of [forOtherClass, privateOne, removed, studentsOfFollowed]) {
      const [m] = await sql<{ tutor_id: string; visibility: string; class_id: string | null; removed_at: Date | null }[]>`select tutor_id, visibility, class_id, removed_at from materials where id = ${id}`;
      const { canRead } = await import("../src/lib/material-access");
      assert.equal(await canRead({ tutorId: m.tutor_id, visibility: m.visibility, classId: m.class_id, removedAt: m.removed_at }, student.id), false);
    }

    // Mes profs: the followed prof and the booked one; never seen the fiches page → every fiche is new.
    const profs = res.body.profs as { tutor: { id: string }; following: boolean; newFiches: number }[];
    assert.equal(res.body.profsTotal, 2);
    assert.deepEqual(profs.map((p) => p.tutor.id).sort(), [tutor.id, followedOnly.id].sort());
    assert.equal(profs.find((p) => p.tutor.id === followedOnly.id)?.following, true);
    assert.equal(profs.find((p) => p.tutor.id === tutor.id)?.newFiches, 2);

    // Seen an hour ago: only what came after counts as new.
    await sql`update profiles set last_seen_fiches_at = now() - interval '1 hour' where id = ${student.id}`;
    res = await home(cookie);
    assert.equal((res.body.profs as typeof profs).find((p) => p.tutor.id === tutor.id)?.newFiches, 1);
    assert.equal((res.body.profs as typeof profs).find((p) => p.tutor.id === followedOnly.id)?.newFiches, 0);
  });
});

describe("B · nothing at all: suggestions from Profil", () => {
  test("no booking, no prof: verified profs matching level + subjects first; none set → the newest verified", async () => {
    const match = await seedTutor({ fullName: "Sana Ben Salah" });
    await sql`update tutors set subject = 'physique', levels = '{bac}' where id = ${match.id}`;
    const pending = await seedTutor({ status: "pending" });
    await sql`update tutors set subject = 'physique', levels = '{bac}' where id = ${pending.id}`;

    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    let res = await home(cookie);
    assert.equal(res.body.next, null);
    assert.equal(res.body.suggestionsMatched, false, "no level, no subjects: the newest verified profs");
    assert.ok(res.body.suggestions.length > 0 && res.body.suggestions.length <= 3);
    assert.ok(res.body.suggestions.every((t: { verified: boolean }) => t.verified), "verified profs only");

    await sql`update profiles set level = 'bac', subjects = 'physique' where id = ${student.id}`;
    res = await home(cookie);
    assert.equal(res.body.suggestionsMatched, true);
    assert.equal(res.body.suggestions[0].id, match.id, "the prof matching both comes first");
    assert.ok(!res.body.suggestions.some((t: { id: string }) => t.id === pending.id), "never a prof who is not verified");
    assert.doesNotMatch(res.raw, /Ben Salah/);
  });
});

describe("B · « Profs pour toi » for a student who already has profs", () => {
  test("always there, matched on level + subjects, never a followed prof; a Profil edit changes it", async () => {
    const followedMatch = await seedTutor({ fullName: "Walid Trabelsi" });
    const otherMatch = await seedTutor({ fullName: "Sana Ben Salah" });
    const svt = await seedTutor({ fullName: "Ines Gharbi" });
    await sql`update tutors set subject = 'physique', levels = '{bac}' where id in ${sql([followedMatch.id, otherMatch.id])}`;
    await sql`update tutors set subject = 'svt', levels = '{bac}' where id = ${svt.id}`;
    const booked = await seedTutor();
    const student = await seedProfile({ role: "student" });
    await seedBooking({ classId: (await seedClass({ tutorId: booked.id, hoursFromNow: 30 })).id, studentId: student.id });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${student.id}, ${followedMatch.id})`;
    await sql`update profiles set level = 'bac', subjects = 'physique' where id = ${student.id}`;

    const cookie = await login(student.id);
    let res = await home(cookie);
    assert.equal(res.body.nothing, false);
    assert.equal(res.body.suggestionsMatched, true);
    const ids = () => res.body.suggestions.map((t: { id: string }) => t.id) as string[];
    assert.ok(res.body.suggestions.length >= 1 && res.body.suggestions.length <= 3, "at most 3");
    assert.equal(res.body.suggestions[0].subject, "physique", "a prof matching level AND subject comes first");
    assert.ok(ids().includes(otherMatch.id) || res.body.suggestions.every((t: { subject: string }) => t.subject === "physique"),
      "the unfollowed physique/bac prof is offered (or 3 newer ones matching just as well)");
    assert.ok(!ids().includes(followedMatch.id), "never a prof the student already follows");

    // Profil: physique → svt. The block follows the edit.
    await sql`update profiles set subjects = 'svt' where id = ${student.id}`;
    res = await home(cookie);
    assert.equal(res.body.suggestionsMatched, true);
    assert.equal(res.body.suggestions[0].subject, "svt", "the svt profs now come first");
    assert.ok(!ids().includes(followedMatch.id));
  });
});
