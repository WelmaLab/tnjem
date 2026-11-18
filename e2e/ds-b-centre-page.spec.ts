import { test, expect } from "@playwright/test";
import { CENTRE_PACKS, isValidSlug, RESERVED_SLUGS, SUPPORT_HOURS } from "@tnajem/shared";
import { centrePoints, centresJsonLd, centreWhatsAppHref, packsView } from "../apps/web/components/centres/centres-offer";
import { attributionFrom } from "../apps/web/components/centres/attribution";

/* december-sprint · B (D12, D14) — /pour-les-centres.

   1. FR + AR render the founder's copy, at 320 / 390 / 768 / 1440, with no
      horizontal overflow; the page is static and has its metadata and hreflang.
   2. SHOW_PACK_PRICES is off: no amount anywhere — not in the HTML, not in the
      JSON-LD — and the « Prix sur demande » line instead. Both sides of every switch
      are tested on the pure helpers (components/centres/centres-offer.ts).
   3. NEXT_PUBLIC_SUPPORT_WHATSAPP is blank in the suite (playwright.config.ts): no
      WhatsApp element on the page or in the footer. The helper is tested with a number.
   4. The route is reserved: no tutor can take the slug, and the header and footer
      link to it. ADDED as its own spec. */

const COPY = {
  fr: {
    h1: "Votre stage de décembre, aussi en ligne. Prêt en 72 heures.",
    lead: "Tnajem met en ligne les cours de votre centre : une page par prof, votre planning et les réservations. Vous gardez vos élèves, vos prix et vos profs.",
    demo: "Demander une démo de 10 minutes",
    know: "Pendant le pilote, les élèves doivent avoir 18 ans ou plus. Cela couvre les classes de Bac et les adultes.",
    onRequest: "Prix sur demande. Réponse sous 24 heures.",
    nav: "Pour les centres",
  },
  ar: {
    h1: "ستاج ديسمبر متاعك، أونلاين زادة. حاضر في 72 ساعة.",
    lead: "تنجّم تحضّرلك فضاء أونلاين باسم المركز: صفحة لكل أستاذ، البرنامج والحجز. تلامذتك، أسوامك وأساتذتك يقعدوا عندك.",
    demo: "اطلب ديمو في 10 دقايق",
    know: "في فترة التجربة، لازم التلامذة يكون عمرهم 18 سنة ولا أكثر. هذا يشمل أقسام الباك والكبار.",
    onRequest: "السوم على حساب الطلب. نجاوبوك في ظرف 24 ساعة.",
    nav: "للمراكز",
  },
} as const;

const FR_POINTS = [
  "On s'occupe de l'installation. Il nous faut 30 minutes de votre temps et la liste de vos profs.",
  "Vos élèves réservent avec un lien ou un QR code affiché au centre.",
  "Les cours se font en direct sur Zoom ou Meet, comme d'habitude.",
  "Vous recevez un rapport des réservations à la fin du stage.",
  "Prix fixe pour ce pack, sans commission sur vos élèves. Ils vous paient directement, comme d'habitude.",
];
const REMINDER = "Vos élèves reçoivent un rappel par email 24 h et 1 h avant chaque cours.";

/** Any pack amount, written the way the page would write it. */
const AMOUNTS = CENTRE_PACKS.flatMap((p) => [String(p.priceTndHt), p.priceTndHt.toLocaleString("fr-FR")]);

/* The marketplace payment-story patterns of e2e/payment-story.spec.ts (read, not
   imported: that spec must stay unchanged). Gate amendment 1: the centre page's
   Arabic must not trip them. */
const AR_STORY = /يد بيد|في يدك|بالشهر(?! الفارط)|تخلّص أستاذك مباشرة|يخلّصك مباشرة|خلاص مباشر|خلّص بالدينار|الخلاص بالدينار/;

