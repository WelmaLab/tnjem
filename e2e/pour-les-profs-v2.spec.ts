import { test, expect, type Page } from "@playwright/test";
import { COMMISSION_PCT, commissionOn, PLANS, tnd } from "@tnajem/shared";

/* profs-v2 · F — the gate over the merged « Pour les profs » page (PROFS_V2.md § F).

   1. FR + AR at 1440 and 390: every section renders, no horizontal overflow.
   2. Every « Créer ma page » goes to prof signup.
   3. The centres card says « Bientôt » and opens the waitlist (a mailto, no backend).
   4. The demo button is absent without NEXT_PUBLIC_PROF_DEMO_URL (the suite pins it
      blank, playwright.config.ts); the honest « Voir les profs » link stands in.
   5. The calculator's numbers are the ones the page always showed.
   6. The FAQ JSON-LD is valid and is the FAQ the page shows, word for word.
   7. With JavaScript off, the whole page is readable. */

const LOCALES = ["fr", "ar"] as const;
const WIDTHS = [1440, 390] as const;
const SECTIONS = [
  "profs-hero", "profs-dash-card", "profs-roles", "profs-features", "profs-steps",
  "profs-income", "profs-faq", "profs-banner", "profs-student-line",
];
const SOON = { fr: "Bientôt", ar: "قريب" } as const;

