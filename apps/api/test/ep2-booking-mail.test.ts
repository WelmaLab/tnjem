import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { MailExtras } from "@tnajem/shared/mail";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, sql, type App } from "./support/fx";
import {
  mailBookingConfirmed, mailBookingCancelled, mailClassCancelled, mailClassMoved,
  setMailDeliveryForTests, dispatchMail, settleMail, siteUrl, coverageOf,
} from "../src/lib/booking-mail";

/* espace prof v2 · pro (P7) — the booking emails, sent for real rows.

   No SMTP in a lane or in CI: delivery is captured through the test seam
   (setMailDeliveryForTests). Every assertion is about OUR fixtures' addresses —
   other test files share the database. */

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

const H = 3_600_000;
const to = (email: string) => outbox.filter((m) => m.to === email);
const ics = (m: Sent) => {
  const a = m.extras?.attachments?.[0];
  return a ? { body: String(a.content), type: a.contentType, name: a.filename } : null;
};

async function booked(opts: { studentLocale?: "fr" | "ar"; isFree?: boolean; price?: string } = {}) {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Mohamed Ben Ali", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "Mohamed Ben Ali" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, seats: 5, seatsTaken: 1 });
  if (opts.price !== undefined) await sql`update classes set price_tnd = ${opts.price} where id = ${klass.id}`;
  const student = await seedProfile({ role: "student", fullName: "Sami Trabelsi" });
  if (opts.studentLocale) await sql`update profiles set locale = ${opts.studentLocale} where id = ${student.id}`;
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: opts.isFree });
  return { tutorProfile, tutor, klass, student, booking };
}

describe("ep2 · booking confirmation", () => {
  test("student and tutor each get one email; the student's carries a PUBLISH .ics for their booking", async () => {
    const f = await booked();
    const res = await mailBookingConfirmed(f.booking.id);
    assert.deepEqual(res, { student: "sent", tutor: "sent" });

    const [s] = to(f.student.email);
    assert.ok(s, "student email");
    assert.match(s.subject, /^Place réservée : « FX Class /);
    assert.ok(s.text.startsWith("Bonjour Sami,"), s.text);
    assert.ok(s.text.includes("Mohamed B."), "the tutor's public name");
    assert.equal(s.text.includes("Ben Ali"), false, "never the tutor's last name");
    assert.ok(s.text.includes(`${siteUrl()}/fr/live/${f.klass.id}`), "the Tnajem live page");
    assert.ok(s.text.includes(`${siteUrl()}/api/calendar/${f.booking.id}?l=fr`), "the calendar link");
    assert.equal(/meet\.jit\.si|room_token/.test(s.text), false, "never the room itself");
    const a = ics(s)!;
    assert.equal(a.type, "text/calendar; charset=utf-8; method=PUBLISH");
    assert.equal(a.name, "tnajem-seance.ics");
    assert.ok(a.body.includes(`UID:booking-${f.booking.id}@`));
    assert.ok(a.body.includes("METHOD:PUBLISH"));

    const [t] = to(f.tutorProfile.email);
    assert.ok(t, "tutor email");
    assert.match(t.subject, /^Nouvelle réservation/);
    assert.ok(t.text.includes("Sami a réservé"), "the student's first name");
    assert.equal(t.text.includes("Trabelsi"), false, "never the student's last name");
    assert.ok(t.text.includes("Places réservées : 1 sur 5."), t.text);
    assert.ok(ics(t)!.body.includes(`UID:class-${f.klass.id}@`), "one calendar entry per class for the tutor");
  });

  test("the student's stored language is the email's language (AR)", async () => {
    const f = await booked({ studentLocale: "ar" });
    await mailBookingConfirmed(f.booking.id);
    const [s] = to(f.student.email);
    assert.match(s.subject, /^بلاصتك محجوزة/);
    assert.ok(s.text.includes(`${siteUrl()}/ar/live/${f.klass.id}`));
    assert.ok(ics(s)!.body.includes("SUMMARY:FX Class"), "Arabic summary keeps the title");
    // The tutor keeps French: each recipient gets their own language.
    assert.match(to(f.tutorProfile.email)[0].subject, /^Nouvelle réservation/);
  });

  test("a free first session says so; a paid seat says the price and the one payment sentence", async () => {
    const free = await booked({ isFree: true });
    await mailBookingConfirmed(free.booking.id);
    assert.ok(to(free.student.email)[0].text.includes("séance offerte"));
    const paid = await booked();
    await mailBookingConfirmed(paid.booking.id);
    const text = to(paid.student.email)[0].text;
    assert.ok(text.includes("Prix : 40 TND. Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof."), text);
  });

  test("no address on file → nothing sent to that person, the other still gets theirs", async () => {
    const f = await booked();
    await sql`update profiles set email = null where id = ${f.student.id}`;
    const res = await mailBookingConfirmed(f.booking.id);
    assert.deepEqual(res, { student: "skipped", tutor: "sent" });
  });

  test("a cancelled booking is not confirmed", async () => {
    const f = await booked();
    await sql`update bookings set status = 'cancelled' where id = ${f.booking.id}`;
    assert.deepEqual(await mailBookingConfirmed(f.booking.id), { student: "skipped", tutor: "skipped" });
  });

  test("dispatchMail runs after the caller returns, and settleMail waits for it", async () => {
    const f = await booked();
    dispatchMail("booking-confirmed", () => mailBookingConfirmed(f.booking.id));
    await settleMail();
    assert.equal(to(f.student.email).length, 1);
  });
});

