import { test, expect, type Browser } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* ZERO CONTACT, IN THE COPY (phase-a lane L1: A3, A4, A12).

   The API never hands one party the other's phone or e-mail (zero-contact.spec.ts).
   These are the places where the PRODUCT'S OWN WORDS contradicted that rule — a
   screen promising the tutor could call, a tutor told to send files by WhatsApp —
   and a placeholder support number. Each test reads the rendered page in both
   locales.

   ADDED as its own spec. Written for the orchestrator's run after merge. */

async function pageAs(browser: Browser, profileId: string) {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(profileId))]);
  return { ctx, page: await ctx.newPage() };
}

test.describe("A3 — the student welcome screen never promises the tutor can reach them", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}/student/welcome`, async ({ browser }) => {
      const me = await seedProfile({ role: "student", birthYear: 1995 });
      const { ctx, page } = await pageAs(browser, me.id);
      await page.goto(`/${locale}/student/welcome`);
      await expect(page.locator("input[type=tel]")).toBeVisible();

      const html = await page.content();
      expect(html, "the tutor must never be said to be able to call").not.toContain("te joindre");
      expect(html).not.toMatch(/يكلمك|يتصل بيك/);
      // …and it says what the number is actually for.
      await expect(page.locator("main")).toContainText(
        locale === "fr" ? "Ton prof ne le voit jamais" : "أستاذك عمرو ما يشوفها",
      );
      await ctx.close();
    });
  }
});

test.describe("A4 — the new-pack page never tells a tutor to send files by WhatsApp or e-mail", () => {
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}/dashboard/new-pack`, async ({ browser }) => {
      const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
      await seedTutor({ profileId: tutorProfile.id, status: "verified" });
      const { ctx, page } = await pageAs(browser, tutorProfile.id);
      await page.goto(`/${locale}/dashboard/new-pack`);
      await expect(page.locator("form")).toBeVisible();

      // The page's own content (the site footer carries Tnajem's contact address).
      const text = await page.locator("main").innerText();
      expect(text).not.toMatch(/whatsapp|e-?mail/i);
      expect(text).not.toMatch(/واتساب|إيميل|ايميل/);
      // No "upload isn't connected yet": Mes documents uploads, and the page says where.
      expect(text).not.toContain("pas encore branché");
      /* .linklike: the « where your files go » link (« …plus tard dans Mes fiches »;
         since phase 6 the file is uploaded on this page too). The sticky action bar's
         « Annuler » also leads back to Mes fiches. */
      await expect(page.locator('main a.linklike[href$="/dashboard/materials"]')).toBeVisible();
      await ctx.close();
    });
  }
});

test.describe("A12 — no placeholder support link: the row is hidden while NEXT_PUBLIC_SUPPORT_WHATSAPP is unset", () => {
  /* playwright.config.ts pins the variable blank for the web build, so this is the
     unset case whatever the developer's .env holds. The valid/invalid parsing is
     unit-tested in apps/api/test/support-contact.test.ts. */
  for (const locale of ["fr", "ar"] as const) {
    test(`/${locale}/account`, async ({ browser }) => {
      const me = await seedProfile({ role: "student", birthYear: 1990, fullName: "Amine Karoui" });
      const { ctx, page } = await pageAs(browser, me.id);
      await page.goto(`/${locale}/account`);
      // Wait for the signed-in panel, so "not there" is not "not rendered yet".
      await expect(page.locator("main")).toContainText("Amine Karoui");

      await expect(page.getByTestId("support-whatsapp")).toHaveCount(0);
      await expect(page.locator('main a[href*="wa.me"]')).toHaveCount(0);
      expect(await page.content(), "the placeholder number must be gone from the page").not.toContain("216XXXX");
      await ctx.close();
    });
  }
});
