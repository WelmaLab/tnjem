import { test, expect, type Page } from "@playwright/test";
import { seedTutor } from "./support/seed";
import { sql } from "./support/db";

/* home v2 · C — the body sections of the home page.

   1. The nine subject chips link to /explore?subject=<slug>, in order, then
      « Toutes les matières » — and a chip's filter really narrows /explore to that
      subject's tutors (the « francais » chip used to miss a tutor stored with the
      code "francais": ilike folds case, not accents).
   2. #etapes exists (the hero's « Comment ça marche ? » scrolls there).
   3. The honesty strings are on the page, in both languages: step 4's next-step
      line (HOME_V2 rule 3) instead of a repeated price line; the keep-list
      (« Sans engagement », « annulation libre jusqu'à 48h avant »); the payment line
      only through <PaymentStory>, labelled « Bientôt »; the tutor band's pilot
      terms; the banner carries no photo (founder decision, 31 Oct 2026).
   4. No horizontal page overflow at 390 and 360 px, FR and AR.

   ADDED, never edited into an existing spec. */

const SLUGS = ["maths", "physique", "svt", "francais", "anglais", "arabe", "philo", "histoire-geo", "technique"];

const HONEST = {
  fr: {
    step4: "Réserve la suivante ou passe au mois avec ton prof.",
    checks: ["Sans engagement", "Annulation libre jusqu'à 48h avant", "Des profs vérifiés"],
    prof: "Crée ta page gratuitement en 2 minutes, fixe ton tarif, et garde 100 % pendant le pilote.",
    soon: "Bientôt",
    stepsTitle: "En 4 étapes, c'est simple.",
  },
  ar: {
    step4: "احجز الحصة الجاية، ولا اعمل اشتراك شهري مع أستاذك.",
    checks: ["بلا التزام", "تنجّم تلغي حتى 48 ساعة قبل", "أساتذة متثبّت منهم"],
    prof: "اعمل صفحتك فابور في دقيقتين، حدّد ثمنك، و⁦100 %⁩ متاعك في فترة التجربة.",
    soon: "قريب",
    stepsTitle: "في 4 مراحل، الحكاية ساهلة.",
  },
} as const;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: the subject chips link to the nine /explore filters, Maths first and active`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const links = page.locator("[data-e2e=home-subjects] nav a");
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual([...SLUGS.map((s) => `/${locale}/explore?subject=${s}`), `/${locale}/explore`]);
    // Tap targets: every chip is at least 44px tall.
    for (const box of await links.evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
  });

  test(`/${locale}: #etapes, the honesty strings and the keep-list`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const h = HONEST[locale];

    const steps = page.locator("section#etapes");
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("heading", { level: 2 })).toHaveText(h.stepsTitle);
    await expect(steps.locator("li")).toHaveCount(4);
    const stepsText = norm(await steps.innerText());
    expect(stepsText).toContain(h.step4);
    // Rule 3: step 4 no longer repeats the price line.
    expect(stepsText).not.toContain("Le prof affiche son tarif avant que tu réserves");
    expect(stepsText).not.toContain("الأستاذ يبيّن ثمنو قبل ما تحجز");

    // The one payment sentence, only through <PaymentStory>, labelled while payments are off.
    const story = page.locator("[data-e2e=home-facts] [data-payment-story]");
    await expect(story).toHaveCount(1);
    await expect(story).toHaveAttribute("data-payment-story", "soon");
    await expect(story.getByText(h.soon, { exact: true })).toBeVisible();

    const cta = page.locator("[data-e2e=home-cta]");
    for (const label of h.checks) await expect(cta.getByText(label, { exact: true })).toBeVisible();
    await expect(cta.locator(`a[href="/${locale}/explore"]`)).toBeVisible();

    // Founder decision: the banner ships WITHOUT a photo — no stock image may slip in.
    await expect(cta.locator("img, picture, svg image")).toHaveCount(0);

    const prof = page.locator("[data-e2e=home-prof]");
    expect(norm(await prof.innerText())).toContain(norm(h.prof));
    await expect(prof.locator(`a[href="/${locale}/pour-les-profs"]`)).toBeVisible();
  });

  for (const width of [390, 360]) {
    test(`/${locale} at ${width}px: no horizontal page overflow, the chips scroll inside their row`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}`);
      await page.waitForLoadState("networkidle");
      await assertNoPageOverflow(page, `/${locale} @${width}`);
      const nav = page.locator("[data-e2e=home-subjects] nav");
      const { sw, cw } = await nav.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(sw, "the chip row is a sideways scroller on a phone").toBeGreaterThan(cw);
    });
  }
}

test("a chip's filter really returns that subject's tutors", async ({ page }) => {
  const maths = await seedTutor({ status: "verified" }); // subject 'Mathématiques'
  const fr = await seedTutor({ status: "verified" });
  // The stored-code form of the subject — the case the « Français » term missed.
  await sql`update tutors set subject = 'francais' where id = ${fr.id}`;

  await page.goto("/fr");
  await page.locator('[data-e2e=home-subjects] a[href="/fr/explore?subject=francais"]').click();
  await expect(page).toHaveURL(/\/fr\/explore\?subject=francais$/);
  await expect(page.locator("#main").getByRole("button", { name: "Français", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`a[href="/fr/${fr.slug}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/fr/${maths.slug}"]`)).toHaveCount(0);

  await page.goto("/fr");
  await page.locator('[data-e2e=home-subjects] a[href="/fr/explore?subject=maths"]').click();
  await expect(page).toHaveURL(/\/fr\/explore\?subject=maths$/);
  await expect(page.locator("#main").getByRole("button", { name: "Maths", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`a[href="/fr/${maths.slug}"]`)).toBeVisible();
  await expect(page.locator(`a[href="/fr/${fr.slug}"]`)).toHaveCount(0);
});

async function assertNoPageOverflow(page: Page, label: string) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(cw);
}
