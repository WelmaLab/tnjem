import { test, expect, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* live-fixes-2 · E — the « ? » (components/app/InfoTip.tsx): a click pins it.

   Found while re-enabling Playwright in CI. A mouse shows the bubble on hover, and a
   click toggled on « shown »: the hover usually rendered before the click, so the
   click HID the text the user had just asked for. lf1-e-notes.spec.ts' « click
   opens » only passed when Playwright's click beat the hover's render — on a slower
   Linux box (2 CPUs) it lost that race in 2 of 8 runs. Now a click opens what is
   closed or only hovered, and closes what it opened. Here the hover is made to render
   FIRST, every time, so the old behaviour fails this deterministically. */

async function asTutor(page: Page) {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedTutor({ profileId: me.id, status: "draft" });
  await page.context().addCookies([sessionCookie(await mintSession(me.id))]);
}

const CASES = [
  { loc: "fr", path: "/dashboard/promotions", e2e: "promo-info" },
  { loc: "ar", path: "/dashboard/promotions", e2e: "promo-info" },
  { loc: "fr", path: "/dashboard/subscriptions", e2e: "subs-info" },
  { loc: "ar", path: "/dashboard/subscriptions", e2e: "subs-info" },
] as const;

for (const { loc, path, e2e } of CASES) {
  test(`${path} ${loc}: hover shows it, a click keeps it open, the next click closes it`, async ({ page }) => {
    await asTutor(page);
    await page.goto(`/${loc}${path}`, { waitUntil: "networkidle" });
    const btn = page.locator(`[data-e2e=${e2e}]`);
    const bubble = page.locator(`[data-e2e=${e2e}-text]`);
    await expect(bubble).toBeHidden();

    // The mouse arrives first, as a person's does: the hover has rendered before the click.
    await btn.hover();
    await expect(bubble).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "true");

    await btn.click();
    await expect(btn, "the click pins what the hover showed").toHaveAttribute("aria-expanded", "true");
    await expect(bubble).toBeVisible();

    // Pinned: the mouse leaving does not close it (no click, so nothing else does).
    await page.locator("main h1").hover();
    await expect(bubble).toBeVisible();

    // The next click on the « ? » closes it, even with the mouse back on it.
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(bubble).toBeHidden();
  });
}
