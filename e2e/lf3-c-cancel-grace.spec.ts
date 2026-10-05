import { test, expect, type Browser, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking, backdateBooking } from "./support/seed";
import { loginAs } from "./support/session";
import { CANCEL_GRACE_MINUTES, tunisClock } from "@tnajem/shared";

/* live-fixes-3 · C — cancelling right after booking no longer costs 40 %.

   Live case (4 Oct 2026): booked a class 30 h away, cancelled 30 s later, 4 TND (40 %)
   recorded for the tutor. Now a cancellation within 15 min of booking is free (unless
   the class starts in less than 15 min) — the API half is
   apps/api/test/lf3-c-cancel-grace.test.ts. Here: what the student is TOLD.

     • /student — inside the grace the confirm box says it is free, and until when;
       the message after says why nothing was retained. Outside it: the 40 % warning,
       unchanged.
     • /checkout and the storefront — when the class is already < 48 h away, BEFORE
       confirming: « Cette séance est dans moins de 48 h : après 15 min, une annulation
       compte 40 % pour le prof. » Absent when the class is > 48 h away. Payments are
       off: the storefront note says nothing is taken.

   ADDED as its own spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const NOTE = {
  fr: "Cette séance est dans moins de 48 h : après 15 min, une annulation compte 40 % pour le prof.",
  ar: "الحصة هاذي في أقل من 48 ساعة : بعد 15 دقيقة، الإلغاء يتحسب ⁦40 %⁩ للأستاذ.",
} as const;
const UI = {
  fr: { cancel: /Annuler ma place/, sure: "Annuler cette réservation ?", yes: /Oui, annuler/, flash: /Réservation annulée/ },
  ar: { cancel: /ألغي مكاني/, sure: "تحب تلغي هذا الحجز ؟", yes: /إيه، ألغي/, flash: /الحجز تلغى/ },
} as const;

async function paidSeat(opts: { hoursFromNow: number; bookedMinutesAgo?: number }) {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: opts.hoursFromNow });
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: false });
  await sql`update classes set seats_taken = 1 where id = ${klass.id}`;
  if (opts.bookedMinutesAgo) await backdateBooking(booking.id, opts.bookedMinutesAgo);
  const [b] = await sql<{ at: Date }[]>`select created_at at from bookings where id = ${booking.id}`;
  return { klass, student, booking, bookedAt: new Date(b.at).getTime() };
}

async function studentPage(browser: Browser, studentId: string, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, studentId);
  return ctx.newPage();
}

async function cancelFromDashboard(page: Page, locale: "fr" | "ar"): Promise<{ warning: string; flash: string }> {
  const u = UI[locale];
  await page.goto(`/${locale}/student`);
  // student-space-v1 · B: « Annuler ma place » is behind the next class's « ⋯ » menu now.
  await page.locator("[data-e2e=seat-menu]").first().click();
  const btn = page.getByRole("button", { name: u.cancel }).first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  const box = page.getByText(u.sure).locator("..");
  await expect(box).toBeVisible();
  const warning = (await box.innerText()).replace(/\s+/g, " ");
  await page.getByRole("button", { name: u.yes }).click();
  const flash = page.getByText(u.flash);
  await expect(flash).toBeVisible({ timeout: 15_000 });
  return { warning, flash: (await flash.innerText()).replace(/\s+/g, " ") };
}

test.describe("C · /student — the grace, said before and after", () => {
  test("FR: booked a moment ago, class 5 h away — « gratuite jusqu'à HH:MM », then « rien n'est retenu »; the ledger says why", async ({ browser }) => {
    const s = await paidSeat({ hoursFromNow: 5 });
    const page = await studentPage(browser, s.student.id);
    const { warning, flash } = await cancelFromDashboard(page, "fr");
    const until = tunisClock(s.bookedAt + CANCEL_GRACE_MINUTES * 60_000);
    expect(warning).toContain(`Annulation gratuite jusqu'à ${until}`);
    expect(warning).toContain("Rien n'est retenu pour ton prof");
    expect(warning).not.toContain("16 TND");
    expect(flash).toContain(`C'était dans les ${CANCEL_GRACE_MINUTES} min après ta réservation`);
    expect(flash).toContain("rien n'est retenu");
    expect(flash).not.toContain("16 TND");
    const [row] = await sql<{ retained_tnd: string; reason: string | null; late: boolean }[]>`
      select retained_tnd, reason, late from cancellations where booking_id = ${s.booking.id}`;
    expect(Number(row.retained_tnd)).toBe(0);
    expect(row.reason).toBe("booking-grace");
    expect(row.late).toBe(true);
    await page.context().close();
  });

  test("AR: the same, in Derja — free until HH:MM, then free", async ({ browser }) => {
    const s = await paidSeat({ hoursFromNow: 5 });
    const page = await studentPage(browser, s.student.id, { width: 390, height: 844 });
    const { warning, flash } = await cancelFromDashboard(page, "ar");
    const until = tunisClock(s.bookedAt + CANCEL_GRACE_MINUTES * 60_000);
    expect(warning).toContain(`الإلغاء بلاش حتى لـ ${until}`);
    expect(warning).not.toContain("16 د.ت");
    expect(flash).toContain(`كان في الـ${CANCEL_GRACE_MINUTES} دقيقة اللي بعد الحجز`);
    expect(flash).not.toContain("16 د.ت");
    const [row] = await sql<{ retained_tnd: string }[]>`select retained_tnd from cancellations where booking_id = ${s.booking.id}`;
    expect(Number(row.retained_tnd)).toBe(0);
    await page.context().close();
  });

  test("booked 20 min ago: the grace is over — the 40 % warning and outcome, as before", async ({ browser }) => {
    const s = await paidSeat({ hoursFromNow: 5, bookedMinutesAgo: 20 });
    const page = await studentPage(browser, s.student.id);
    const { warning, flash } = await cancelFromDashboard(page, "fr");
    expect(warning).not.toContain("Annulation gratuite jusqu'à");
    expect(warning).toContain("16 TND");
    expect(flash).toContain("16 TND");
    expect(flash).toContain("Rien n'est prélevé pendant le pilote");
    await page.context().close();
  });
});

/* ── the « moins de 48 h » note before confirming ── */

