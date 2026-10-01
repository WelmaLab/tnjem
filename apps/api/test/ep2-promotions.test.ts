import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, fxClientIp, type App,
} from "./support/fx";

/* Espace prof v2 · Phase 5 B — promotions, 20 % maximum.

   The cap three times (the API's Zod, the database CHECK on a raw insert, the
   price calculation), no stacking, the price RECORDED on the booking with the
   promotion it used, `uses` moved atomically and given back on cancel, a calm
   notice (never an error) for a code that does not apply, public vs code-only,
   the audit log on create/end, and the admin's read-only, audited view. */

let app: App;
let adminCookie: string;
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL };
before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.ADMIN_EMAILS = admin.email;
  process.env.OTP_CHANNEL = "email";
  adminCookie = await login(admin.id);
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Promotions cascade from this file's tutors; audit rows stay (append-only, 0031).
  await stopApp(app);
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const create = (cookie: string, body: Record<string, unknown>) =>
  call(app, "POST", "/tutor/promotions", cookie, { scope: "all", endsAt: inDays(10), ...body });

async function setup() {
  const tutor = await seedTutor();
  const klass = await seedClass({ tutorId: tutor.id }); // 40 TND
  const tutorCookie = await login(tutor.profileId);
  const student = await seedProfile({ role: "student" });
  return { tutor, klass, tutorCookie, student, studentCookie: await login(student.id) };
}

describe("P5 · the 20 % cap, three times", () => {
  test("API: 25 % rejected, 20 % accepted", async () => {
    const { tutorCookie } = await setup();
    assert.deepEqual((await create(tutorCookie, { percent: 25 })).body, { ok: false, error: "percent-out-of-range" });
    const ok = await create(tutorCookie, { percent: 20 });
    assert.equal(ok.body.ok, true, ok.raw);
    assert.equal(ok.body.promotion.percent, 20);
    assert.equal(ok.body.promotion.state, "live");
  });

  test("DATABASE: a raw INSERT of 25 % (or 0 %) is refused by the CHECK; 20 % goes in", async () => {
    const { tutor } = await setup();
    for (const percent of [25, 0, 21]) {
      await assert.rejects(
        sql`insert into promotions (id, tutor_id, percent, scope, ends_at) values (${randomUUID()}, ${tutor.id}, ${percent}, 'all', now() + interval '1 day')`,
        (e: { code?: string; constraint_name?: string }) => e.code === "23514" && e.constraint_name === "promotions_percent_1_20",
        `${percent} %`,
      );
    }
    await sql`insert into promotions (id, tutor_id, percent, scope, ends_at) values (${randomUUID()}, ${tutor.id}, 20, 'all', now() + interval '1 day')`;
  });

  test("the other database guards: scope/target, window, code shape, uses within max", async () => {
    const { tutor } = await setup();
    const bad = [
      sql`insert into promotions (tutor_id, percent, scope, ends_at) values (${tutor.id}, 10, 'class', now() + interval '1 day')`,
      sql`insert into promotions (tutor_id, percent, scope, ends_at) values (${tutor.id}, 10, 'all', now() - interval '1 day')`,
      sql`insert into promotions (tutor_id, percent, scope, ends_at, code) values (${tutor.id}, 10, 'all', now() + interval '1 day', 'lower')`,
      sql`insert into promotions (tutor_id, percent, scope, ends_at, max_uses, uses) values (${tutor.id}, 10, 'all', now() + interval '1 day', 1, 2)`,
    ];
    for (const q of bad) await assert.rejects(q, (e: { code?: string }) => e.code === "23514");
  });
});

