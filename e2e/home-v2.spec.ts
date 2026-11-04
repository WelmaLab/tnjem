import { test, expect, type Browser, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* home v2 · G — the gate over the merged home page (HOME_V2.md § G).

   1. FR + AR at 1440 and 390: every section renders, no horizontal overflow, no
      social icon (the suite leaves NEXT_PUBLIC_SOCIAL_* blank), no `href="#"`.
   2. The subject chips link to the right /explore filter, in both locales.
   3. The tutor card with 0, 1 and 3 real tutors, end to end on the ISR-cached page,
      and no rating below 3 reviews. « 0 » cannot exist on the shared e2e database,
      so this test SUSPENDS every public tutor for its duration and puts each one back
      in `finally` (workers:1 — nothing else reads the catalogue meanwhile). The cache
      is busted the way production busts it: a tutor's own free-first switch answers
      `revalidate.publicTutors` (the same path as home-v2-hero.spec.ts).
   4. /explore?q= lands on that search — the WebSite SearchAction is true.
   5. nojs: with JavaScript off, the whole page is readable.

   The lane specs (home-v2-hero/-sections/-chrome/-perf/-rtl) prove the details;
   this one proves the page as a whole. */

const HOST = new URL(BASE_URL).hostname;
const LOCALES = ["fr", "ar"] as const;
const WIDTHS = [1440, 390] as const;
const SECTIONS = ["home-hero", "hero-tutors-card", "home-subjects", "home-steps", "home-facts", "home-cta", "home-prof"];
const SLUGS = ["maths", "physique", "svt", "francais", "anglais", "arabe", "philo", "histoire-geo", "technique"];

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`/${locale} at ${width}px: every section, no overflow, no social icon, no dead link`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`/${locale}`);

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toBeVisible();
      for (const s of SECTIONS) {
        const el = page.locator(`[data-e2e=${s}]`);
        await expect(el, s).toHaveCount(1);
        await el.scrollIntoViewIfNeeded();
        await expect(el, s).toBeVisible();
      }
      await expect(page.locator("#etapes")).toHaveCount(1);
      await expect(page.locator("footer")).toBeVisible();
      await expect(page.locator("[data-e2e=pilot-tag]")).toHaveCount(0); // ALLOW_MINORS=1 here; pilot-tag.spec covers the other server

      // No horizontal page scroll, top to bottom (the chip row scrolls inside itself).
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, "horizontal page overflow (px)").toBeLessThanOrEqual(0);

      // Honesty rule 5: no social account configured → no icon, no empty list.
      await expect(page.locator("[data-e2e=footer-social]")).toHaveCount(0);
      await expect(page.locator('a[href*="instagram.com"], a[href*="facebook.com"], a[href*="linkedin.com"]')).toHaveCount(0);
      await expect(page.locator('a[href="#"]'), "never a dead « # » link").toHaveCount(0);
      await ctx.close();
    });
  }

  test(`/${locale}: the subject chips link to their /explore filter`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const chips = page.locator("[data-e2e=home-subjects] a.hv2-chip");
    await expect(chips).toHaveCount(SLUGS.length);
    expect(await chips.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(
      SLUGS.map((s) => `/${locale}/explore?subject=${s}`),
    );
    await expect(chips.first()).toHaveAttribute("data-active", "true"); // Maths, active by default
    // Each chip's icon is a CSS mask (globals.css `.hv2-sic-<slug>`): a purged rule
    // would paint a solid square instead of the drawing.
    const masks = await chips.locator(".hv2-sic").evaluateAll((els) =>
      els.map((e) => {
        const cs = getComputedStyle(e);
        return cs.maskImage || cs.getPropertyValue("-webkit-mask-image");
      }),
    );
    expect(masks).toHaveLength(SLUGS.length);
    for (const m of masks) expect(m).toContain("data:image/svg+xml");
    await expect(page.locator("[data-e2e=home-subjects-all]")).toHaveAttribute("href", `/${locale}/explore`);

    // Following one lands on /explore with that filter on.
    await chips.nth(1).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/explore\\?subject=physique$`));
  });
}

/* ── 3. the card with 0, 1 and 3 real tutors ─────────────────────────────── */

async function cardState(page: Page) {
  await page.goto("/fr", { waitUntil: "domcontentloaded" });
  return page
    .locator("[data-e2e=hero-tutor-row]")
    .evaluateAll((els) => els.map((e) => `${e.getAttribute("data-kind")}:${e.getAttribute("href")}`));
}

/** A real write that busts PUBLIC_TUTORS_TAG: a tutor's own free-first switch. The
    switch's owner is a PENDING tutor, so it never shows on the card itself. */
async function bust(browser: Browser, profileId: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/settings?tab=vitrine");
  const sw = page.locator("[data-e2e=free-first-toggle]").getByRole("switch");
  const before = await sw.getAttribute("aria-checked");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await expect(sw).toBeEnabled();
  await ctx.close();
}

test("the hero card with 0, 1 and 3 real tutors — neutral rows fill the rest, no rating below 3 reviews", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const poll = (expected: string[]) =>
    expect.poll(() => cardState(page), { timeout: 75_000, intervals: [1_000, 2_000, 5_000] }).toEqual(expected);

  const owner = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedTutor({ profileId: owner.id, status: "pending" });

  const hidden = (await sql`
    update tutors set suspended_at = now()
    where status = 'verified' and suspended_at is null
    returning id`) as unknown as { id: string }[];
  const seeded: string[] = [];
  try {
    // 0 real tutors → three neutral subject rows, no figure, no photo.
    await bust(browser, owner.id);
    await poll(["subject:/fr/explore?subject=maths&level=bac", "subject:/fr/explore?subject=physique&level=secondaire", "subject:/fr/explore?subject=francais&level=primaire"]);
    const card = page.locator("[data-e2e=hero-tutors-card]");
    await expect(card).not.toContainText(/\d/);
    await expect(card.locator("img, [data-e2e=hero-price], [data-e2e=hero-rating]")).toHaveCount(0);
    await expect(card).toContainText("Voir les profs");

    // 1 real tutor with TWO reviews and a class → his row first, a price, no rating.
    const one = await seedTutor({ status: "verified", fullName: "Sami Gatei" });
    seeded.push(one.id);
    await seedClass({ tutorId: one.id, priceTnd: 40, hoursFromNow: 96 });
    for (const r of [5, 5]) await sql`insert into reviews (tutor_id, rating, text) values (${one.id}, ${r}, 'hv2-g e2e')`;
    await bust(browser, owner.id);
    await poll([`tutor:/fr/${one.slug}`, "subject:/fr/explore?subject=physique&level=secondaire", "subject:/fr/explore?subject=francais&level=primaire"]);
    const first = page.locator("[data-e2e=hero-tutor-row]").first();
    await expect(first.locator("[data-e2e=hero-price]")).toHaveText(/40\s*TND\s*\/ séance/);
    await expect(first.locator("[data-e2e=hero-rating]"), "2 reviews → no rating").toHaveCount(0);
    await expect(first).not.toContainText("Gatei"); // public name only

    // 3 real tutors, one of them with THREE reviews → three tutor rows, that one rated.
    const two = await seedTutor({ status: "verified", fullName: "Ines Ouertani" });
    const three = await seedTutor({ status: "verified", fullName: "Karim Jaziri" });
    seeded.push(two.id, three.id);
    for (const r of [4, 5, 5]) await sql`insert into reviews (tutor_id, rating, text) values (${two.id}, ${r}, 'hv2-g e2e')`;
    // Newest-verified first: three, two, one.
    await sql`update tutors set reviewed_at = now() + interval '200 years 1 second' where id = ${one.id}`;
    await sql`update tutors set reviewed_at = now() + interval '200 years 2 seconds' where id = ${two.id}`;
    await sql`update tutors set reviewed_at = now() + interval '200 years 3 seconds' where id = ${three.id}`;
    await bust(browser, owner.id);
    await poll([three, two, one].map((t) => `tutor:/fr/${t.slug}`));
    const rows = page.locator("[data-e2e=hero-tutor-row]");
    await expect(rows.nth(1).locator("[data-e2e=hero-rating]")).toContainText("(3 avis)");
    await expect(rows.nth(0).locator("[data-e2e=hero-rating]")).toHaveCount(0);
    await expect(rows.nth(2).locator("[data-e2e=hero-rating]")).toHaveCount(0);
    for (const r of await page.locator("[data-e2e=hero-rating]").allInnerTexts()) {
      expect(Number(/\((\d+)/.exec(r)?.[1] ?? "0"), r).toBeGreaterThanOrEqual(3);
    }
  } finally {
    if (hidden.length) await sql`update tutors set suspended_at = null where id in ${sql(hidden.map((h) => h.id))}`;
    if (seeded.length) {
      await sql`update tutors set reviewed_at = null where id in ${sql(seeded)}`;
      await sql`delete from reviews where tutor_id in ${sql(seeded)}`;
    }
    await bust(browser, owner.id).catch(() => {});
  }
});

/* ── 4. the SearchAction's target is a real search ──────────────────────── */

test("/explore?q= lands on that search (the WebSite SearchAction is true)", async ({ page, request }) => {
  const t = await seedTutor({ status: "verified", fullName: "Zoubeida Hv2gsearch" });
  const html = await (await request.get("/fr")).text();
  expect(html).toContain("/fr/explore?q={search_term_string}");

  await page.goto("/fr/explore?q=Zoubeida");
  await expect(page.getByRole("searchbox").or(page.locator('input[type="search"]')).first()).toHaveValue("Zoubeida");
  await expect(page.locator(`a[href="/fr/${t.slug}"]`).first()).toBeVisible({ timeout: 20_000 });
});

/* ── 5. the Arabic font swap moves nothing ─────────────────────────────────
   The H1 is the LCP and sits above the hero; hero.css reserves the line count
   IBM Plex Sans Arabic needs, so the H1 is the same height before the web font
   arrives (blocked here) and after. A copy change that breaks this fails here. */

test("/ar: the H1 is as tall in the fallback face as in IBM Plex Sans Arabic (no shift at the font swap)", async ({ browser }) => {
  const heights = async (blockFonts: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    if (blockFonts) await page.route(/\.woff2?(\?|$)/, (r) => r.abort());
    await page.goto("/ar", { waitUntil: "networkidle" });
    const out: number[] = [];
    for (const w of [360, 390, 414, 600, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      out.push(await page.locator("h1").evaluate((h) => Math.round(h.getBoundingClientRect().height)));
    }
    await ctx.close();
    return out;
  };
  expect(await heights(true)).toEqual(await heights(false));
});

/* ── 6. nojs ─────────────────────────────────────────────────────────────── */

for (const locale of LOCALES) {
  test(`/${locale} with JavaScript off is fully readable`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/${locale}`);
    await expect(page.locator("h1")).toBeVisible();
    for (const s of SECTIONS) {
      const el = page.locator(`[data-e2e=${s}]`);
      await el.scrollIntoViewIfNeeded();
      await expect(el, s).toBeVisible();
      expect(await el.evaluate((n) => Number(getComputedStyle(n).opacity)), `${s} opacity`).toBe(1);
      expect((await el.innerText()).trim().length, `${s} has text`).toBeGreaterThan(10);
    }
    await expect(page.locator(".lp-armed")).toHaveCount(0);
    await expect(page.locator("[data-e2e=hero-tutor-row]")).toHaveCount(3);
    await expect(page.locator("[data-e2e=home-subjects] a.hv2-chip")).toHaveCount(SLUGS.length);
    await ctx.close();
  });
}
