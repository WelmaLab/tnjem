import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App, type Tutor } from "./support/fx";
import { getHomeTutors } from "../src/lib/home-tutors";
import { runFollowDigest, type MailSender } from "../src/lib/follow-digest";
import { classUnlistedSchema, classUnlistedBodySchema } from "@tnajem/shared/class-input";
import { db } from "../src/db";

/* december-sprint · E (D18) — UNLISTED CLASSES (classes.unlisted, 0045).

   An unlisted class is bookable by its link (and its QR code, which is the same
   link) exactly like a listed one, and offered nowhere: not on the storefront's
   class list, not in Explore's « à partir de » nor the home card's price, not in the
   follow digest, not in a student's « Cette semaine » / « Mes profs » / « Réserver la
   prochaine ». A student who booked it keeps it in their own bookings.

   Parallel files share one database: every assertion is about rows this file seeded. */

let app: App;
let tutor: Tutor;
let tutorCookie: string;
let listedId: string;
let unlistedId: string;
const SUBJECT = `ds-e-subject-${randomBytes(3).toString("hex")}`;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

before(async () => {
  app = await startApp();
  tutor = await seedTutor({ fullName: "Sana Centre" });
  await sql`update tutors set subject = ${SUBJECT} where id = ${tutor.id}`;
  tutorCookie = await login(tutor.profileId);
  // The listed class costs 40 (seedClass); the unlisted one is CHEAPER and SOONER, so
  // without the filter it would set the public « à partir de » and the next class.
  listedId = (await seedClass({ tutorId: tutor.id, hoursFromNow: 96 })).id;
  const res = await call(app, "POST", "/classes", tutorCookie, {
    title: "Groupe du centre", scheduledAt: inDays(2), durationMin: 60, priceTnd: 12, seats: 10,
    isFreeFirst: false, unlisted: true,
  });
  assert.equal(res.body.ok, true, res.raw);
  unlistedId = res.body.id;
});

after(async () => {
  await stopApp(app);
});

describe("D18 · the schema and POST /classes", () => {
  test("the shared schema: optional boolean, nothing else", () => {
    assert.equal(classUnlistedSchema.safeParse(undefined).success, true);
    assert.equal(classUnlistedSchema.safeParse(true).success, true);
    assert.equal(classUnlistedSchema.safeParse("yes").success, false);
    assert.equal(classUnlistedBodySchema.safeParse({ unlisted: false }).success, true);
    assert.equal(classUnlistedBodySchema.safeParse({}).success, false);
    assert.equal(classUnlistedBodySchema.safeParse({ unlisted: 1 }).success, false);
  });

  test("created with unlisted: true is stored unlisted", async () => {
    const [row] = await sql<{ unlisted: boolean }[]>`select unlisted from classes where id = ${unlistedId}`;
    assert.equal(row.unlisted, true);
  });

  test("default false: a body without the field, and the column default", async () => {
    const res = await call(app, "POST", "/classes", tutorCookie, {
      title: "Sans le champ", scheduledAt: inDays(5), durationMin: 60, priceTnd: 50, seats: 5, isFreeFirst: false,
    });
    assert.equal(res.body.ok, true, res.raw);
    const [row] = await sql<{ unlisted: boolean }[]>`select unlisted from classes where id = ${res.body.id}`;
    assert.equal(row.unlisted, false);
    const [seeded] = await sql<{ unlisted: boolean }[]>`select unlisted from classes where id = ${listedId}`;
    assert.equal(seeded.unlisted, false, "a raw insert gets the column default");
  });

  test("a non-boolean unlisted is a 400", async () => {
    const res = await call(app, "POST", "/classes", tutorCookie, {
      title: "Mauvais", scheduledAt: inDays(5), durationMin: 60, priceTnd: 30, seats: 5, isFreeFirst: false, unlisted: "yes",
    });
    assert.equal(res.status, 400);
  });
});