describe("P5 · a booking records the price shown, with ONE promotion", () => {
  test("a public 15 % promotion: 40 → 34 TND recorded, one use taken; cancelling gives it back", async () => {
    const { klass, tutorCookie, studentCookie } = await setup();
    const p = (await create(tutorCookie, { percent: 15, maxUses: 5 })).body.promotion;
    const res = await call(app, "POST", "/bookings", studentCookie, { classId: klass.id });
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.priceTnd, 34);
    assert.equal(res.body.promotionPercent, 15);
    const [b] = await sql<{ id: string; price_tnd: string; promotion_id: string }[]>`
      select id, price_tnd, promotion_id from bookings where class_id = ${klass.id}`;
    assert.equal(Number(b.price_tnd), 34);
    assert.equal(b.promotion_id, p.id);
    const [{ uses }] = await sql<{ uses: number }[]>`select uses from promotions where id = ${p.id}`;
    assert.equal(uses, 1);

    await call(app, "POST", "/bookings/cancel", studentCookie, { bookingId: b.id });
    const [{ uses: after }] = await sql<{ uses: number }[]>`select uses from promotions where id = ${p.id}`;
    assert.equal(after, 0, "the use goes back");
    const [led] = await sql<{ amount_tnd: string }[]>`select amount_tnd from cancellations where booking_id = ${b.id}`;
    assert.equal(Number(led.amount_tnd), 34, "the ledger values the seat at the price it was booked at");
  });

  test("NO STACKING: a public 10 % and a code 20 % — with the code, only the 20 % is used", async () => {
    const { klass, tutorCookie, studentCookie } = await setup();
    const pub = (await create(tutorCookie, { percent: 10 })).body.promotion;
    const coded = (await create(tutorCookie, { percent: 20, code: "RENTREE" })).body.promotion;
    const res = await call(app, "POST", "/bookings", studentCookie, { classId: klass.id, promoCode: "rentree" });
    assert.equal(res.body.priceTnd, 32);
    assert.equal(res.body.promotionPercent, 20);
    const uses = await sql<{ id: string; uses: number }[]>`select id, uses from promotions where id in ${sql([pub.id, coded.id])}`;
    assert.deepEqual(Object.fromEntries(uses.map((u) => [u.id, u.uses])), { [pub.id]: 0, [coded.id]: 1 });
  });

  test("an expired or invalid code: a calm notice, and the normal price is booked", async () => {
    const { tutor, klass, tutorCookie, studentCookie } = await setup();
    const p = (await create(tutorCookie, { percent: 20, code: "ETE" })).body.promotion;
    await sql`update promotions set starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' where id = ${p.id}`;
    const res = await call(app, "POST", "/bookings", studentCookie, { classId: klass.id, promoCode: "ETE" });
    assert.equal(res.body.ok, true);
    assert.equal(res.body.priceTnd, 40);
    assert.equal(res.body.promoNotice, "expired");
    const other = await seedClass({ tutorId: tutor.id });
    const res2 = await call(app, "POST", "/bookings", studentCookie, { classId: other.id, promoCode: "NOPE" });
    assert.equal(res2.body.priceTnd, 40);
    assert.equal(res2.body.promoNotice, "invalid");
  });

  test("max_uses is atomic: one use left, two students — one discount, one normal price", async () => {
    const { klass, tutorCookie } = await setup();
    const p = (await create(tutorCookie, { percent: 20, maxUses: 1 })).body.promotion;
    const a = await seedProfile({ role: "student" });
    const b = await seedProfile({ role: "student" });
    const [ra, rb] = await Promise.all([
      call(app, "POST", "/bookings", await login(a.id), { classId: klass.id }),
      call(app, "POST", "/bookings", await login(b.id), { classId: klass.id }),
    ]);
    assert.deepEqual([ra.body.priceTnd, rb.body.priceTnd].sort(), [32, 40]);
    const [{ uses }] = await sql<{ uses: number }[]>`select uses from promotions where id = ${p.id}`;
    assert.equal(uses, 1);
  });

  test("paused or ended promotions do not apply; ending is audited", async () => {
    const { klass, tutorCookie, studentCookie } = await setup();
    const p = (await create(tutorCookie, { percent: 20 })).body.promotion;
    assert.equal((await call(app, "POST", `/tutor/promotions/${p.id}/pause`, tutorCookie)).body.promotion.state, "paused");
    assert.equal((await call(app, "POST", "/bookings", studentCookie, { classId: klass.id })).body.priceTnd, 40);
    assert.equal((await call(app, "POST", `/tutor/promotions/${p.id}/end`, tutorCookie)).body.promotion.state, "ended");
    const audit = await sql<{ action: string; admin_profile_id: string | null; note: string }[]>`
      select action, admin_profile_id, note from admin_actions where subject_kind = 'promotion' and subject_id = ${p.id} order by created_at`;
    assert.deepEqual(audit.map((a) => a.action), ["promotion.create", "promotion.end"]);
    assert.equal(audit[0].admin_profile_id, null, "a tutor is not an admin: the actor column stays empty");
    assert.match(audit[0].note, /^tutor [0-9a-f-]{36} · 20 % · all · public$/);
    assert.equal((await call(app, "POST", `/tutor/promotions/${p.id}/resume`, tutorCookie)).body.error, "not-found", "ending is terminal");
  });
});