async function tutorWithClass(hoursFromNow: number) {
  const tutor = await seedTutor({ status: "verified", fullName: "Walid Tester" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow, seats: 10 });
  return { tutor, klass };
}

test.describe("C · checkout — the note before « Confirmer ma place »", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}/checkout: shown when the class is < 48 h away, absent when it is > 48 h away`, async ({ browser }) => {
      const near = await tutorWithClass(30);
      const far = await tutorWithClass(72);
      const student = await seedProfile({ role: "student", birthYear: 1990 });
      const page = await studentPage(browser, student.id);

      await page.goto(`/${locale}/checkout?class=${near.klass.id}`);
      await expect(page.locator("button.ck-cta")).toBeVisible({ timeout: 15_000 });
      const note = page.locator("[data-e2e=late-cancel-note]");
      await expect(note).toBeVisible();
      await expect(note).toHaveText(NOTE[locale]);
      // Before the confirm button, on the page.
      const [n, b] = await Promise.all([note.boundingBox(), page.locator("button.ck-cta").boundingBox()]);
      expect(n!.y + n!.height).toBeLessThanOrEqual(b!.y);

      await page.goto(`/${locale}/checkout?class=${far.klass.id}`);
      await expect(page.locator("button.ck-cta")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("[data-e2e=late-cancel-note]")).toHaveCount(0);
      await page.context().close();
    });
  }

  test("a class starting within 30 min: the grace is cut short, so the note says so (no « après 15 min »)", async ({ browser }) => {
    const soon = await tutorWithClass(0.4); // 24 min away
    const student = await seedProfile({ role: "student", birthYear: 1990 });
    const page = await studentPage(browser, student.id);
    await page.goto(`/fr/checkout?class=${soon.klass.id}`);
    await expect(page.locator("button.ck-cta")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-e2e=late-cancel-note]")).toHaveText(
      "Cette séance commence bientôt : à partir de 15 min avant le début, une annulation compte 40 % pour le prof.",
    );
    await page.context().close();
  });
});

test.describe("C · storefront — the note next to « Réserver »", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}/<slug>: in the aside at 1440×900 and in the phone bar at 390×844, only inside 48 h — and payments off is said`, async ({ browser }) => {
      const near = await tutorWithClass(30);
      const far = await tutorWithClass(72);
      const pilot = locale === "fr" ? "Rien n'est prélevé pendant le pilote." : "ما يتخصم حتى مليم في فترة التجربة.";

      for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
        const page = await ctx.newPage();
        await page.goto(`/${locale}/${near.tutor.slug}`);
        const where = vp.width >= 960 ? "[data-sf-aside=true]" : "[data-sf-mobilecta=true]";
        const note = page.locator(`${where} [data-e2e=late-cancel-note]`);
        await expect(note, `${vp.width}: the note`).toBeVisible({ timeout: 15_000 });
        await expect(note).toContainText(NOTE[locale]);
        await expect(note).toContainText(pilot);
        // Above the button that leads to the checkout.
        const cta = page.locator(`${where} a[href*="/checkout?class=${near.klass.id}"]`);
        const [n, b] = await Promise.all([note.boundingBox(), cta.boundingBox()]);
        expect(n!.y + n!.height, `${vp.width}: before « Réserver »`).toBeLessThanOrEqual(b!.y);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);

        await page.goto(`/${locale}/${far.tutor.slug}`);
        await expect(page.locator(`${where} a[href*="/checkout?class=${far.klass.id}"]`)).toBeVisible({ timeout: 15_000 });
        await expect(page.locator("[data-e2e=late-cancel-note]")).toHaveCount(0);
        await ctx.close();
      }
    });
  }
});
