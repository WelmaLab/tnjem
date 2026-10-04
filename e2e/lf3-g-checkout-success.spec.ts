import { test, expect, type Browser } from "@playwright/test";
import { seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* live-fixes-3 · G — AFTER « CONFIRMER MA PLACE ».

   On a phone the confirm button is at the bottom of a long page, and the success
   rendered while the page stayed scrolled there: « C'est réservé ! » was off-screen
   and focus was on a button that had just been disabled. Now, on success — a new seat
   or one the student already held — the page goes back to the top (instantly under
   prefers-reduced-motion, smoothly otherwise), the success content reads from the top,
   and focus is on the heading, with a visible ring; the next Tab reaches « Voir mes
   cours ». At 390×844, FR and AR. ADDED as its own spec. */

const TITLE = { fr: "C'est réservé !", ar: "حجزت بلاصتك!" } as const;
const ALREADY = { fr: "Tu avais déjà cette place.", ar: "مكانك كان محجوز من قبل." } as const;
const CTA = { fr: "Voir mes cours", ar: "شوف حصصي" } as const;
const CONFIRM = { fr: "Confirmer ma place", ar: "أكّد مكاني" } as const;

async function scene(opts: { alreadyBooked: boolean }) {
  const tutor = await seedTutor({ status: "verified", fullName: "Sonia Prof" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 96, priceTnd: 20, isFreeFirst: false });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  if (opts.alreadyBooked) await seedBooking({ classId: klass.id, studentId: student.id, isFree: false });
  return { klass, student };
}

async function confirmFromTheBottom(browser: Browser, loc: "fr" | "ar", reducedMotion: "reduce" | "no-preference", alreadyBooked: boolean) {
  const s = await scene({ alreadyBooked });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion });
  await ctx.addCookies([sessionCookie(await mintSession(s.student.id))]);
  const page = await ctx.newPage();
  await page.goto(`/${loc}/checkout?class=${s.klass.id}`);
  const confirm = page.getByRole("button", { name: CONFIRM[loc] });
  await expect(confirm).toBeVisible({ timeout: 20_000 });
  // The case that was broken: the page is long, and the reader is far down it (the
  // button mid-screen, the page's top — where the success heading goes — out of sight).
  await confirm.evaluate((el) => el.scrollIntoView({ block: "center" }));
  expect(await page.evaluate(() => window.scrollY), "the page is scrolled down to the button").toBeGreaterThan(200);
  await confirm.click();
  return { page, ctx };
}

for (const loc of ["fr", "ar"] as const) {
  for (const motion of ["reduce", "no-preference"] as const) {
    test(`G · a new seat: back to the top, focus on « ${TITLE[loc]} » (${loc}, motion ${motion}, 390×844)`, async ({ browser }) => {
      const { page, ctx } = await confirmFromTheBottom(browser, loc, motion, false);
      const title = page.locator("[data-e2e=checkout-success-title]");
      await expect(title).toHaveText(TITLE[loc], { timeout: 20_000 });
      await expect(title, "the heading is on screen").toBeInViewport({ ratio: 1 });
      await expect.poll(() => page.evaluate(() => window.scrollY), { message: "back at the top" }).toBe(0);
      if (motion === "reduce") expect(await page.evaluate(() => window.scrollY), "instantly under reduced motion").toBe(0);
      await expect(title, "focus moved to the heading").toBeFocused();
      expect(await title.evaluate((el) => document.activeElement === el)).toBe(true);
      // A visible focus ring, not just programmatic focus.
      const ring = await title.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
      // The next Tab goes to the one thing to do next.
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: CTA[loc] })).toBeFocused();
      await ctx.close();
    });
  }

  test(`G · already booked: the same — top, focus on the heading (${loc}, 390×844)`, async ({ browser }) => {
    const { page, ctx } = await confirmFromTheBottom(browser, loc, "reduce", true);
    const title = page.locator("[data-e2e=checkout-success-title]");
    await expect(title).toHaveText(TITLE[loc], { timeout: 20_000 });
    await expect(page.locator("[data-e2e=checkout-success]")).toContainText(ALREADY[loc]);
    await expect(title).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(title).toBeFocused();
    await ctx.close();
  });
}