describe("ep2 · cancellations and moves", () => {
  test("the student's cancellation carries METHOD:CANCEL for the same UID; the tutor is told", async () => {
    const f = await booked();
    await mailBookingCancelled(f.booking.id, { late: true, waived: false, wasFree: false, retainedTnd: 16 });
    const [s] = to(f.student.email);
    assert.match(s.subject, /^Réservation annulée/);
    assert.ok(s.text.includes("16 TND sont notés comme retenus"), s.text);
    assert.ok(s.text.includes("Rien n'est prélevé pendant le pilote"), s.text);
    const a = ics(s)!;
    assert.equal(a.type, "text/calendar; charset=utf-8; method=CANCEL");
    assert.ok(a.body.includes("METHOD:CANCEL") && a.body.includes("STATUS:CANCELLED"));
    assert.ok(a.body.includes(`UID:booking-${f.booking.id}@`));
    const [t] = to(f.tutorProfile.email);
    assert.ok(t.text.includes("Annulation tardive"), t.text);
  });

  test("a class called off by its tutor: each student (CANCEL .ics) and the tutor", async () => {
    const f = await booked();
    const other = await seedProfile({ role: "student", fullName: "Ines K" });
    const b2 = await seedBooking({ classId: f.klass.id, studentId: other.id });
    const res = await mailClassCancelled(f.klass.id, [f.booking.id, b2.id], { tutorDidIt: true });
    assert.deepEqual(res, { students: 2, tutor: "sent" });
    assert.ok(to(f.student.email)[0].text.includes("Tu ne dois rien"));
    assert.ok(ics(to(other.email)[0])!.body.includes(`UID:booking-${b2.id}@`));
    const t = to(f.tutorProfile.email)[0];
    assert.ok(t.text.includes("Les 2 élèves inscrits sont prévenus"), t.text);
    assert.ok(ics(t)!.body.includes(`UID:class-${f.klass.id}@`) && ics(t)!.body.includes("METHOD:CANCEL"));
  });

  test("a class called off by the platform does not mail the tutor", async () => {
    const f = await booked();
    const res = await mailClassCancelled(f.klass.id, [f.booking.id], { tutorDidIt: false });
    assert.deepEqual(res, { students: 1, tutor: "skipped" });
  });

  test("a moved class re-sends the same UID with a higher SEQUENCE and the new time", async () => {
    const f = await booked();
    await mailBookingConfirmed(f.booking.id);
    const seq = (body: string) => Number(/SEQUENCE:(\d+)/.exec(body)![1]);
    const before = seq(ics(to(f.student.email)[0])!.body);
    outbox.length = 0;
    await new Promise((r) => setTimeout(r, 1100)); // SEQUENCE has one-second resolution
    await sql`update classes set scheduled_at = scheduled_at + interval '1 day', rescheduled_at = now() where id = ${f.klass.id}`;
    assert.deepEqual(await mailClassMoved(f.klass.id), { students: 1 });
    const m = to(f.student.email)[0];
    assert.match(m.subject, /^Séance déplacée/);
    assert.ok(seq(ics(m)!.body) > before, "SEQUENCE grows");
    assert.ok(ics(m)!.body.includes(`UID:booking-${f.booking.id}@`));
  });
});

describe("ep2 · coverage", () => {
  test("subscription > free > paid > zero", () => {
    assert.deepEqual(coverageOf({ isFree: true, priceTnd: "40", subscriptionId: "s1" }), { kind: "subscription" });
    assert.deepEqual(coverageOf({ isFree: true, priceTnd: "40" }), { kind: "free" });
    assert.deepEqual(coverageOf({ isFree: false, priceTnd: "40.00" }), { kind: "paid", priceTnd: 40, promo: null });
    assert.deepEqual(coverageOf({ isFree: false, priceTnd: "0" }), { kind: "zero" });
  });

  test("the price BOOKED wins over the list price, with its promotion", () => {
    assert.deepEqual(
      coverageOf({ isFree: false, priceTnd: "40.00", bookedPriceTnd: "32.00", promotionPercent: 20 }),
      { kind: "paid", priceTnd: 32, promo: { percent: 20, listTnd: 40 } },
    );
    // A booking written before 0035 has no recorded price: the list price, no promo.
    assert.deepEqual(coverageOf({ isFree: false, priceTnd: "40", bookedPriceTnd: null }), { kind: "paid", priceTnd: 40, promo: null });
  });
});