/** Thin and normal no-break spaces (fr-FR grouping) as plain spaces. */
const flat = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`/${locale}/pour-les-profs at ${width}px: every section, no overflow`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`/${locale}/pour-les-profs`);

      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("h1")).toBeVisible();
      for (const s of SECTIONS) {
        const el = page.locator(`[data-e2e=${s}]`);
        await expect(el, s).toHaveCount(1);
        await el.scrollIntoViewIfNeeded();
        await expect(el, s).toBeVisible();
      }
      await expect(page.locator("footer")).toBeVisible();

      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, "horizontal page overflow (px)").toBeLessThanOrEqual(0);
      await expect(page.locator('a[href="#"]'), "never a dead « # » link").toHaveCount(0);
      // Honesty rule 4: the floating card shows only what the prof space has.
      await expect(page.locator("[data-e2e=profs-dash-card]")).not.toContainText(/revenus|مداخيل|\d/);
      await ctx.close();
    });
  }

  test(`/${locale}/pour-les-profs: every « Créer ma page » goes to prof signup`, async ({ page }) => {
    await page.goto(`/${locale}/pour-les-profs`);
    await expect(page.locator("[data-e2e=profs-cta]")).toHaveAttribute("href", `/${locale}/signup/prof`);
    await expect(page.locator("[data-e2e=profs-role-indep]")).toHaveAttribute("href", `/${locale}/signup/prof`);
    await expect(page.locator("[data-e2e=profs-banner-cta]")).toHaveAttribute("href", `/${locale}/signup/prof`);
    await page.locator("[data-e2e=profs-cta]").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/signup/prof$`));
  });

  test(`/${locale}/pour-les-profs: the centres card is « ${SOON[locale]} » and opens the waitlist`, async ({ page }) => {
    await page.goto(`/${locale}/pour-les-profs`);
    const card = page.locator("[data-e2e=profs-role-centre]");
    await expect(card).toContainText(SOON[locale]);
    await expect(card).not.toContainText(/Nouveau|جديد/);
    await expect(card.locator(".tag-soon")).toHaveCount(1);
    // The same subject in both locales, so the inbox can file it.
    await expect(card).toHaveAttribute("href", "mailto:contact@tnajem.com?subject=Tnajem%20pour%20les%20centres");
    // One link, nothing nested inside it.
    await expect(card.locator("a, button")).toHaveCount(0);
  });

  test(`/${locale}/pour-les-profs: no demo button without NEXT_PUBLIC_PROF_DEMO_URL`, async ({ page }) => {
    await page.goto(`/${locale}/pour-les-profs`);
    await expect(page.locator("[data-e2e=profs-demo]")).toHaveCount(0);
    await expect(page.locator("[data-e2e=profs-see-tutors]")).toHaveAttribute("href", `/${locale}/explore`);
    // Honesty rule 1: the « plus tard » pricing line stays, with its /tarifs link.
    const later = page.locator("[data-e2e=profs-later]");
    await expect(later).toContainText(`${COMMISSION_PCT} %`);
    await expect(later.locator(`a[href="/${locale}/tarifs"]`)).toHaveCount(1);
  });
}

/* ── 5. the calculator ─────────────────────────────────────────────────────
   The worked example is 8 students × 2 courses × 20 TND × 4 weeks, the plan picked
   by OPEN classes (e2e/plans.spec.ts proves the catalogue side). Pinned here as the
   figures the page showed before v2, so a restyle can never change them. */
test("the calculator shows the same figures as before v2, in both locales", async ({ page }) => {
  const gross = 8 * 2 * 20 * 4;
  const commission = commissionOn(gross);
  const plan = [...PLANS]
    .filter((p) => p.listed)
    .sort((a, b) => a.monthlyMillimes - b.monthlyMillimes)
    .find((p) => p.maxClasses === null || p.maxClasses >= 2)!;
  const net = gross - commission - tnd(plan.monthlyMillimes);
  expect([gross, commission, net], "the catalogue still gives the pre-v2 example").toEqual([1280, 128, 1123]);

  for (const [locale, cur] of [["fr", "TND"], ["ar", "دينار"]] as const) {
    await page.goto(`/${locale}/pour-les-profs`);
    const calc = page.locator("[data-e2e=profs-income]");
    expect(flat(await calc.locator(".lpp-amount").innerText())).toBe(`1 280 ${cur}`);
    expect(flat(await calc.locator("[data-e2e=lpp-later-net]").innerText())).toBe(`1 123 ${cur}`);
    const text = flat(await calc.innerText());
    expect(text).toContain("8");
    expect(text).toContain("20");
    expect(text).toContain(`− 128`);
    await expect(calc.locator("[data-payment-story]")).toHaveCount(1);
  }
});

/* ── 6. the FAQ JSON-LD ───────────────────────────────────────────────────── */

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const raw = await page.locator('script[type="application/ld+json"]').allTextContents();
  const out: Record<string, unknown>[] = [];
  for (const r of raw) {
    const v = JSON.parse(r); // throws (and fails) on invalid JSON
    for (const n of Array.isArray(v) ? v : [v]) {
      if (n && typeof n === "object" && Array.isArray(n["@graph"])) out.push(...n["@graph"]);
      else out.push(n);
    }
  }
  return out;
}

for (const locale of LOCALES) {
  test(`/${locale}/pour-les-profs: the FAQPage JSON-LD is valid and is the visible FAQ`, async ({ page }) => {
    await page.goto(`/${locale}/pour-les-profs`);
    const nodes = await jsonLd(page);
    const faq = nodes.filter((n) => n["@type"] === "FAQPage");
    expect(faq, "exactly one FAQPage").toHaveLength(1);
    expect(faq[0]["@context"]).toBe("https://schema.org");
    const qs = faq[0].mainEntity as { "@type": string; name: string; acceptedAnswer: { "@type": string; text: string } }[];

    const shown = await page.locator("[data-e2e=profs-faq] details").evaluateAll((els) =>
      els.map((d) => ({
        q: d.querySelector("summary")!.textContent!.trim(),
        a: d.querySelector("summary")!.nextElementSibling!.textContent!.trim(),
      })),
    );
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(qs.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }))).toEqual(shown);
    for (const q of qs) {
      expect(q["@type"]).toBe("Question");
      expect(q.acceptedAnswer["@type"]).toBe("Answer");
    }

    const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList") as { itemListElement: { position: number; item: string }[] };
    expect(crumbs, "a BreadcrumbList").toBeTruthy();
    expect(crumbs.itemListElement.map((i) => i.position)).toEqual([1, 2]);
    expect(crumbs.itemListElement[1].item).toMatch(new RegExp(`^https?://[^/]+/${locale}/pour-les-profs$`));

    // Truth rule: no rating or review markup on a page with no reviews.
    const all = JSON.stringify(nodes);
    expect(all).not.toMatch(/AggregateRating|"Review"/);
  });
}

/* ── 7. nojs ─────────────────────────────────────────────────────────────── */

for (const locale of LOCALES) {
  test(`/${locale}/pour-les-profs with JavaScript off is fully readable`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/${locale}/pour-les-profs`);
    await expect(page.locator("h1")).toBeVisible();
    for (const s of SECTIONS.filter((x) => x !== "profs-dash-card")) {
      const el = page.locator(`[data-e2e=${s}]`);
      await el.scrollIntoViewIfNeeded();
      await expect(el, s).toBeVisible();
      expect(await el.evaluate((n) => Number(getComputedStyle(n).opacity)), `${s} opacity`).toBe(1);
      expect((await el.innerText()).trim().length, `${s} has text`).toBeGreaterThan(10);
    }
    await expect(page.locator(".lp-armed")).toHaveCount(0);
    // The FAQ is native <details>: the first answer is open, the others open without JS.
    const faq = page.locator("[data-e2e=profs-faq] details");
    await expect(faq.first().locator("p")).toBeVisible();
    await faq.nth(1).locator("summary").click();
    await expect(faq.nth(1).locator("p")).toBeVisible();
    await ctx.close();
  });
}
