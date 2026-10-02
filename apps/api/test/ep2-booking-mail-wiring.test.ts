import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { MailExtras } from "@tnajem/shared/mail";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App } from "./support/fx";
import { setMailDeliveryForTests, settleMail } from "../src/lib/booking-mail";

/* espace prof v2 · pro (P7) — the booking emails, driven through the REAL routes.

   POST /bookings, /bookings/cancel, /classes/:id/cancel and /classes/:id/reschedule
   each send their emails after the commit (dispatchMail). Covered seats (C7) and
   promotion prices (C6) are stated truthfully, the "bookings" preference (C5) is
   respected, and every email carries the one-click unsubscribe link + headers.
   Mail is captured by the test seam; assertions use this file's addresses only. */

type Sent = { to: string; subject: string; text: string; extras?: MailExtras };
const outbox: Sent[] = [];
let app: App;

before(async () => {
  app = await startApp();
  setMailDeliveryForTests(async (to, subject, text, extras) => {
    outbox.push({ to, subject, text, extras });
    return true;
  });
});
after(async () => {
  setMailDeliveryForTests(null);
  await stopApp(app);
});
beforeEach(() => {
  outbox.length = 0;
});

const to = (email: string) => outbox.filter((m) => m.to === email);
const icsOf = (m: Sent) => String(m.extras?.attachments?.[0]?.content ?? "");

async function setup(opts: { price?: string } = {}) {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Mohamed Ben Ali", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "Mohamed Ben Ali" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, seats: 5 });
  if (opts.price) await sql`update classes set price_tnd = ${opts.price} where id = ${klass.id}`;
  const student = await seedProfile({ role: "student", fullName: "Sami T" });
  return { tutorProfile, tutor, klass, student, studentCookie: await login(student.id), tutorCookie: await login(tutorProfile.id) };
}

async function book(s: Awaited<ReturnType<typeof setup>>, body: Record<string, unknown> = {}) {
  const res = await call(app, "POST", "/bookings", s.studentCookie, { classId: s.klass.id, ...body });
  assert.equal(res.body.ok, true, res.raw);
  await settleMail();
  return res.body;
}

