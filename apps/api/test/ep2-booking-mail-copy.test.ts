import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CANCEL_FREE_WINDOW_HOURS, LATE_CANCEL_RETAINED_PCT, MONTHLY_PAYMENT_NOTE } from "@tnajem/shared";
import { BOOKING_MAIL, mailLocale, type Coverage, type MailClass } from "../src/lib/booking-mail-copy";

/* espace prof v2 · pro (P7) — the booking emails say only what is true.

   Payments are OFF: a price is a price, the online payment is "bientôt", and the
   money is settled with the tutor outside Tnajem. The cancellation rule is the one
   the API enforces. FR and AR carry the same messages (same keys). */

const cls: MailClass = { title: "Bac — fonctions", tutorName: "Mohamed B.", date: "02/10/2026", time: "18:00", durationMin: 90 };
const links = { liveUrl: "https://tnajem.com/fr/live/c1", calendarUrl: "https://tnajem.com/api/calendar/b1?l=fr", spaceUrl: "https://tnajem.com/fr/student" };
const coverages: Coverage[] = [{ kind: "paid", priceTnd: 40 }, { kind: "zero" }, { kind: "free" }, { kind: "subscription" }];

const SOON = { fr: "bientôt", ar: "قريب" } as const;
const OUTSIDE = { fr: "hors Tnajem", ar: "برّا Tnajem" } as const;
// What must never be claimed while payments are off.
const FALSE_MONEY = /\bpayé\b|paiement (effectué|reçu)|carte bancaire|débité|tkhalset|تخلّصت/i;

