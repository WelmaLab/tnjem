import { test, expect } from "@playwright/test";

/* espace prof v2 · pro (P7) — /aide, the short help page (contract C9).

   Public, FR/AR, server-rendered (readable with no JavaScript), its own title and
   share card, indexable, in the sitemap with fr-TN ⇄ ar-TN alternates, and the
   online payment always shown with its « Bientôt » label.

   ADDED, never edited into an existing spec. */

const TOPICS = ["verification", "paiement", "partage", "promotions", "abonnements"];

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}/aide renders the five answers, with the payment story labelled « Bientôt »`, async ({ page }) => {
    const res = await page.goto(`/${locale}/aide`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    await expect(page.locator("main h1")).toHaveText(locale === "ar" ? "مساعدة للأساتذة" : "Aide pour les profs");
    for (const id of TOPICS) {
      await expect(page.locator(`main article#${id} h2`)).toBeVisible();
      await expect(page.locator(`main nav a[href="#${id}"]`)).toBeVisible();
    }
    const story = page.locator("#paiement [data-payment-story]");
    await expect(story).toBeVisible();
    await expect(story).toContainText(locale === "ar" ? "قريب" : "Bientôt");
    // The anchors work: a chip jumps to its card.
    await page.locator('main nav a[href="#abonnements"]').click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/aide#abonnements$`));
  });

  test(`/${locale}/aide: its own title, a share card, indexable`, async ({ request }) => {
    const html = await (await request.get(`/${locale}/aide`)).text();
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    expect(title).toContain(locale === "ar" ? "مساعدة للأساتذة" : "Aide pour les profs");
    expect(html).toMatch(/<meta property="og:image" content="[^"]*\/og\.png/);
    expect(html).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    expect(html).toMatch(/hreflang="ar-TN"[^>]*\/ar\/aide/i);
    expect(html).toContain(`/fr/aide`);
  });
}

test("/fr/aide is complete without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("/fr/aide");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(TOPICS.length);
  await expect(page.locator("#paiement")).toContainText("hors Tnajem");
  await ctx.close();
});

test("/aide fits a 390 px phone with no horizontal scroll, in both languages", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  for (const locale of ["fr", "ar"]) {
    await page.goto(`/${locale}/aide`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `/${locale}/aide scrolls sideways`).toBeLessThanOrEqual(0);
  }
  await ctx.close();
});

test("the sitemap lists /aide in both languages, each with its alternates", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toMatch(/<loc>[^<]*\/fr\/aide<\/loc>/);
  expect(xml).toMatch(/<loc>[^<]*\/ar\/aide<\/loc>/);
  expect(xml).toMatch(/hreflang="ar-TN"[^>]*\/ar\/aide"/);
});

test("the word « aide » is not a tutor storefront: the route is served, never the 404 or a slug", async ({ request }) => {
  const res = await request.get("/fr/aide", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toContain("Cette page n'existe pas");
});