describe("D18 · absent from every public list", () => {
  test("the storefront's class list (and so its JSON-LD) leaves it out", async () => {
    const sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.equal(sf.status, 200);
    const ids = sf.body.classes.map((c: { id: string }) => c.id);
    assert.ok(ids.includes(listedId), "the listed class is there");
    assert.ok(!ids.includes(unlistedId), "the unlisted one is not");
    assert.doesNotMatch(sf.raw, /Groupe du centre/);
  });

  test("Explore and its search: the tutor is found, priced by the listed class only", async () => {
    for (const q of [`subject=${encodeURIComponent(SUBJECT)}`, `q=${encodeURIComponent(tutor.slug)}`]) {
      const res = await call(app, "GET", `/tutors/explore?${q}`, null);
      const card = res.body.find((t: { slug: string }) => t.slug === tutor.slug);
      assert.ok(card, `found by ${q}`);
      assert.equal(card.price_from_tnd, 40, "« à partir de » ignores the 12 TND unlisted class");
    }
  });

  test("the home card's price ignores it", async () => {
    const [card] = await getHomeTutors({ restrictTo: [tutor.id] });
    assert.deepEqual(card?.price, { tnd: 40, per: "session" });
  });

  test("a tutor whose only class is unlisted shows no class price at all", async () => {
    const solo = await seedTutor();
    await sql`update tutors set subject = ${SUBJECT} where id = ${solo.id}`;
    const k = await seedClass({ tutorId: solo.id });
    await sql`update classes set unlisted = true where id = ${k.id}`;
    const res = await call(app, "GET", `/tutors/explore?subject=${encodeURIComponent(SUBJECT)}`, null);
    const card = res.body.find((t: { slug: string }) => t.slug === solo.slug);
    assert.ok(card, "the tutor stays listed");
    assert.equal(card.price_from_tnd, null);
    const sf = await call(app, "GET", `/tutors/${solo.slug}/storefront`, null);
    assert.deepEqual(sf.body.classes, []);
  });

  test("the sitemap refs list tutors, never classes", async () => {
    const refs = await call(app, "GET", "/tutors/public-refs", null);
    assert.ok(refs.body.some((r: { slug: string }) => r.slug === tutor.slug));
    assert.ok(!refs.raw.includes(unlistedId));
  });

  test("a review of the unlisted class keeps its text but not the class title", async () => {
    const student = await seedProfile({ role: "student" });
    const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -48 });
    await sql`update classes set unlisted = true, title = 'Groupe privé passé' where id = ${past.id}`;
    await sql`insert into reviews (tutor_id, student_id, class_id, rating, text) values (${tutor.id}, ${student.id}, ${past.id}, 5, 'Très clair')`;
    const res = await call(app, "GET", `/tutors/${tutor.slug}/reviews`, null);
    const item = res.body.items.find((r: { text: string }) => r.text === "Très clair");
    assert.ok(item);
    assert.equal(item.classTitle, null);
    assert.doesNotMatch(res.raw, /Groupe privé passé/);
  });
});

describe("D18 · bookable by its link, kept by whoever booked it", () => {
  test("GET /classes/:id answers it, flagged unlisted (the page adds robots noindex)", async () => {
    const res = await call(app, "GET", `/classes/${unlistedId}`, null);
    assert.equal(res.body.id, unlistedId);
    assert.equal(res.body.unlisted, true);
    assert.equal(res.body.tutor_slug, tutor.slug);
    const listed = await call(app, "GET", `/classes/${listedId}`, null);
    assert.equal(listed.body.unlisted, false);
  });

  test("a student books it exactly like a listed class, and keeps it in their bookings", async () => {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const cookie = await login(student.id);
    const booked = await call(app, "POST", "/bookings", cookie, { classId: unlistedId });
    assert.equal(booked.body.ok, true, booked.raw);
    const [k] = await sql<{ seats_taken: number }[]>`select seats_taken from classes where id = ${unlistedId}`;
    assert.equal(k.seats_taken, 1);

    const mine = await call(app, "GET", "/student/classes", cookie);
    assert.ok(mine.body.ahead.some((r: { classId: string }) => r.classId === unlistedId), "in « Mes cours »");
    const home = await call(app, "GET", "/student/home", cookie);
    assert.equal(home.body.next?.classId, unlistedId, "it is their next class");
    const profs = await call(app, "GET", "/student/profs", cookie);
    const card = profs.body.profs.find((p: { tutor: { id: string } }) => p.tutor.id === tutor.id);
    assert.equal(card?.nextClass?.classId, unlistedId, "a booked unlisted class is their prof's next class for them");

  });
});