describe("ep2 · booking mail copy", () => {
  test("FR and AR have exactly the same keys", () => {
    assert.deepEqual(Object.keys(BOOKING_MAIL.fr).sort(), Object.keys(BOOKING_MAIL.ar).sort());
  });

  test("the recipient's stored language picks the copy; anything else is French", () => {
    assert.equal(mailLocale("ar"), "ar");
    assert.equal(mailLocale("fr"), "fr");
    assert.equal(mailLocale(null), "fr");
    assert.equal(mailLocale("en"), "fr");
  });

  for (const loc of ["fr", "ar"] as const) {
    test(`${loc}: a paid seat says the price and the ONE payment sentence (MONTHLY_PAYMENT_NOTE); the tutor reads « hors Tnajem »`, () => {
      const m = BOOKING_MAIL[loc].studentConfirmed({ first: "Sami", cls, coverage: { kind: "paid", priceTnd: 40 }, ...links });
      assert.ok(m.text.includes("40"), m.text);
      assert.ok(m.text.includes(MONTHLY_PAYMENT_NOTE[loc]), m.text);
      const t = BOOKING_MAIL[loc].tutorNewBooking({ first: "Mohamed", cls, student: "Sami", coverage: { kind: "paid", priceTnd: 40 }, seatsTaken: 1, seats: 5, liveUrl: links.liveUrl, dashboardUrl: "https://tnajem.com/fr/dashboard/classes" });
      assert.ok(t.text.includes(SOON[loc]) && t.text.includes(OUTSIDE[loc]), t.text);
    });

    test(`${loc}: one payment story (D4) — "pay your tutor directly" only inside MONTHLY_PAYMENT_NOTE`, () => {
      const texts: string[] = [];
      for (const coverage of coverages) {
        texts.push(BOOKING_MAIL[loc].studentConfirmed({ cls, coverage, ...links }).text);
        texts.push(BOOKING_MAIL[loc].tutorNewBooking({ cls, student: "Sami", coverage, seatsTaken: 1, seats: 5, liveUrl: links.liveUrl, dashboardUrl: "x" }).text);
      }
      for (const text of texts) {
        const rest = text.split(MONTHLY_PAYMENT_NOTE[loc]).join(" ");
        assert.equal(/directement|te paie(nt)? directement|en main propre|مباشرة|يد بيد/.test(rest), false, rest);
      }
    });

    test(`${loc}: no email claims a payment happened`, () => {
      for (const coverage of coverages) {
        const texts = [
          BOOKING_MAIL[loc].studentConfirmed({ cls, coverage, ...links }).text,
          BOOKING_MAIL[loc].tutorNewBooking({ cls, student: "Sami", coverage, seatsTaken: 1, seats: 5, liveUrl: links.liveUrl, dashboardUrl: "x" }).text,
        ];
        for (const text of texts) assert.equal(FALSE_MONEY.test(text), false, text);
      }
    });

    test(`${loc}: the cancellation rule is the enforced one (${CANCEL_FREE_WINDOW_HOURS} h, ${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} % noted)`, () => {
      const m = BOOKING_MAIL[loc].studentConfirmed({ cls, coverage: { kind: "paid", priceTnd: 40 }, ...links });
      assert.ok(m.text.includes(String(CANCEL_FREE_WINDOW_HOURS)), m.text);
      assert.ok(m.text.includes(`${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %`), m.text);
      // A free first session retains nothing: no percentage is quoted for it.
      const free = BOOKING_MAIL[loc].studentConfirmed({ cls, coverage: { kind: "free" }, ...links });
      assert.equal(free.text.includes(`${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %`), false, free.text);
    });

    test(`${loc}: the confirmation links the live PAGE and the calendar, both given by the caller`, () => {
      const m = BOOKING_MAIL[loc].studentConfirmed({ cls, coverage: { kind: "free" }, ...links });
      assert.ok(m.text.includes(links.liveUrl));
      assert.ok(m.text.includes(links.calendarUrl));
      assert.equal(/meet\.jit\.si|zoom\.us|meet\.google/.test(m.text), false);
    });

    test(`${loc}: a late cancellation reports the noted amount, never a debit`, () => {
      const m = BOOKING_MAIL[loc].studentCancelled({ cls, outcome: { late: true, waived: false, wasFree: false, retainedTnd: 16 }, spaceUrl: "s", exploreUrl: "e" });
      assert.ok(m.text.includes("16"), m.text);
      assert.equal(FALSE_MONEY.test(m.text), false, m.text);
      const waived = BOOKING_MAIL[loc].studentCancelled({ cls, outcome: { late: true, waived: true, wasFree: false, retainedTnd: 0 }, spaceUrl: "s", exploreUrl: "e" });
      assert.equal(waived.text.includes("16"), false);
    });

    test(`${loc}: the unsubscribe line appears only when a link is given`, () => {
      const without = BOOKING_MAIL[loc].reviewPrompt({ cls, reviewUrl: "r" });
      const withLink = BOOKING_MAIL[loc].reviewPrompt({ cls, reviewUrl: "r", unsubscribeUrl: "https://tnajem.com/u/x" });
      assert.equal(without.text.includes("https://tnajem.com/u/x"), false);
      assert.ok(withLink.text.includes("https://tnajem.com/u/x"));
    });

    test(`${loc}: every subject names the class`, () => {
      const c = BOOKING_MAIL[loc];
      const subjects = [
        c.studentConfirmed({ cls, coverage: { kind: "zero" }, ...links }).subject,
        c.tutorNewBooking({ cls, student: "S", coverage: { kind: "zero" }, seatsTaken: 1, seats: 1, liveUrl: "l", dashboardUrl: "d" }).subject,
        c.studentCancelled({ cls, outcome: { late: false, waived: false, wasFree: false, retainedTnd: 0 }, spaceUrl: "s", exploreUrl: "e" }).subject,
        c.tutorStudentCancelled({ cls, student: "S", late: false, dashboardUrl: "d" }).subject,
        c.studentClassCancelled({ cls, spaceUrl: "s", exploreUrl: "e" }).subject,
        c.tutorClassCancelled({ cls, notified: 2, dashboardUrl: "d" }).subject,
        c.studentClassMoved({ cls, liveUrl: "l", spaceUrl: "s" }).subject,
        c.studentReminder({ cls, step: "24h", liveUrl: "l", spaceUrl: "s" }).subject,
        c.studentReminder({ cls, step: "1h", liveUrl: "l", spaceUrl: "s" }).subject,
        c.tutorReminder({ cls, step: "1h", booked: 3, liveUrl: "l", dashboardUrl: "d" }).subject,
        c.reviewPrompt({ cls, reviewUrl: "r" }).subject,
      ];
      for (const s of subjects) assert.ok(s.includes(cls.title), s);
    });
  }
});
