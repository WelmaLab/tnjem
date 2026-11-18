/* december-sprint · B (D12, D14) — what /pour-les-centres says about the offer,
   decided by the switches in @tnajem/shared/centres. PURE (no React, no CSS, no
   server-only), so e2e/ds-b-centre-page.spec.ts can test both sides of every switch
   without a rebuild.

   TRUTH RULE: while SHOW_PACK_PRICES is false no amount may reach the page — not in
   the HTML, not in the JSON-LD. packsView() is the only place an amount is formatted,
   and it returns none at all while the switch is off. The refund line does not exist
   while SHOW_REFUND_GUARANTEE is off (and no refund wording is written yet: the
   founder has not given one, so turning the switch on adds nothing until he does). */
import {
  CENTRE_PACKS,
  SHOW_PACK_PRICES,
  SHOW_REMINDERS_LINE,
  supportWhatsAppHref,
  type CentrePack,
} from "@tnajem/shared";
/** The app's two locales (lib/locale.ts AppLocale), spelled out: e2e imports this file and has no "@/" alias. */
type AppLocale = "fr" | "ar";

type L = AppLocale;

/** The five key points, word for word (DECEMBER_SPRINT.md, D12), then the reminder
    point of gate amendment 8 when SHOW_REMINDERS_LINE is on. */
const POINTS: Record<L, readonly string[]> = {
  fr: [
    "On s'occupe de l'installation. Il nous faut 30 minutes de votre temps et la liste de vos profs.",
    "Vos élèves réservent avec un lien ou un QR code affiché au centre.",
    "Les cours se font en direct sur Zoom ou Meet, comme d'habitude.",
    "Vous recevez un rapport des réservations à la fin du stage.",
    "Prix fixe pour ce pack, sans commission sur vos élèves. Ils vous paient directement, comme d'habitude.",
  ],
  /* Gate amendment 1: the fifth point is about the centre's OWN pupils paying the
     centre, and its Arabic must not read as a marketplace payment story
     (e2e/payment-story.spec.ts, OTHER_STORIES): no « مباشرة », no « خلاص مباشر ». */
  ar: [
    "إحنا نتكفّلو بالتحضير الكل. نحتاجو 30 دقيقة من وقتك وليستة أساتذتك.",
    "تلامذتك يحجزو بلينك ولا بـ QR code معلّق في المركز.",
    "الدروس تصير لايف على Zoom ولا Meet، كيما العادة.",
    "في آخر الستاج يوصلك تقرير على الحجوزات.",
    "سوم ثابت للعرض هذا، بلا عمولة على تلامذتك. يخلّصوك هوما كيما العادة.",
  ],
};

const REMINDER_POINT: Record<L, string> = {
  fr: "Vos élèves reçoivent un rappel par email 24 h et 1 h avant chaque cours.",
  ar: "تلامذتك يوصلهم تذكير بالإيميل قبل كل درس بـ 24 ساعة وبساعة.",
};

export type PointIcon = "settings" | "qr" | "video" | "chart" | "wallet" | "bell";
const ICONS: readonly PointIcon[] = ["settings", "qr", "video", "chart", "wallet"];

export function centrePoints(locale: L, opts: { reminders: boolean } = { reminders: SHOW_REMINDERS_LINE }) {
  const out = POINTS[locale].map((text, i) => ({ text, icon: ICONS[i] }));
  if (opts.reminders) out.push({ text: REMINDER_POINT[locale], icon: "bell" });
  return out;
}

const ON_REQUEST: Record<L, string> = {
  fr: "Prix sur demande. Réponse sous 24 heures.",
  ar: "السوم على حساب الطلب. نجاوبوك في ظرف 24 ساعة.",
};
const CAP: Record<L, (n: number) => string> = {
  fr: (n) => `${n} centres seulement`,
  ar: (n) => `${n} مراكز برك`,
};
const HT: Record<L, string> = { fr: "TND HT", ar: "دينار بلا أداءات" };

/** Western digits in both locales, grouped like the rest of the site (« 1 490 »). */
const nf = (v: number) => v.toLocaleString("fr-FR");

export type PackView = { code: CentrePack["code"]; name: string; cap: string | null; price: string | null };

/** The packs as the page shows them. `price` is null for every pack, and
    `onRequest` is the « Prix sur demande » line, while prices are hidden. */
export function packsView(
  locale: L,
  opts: { showPrices: boolean } = { showPrices: SHOW_PACK_PRICES },
  packs: readonly CentrePack[] = CENTRE_PACKS,
): { packs: PackView[]; onRequest: string | null } {
  return {
    packs: packs.map((p) => ({
      code: p.code,
      name: p.name[locale],
      cap: p.maxCentres ? CAP[locale](p.maxCentres) : null,
      price: opts.showPrices ? `${nf(p.priceTndHt)} ${HT[locale]}` : null,
    })),
    onRequest: opts.showPrices ? null : ON_REQUEST[locale],
  };
}

/** The text a WhatsApp chat opened from this page starts with, in its language. */
export const CENTRE_WHATSAPP_MESSAGE: Record<L, string> = {
  fr: "Bonjour Tnajem, je voudrais une démo pour mon centre.",
  ar: "عسلامة Tnajem، نحب ديمو للمركز متاعي.",
};

/** wa.me link for this page, or null (and no WhatsApp element at all) while
    NEXT_PUBLIC_SUPPORT_WHATSAPP is empty — the one source (gate amendment 2). */
export function centreWhatsAppHref(raw: string | null | undefined, locale: L): string | null {
  return supportWhatsAppHref(raw, CENTRE_WHATSAPP_MESSAGE[locale]);
}

/* ── structured data ──────────────────────────────────────────────────────────
   Page-level only (Organization and WebSite are the layout's): the breadcrumb, and
   the service the page describes. An Offer with a price exists ONLY while
   SHOW_PACK_PRICES is on; while it is off the JSON-LD names the packs and nothing
   else — no price, no priceCurrency, no "0". No rating, no review (truth rule). */
export function centresJsonLd(
  locale: L,
  site: string,
  text: { crumb: string; name: string; description: string },
  opts: { showPrices: boolean } = { showPrices: SHOW_PACK_PRICES },
): object[] {
  const home = `${site}/${locale}`;
  const url = `${home}/pour-les-centres`;
  const view = packsView(locale, opts);
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: text.name,
      description: text.description,
      url,
      inLanguage: locale === "ar" ? "ar-TN" : "fr-TN",
      serviceType: locale === "ar" ? "تحضير دروس المراكز أونلاين" : "Mise en ligne des cours d'un centre de soutien",
      areaServed: { "@type": "Country", name: "Tunisie" },
      provider: { "@type": "Organization", name: "Tnajem", url: site },
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: text.crumb,
        itemListElement: CENTRE_PACKS.map((p, i) => ({
          "@type": "Offer",
          name: view.packs[i].name,
          ...(opts.showPrices
            ? { price: p.priceTndHt, priceCurrency: "TND", priceSpecification: { "@type": "PriceSpecification", price: p.priceTndHt, priceCurrency: "TND", valueAddedTaxIncluded: false } }
            : {}),
        })),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Tnajem", item: home },
        { "@type": "ListItem", position: 2, name: text.crumb, item: url },
      ],
    },
  ];
}
