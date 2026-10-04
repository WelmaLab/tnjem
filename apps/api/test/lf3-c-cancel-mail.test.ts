import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CANCEL_GRACE_MINUTES, LATE_CANCEL_RETAINED_PCT } from "@tnajem/shared";
import { BOOKING_MAIL, type Coverage, type MailClass } from "../src/lib/booking-mail-copy";

/* live-fixes-3 · C — the booking e-mails state the 15-minute grace.

   The confirmation states the cancellation rule, so it now says that a change of
   mind within 15 min of booking is always free (where a late cancel could cost
   something: a paid seat, or the free first session). A cancellation inside the
   grace is reported as free, with the reason; the tutor is not told « tardive ». */

const cls: MailClass = { title: "Bac — fonctions", tutorName: "Mohamed B.", date: "05/10/2026", time: "18:00", durationMin: 90 };
const links = { liveUrl: "https://tnajem.com/fr/live/c1", calendarUrl: "https://tnajem.com/api/calendar/b1?l=fr", spaceUrl: "https://tnajem.com/fr/student" };
const PCT = `${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %`;
const GRACE = { fr: `Dans les ${CANCEL_GRACE_MINUTES} min qui suivent ta réservation`, ar: `في الـ${CANCEL_GRACE_MINUTES} دقيقة اللي بعد الحجز` } as const;
const FREE = { fr: "rien n'est retenu", ar: "حتى شي ما يتحسب" } as const;
const LATE = { fr: "Annulation tardive", ar: "إلغاء متأخّر" } as const;

describe("lf3 · C · the grace in the booking e-mails", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`${loc}: the confirmation states the grace for a paid seat and a free first session, not where nothing can be retained`, () => {
      const with_: Coverage[] = [{ kind: "paid", priceTnd: 40 }, { kind: "free" }];
      const without: Coverage[] = [{ kind: "zero" }, { kind: "subscription" }];
      for (const coverage of with_) {
        const t = BOOKING_MAIL[loc].studentConfirmed({ cls, coverage, ...links }).text;
        assert.ok(t.includes(GRACE[loc]), t);
      }
      for (const coverage of without) {
        const t = BOOKING_MAIL[loc].studentConfirmed({ cls, coverage, ...links }).text;
        assert.equal(t.includes(GRACE[loc]), false, t);
      }
    });

    test(`${loc}: a cancellation inside the grace is reported as free, with the reason — no amount, no 40 %`, () => {
      const t = BOOKING_MAIL[loc].studentCancelled({
        cls, outcome: { late: true, waived: false, wasFree: false, retainedTnd: 0, grace: true }, spaceUrl: "s", exploreUrl: "e",
      }).text;
      assert.ok(t.includes(FREE[loc]), t);
      assert.ok(t.includes(String(CANCEL_GRACE_MINUTES)), t);
      assert.equal(t.includes(PCT), false, t);
    });

    test(`${loc}: a free first seat cancelled inside the grace is not said to be « utilisée »`, () => {
      const t = BOOKING_MAIL[loc].studentCancelled({
        cls, outcome: { late: true, waived: false, wasFree: true, retainedTnd: 0, grace: true }, spaceUrl: "s", exploreUrl: "e",
      }).text;
      assert.equal(/utilisée|مستعملة/.test(t), false, t);
    });

    test(`${loc}: the tutor's notice says « tardive » only when it was (the sender passes late && !grace)`, () => {
      const late = BOOKING_MAIL[loc].tutorStudentCancelled({ cls, student: "Sami", late: true, dashboardUrl: "d" }).text;
      const grace = BOOKING_MAIL[loc].tutorStudentCancelled({ cls, student: "Sami", late: false, dashboardUrl: "d" }).text;
      assert.ok(late.includes(LATE[loc]), late);
      assert.equal(grace.includes(LATE[loc]), false, grace);
    });
  }
});
