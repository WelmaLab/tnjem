import { test, expect } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* live-fixes-1 · G — the share sheet's « Plus d'apps · Instagram, TikTok… ».

   It shared a row with « QR code » and wrapped onto three lines on a phone. Now: a
   full-width secondary button with an icon, on one line; « QR code » a separate
   button of the same height, on its own row. navigator.share (the phone's own sheet)
   is what « Plus d'apps » opens, so the spec provides one. */

for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  for (const loc of ["fr", "ar"] as const) {
    test(`${loc} ${vp.width}: « Plus d'apps » full width, one line, with its icon; « QR code » the same height below`, async ({ browser }) => {
      const me = await seedProfile({ role: "tutor", birthYear: 1985 });
      await seedTutor({ profileId: me.id, status: "verified" });
      const ctx = await browser.newContext({ viewport: vp });
      await ctx.addCookies([sessionCookie(await mintSession(me.id))]);
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, "share", { value: async () => undefined, configurable: true });
        window.open = (() => null) as typeof window.open;
      });
      const page = await ctx.newPage();
      await page.goto(`/${loc}/dashboard/storefront`, { waitUntil: "networkidle" });
      await page.locator("[data-e2e=share-open-profile]").first().click();
      const sheet = page.locator("[data-e2e=share-sheet][open]");
      await expect(sheet).toBeVisible();

      const more = sheet.locator("[data-e2e=share-native]");
      const qr = sheet.locator("[data-e2e=share-qr-toggle]");
      await expect(more).toContainText(loc === "fr" ? "Plus d'apps" : "تطبيقات أخرى");
      await expect(more).toContainText("Instagram");
      await expect(more.locator("svg.ic")).toHaveCount(1);
      await expect(qr.locator("svg.ic")).toHaveCount(1);

      const m = (await more.boundingBox())!;
      const q = (await qr.boundingBox())!;
      const row = (await sheet.locator(".shs-secondary").boundingBox())!;
      // Full width of the sheet's column, one line (a 48px button), the same height as « QR code ».
      expect(Math.abs(m.width - row.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(q.width - row.width)).toBeLessThanOrEqual(1);
      expect(m.height).toBeLessThanOrEqual(50);
      expect(Math.abs(m.height - q.height)).toBeLessThanOrEqual(1);
      expect(q.y).toBeGreaterThanOrEqual(m.y + m.height); // its own row
      const oneLine = await more.locator(".shs-sec-t").evaluate((el) => el.getClientRects().length === 1 && getComputedStyle(el).whiteSpace === "nowrap");
      expect(oneLine).toBe(true);

      // Both still work: the QR panel opens, « Plus d'apps » calls the phone's sheet.
      await qr.click();
      await expect(sheet.locator("[data-e2e=share-qr]")).toBeVisible();
      await expect(qr).toHaveAttribute("aria-expanded", "true");
      await ctx.close();
    });
  }
}