describe("D18 · never advertised to followers", () => {
  test("« Cette semaine » and « Mes profs » of a follower who did not book it", async () => {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const cookie = await login(student.id);
    assert.equal((await call(app, "POST", "/follows", cookie, { slug: tutor.slug })).body.ok, true);
    const home = await call(app, "GET", "/student/home", cookie);
    assert.equal(home.body.ok, true, home.raw);
    const open = home.body.week.filter((w: { kind: string }) => w.kind === "open").map((w: { open: { classId: string } }) => w.open.classId);
    assert.ok(!open.includes(unlistedId), "not in « Cette semaine »");
    const profs = await call(app, "GET", "/student/profs", cookie);
    const card = profs.body.profs.find((p: { tutor: { id: string } }) => p.tutor.id === tutor.id);
    assert.ok(card, "the followed prof is shown");
    assert.notEqual(card.nextClass?.classId, unlistedId, "the next class shown is a listed one");
    assert.equal(card.nextClass?.classId, listedId);
  });

  test("the follow digest announces the listed class, never the unlisted one", async () => {
    const t = await seedTutor({ fullName: "Digest Centre" });
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    assert.equal((await call(app, "POST", "/follows", await login(student.id), { slug: t.slug })).body.ok, true);
    const pub = await seedClass({ tutorId: t.id });
    const hidden = await seedClass({ tutorId: t.id });
    await sql`update classes set unlisted = true where id = ${hidden.id}`;
    const sent: { to: string; text: string }[] = [];
    const send: MailSender = async (to, _subject, text) => {
      sent.push({ to, text });
      return true;
    };
    await runFollowDigest(db, { send });
    const notes = await sql<{ msg_params: unknown }[]>`
      select msg_params from notifications where profile_id = ${student.id} and kind = 'follow_digest'`;
    assert.equal(notes.length, 1);
    const params = JSON.stringify(notes[0].msg_params);
    assert.match(params, new RegExp(pub.title));
    assert.doesNotMatch(params, new RegExp(hidden.title));
    const mail = sent.filter((m) => m.to === student.email);
    assert.equal(mail.length, 1);
    assert.doesNotMatch(mail[0].text, new RegExp(hidden.title));
    assert.doesNotMatch(mail[0].text, new RegExp(hidden.id));
  });
});

