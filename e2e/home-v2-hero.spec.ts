import { test, expect, type Browser, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass } from "./support/seed";
import { loginAs } from "./support/session";
import { API_URL, BASE_URL } from "./support/env";

/* home v2 · B — the hero's « real tutors » card, on the live, ISR-cached home page.

   WHAT IS PROVED WHERE
     • The card with 0, 1 and 3 tutors, « no rating below 3 reviews » and « no
       invented number », EXACTLY: apps/api/test/hv2-b-hero-rows.test.ts (the rows,
       from fixtures) and apps/api/test/hv2-b-home-tutors.test.ts (the route, against
       Postgres). The shared e2e database holds every other spec's verified tutors, so
       « 0 tutors » cannot be staged here.
     • HERE: the real page renders what GET /tutors/home answers — three real rows
       for three real tutors, one link each, a price only when there is one, a rating
       only from 3 reviews — and, on the whole page, no figure the API did not send.

   FRESH DATA UNDER ISR, WITHOUT WAITING THE MINUTE OUT. The card's read is tagged
   PUBLIC_TUTORS_TAG (lib/home-tutors.ts), and so is the prerendered page that used
   it. The test busts that tag the way production does: one of the seeded tutors
   flips their free-first switch in Réglages › Vitrine — a real server action whose
   API answer carries `revalidate.publicTutors`, which lib/api.ts replays. The next
   GET of /fr renders fresh. The poll is capped at one cache window (60 s + margin):
   if the tag ever stopped reaching the page, the test would still converge on the
   plain 60 s revalidate, and a slower pass is the signal to look at.

   ORDER: the three tutors are verified « a century from now », so newest-verified-
   first puts them on top, and a later run's century is later still. No other spec
   writes a reviewed_at in the future. afterAll sets it back to null. */

const HOST = new URL(BASE_URL).hostname;
let ids: string[] = [];

test.afterAll(async () => {
  if (!ids.length) return;
  // Back to « verified at no known time »: off the top of the card for whoever runs next.
  await sql`update tutors set reviewed_at = null where id in ${sql(ids)}`;
  await sql`delete from reviews where tutor_id in ${sql(ids)}`;
  await sql`delete from tutor_offers where tutor_id in ${sql(ids)}`;
});