describe("ep2 · POST /bookings sends the confirmations", () => {
  test("student + tutor, with the .ics, the unsubscribe link and List-Unsubscribe headers", async () => {
    const s = await setup();
    await book(s);
    const [st] = to(s.student.email);
    assert.ok(st, "student email");
    assert.match(st.subject, /^Place réservée/);
    assert.ok(st.text.includes("Prix : 40 TND. Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof."), st.text);
    assert.ok(icsOf(st).includes("METHOD:PUBLISH"));
    assert.ok(/\/api\/email\/unsubscribe\?token=/.test(st.text), "one-click unsubscribe in the footer");
    assert.equal(st.extras?.headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.match(st.extras?.headers?.["List-Unsubscribe"] ?? "", /^<https?:\/\/.+\/api\/email\/unsubscribe\?token=/);
    assert.equal(to(s.tutorProfile.email).length, 1, "tutor email");
  });

  test("a seat covered by the monthly subscription (C7) says so — no price, counts in the month", async () => {
    const s = await setup();
    const [offer] = await sql<{ id: string }[]>`
      insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month)
      values (${s.tutor.id}, 'FX mensuel', 4, '120') returning id`;
    await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end, confirmed_at)
              values (${offer.id}, ${s.tutor.id}, ${s.student.id}, 'active', 4, '120', now() - interval '1 day', now() + interval '29 days', now())`;
    const res = await book(s);
    assert.equal(res.covered, true, JSON.stringify(res));
    const st = to(s.student.email)[0];
    assert.ok(st.text.includes("comprise dans ton abonnement mensuel"), st.text);
    assert.equal(/Prix : \d/.test(st.text), false, "no per-seat price for a covered seat");
    assert.ok(st.text.includes("la séance revient dans ton abonnement du mois"), st.text);
    assert.ok(to(s.tutorProfile.email)[0].text.includes("comprise dans son abonnement mensuel"));

    // Cancelled: nothing retained, the session goes back to the month.
    const [bk] = await sql<{ id: string }[]>`select id from bookings where class_id = ${s.klass.id} and student_id = ${s.student.id}`;
    outbox.length = 0;
    await call(app, "POST", "/bookings/cancel", s.studentCookie, { bookingId: bk.id });
    await settleMail();
    assert.ok(to(s.student.email)[0].text.includes("la séance revient dans ton abonnement du mois"));
  });

  test("a promotion price (C6) is the price booked, with the percent and the list price", async () => {
    const s = await setup();
    await sql`insert into promotions (tutor_id, percent, scope, starts_at, ends_at)
              values (${s.tutor.id}, 20, 'all', now() - interval '1 hour', now() + interval '10 days')`;
    const res = await book(s);
    assert.equal(res.priceTnd, 32, JSON.stringify(res));
    const st = to(s.student.email)[0];
    assert.ok(st.text.includes("Prix : 32 TND (−20 % sur 40 TND)."), st.text);
    assert.ok(to(s.tutorProfile.email)[0].text.includes("(32 TND (−20 % sur 40 TND))"));
  });

  test("Arabic: the promotion percent is bidi-isolated, so it cannot read « % 20− »", async () => {
    const s = await setup();
    await sql`update profiles set locale = 'ar' where id = ${s.student.id}`;
    await sql`insert into promotions (tutor_id, percent, scope, starts_at, ends_at)
              values (${s.tutor.id}, 20, 'all', now() - interval '1 hour', now() + interval '10 days')`;
    await book(s);
    const st = to(s.student.email)[0];
    assert.ok(st.text.includes("⁦−20 %⁩"), st.text);
    assert.ok(st.text.includes("32 د.ت"), st.text);
  });

  test("the student turned 'bookings' emails off (C5): no confirmation for them, the tutor still gets theirs", async () => {
    const s = await setup();
    await sql`insert into notification_prefs (profile_id, bookings) values (${s.student.id}, false)`;
    await book(s);
    assert.equal(to(s.student.email).length, 0);
    assert.equal(to(s.tutorProfile.email).length, 1);
  });

  test("the tutor turned 'bookings' off: no new-booking or cancellation notice; 'reminders' off alone changes nothing here", async () => {
    const s = await setup();
    await sql`insert into notification_prefs (profile_id, bookings) values (${s.tutorProfile.id}, false)`;
    await book(s);
    assert.equal(to(s.tutorProfile.email).length, 0);
    const [bk] = await sql<{ id: string }[]>`select id from bookings where class_id = ${s.klass.id} and student_id = ${s.student.id}`;
    await call(app, "POST", "/bookings/cancel", s.studentCookie, { bookingId: bk.id });
    await settleMail();
    assert.equal(to(s.tutorProfile.email).length, 0);

    const t = await setup();
    await sql`insert into notification_prefs (profile_id, reminders) values (${t.tutorProfile.id}, false)`;
    await book(t);
    assert.equal(to(t.tutorProfile.email).length, 1, "a booking notice follows 'bookings', not 'reminders'");
  });
});

describe("ep2 · cancellations and moves send their emails", () => {
  test("POST /bookings/cancel: the student's CANCEL .ics and the tutor's notice", async () => {
    const s = await setup();
    await book(s);
    const [bk] = await sql<{ id: string }[]>`select id from bookings where class_id = ${s.klass.id} and student_id = ${s.student.id}`;
    outbox.length = 0;
    const res = await call(app, "POST", "/bookings/cancel", s.studentCookie, { bookingId: bk.id });
    assert.equal(res.body.ok, true, res.raw);
    await settleMail();
    const st = to(s.student.email)[0];
    assert.match(st.subject, /^Réservation annulée/);
    assert.ok(st.text.includes("Tu as annulé à temps : rien n'est retenu."), st.text);
    assert.ok(icsOf(st).includes("METHOD:CANCEL") && icsOf(st).includes(`UID:booking-${bk.id}@`));
    assert.match(to(s.tutorProfile.email)[0].subject, /^Annulation/);
  });

  test("POST /classes/:id/cancel by the tutor: the student and the tutor", async () => {
    const s = await setup();
    await book(s);
    outbox.length = 0;
    const res = await call(app, "POST", `/classes/${s.klass.id}/cancel`, s.tutorCookie, {});
    assert.equal(res.body.ok, true, res.raw);
    await settleMail();
    assert.ok(to(s.student.email)[0].text.includes("Tu ne dois rien."));
    assert.ok(icsOf(to(s.student.email)[0]).includes("METHOD:CANCEL"));
    assert.ok(to(s.tutorProfile.email)[0].text.includes("L'élève inscrit est prévenu"));
  });

  test("POST /classes/:id/reschedule: the new time and an updated .ics", async () => {
    const s = await setup();
    await book(s);
    outbox.length = 0;
    const at = new Date(Date.now() + 5 * 24 * 3600_000).toISOString();
    const res = await call(app, "POST", `/classes/${s.klass.id}/reschedule`, s.tutorCookie, { scheduledAt: at });
    assert.equal(res.body.ok, true, res.raw);
    await settleMail();
    const st = to(s.student.email)[0];
    assert.match(st.subject, /^Séance déplacée/);
    assert.ok(st.text.includes("tu peux annuler sans frais"));
    assert.ok(icsOf(st).includes("METHOD:PUBLISH"));
  });
});