describe("D18 · POST /classes/:id/unlisted — the owner's switch", () => {
  test("owner flips it; the storefront follows; the no-op says already", async () => {
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 120 });
    const on = await call(app, "POST", `/classes/${k.id}/unlisted`, tutorCookie, { unlisted: true });
    assert.equal(on.body.ok, true, on.raw);
    assert.deepEqual(on.body.revalidate, { tutors: [tutor.slug], publicTutors: true });
    let sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.ok(!sf.body.classes.some((c: { id: string }) => c.id === k.id));
    const dash = await call(app, "GET", "/dashboard", tutorCookie);
    assert.equal(dash.body.classes.find((c: { id: string }) => c.id === k.id)?.unlisted, true, "the tutor's own list shows it");

    assert.deepEqual((await call(app, "POST", `/classes/${k.id}/unlisted`, tutorCookie, { unlisted: true })).body, { ok: true, already: true, unlisted: true });
    const off = await call(app, "POST", `/classes/${k.id}/unlisted`, tutorCookie, { unlisted: false });
    assert.equal(off.body.ok, true);
    sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.ok(sf.body.classes.some((c: { id: string }) => c.id === k.id));
  });

  test("not the owner, signed out, a cancelled class, a bad body", async () => {
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 120 });
    const other = await seedTutor();
    assert.deepEqual((await call(app, "POST", `/classes/${k.id}/unlisted`, await login(other.profileId), { unlisted: true })).body, { ok: false, error: "not-found" });
    assert.deepEqual((await call(app, "POST", `/classes/${k.id}/unlisted`, null, { unlisted: true })).body, { ok: false, error: "not-authenticated" });
    assert.equal((await call(app, "POST", `/classes/${k.id}/unlisted`, tutorCookie, { unlisted: "x" })).status, 400);
    const [row] = await sql<{ unlisted: boolean }[]>`select unlisted from classes where id = ${k.id}`;
    assert.equal(row.unlisted, false, "nothing changed");

    const gone = await seedClass({ tutorId: tutor.id, status: "cancelled" });
    assert.deepEqual((await call(app, "POST", `/classes/${gone.id}/unlisted`, tutorCookie, { unlisted: true })).body, { ok: false, error: "unavailable" });
  });
});

describe("D18 · Explore's promotion price and the messages offer", () => {
  test("a live public promotion prices Explore from the listed class, never the unlisted one", async () => {
    const t = await seedTutor();
    await sql`update tutors set subject = ${SUBJECT} where id = ${t.id}`;
    await seedClass({ tutorId: t.id, hoursFromNow: 100 }); // 40 TND, listed
    const cheap = await seedClass({ tutorId: t.id, hoursFromNow: 50 });
    await sql`update classes set unlisted = true, price_tnd = '10' where id = ${cheap.id}`;
    await sql`insert into promotions (tutor_id, percent, scope, ends_at) values (${t.id}, 10, 'all', now() + interval '2 days')`;
    const res = await call(app, "GET", `/tutors/explore?subject=${encodeURIComponent(SUBJECT)}`, null);
    const card = res.body.find((x: { slug: string }) => x.slug === t.slug);
    assert.ok(card);
    assert.equal(card.price_from_tnd, 40);
    assert.equal(card.price_from_promo?.final_tnd, 36, "−10 % of the listed 40, not of the unlisted 10");
  });

  test("the conversation's « next class » never offers an unlisted class to a student who has not booked it", async () => {
    const t = await seedTutor();
    const hidden = await seedClass({ tutorId: t.id, hoursFromNow: 30 });
    await sql`update classes set unlisted = true where id = ${hidden.id}`;
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const cookie = await login(student.id);

    let conv = await call(app, "GET", `/conversations/${t.id}`, cookie);
    assert.equal(conv.status, 200, conv.raw);
    assert.equal(conv.body.nextClass, null, "only an unlisted class on sale: nothing is offered");

    const listed = await seedClass({ tutorId: t.id, hoursFromNow: 90 });
    conv = await call(app, "GET", `/conversations/${t.id}`, cookie);
    assert.equal(conv.body.nextClass?.classId, listed.id, "the listed one is offered, though the unlisted one is sooner");
    assert.equal(conv.body.nextClass?.booked, false);

    // Booked, it is theirs: the existing « booked » path shows it.
    const booked = await call(app, "POST", "/bookings", cookie, { classId: hidden.id });
    assert.equal(booked.body.ok, true, booked.raw);
    conv = await call(app, "GET", `/conversations/${t.id}`, cookie);
    assert.equal(conv.body.nextClass?.classId, hidden.id);
    assert.equal(conv.body.nextClass?.booked, true);
  });
});

