import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RESERVED_SLUGS } from "@tnajem/shared";
import { seedTutor } from "./support/seed";

/* ════════════════════════════════════════════════════════════════════════════
   An unknown tutor slug is a REAL 404 — with a page a person can read.

   The distribution model is a tutor pasting tnajem.com/<their-name> into
   WhatsApp. On 14 Sept a nonsense slug answered 200 with another tutor's full
   storefront and a working "Réserver". Two things are pinned here, and neither
   is allowed to buy the other:

     1. The STATUS is 404 (proxy.ts sets it — a runtime notFound() on
        Next 14.2 would ship an empty <body>, see app/[locale]/[slug]/page.tsx).
     2. The BODY is in the server HTML: the check runs with JavaScript OFF.

   And the rule the middleware depends on: every top-level route is a reserved
   slug. A route missing from RESERVED_SLUGS would be looked up as a tutor, not
   found, and answer 404 to every visitor.

   ADDED, never edited into an existing spec. */

const NOT_FOUND_TITLE = { fr: "Cette page n'existe pas", ar: "الصفحة هاذي ما موجودةش" } as const;

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}/<nonsense> answers 404 and renders the not-found screen with JS off`, async ({ browser }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false });
    const page = await ctx.newPage();

    const res = await page.goto(`/${locale}/does-not-exist-xyz-${Date.now()}`);

    expect(res?.status(), "a nonsense slug must be a hard 404, not a soft one").toBe(404);
    await expect(page.locator("main h1"), "the 404 must say what happened, server-side").toHaveText(
      NOT_FOUND_TITLE[locale],
    );
    await expect(page.locator(`main a[href="/${locale}/explore"]`), "a way onward: explore").toBeVisible();
    await expect(page.locator(`main a[href="/${locale}"]`), "a way onward: home").toBeVisible();
    await expect(page.locator("main .sf-bio"), "no storefront may render at an unknown slug").toHaveCount(0);

    await ctx.close();
  });
}

test("a verified tutor's slug still resolves with 200", async ({ page }) => {
  const tutor = await seedTutor({ status: "verified", fullName: "Resolvable Tutor" });

  const res = await page.goto(`/fr/${tutor.slug}`);

  expect(res?.status(), "a real storefront must not be caught by the 404").toBe(200);
  // phase-a lane L2 (A23): shown as first name + initial.
  await expect(page.locator("main h1"), "the real tutor's page renders").toContainText("Resolvable T.");
});

test("every top-level route is a reserved slug", () => {
  const routes = readdirSync(resolve("apps/web/app/[locale]"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("["))
    .map((d) => d.name);

  expect(routes.length, "the route scan found nothing — wrong directory?").toBeGreaterThan(5);
  for (const route of routes) {
    expect(RESERVED_SLUGS, `"${route}" is a route; unreserved, middleware would 404 it`).toContain(route);
  }
});
