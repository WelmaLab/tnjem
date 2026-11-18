import { test, expect, type Page } from "@playwright/test";
import { CONTACT_EMAIL, SUPPORT_HOURS } from "@tnajem/shared";

/* december sprint · C (D23) — THE PRICING WORDS, crawled.

   The founder replaced the « gratuit pendant le pilote / 0 % / tu gardes 100 % »
   framing with one rule (DECEMBER_SPRINT.md, "Pricing rule", as amended at the gate
   on 18 Nov): 3 months without a subscription, then a plan; 10 % on every paying
   student, taken only on payments that go through Tnajem; online payment is not open,
   so Tnajem takes nothing yet.

   This spec visits the tutor-facing pages in both locales and asserts:
     1. none of the removed phrases is rendered — body text, and the meta, Open Graph
        and Twitter descriptions (except /signup/prof's metadata, which lane A owns);
     2. the approved wording is where it is expected;
     3. /aide keeps today's sentence « pour l'instant, ton élève te paie hors Tnajem »,
        and its WhatsApp block — with the support hours — stays hidden while
        NEXT_PUBLIC_SUPPORT_WHATSAPP is empty (the suite pins it empty).

   « pilote » itself is NOT banned: it stays where it describes the 18+ rule,
   payments being off, or cancellation amounts recorded and not charged.

   ADDED, never edited into an existing spec. */

const PATHS = ["", "/pour-les-profs", "/tarifs", "/aide", "/signup/prof"] as const;