for (const locale of ["fr", "ar"] as const) {
  const c = COPY[locale];

  test(`/${locale}/pour-les-centres renders the copy, with no overflow from 320 to 1440`, async ({ page }) => {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/pour-les-centres`);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
      await expect(page.locator("h1")).toHaveText(c.h1);
      await expect(page.locator("main p.web-lead")).toHaveText(c.lead);
      await expect(page.locator("[data-e2e=centres-demo]")).toHaveText(c.demo);
      await expect(page.locator("[data-e2e=centres-demo]")).toHaveAttribute("href", "#demo");
      await expect(page.locator("[data-e2e=centres-know]")).toContainText(c.know);
      await expect(page.locator("[data-e2e=centres-on-request]")).toHaveText(c.onRequest);
      await expect(page.locator("[data-e2e=centres-packs] [data-pack]")).toHaveCount(CENTRE_PACKS.length);
      await expect(page.locator("#demo [data-e2e=centre-lead-form]")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${width}px: horizontal overflow`).toBeLessThanOrEqual(0);
    }
    if (locale === "fr") {
      expect(await page.locator("[data-e2e=centres-points] li p").allTextContents()).toEqual(FR_POINTS);
    } else {
      expect(await page.locator("main").innerText()).not.toMatch(AR_STORY);
    }
  });

  test(`/${locale}/pour-les-centres: no amount and no WhatsApp anywhere, JSON-LD without a price`, async ({ page, request }) => {
    const res = await request.get(`/${locale}/pour-les-centres`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    for (const a of AMOUNTS) expect(html, `amount ${a} in the HTML`).not.toContain(`${a} TND`);
    expect(html).not.toMatch(/priceCurrency|"price"/);
    expect(html).not.toContain("wa.me");

    await page.goto(`/${locale}/pour-les-centres`);
    const text = await page.locator("body").innerText();
    for (const a of AMOUNTS) expect(text).not.toContain(a);
    await expect(page.locator("[data-e2e=centres-pack-price]")).toHaveCount(0);
    await expect(page.locator('a[href*="wa.me"], [data-e2e=centres-whatsapp], [data-e2e=centres-contact-whatsapp], [data-e2e=footer-whatsapp]')).toHaveCount(0);
    await expect(page.locator("[data-e2e=centres-contact-email]")).toHaveAttribute("href", "mailto:contact@tnajem.com");

    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const ld = blocks.flatMap((b) => {
      const v = JSON.parse(b);
      return Array.isArray(v) ? v : [v];
    });
    const service = ld.find((d) => d["@type"] === "Service");
    expect(service, "a Service block").toBeTruthy();
    expect(service.url).toMatch(new RegExp(`/${locale}/pour-les-centres$`));
    expect(JSON.stringify(service)).not.toMatch(/price/i);
    const crumbs = ld.find((d) => d["@type"] === "BreadcrumbList");
    expect(crumbs.itemListElement[1].name).toBe(c.nav);
    expect(JSON.stringify(ld)).not.toMatch(/AggregateRating|Review/);

    // Metadata: canonical + hreflang, its own title.
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/${locale}/pour-les-centres$`));
    await expect(page.locator('link[rel="alternate"][hreflang="fr-TN"]')).toHaveAttribute("href", /\/fr\/pour-les-centres$/);
    await expect(page.locator('link[rel="alternate"][hreflang="ar-TN"]')).toHaveAttribute("href", /\/ar\/pour-les-centres$/);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", new RegExp(`/${locale}/pour-les-centres$`));
  });

  test(`/${locale}: the header and the footer link to /${locale}/pour-les-centres`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await expect(page.locator("nav.qh-nav").getByRole("link", { name: c.nav })).toHaveAttribute("href", `/${locale}/pour-les-centres`);
    await expect(page.locator("[data-e2e=footer-centres]")).toHaveAttribute("href", `/${locale}/pour-les-centres`);
    await expect(page.locator("[data-e2e=footer-hours]")).toHaveText(SUPPORT_HOURS[locale]);
    await page.goto(`/${locale}/pour-les-centres`);
    await expect(page.locator("nav.qh-nav").getByRole("link", { name: c.nav })).toHaveAttribute("aria-current", "page");
  });
}

test("the sitemap lists both locales with hreflang", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toMatch(/<loc>[^<]*\/fr\/pour-les-centres<\/loc>/);
  expect(xml).toMatch(/<loc>[^<]*\/ar\/pour-les-centres<\/loc>/);
  expect(xml).toMatch(/hreflang="ar-TN" href="[^"]*\/ar\/pour-les-centres"/);
});

test("no tutor can take the slug « pour-les-centres »", () => {
  expect(RESERVED_SLUGS).toContain("pour-les-centres");
  expect(isValidSlug("pour-les-centres")).toBe(false);
});

test.describe("the switches, both sides (pure helpers)", () => {
  test("SHOW_PACK_PRICES: hidden → no amount and the on-request line; shown → « 1 490 TND HT »", () => {
    for (const locale of ["fr", "ar"] as const) {
      const hidden = packsView(locale, { showPrices: false });
      expect(hidden.onRequest).toBe(COPY[locale].onRequest);
      expect(hidden.packs.every((p) => p.price === null)).toBe(true);
      expect(JSON.stringify(hidden)).not.toMatch(/\d{3}/);
    }
    const shown = packsView("fr", { showPrices: true });
    expect(shown.onRequest).toBeNull();
    expect(shown.packs.map((p) => p.price)).toEqual(["350 TND HT", "790 TND HT", "1 490 TND HT"].map((s) => s.replace(" 490", " 490")));
    expect(shown.packs.find((p) => p.code === "fondateur")?.cap).toBe("10 centres seulement");
    expect(packsView("ar", { showPrices: true }).packs[0].price).toBe("350 دينار بلا أداءات");
  });

  test("the JSON-LD carries a price only while prices are shown", () => {
    const text = { crumb: "Pour les centres", name: "x", description: "y" };
    expect(JSON.stringify(centresJsonLd("fr", "https://tnajem.com", text, { showPrices: false }))).not.toMatch(/price/i);
    const shown = JSON.stringify(centresJsonLd("fr", "https://tnajem.com", text, { showPrices: true }));
    expect(shown).toContain('"priceCurrency":"TND"');
    expect(shown).toContain('"price":1490');
  });

  test("SHOW_REMINDERS_LINE: off → the five points; on → the reminder point is added", () => {
    expect(centrePoints("fr", { reminders: false }).map((p) => p.text)).toEqual(FR_POINTS);
    expect(centrePoints("fr", { reminders: true }).map((p) => p.text)).toEqual([...FR_POINTS, REMINDER]);
    expect(centrePoints("ar", { reminders: true })).toHaveLength(6);
    for (const p of centrePoints("ar", { reminders: true })) expect(p.text).not.toMatch(AR_STORY);
  });

  test("WhatsApp: hidden while the number is empty or invalid, a prefilled wa.me link with one", () => {
    for (const raw of [undefined, "", "  ", "+21612345678", "216 12 345 678"]) {
      expect(centreWhatsAppHref(raw, "fr"), String(raw)).toBeNull();
    }
    expect(centreWhatsAppHref("21612345678", "fr")).toBe(
      `https://wa.me/21612345678?text=${encodeURIComponent("Bonjour Tnajem, je voudrais une démo pour mon centre.")}`,
    );
    expect(centreWhatsAppHref("21612345678", "ar")).toBe(
      `https://wa.me/21612345678?text=${encodeURIComponent("عسلامة Tnajem، نحب ديمو للمركز متاعي.")}`,
    );
  });

  test("attribution: UTM kept, an outside referrer as origin + path only, own pages ignored", () => {
    expect(attributionFrom("?utm_source=whatsapp&utm_medium=dm", "", "https://tnajem.com")).toEqual({
      utmSource: "whatsapp", utmMedium: "dm", utmCampaign: undefined, referrer: undefined,
    });
    expect(attributionFrom("", "https://www.facebook.com/groups/x?fbclid=secret", "https://tnajem.com")?.referrer).toBe(
      "https://www.facebook.com/groups/x",
    );
    expect(attributionFrom("", "https://tnajem.com/fr/pour-les-profs", "https://tnajem.com")).toBeNull();
    expect(attributionFrom("", "not a url", "https://tnajem.com")).toBeNull();
    expect(attributionFrom(`?utm_source=${"x".repeat(300)}`, "", "https://tnajem.com")?.utmSource).toHaveLength(100);
  });
});
