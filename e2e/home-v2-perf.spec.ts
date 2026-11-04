import { test, expect, type APIRequestContext } from "@playwright/test";

/* home v2 · E — the home page is a Server Component, statically rendered with ISR,
   with its own <head>, and nothing on it moves after the first paint.

   Runs against the production build (ISR does not exist in `next dev`). The pilot
   tag needs the second web process with ALLOW_MINORS unset (playwright.config.ts,
   :3212 — E2E_PILOT_BASE_URL), as in pilot-tag.spec.ts.
   ADDED, never edited into an existing spec. */

const PILOT = process.env.E2E_PILOT_BASE_URL ?? "http://localhost:3212";

async function html(request: APIRequestContext, path: string) {
  const res = await request.get(path, { maxRedirects: 0 });
  expect(res.status(), path).toBe(200);
  return { headers: res.headers(), body: await res.text() };
}

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: static + ISR (60 s), canonical and hreflang FR/AR/x-default`, async ({ request }) => {
    const { headers, body } = await html(request, `/${locale}`);
    // STALE = the cached copy, served while it regenerates (the entry is older than 60 s).
    expect(["HIT", "STALE"], "prerendered, not rendered per request").toContain(headers["x-nextjs-cache"]);
    expect(headers["cache-control"], "export const revalidate = 60").toContain("s-maxage=60");

    const link = (rel: string, lang?: string) =>
      body.match(new RegExp(`<link rel="${rel}"${lang ? ` hrefLang="${lang}"` : ""} href="([^"]+)"`))?.[1];
    expect(link("canonical")).toMatch(new RegExp(`/${locale}$`));
    expect(link("alternate", "fr-TN")).toMatch(/\/fr$/);
    expect(link("alternate", "ar-TN")).toMatch(/\/ar$/);
    expect(link("alternate", "x-default")).toMatch(/\/fr$/);

    // The brand title, without the "· Tnajem" template suffix, and a complete share card.
    const title = body.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
    expect(title).toBe(locale === "ar" ? "Tnajem — تعلّم مع أستاذك" : "Tnajem — apprends avec ton prof");
    expect(body).toMatch(/<meta property="og:image" content="[^"]*\/og\.png/);

    // The H1 is in the server HTML (the LCP element is text, not an image).
    expect(body).toMatch(/<h1 class="web-h1[^"]*">/);
  });
}

test("/fr structured data: one Organization, one WebSite with a SearchAction to /explore?q=, no rating", async ({ request }) => {
  const { body } = await html(request, "/fr");
  const nodes = [...body.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)]
    .flatMap((m) => [JSON.parse(m[1])].flat()) as { "@type": string; potentialAction?: unknown }[];
  expect(nodes.filter((n) => n["@type"] === "Organization")).toHaveLength(1);
  expect(nodes.filter((n) => n["@type"] === "WebSite")).toHaveLength(1);
  const all = JSON.stringify(nodes);
  expect(all, "truth rule: no rating markup").not.toMatch(/AggregateRating|"Review"/);
  /* home v2 · G: ExploreClient now seeds its search box from ?q=, so the WebSite node
     carries a SearchAction to the locale's /explore?q= (proved in home-v2.spec.ts). */
  const site = nodes.find((n) => n["@type"] === "WebSite") as { potentialAction?: { "@type": string; target: { urlTemplate: string } } };
  expect(site.potentialAction?.["@type"]).toBe("SearchAction");
  expect(site.potentialAction?.target.urlTemplate).toMatch(/\/fr\/explore\?q=\{search_term_string\}$/);
});

test("with JavaScript off, every section is visible (the reveal never hides content)", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/fr");
  await expect(page.locator(".lp-rv")).toHaveCount(3);
  await expect(page.locator(".lp-armed")).toHaveCount(0);
  for (const n of await page.locator(".lp-rv").all()) {
    expect(await n.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  }
  await expect(page.locator("#etapes")).toBeVisible();
  await ctx.close();
});

test("the reveal arms an off-screen section and shows it once scrolled to", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/fr");
  const steps = page.locator("#etapes .lp-rv");
  await expect(steps).toHaveClass(/lp-armed/);
  await page.locator("#etapes").scrollIntoViewIfNeeded();
  await expect(steps).not.toHaveClass(/lp-armed/);
  await ctx.close();
});

/* The pilot tag arrives after hydration. Where it does not fit beside the eyebrow
   (phones; the two-column hero at 960–1279px in French) it used to wrap the row
   and push the H1 down — the only layout shift on the base page. */
for (const width of [390, 1024]) {
  test(`the pilot tag's arrival moves nothing (/fr, ${width}px)`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      (window as unknown as { __shifts: string[] }).__shifts = [];
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] }[]) {
          for (const s of e.sources ?? []) {
            if (Math.round(s.previousRect.y) !== Math.round(s.currentRect.y)) {
              const el = s.node instanceof Element ? s.node : s.node?.parentElement;
              (window as unknown as { __shifts: string[] }).__shifts.push(`${el?.tagName}.${el?.className} ${s.previousRect.y}→${s.currentRect.y}`);
            }
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${PILOT}/fr`);
    await expect(page.locator("[data-e2e=pilot-tag]")).toBeVisible();
    await page.waitForTimeout(500);
    const shifts = await page.evaluate(() => (window as unknown as { __shifts: string[] }).__shifts);
    expect(shifts, "something moved vertically after the first paint").toEqual([]);
    await ctx.close();
  });
}