async function cardHrefs(page: Page): Promise<string[]> {
  await page.goto("/fr", { waitUntil: "domcontentloaded" });
  return page.locator("[data-e2e=hero-tutor-row]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
}

/** A real write that busts PUBLIC_TUTORS_TAG: the tutor's own free-first switch. */
async function bustPublicTutors(browser: Browser, profileId: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/settings?tab=vitrine");
  const sw = page.locator("[data-e2e=free-first-toggle]").getByRole("switch");
  const before = await sw.getAttribute("aria-checked");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
  await expect(sw).toBeEnabled(); // the action has answered (busy → done)
  await ctx.close();
}

test("the card shows the three newest real tutors — one link each, a price only when real, a rating only from 3 reviews", async ({ page, browser }) => {
  test.setTimeout(150_000);

  const profileA = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Hédi Ben Salah" });
  const a = await seedTutor({ profileId: profileA.id, status: "verified", fullName: "Hédi Ben Salah" }); // 3 reviews, a class at 35
  const b = await seedTutor({ status: "verified", fullName: "Rim Chaabane" }); // 2 reviews, nothing on sale
  const c = await seedTutor({ status: "verified", fullName: "Yosr Mejri" }); // a monthly offer at 90
  ids = [a.id, b.id, c.id];
  const slugs = [a.slug, b.slug, c.slug];
  await sql`update tutors set reviewed_at = now() + interval '100 years 3 seconds', levels = ${sql.array(["bac"])} where id = ${a.id}`;
  await sql`update tutors set reviewed_at = now() + interval '100 years 2 seconds', subject = 'Physique' where id = ${b.id}`;
  await sql`update tutors set reviewed_at = now() + interval '100 years 1 second', subject = 'Anglais' where id = ${c.id}`;
  await seedClass({ tutorId: a.id, priceTnd: 35, hoursFromNow: 120 });
  for (const r of [5, 4, 5]) await sql`insert into reviews (tutor_id, rating, text) values (${a.id}, ${r}, 'hv2-b e2e')`;
  for (const r of [5, 5]) await sql`insert into reviews (tutor_id, rating, text) values (${b.id}, ${r}, 'hv2-b e2e')`;
  await sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${c.id}, 'hv2-b e2e', 4, '90')`;

  // The API answers them at once…
  if (API_URL) {
    const api = (await (await fetch(`${API_URL}/tutors/home`)).json()) as { slug: string }[];
    expect(api.map((t) => t.slug)).toEqual(slugs);
  }
  // …and the cached page as soon as a real write busts the public-tutors tag.
  await bustPublicTutors(browser, profileA.id);
  await expect
    .poll(() => cardHrefs(page), { timeout: 75_000, intervals: [1_000, 2_000, 5_000] })
    .toEqual(slugs.map((s) => `/fr/${s}`));

  const rows = page.locator("[data-e2e=hero-tutor-row]");
  await expect(rows).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const row = rows.nth(i);
    await expect(row).toHaveAttribute("data-kind", "tutor");
    // ONE control: nothing interactive inside the row link.
    await expect(row.locator("a, button, input, select, textarea")).toHaveCount(0);
  }

  const [ra, rb, rc] = [rows.nth(0), rows.nth(1), rows.nth(2)];
  await expect(ra).toContainText("Prof de Maths");
  await expect(ra).toContainText("Bac · en ligne");
  await expect(ra.locator("[data-e2e=hero-price]")).toHaveText(/35\s*TND\s*\/ séance/);
  await expect(ra.locator("[data-e2e=hero-rating]")).toContainText("4,7");
  await expect(ra.locator("[data-e2e=hero-rating]")).toContainText("(3 avis)");

  await expect(rb).toContainText("Prof de Physique");
  await expect(rb.locator("[data-e2e=hero-price]"), "nothing on sale → no price").toHaveCount(0);
  await expect(rb.locator("[data-e2e=hero-rating]"), "2 reviews → no rating").toHaveCount(0);

  await expect(rc).toContainText("Prof d'Anglais");
  await expect(rc.locator("[data-e2e=hero-price]")).toHaveText(/90\s*TND\s*\/ mois/);

  // The public name at most — never a surname — and the photo only when approved (none here).
  const card = page.locator("[data-e2e=hero-tutors-card]");
  for (const surname of ["Ben Salah", "Chaabane", "Mejri"]) await expect(card).not.toContainText(surname);
  await expect(card.locator("img")).toHaveCount(0);

  // The row is the tutor's page.
  await ra.click();
  await expect(page).toHaveURL(new RegExp(`/fr/${a.slug}$`));
});

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: no figure on the page that the API did not send — prices and ratings live only in real tutor rows`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const card = page.locator("[data-e2e=hero-tutors-card]");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-e2e=hero-tutor-row]")).toHaveCount(3);

    const currency = locale === "ar" ? "د.ت" : "TND";
    const reviewCount = /\(\s*\d+\s*(avis|تقييم)\s*\)/g;
    const count = (s: string, needle: string | RegExp) =>
      typeof needle === "string" ? s.split(needle).length - 1 : (s.match(needle) ?? []).length;
    const body = await page.locator("main").first().innerText();
    const prices = await page.locator("[data-e2e=hero-price]").allInnerTexts();
    const ratings = await page.locator("[data-e2e=hero-rating]").allInnerTexts();
    expect(count(body, currency), "every currency figure on the page is a real tutor's price").toBe(count(prices.join(" "), currency));
    expect(count(body, reviewCount), "no review count outside a real tutor's row").toBe(count(ratings.join(" "), reviewCount));
    expect(count(body, /★/), "no star-rating glyphs in the copy").toBe(0);

    // A neutral row has no figure at all, and links to a filtered /explore.
    const neutral = card.locator("[data-e2e=hero-tutor-row][data-kind=subject]");
    for (let i = 0; i < (await neutral.count()); i++) {
      await expect(neutral.nth(i)).not.toContainText(/\d/);
      await expect(neutral.nth(i)).toHaveAttribute("href", new RegExp(`^/${locale}/explore\\?subject=`));
    }
    // Every rating shown is backed by 3+ reviews.
    for (const r of ratings) {
      const n = Number(/\((\d+)/.exec(r)?.[1] ?? "0");
      expect(n, r).toBeGreaterThanOrEqual(3);
    }
  });
}
