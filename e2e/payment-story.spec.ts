import { test, expect, type Page } from "@playwright/test";
import { seedTutor, seedClass, seedProfile, seedOffer } from "./support/seed";
import { loginAs } from "./support/session";

/* phase-a lane L3 (A22) — ONE payment story on every public page, in both locales.

   D4: the student pays online, through Tnajem, before the session. The site used
   to also say "directement", "en main propre", "juste avant chaque séance — ou au
   mois", "après", and "Paiement en dinar". This crawler asserts, page by page:
     1. no other payment timing or method appears (FR and AR);
     2. the one sentence only ever appears inside a [data-payment-story] element;
     3. with PAYMENTS_ENABLED off (the suite's setting), every such element carries
        the visible "Bientôt" / "قريب" label — the sentence never reads as true today;
     4. no payment provider, card or e-dinar is named.
   The static twin that the API gate runs is apps/api/test/payment-story.test.ts.

   ADDED, never edited into an existing spec. */

const STORY = {
  fr: { sentence: "Tu paies en ligne, via Tnajem, avant la séance.", tutor: "Tes élèves paient en ligne, via Tnajem, avant la séance.", soon: "Bientôt" },
  ar: { sentence: "تخلّص أونلاين، على Tnajem، قبل الحصة.", tutor: "تلامذتك يخلّصو أونلاين، على Tnajem، قبل الحصة.", soon: "قريب" },
} as const;

const OTHER_STORIES: RegExp[] = [
  /en main propre/i,
  /de la main à la main/i,
  /(paies|payes|règles) (ton|le) prof/i,
  /te paie(nt)? directement/i,
  /directement avec (ton prof|lui)/i,
  /au mois, si tu préfères|ou au mois/i,
  /après la séance|après chaque séance/i,
  /paie(ment)? en dinar/i,
  /paiement direct/i,
  /konnect|clictopay|e-?dinar|flouci|\bD17\b|carte bancaire/i,
  /يد بيد|في يدك|بالشهر(?! الفارط)|تخلّص أستاذك مباشرة|يخلّصك مباشرة|خلاص مباشر|خلّص بالدينار|الخلاص بالدينار/,
];

/* espace prof v2 · growth (phase 5) — ONE allowed sentence, by coordinator decision:
   the monthly offer's note on a tutor's page, the spec's own words
   (MONTHLY_PAYMENT_NOTE in packages/shared/src/offers.ts; the API twin asserts
   these literals equal it). It opens with "Paiement en ligne bientôt" and sits
   beside the "Bientôt" tag. EXACTLY this sentence is cut out of the page text
   before the scan, so every other "règles directement" phrasing is still caught;
   the crawl below visits a tutor WITH a monthly offer, so it is really rendered. */
const ALLOWED = {
  fr: "Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof.",
  ar: "الخلاص أونلاين قريب — للوقت هذا تخلّص أستاذك مباشرة.",
} as const;

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

/** Returns how many times the allowed monthly note was on the page. */
async function checkPage(page: Page, url: string, locale: "fr" | "ar"): Promise<number> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  const raw = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const allowed = count(raw, ALLOWED[locale]);
  const text = raw.split(ALLOWED[locale]).join(" ");

  for (const re of OTHER_STORIES) {
    expect(text, `${url}: another payment story (${re})`).not.toMatch(re);
  }

  /* phase-a/verify-fix (D2): the metadata too — the Google snippet and the link
     preview are copy people read, and /tarifs' description said "L'élève ne paie
     jamais Tnajem" while the visible page was clean. */
  const meta = await page.evaluate(() =>
    ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']
      .map((sel) => document.head.querySelector(sel)?.getAttribute("content") ?? "")
      .join(" "),
  );
  for (const re of [...OTHER_STORIES, /ne paie(nt)? jamais Tnajem|ما يخلّص حتى حاجة لـ Tnajem/i]) {
    expect(meta, `${url}: another payment story in the page metadata (${re})`).not.toMatch(re);
  }

  const stories = page.locator("[data-payment-story]");
  const n = await stories.count();
  for (let i = 0; i < n; i++) {
    const el = stories.nth(i);
    await expect(el, `${url}: payments are off, so the label must be visible`).toHaveAttribute("data-payment-story", "soon");
    await expect(el.getByText(STORY[locale].soon, { exact: true })).toBeVisible();
  }

  const s = STORY[locale];
  const sentences = count(text, s.sentence) + count(text, s.tutor);
  expect(sentences, `${url}: the payment sentence appears outside its labelled element`).toBe(n);
  return allowed;
}

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: every public page tells one payment story, labelled "${STORY[locale].soon}"`, async ({ page }) => {
    const tutor = await seedTutor({ status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 25, hoursFromNow: 96 });
    // growth (phase 5): a monthly offer, so the tutor page renders the allowed note.
    await seedOffer({ tutorId: tutor.id });

    const PUBLIC = [
      "",
      "/explore",
      "/tarifs",
      "/pour-les-profs",
      "/signup/eleve",
      "/signup/prof",
      "/auth",
      `/${tutor.slug}`,
      `/class/${klass.id}`,
      `/checkout?class=${klass.id}`,
    ];
    for (const path of PUBLIC) {
      const notes = await checkPage(page, `/${locale}${path}`, locale);
      if (path === `/${tutor.slug}`) {
        expect(notes, `/${locale}${path}: the monthly offer's note is rendered, once`).toBe(1);
        await expect(page.locator("[data-e2e=offer-payment-note]").getByText(STORY[locale].soon, { exact: true })).toBeVisible();
      }
    }
  });
}

test("the pages that explain payment do carry the one sentence", async ({ page }) => {
  // Not a crawl: the surfaces that must SAY it, so the gate above cannot pass by deletion alone.
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 25, hoursFromNow: 96 });
  /* phase-a/integrate: checkout is behind sign-in (an anonymous visitor lands on
     /auth), so an adult student is signed in for these pages. */
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  await loginAs(page.context(), student.id);
  for (const path of ["/fr", "/fr/tarifs", "/fr/pour-les-profs", `/fr/${tutor.slug}`, `/fr/checkout?class=${klass.id}`]) {
    await page.goto(path);
    await expect(page.locator("[data-payment-story]").first(), path).toBeVisible({ timeout: 15_000 });
  }
});
