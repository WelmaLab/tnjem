import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App,
} from "./support/fx";
import { MONTHLY_PAYMENT_NOTE } from "@tnajem/shared";
import { runSubscriptionJobs } from "../src/lib/subscription-cron";
import type { MailSender } from "../src/lib/follow-digest";
import { db } from "../src/db";

/* Espace prof v2 · Phase 5 A — monthly offers and subscriptions, payments off.

   ≤ 3 offers (price > 0, 1–31 sessions) → a student asks (requested, the price
   shown kept on the row) → the teacher confirms by hand (active for one month) →
   the subscriber's bookings in that teacher's classes are COVERED (contract C7:
   bookings.subscription_id) up to the monthly quota, then ordinary → the nightly
   job reminds 3 days before and expires past period_end → one-click renewal. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  // Offers, subscriptions and bookings cascade from this file's tutors and profiles.
  await stopApp(app);
});

async function tutorWithOffer(sessionsPerMonth = 2, priceTnd = 100) {
  const tutor = await seedTutor();
  const cookie = await login(tutor.profileId);
  const res = await call(app, "POST", "/tutor/offers", cookie, { title: `${sessionsPerMonth} séances`, sessionsPerMonth, priceTnd });
  assert.equal(res.body.ok, true, res.raw);
  return { tutor, cookie, offerId: res.body.id as string };
}

async function activeSubscriber(sessionsPerMonth = 2) {
  const t = await tutorWithOffer(sessionsPerMonth);
  const student = await seedProfile({ role: "student", fullName: "Nour Gharbi" });
  const sc = await login(student.id);
  const req = await call(app, "POST", "/subscriptions", sc, { offerId: t.offerId });
  assert.equal(req.body.ok, true, req.raw);
  const subId = req.body.subscription.id as string;
  const conf = await call(app, "POST", `/tutor/subscriptions/${subId}/confirm`, t.cookie);
  assert.equal(conf.body.ok, true, conf.raw);
  return { ...t, student, sc, subId };
}

describe("P5 · the spec's own payment note", () => {
  test("is word for word the spec's sentence (rendered beside 'Bientôt')", () => {
    assert.equal(MONTHLY_PAYMENT_NOTE.fr, "Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof.");
    assert.ok(MONTHLY_PAYMENT_NOTE.ar.length > 10);
  });
});

describe("P5 · offers", () => {
  test("at most 3; price > 0; 1–31 sessions; archiving frees a slot", async () => {
    const tutor = await seedTutor();
    const cookie = await login(tutor.profileId);
    const mk = (body: Record<string, unknown>) => call(app, "POST", "/tutor/offers", cookie, { title: "Offre", sessionsPerMonth: 4, priceTnd: 80, ...body });
    assert.deepEqual((await mk({ priceTnd: 0 })).body, { ok: false, error: "price-must-be-positive" });
    assert.deepEqual((await mk({ sessionsPerMonth: 32 })).body, { ok: false, error: "invalid-sessions" });
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push((await mk({ title: `Offre ${i + 1}` })).body.id);
    assert.deepEqual((await mk({ title: "Offre 4" })).body, { ok: false, error: "max-offers", max: 3 });
    assert.equal((await call(app, "POST", `/tutor/offers/${ids[0]}/archive`, cookie)).body.ok, true);
    assert.equal((await mk({ title: "Offre 4" })).body.ok, true);
    const list = await call(app, "GET", "/tutor/offers", cookie);
    assert.equal(list.body.offers.length, 3);
  });

  test("the database refuses what Zod refuses (a raw insert)", async () => {
    const tutor = await seedTutor();
    await assert.rejects(sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'x', 4, 0)`, (e: { code?: string }) => e.code === "23514");
    await assert.rejects(sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'x', 32, 10)`, (e: { code?: string }) => e.code === "23514");
  });

  test("only the owner edits; the storefront shows active offers only", async () => {
    const { tutor, cookie, offerId } = await tutorWithOffer();
    const stranger = await seedTutor();
    assert.deepEqual((await call(app, "POST", `/tutor/offers/${offerId}`, await login(stranger.profileId), { priceTnd: 1 })).body, { ok: false, error: "not-found" });
    let sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.deepEqual(sf.body.offers.map((o: { id: string }) => o.id), [offerId]);
    await call(app, "POST", `/tutor/offers/${offerId}`, cookie, { active: false });
    sf = await call(app, "GET", `/tutors/${tutor.slug}/storefront`, null);
    assert.deepEqual(sf.body.offers, []);
  });
});

describe("P5 · request → confirm", () => {
  test("a student asks; the teacher is told (first name); the price shown is kept; asking twice is refused", async () => {
    const { tutor, offerId } = await tutorWithOffer(4, 120);
    const student = await seedProfile({ role: "student", fullName: "Skander Ayari" });
    const sc = await login(student.id);
    const res = await call(app, "POST", "/subscriptions", sc, { offerId });
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.subscription.status, "requested");
    assert.equal(res.body.subscription.priceTnd, 120);
    assert.equal(res.body.subscription.periodEnd, null);
    assert.deepEqual((await call(app, "POST", "/subscriptions", sc, { offerId })).body, { ok: false, error: "already-subscribed" });
    const [n] = await sql<{ body: string; kind: string }[]>`select kind, body from notifications where profile_id = ${tutor.profileId}`;
    assert.equal(n.kind, "subscription_requested");
    assert.match(n.body, /^Skander /);
    assert.doesNotMatch(n.body, /Ayari/);
  });

  test("own offer, a tutor account, a minor without consent: refused", async () => {
    const { tutor, offerId } = await tutorWithOffer();
    assert.deepEqual((await call(app, "POST", "/subscriptions", await login(tutor.profileId), { offerId })).body, { ok: false, error: "own-offer" });
    const other = await seedTutor();
    assert.deepEqual((await call(app, "POST", "/subscriptions", await login(other.profileId), { offerId })).body, { ok: false, error: "students-only" });
    const minor = await seedProfile({ role: "student", birthYear: new Date().getFullYear() - 15 });
    const before = process.env.ALLOW_MINORS;
    delete process.env.ALLOW_MINORS;
    try {
      assert.deepEqual((await call(app, "POST", "/subscriptions", await login(minor.id), { offerId })).body, { ok: false, error: "adults-only" });
    } finally {
      if (before !== undefined) process.env.ALLOW_MINORS = before;
    }
  });

  test("a monthly promotion lowers the price agreed and takes one use; cancelling the request gives it back", async () => {
    const { cookie, offerId } = await tutorWithOffer(4, 120);
    const p = await call(app, "POST", "/tutor/promotions", cookie, { percent: 10, scope: "monthly", endsAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    assert.equal(p.body.ok, true, p.raw);
    const student = await seedProfile({ role: "student" });
    const sc = await login(student.id);
    const res = await call(app, "POST", "/subscriptions", sc, { offerId });
    assert.equal(res.body.subscription.priceTnd, 108);
    const [{ uses }] = await sql<{ uses: number }[]>`select uses from promotions where id = ${p.body.promotion.id}`;
    assert.equal(uses, 1);
    assert.equal((await call(app, "POST", `/subscriptions/${res.body.subscription.id}/cancel`, sc)).body.ok, true);
    const [{ uses: after }] = await sql<{ uses: number }[]>`select uses from promotions where id = ${p.body.promotion.id}`;
    assert.equal(after, 0);
  });

  test("only THIS teacher confirms; it runs one month from confirmation", async () => {
    const { offerId, cookie } = await tutorWithOffer();
    const student = await seedProfile({ role: "student" });
    const sc = await login(student.id);
    const subId = (await call(app, "POST", "/subscriptions", sc, { offerId })).body.subscription.id;
    assert.deepEqual((await call(app, "POST", `/tutor/subscriptions/${subId}/confirm`, sc)).body, { ok: false, error: "not-found" }, "the student cannot");
    const stranger = await seedTutor();
    assert.deepEqual((await call(app, "POST", `/tutor/subscriptions/${subId}/confirm`, await login(stranger.profileId))).body, { ok: false, error: "not-found" });
    const res = await call(app, "POST", `/tutor/subscriptions/${subId}/confirm`, cookie);
    assert.equal(res.body.ok, true);
    const [row] = await sql<{ status: string; days: number }[]>`
      select status, extract(day from period_end - period_start)::int as days from student_subscriptions where id = ${subId}`;
    assert.equal(row.status, "active");
    assert.ok(row.days >= 28 && row.days <= 31, `one month: ${row.days} days`);
    assert.deepEqual((await call(app, "POST", `/tutor/subscriptions/${subId}/confirm`, cookie)).body, { ok: false, error: "not-requested" });
    const mine = await call(app, "GET", `/subscriptions/mine?slug=${(await sql<{ slug: string }[]>`select t.slug from tutors t join student_subscriptions s on s.tutor_id = t.id where s.id = ${subId}`)[0].slug}`, sc);
    assert.equal(mine.body.subscription.status, "active");
  });
});

describe("P5 · covered seats (C7)", () => {
  test("a subscriber's booking is covered up to the quota, then ordinary; cancelling gives the session back", async () => {
    const { tutor, sc, subId, student } = await activeSubscriber(2);
    const k1 = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    const k2 = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const k3 = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
    const b1 = await call(app, "POST", "/bookings", sc, { classId: k1.id });
    const b2 = await call(app, "POST", "/bookings", sc, { classId: k2.id });
    const b3 = await call(app, "POST", "/bookings", sc, { classId: k3.id });
    assert.deepEqual([b1.body.covered, b2.body.covered, b3.body.covered], [true, true, false]);
    assert.deepEqual([b1.body.priceTnd, b3.body.priceTnd], [0, 40]);
    const rows = await sql<{ class_id: string; subscription_id: string | null; seats_taken: number }[]>`
      select b.class_id, b.subscription_id, c.seats_taken from bookings b join classes c on c.id = b.class_id
       where b.student_id = ${student.id} order by c.scheduled_at`;
    assert.deepEqual(rows.map((r) => r.subscription_id), [subId, subId, null]);
    assert.deepEqual(rows.map((r) => r.seats_taken), [1, 1, 1], "covered or not, a seat is a seat");

    // Cancel a covered seat: the session comes back, and the ledger values it at 0.
    const [first] = await sql<{ id: string }[]>`select id from bookings where class_id = ${k1.id} and student_id = ${student.id}`;
    await call(app, "POST", "/bookings/cancel", sc, { bookingId: first.id });
    const [led] = await sql<{ amount_tnd: string }[]>`select amount_tnd from cancellations where booking_id = ${first.id}`;
    assert.equal(Number(led.amount_tnd), 0);
    const k4 = await seedClass({ tutorId: tutor.id, hoursFromNow: 120 });
    assert.equal((await call(app, "POST", "/bookings", sc, { classId: k4.id })).body.covered, true);
    const mine = await call(app, "GET", `/subscriptions/mine?slug=${tutor.slug}`, sc);
    assert.equal(mine.body.subscription.usedThisPeriod, 2);
  });

  test("not covered: another teacher's class, a class after period_end, a paused subscription", async () => {
    const { tutor, sc, subId, cookie } = await activeSubscriber(5);
    const other = await seedTutor();
    const elsewhere = await seedClass({ tutorId: other.id });
    assert.equal((await call(app, "POST", "/bookings", sc, { classId: elsewhere.id })).body.covered, false);
    const late = await seedClass({ tutorId: tutor.id, hoursFromNow: 24 * 40 });
    assert.equal((await call(app, "POST", "/bookings", sc, { classId: late.id })).body.covered, false, "after the paid month");
    await call(app, "POST", `/tutor/subscriptions/${subId}/pause`, cookie);
    const k = await seedClass({ tutorId: tutor.id });
    assert.equal((await call(app, "POST", "/bookings", sc, { classId: k.id })).body.covered, false, "paused");
  });

  test("two simultaneous bookings for the last session: exactly one is covered", async () => {
    const { tutor, sc } = await activeSubscriber(1);
    const a = await seedClass({ tutorId: tutor.id, hoursFromNow: 50 });
    const b = await seedClass({ tutorId: tutor.id, hoursFromNow: 60 });
    const [ra, rb] = await Promise.all([
      call(app, "POST", "/bookings", sc, { classId: a.id }),
      call(app, "POST", "/bookings", sc, { classId: b.id }),
    ]);
    assert.deepEqual([ra.body.covered, rb.body.covered].sort(), [false, true]);
  });
});

describe("P5 · the nightly sweep, renewal, pause and cancel", () => {
  const capture = () => {
    const sent: { to: string; headers?: Record<string, string>; text: string }[] = [];
    const send: MailSender = async (to, _s, text, extras) => {
      sent.push({ to, headers: extras?.headers, text });
      return true;
    };
    return { sent, send };
  };

  test("3 days before the end: one reminder (in-app both sides + e-mail with one-click unsubscribe), never twice", async () => {
    const { subId, student, tutor } = await activeSubscriber();
    await sql`update student_subscriptions set period_end = now() + interval '2 days' where id = ${subId}`;
    const { sent, send } = capture();
    await runSubscriptionJobs(db, { send });
    await runSubscriptionJobs(db, { send });
    const mail = sent.filter((m) => m.to === student.email);
    assert.equal(mail.length, 1);
    assert.equal(mail[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(mail[0].text, /Paiement en ligne bientôt/);
    const kinds = await sql<{ profile_id: string }[]>`select profile_id from notifications where kind = 'subscription_ending' and profile_id in ${sql([student.id, tutor.profileId])}`;
    assert.equal(kinds.length, 2);
  });

  test("past period_end → expired; seats are ordinary again; one click renews it for a month", async () => {
    const { subId, sc, tutor, cookie } = await activeSubscriber();
    await sql`update student_subscriptions set period_start = now() - interval '40 days', period_end = now() - interval '1 hour' where id = ${subId}`;
    const r = await runSubscriptionJobs(db, { send: async () => true });
    assert.ok(r.expired >= 1);
    const [{ status }] = await sql<{ status: string }[]>`select status from student_subscriptions where id = ${subId}`;
    assert.equal(status, "expired");
    const k = await seedClass({ tutorId: tutor.id });
    assert.equal((await call(app, "POST", "/bookings", sc, { classId: k.id })).body.covered, false);

    const renew = await call(app, "POST", `/tutor/subscriptions/${subId}/renew`, cookie);
    assert.equal(renew.body.ok, true, renew.raw);
    const [row] = await sql<{ status: string; fresh: boolean }[]>`
      select status, period_start > now() - interval '1 minute' as fresh from student_subscriptions where id = ${subId}`;
    assert.deepEqual({ ...row }, { status: "active", fresh: true });
  });

  test("renewing a running month adds a month to its end (windows stay aligned) and re-arms the reminder", async () => {
    const { subId, cookie } = await activeSubscriber();
    await sql`update student_subscriptions set reminder_sent_for = period_end where id = ${subId}`;
    const [before] = await sql<{ end: string }[]>`select period_end::text as end from student_subscriptions where id = ${subId}`;
    await call(app, "POST", `/tutor/subscriptions/${subId}/renew`, cookie);
    const [row] = await sql<{ ok: boolean; reminder: string | null }[]>`
      select period_end = ${before.end}::timestamptz + interval '1 month' as ok, reminder_sent_for::text as reminder
        from student_subscriptions where id = ${subId}`;
    assert.equal(row.ok, true);
    assert.equal(row.reminder, null);
  });

  test("pause → resume; the student cancels and the teacher is told", async () => {
    const { subId, cookie, sc, tutor } = await activeSubscriber();
    assert.equal((await call(app, "POST", `/tutor/subscriptions/${subId}/pause`, cookie)).body.ok, true);
    assert.equal((await call(app, "POST", `/tutor/subscriptions/${subId}/resume`, cookie)).body.status, "active");
    assert.equal((await call(app, "POST", `/subscriptions/${subId}/cancel`, sc)).body.ok, true);
    assert.deepEqual((await call(app, "POST", `/subscriptions/${subId}/cancel`, sc)).body, { ok: true, already: true });
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${tutor.profileId} and kind = 'subscription_cancelled'`;
    assert.equal(n.n, 1);
  });

  test("Mes élèves: an active subscriber carries the 'subscriber' relation (a request does not)", async () => {
    const { cookie, offerId } = await activeSubscriber();
    const asker = await seedProfile({ role: "student", fullName: "Ines Ayed" });
    await call(app, "POST", "/subscriptions", await login(asker.id), { offerId });
    const res = await call(app, "GET", "/tutor/students", cookie);
    const rows = res.body as { name: string; relations: string[]; status: string }[];
    assert.deepEqual(rows.find((r) => r.name === "Nour")?.relations, ["subscriber"]);
    assert.equal(rows.find((r) => r.name === "Ines"), undefined, "a request is not a subscriber yet");
  });

  test("the teacher's list: first names only, the quota used, expiring soon", async () => {
    const { subId, cookie } = await activeSubscriber();
    await sql`update student_subscriptions set period_end = now() + interval '5 days' where id = ${subId}`;
    const res = await call(app, "GET", "/tutor/subscriptions", cookie);
    const row = res.body.rows.find((r: { id: string }) => r.id === subId);
    assert.equal(row.studentFirstName, "Nour");
    assert.equal(row.expiringSoon, true);
    assert.doesNotMatch(res.raw, /Gharbi|@tnajem\.invalid/);
  });

  test("dry-run changes nothing", async () => {
    const { subId } = await activeSubscriber();
    await sql`update student_subscriptions set period_end = now() - interval '1 minute', period_start = now() - interval '31 days' where id = ${subId}`;
    await runSubscriptionJobs(db, { dryRun: true });
    const [{ status }] = await sql<{ status: string }[]>`select status from student_subscriptions where id = ${subId}`;
    assert.equal(status, "active");
  });
});