/** The removed wording, as rendered (case-insensitive in French). */
const GONE: Record<"fr" | "ar", RegExp[]> = {
  fr: [
    /gratuit pendant le pilote/i,
    /0 % aujourd'hui/i,
    /0 % de commission/i,
    /pas d'abonnement/i,
    /tu gardes 100/i,
    /garde 100 %/i,
    /aucune de ces offres n'est encore facturée/i,
    /inclus pendant le pilote/i,
    /100 % pour toi/i,
    /tu gardes tout/i,
  ],
  ar: [
    /⁦?0 %⁩? ?عمولة/,
    /تحتفظ بـ ⁦?100/,
    /فابور في فترة التجربة/,
    /⁦?100 %⁩? متاعك/,
    /تحتفظ بالكل/,
    /موجود في فترة التجربة/,
    /* « بلا اشتراك » is the approved badge's own words (« 3 شهور بلا اشتراك »), so it
       is banned only on its own — the old « Pas d'abonnement » check. */
    /(?<!شهور )(?<!\()بلا اشتراك/,
  ],
};

const APPROVED = {
  fr: {
    badge: "3 mois sans abonnement",
    short: "3 mois sans abonnement. 10 % sur chaque élève payant, dès que le paiement passe par Tnajem.",
    long1: "Tnajem coûte deux choses au prof. Un abonnement mensuel, offert pendant tes 3 premiers mois. Et 10 % sur chaque élève payant. Rien sur une séance que tu offres.",
    long2: "Les 10 % sont prélevés sur les paiements qui passent par Tnajem. Le paiement en ligne n'est pas encore ouvert. D'ici là, Tnajem ne prélève rien.",
    planButton: "Offert tes 3 premiers mois",
    freeCta: "Commencer gratuitement",
    notice: "On te préviendra avant l'ouverture du paiement en ligne.",
    aideQ: "Comment je suis payé ?",
    aideKept: "pour l'instant, ton élève te paie hors Tnajem",
  },
  ar: {
    badge: "3 شهور بلا اشتراك",
    short: "3 شهور بلا اشتراك. ⁦10 %⁩ على كل تلميذ خلّص، كي الخلاص يعدّي من Tnajem.",
    long1: "Tnajem تكلّف الأستاذ زوز حاجات. اشتراك شهري، فابور في أول 3 شهور متاعك. و ⁦10 %⁩ على كل تلميذ خلّص. والو على حصة إنتي تعطيها بلاش.",
    long2: "العمولة متاع ⁦10 %⁩ تتخصم من الخلاص اللي يعدّي من Tnajem. الخلاص أونلاين ما زال ما تحلّش. لين يتحلّ، Tnajem ما تاخذ حتى شي.",
    planButton: "فابور في أول 3 شهور متاعك",
    freeCta: "ابدا فابور",
    notice: "باش نعلموك قبل ما يتحلّ الخلاص أونلاين.",
    aideQ: "كيفاش نتخلّص ؟",
    aideKept: "للوقت هذا، التلميذ يخلّصك برّا Tnajem",
  },
} as const;

const flat = (s: string) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

async function bodyText(page: Page): Promise<string> {
  return flat(await page.locator("body").innerText());
}

async function metaText(page: Page): Promise<string> {
  return flat(
    await page.evaluate(() =>
      ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']
        .map((sel) => document.head.querySelector(sel)?.getAttribute("content") ?? "")
        .join(" | "),
    ),
  );
}

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: no removed pricing wording on the tutor pages, body or metadata`, async ({ page }) => {
    for (const path of PATHS) {
      const url = `/${locale}${path}`;
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const body = await bodyText(page);
      for (const re of GONE[locale]) expect(body, `${url}: removed wording ${re}`).not.toMatch(re);
      // /signup/prof's metadata is lane A's: only its body text is this lane's.
      if (path !== "/signup/prof") {
        const meta = await metaText(page);
        for (const re of GONE[locale]) expect(meta, `${url} metadata: removed wording ${re}`).not.toMatch(re);
      }
    }
  });

  test(`/${locale}: the approved wording is where it is expected`, async ({ page }) => {
    const w = APPROVED[locale];

    await page.goto(`/${locale}`);
    expect(flat(await page.locator("[data-e2e=home-prof]").innerText())).toContain(w.short);

    await page.goto(`/${locale}/pour-les-profs`);
    const profs = await bodyText(page);
    expect(profs).toContain(w.badge);
    expect(profs, "the FAQ answers with the long version, both parts").toContain(`${w.long1} ${w.long2}`);
    for (const sel of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      const content = flat((await page.locator(`head ${sel}`).getAttribute("content")) ?? "");
      expect(content, `${sel} ends with the short line`).toContain(w.short);
    }

    await page.goto(`/${locale}/tarifs`);
    const tarifs = await bodyText(page);
    expect(tarifs, "the hero is the long version, part 1").toContain(w.long1);
    // The banner is chosen from the real flag; the suite runs with payments off.
    const banner = flat(await page.locator("main .note-info").first().innerText());
    expect(banner).toBe(`${w.long2} ${w.notice}`);
    /* Every PAID plan says the approved plan button; the Gratuit card — first in the
       grid — keeps its own free-plan CTA (it never costs anything). */
    const ctas = (await page.locator("[data-e2e=plan-cta]").allInnerTexts()).map(flat);
    expect(ctas.length).toBeGreaterThanOrEqual(4);
    expect(ctas[0], "Gratuit").toBe(w.freeCta);
    for (const t of ctas.slice(1)) expect(t).toBe(w.planButton);
    // The worked example: 1 000 collected, and 900 in the first 3 months, shown first.
    expect(flat(await page.locator("[data-e2e=tarifs-ex-free]").innerText())).toMatch(/\b900 /);
    const rows = await page.locator(".tf-ex-row").allInnerTexts();
    expect(rows.findIndex((r) => /\b900 /.test(flat(r))), "the first-months row comes before the one after").toBeLessThan(
      rows.findIndex((r) => /\b841 /.test(flat(r))),
    );
    expect(tarifs).toContain(w.notice);

    await page.goto(`/${locale}/aide`);
    const card = page.locator("#paiement");
    await expect(card.locator("h2")).toHaveText(w.aideQ);
    const aide = flat(await card.innerText());
    expect(aide).toContain(w.long1);
    expect(aide).toContain(w.long2);
    expect(aide, "today's sentence stays as it is").toContain(w.aideKept);
    expect(aide).toContain(w.notice);
  });

  test(`/${locale}/aide: with no WhatsApp number, the mailbox and the support hours`, async ({ page }) => {
    await page.goto(`/${locale}/aide`);
    // The suite pins NEXT_PUBLIC_SUPPORT_WHATSAPP empty: no WhatsApp anywhere on the page.
    await expect(page.locator("a[href^='https://wa.me/']")).toHaveCount(0);
    await expect(page.locator("[data-e2e=aide-mail]")).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
    await expect(page.locator("[data-e2e=aide-hours]")).toHaveText(SUPPORT_HOURS[locale]);
  });
}

test("the removed wording is gone from llms.txt, and the rule is stated", async ({ request }) => {
  const res = await request.get("/llms.txt");
  expect(res.ok()).toBe(true);
  const txt = await res.text();
  for (const re of [/0% is a property of the pilot/i, /takes no commission/i, /Every plan below is free right now/i]) {
    expect(txt, `${re}`).not.toMatch(re);
  }
  expect(txt).toContain("A monthly subscription, free for the first 3 months.");
  expect(txt).toContain("10 % on each paying student");
  expect(txt).toContain("Online payment is not open yet. Until then, Tnajem takes nothing.");
});