describe("D18 · QA follow-ups", () => {
  test("a class-scoped public promotion on an unlisted class: its id is in no public payload, and booking by link still gets the discount", async () => {
    const t = await seedTutor();
    const listedK = await seedClass({ tutorId: t.id, hoursFromNow: 100 });
    const hidden = await seedClass({ tutorId: t.id, hoursFromNow: 60 }); // 40 TND
    await sql`update classes set unlisted = true where id = ${hidden.id}`;
    const [promo] = await sql<{ id: string }[]>`
      insert into promotions (tutor_id, percent, scope, target_id, ends_at)
      values (${t.id}, 10, 'class', ${hidden.id}, now() + interval '2 days') returning id`;
    const [other] = await sql<{ id: string }[]>`
      insert into promotions (tutor_id, percent, scope, target_id, ends_at)
      values (${t.id}, 5, 'class', ${listedK.id}, now() + interval '2 days') returning id`;

    const sf = await call(app, "GET", `/tutors/${t.slug}/storefront`, null);
    assert.equal(sf.status, 200);
    assert.ok(!sf.raw.includes(hidden.id), "the unlisted class uuid is nowhere in the storefront payload");
    assert.ok(!sf.raw.includes(promo.id), "nor its promotion");
    assert.ok(sf.raw.includes(other.id), "a listed class's promotion still is");

    const pricing = await call(app, "GET", `/tutors/${t.slug}/pricing`, null);
    assert.ok(!pricing.raw.includes(hidden.id), "nor in GET /tutors/:slug/pricing");
    assert.ok(pricing.body.promotions.some((p: { id: string }) => p.id === other.id));

    // The class's own page and checkout name it, and then get its promotion.
    const own = await call(app, "GET", `/tutors/${t.slug}/pricing?class=${hidden.id}`, null);
    assert.ok(own.body.promotions.some((p: { id: string; targetId: string }) => p.id === promo.id && p.targetId === hidden.id));
    const elsewhere = await call(app, "GET", `/tutors/${t.slug}/pricing?class=${listedK.id}`, null);
    assert.ok(!elsewhere.raw.includes(hidden.id), "naming another class does not unlock it");

    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const booked = await call(app, "POST", "/bookings", await login(student.id), { classId: hidden.id });
    assert.equal(booked.body.ok, true, booked.raw);
    const [b] = await sql<{ price_tnd: string; promotion_id: string | null }[]>`
      select price_tnd, promotion_id from bookings where class_id = ${hidden.id} and student_id = ${student.id}`;
    assert.equal(Number(b.price_tnd), 36, "−10 % of 40, applied at booking");
    assert.equal(b.promotion_id, promo.id);
  });

  test("a test tutor's unlisted class: flagged both ways, still bookable by link", async () => {
    const t = await seedTutor();
    await sql`update tutors set is_test = true where id = ${t.id}`;
    const k = await seedClass({ tutorId: t.id, hoursFromNow: 70 });
    await sql`update classes set unlisted = true where id = ${k.id}`;
    const res = await call(app, "GET", `/classes/${k.id}`, null);
    assert.equal(res.body.id, k.id);
    assert.equal(res.body.unlisted, true);
    assert.equal(res.body.tutor_is_test, true);
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const booked = await call(app, "POST", "/bookings", await login(student.id), { classId: k.id });
    assert.equal(booked.body.ok, true, booked.raw);
  });

  test("a suspended tutor's unlisted class answers exactly like their listed one: unreachable, not bookable", async () => {
    const t = await seedTutor();
    const listedK = await seedClass({ tutorId: t.id, hoursFromNow: 70 });
    const hidden = await seedClass({ tutorId: t.id, hoursFromNow: 70 });
    await sql`update classes set unlisted = true where id = ${hidden.id}`;
    await sql`update tutors set suspended_at = now() where id = ${t.id}`;
    const cookie = await login((await seedProfile({ role: "student", birthYear: 1995 })).id);
    for (const id of [listedK.id, hidden.id]) {
      assert.equal((await call(app, "GET", `/classes/${id}`, null)).body, null, `GET /classes/${id} is null`);
      assert.deepEqual((await call(app, "POST", "/bookings", cookie, { classId: id })).body, { ok: false, error: "unavailable" });
    }
  });
});