describe("P5 · public vs code-only, and what pages see", () => {
  test("the storefront and Explore carry PUBLIC promotions only; a code is resolved by the pricing endpoint", async () => {
    const { tutor, tutorCookie } = await setup();
    const pub = (await create(tutorCookie, { percent: 15 })).body.promotion;
    await create(tutorCookie, { percent: 20, code: "SECRET" });
    const sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.deepEqual(sf.body.promotions.map((p: { id: string }) => p.id), [pub.id]);
    assert.doesNotMatch(sf.raw, /SECRET/, "a code never reaches the public page");

    const ip = fxClientIp();
    const priced = await app.inject({ method: "GET", url: `/tutors/${tutor.slug}/pricing?code=secret`, remoteAddress: ip });
    const body = JSON.parse(priced.body);
    assert.equal(body.code.state, "ok");
    assert.equal(body.code.promotion.percent, 20);
    const wrong = JSON.parse((await app.inject({ method: "GET", url: `/tutors/${tutor.slug}/pricing?code=NOPE`, remoteAddress: ip })).body);
    assert.deepEqual(wrong.code, { state: "invalid" });
    assert.doesNotMatch(priced.body, /uses|max/i, "never the cap or the count");

    const explore = await call(app, "GET", `/tutors/explore?q=${encodeURIComponent(tutor.slug)}`, null);
    const card = explore.body.find((t: { slug: string }) => t.slug === tutor.slug);
    assert.deepEqual({ ...card.price_from_promo, ends_at: undefined }, { final_tnd: 34, percent: 15, ends_at: undefined });
    assert.equal(card.price_from_tnd, 40, "the struck-through price");
  });

  test("a code is unique per tutor; a target must be the tutor's own", async () => {
    const { tutorCookie } = await setup();
    await create(tutorCookie, { percent: 10, code: "BAC" });
    assert.deepEqual((await create(tutorCookie, { percent: 12, code: "bac" })).body, { ok: false, error: "code-taken" });
    const stranger = await seedTutor();
    const theirs = await seedClass({ tutorId: stranger.id });
    assert.deepEqual((await create(tutorCookie, { percent: 10, scope: "class", targetId: theirs.id })).body, { ok: false, error: "not-found" });
  });

  test("only the owner manages a promotion; students and strangers cannot", async () => {
    const { tutorCookie, studentCookie } = await setup();
    const p = (await create(tutorCookie, { percent: 10 })).body.promotion;
    assert.deepEqual((await create(studentCookie, { percent: 10 })).body, { ok: false, error: "not-a-tutor" });
    const stranger = await seedTutor();
    assert.deepEqual((await call(app, "POST", `/tutor/promotions/${p.id}/end`, await login(stranger.profileId))).body, { ok: false, error: "not-found" });
  });
});

describe("P5 · the admin's read-only view", () => {
  test("refused to a non-admin; an admin read is audited", async () => {
    const { tutor, tutorCookie } = await setup();
    await create(tutorCookie, { percent: 10 });
    assert.deepEqual((await call(app, "GET", `/admin/tutors/${tutor.id}/promotions`, tutorCookie)).body, { ok: false, error: "forbidden" });
    const res = await call(app, "GET", `/admin/tutors/${tutor.id}/promotions`, adminCookie);
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.promotions.length, 1);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'promotions.read' and subject_id = ${tutor.id}`;
    assert.equal(n, 1);
  });
});
