import { JsonLd } from "@/components/JsonLd";
import { faqItems } from "@/components/landing/profs-faq";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { SITE_URL } from "@/lib/metadata";

/* /pour-les-profs structured data (profs-v2 · D): the FAQ the page really shows,
   from the same faqItems() as the accordion so the two cannot drift, plus the
   breadcrumb. Page-level only: Organization and WebSite are the layout's.

   TRUTH RULE: no AggregateRating, no Review, nothing the page does not say. */
const copy = bilingual({
  fr: { crumb: "Pour les profs" },
  ar: { crumb: "للأساتذة" },
});

export function ProfsJsonLd({ locale }: { locale: AppLocale }) {
  const home = `${SITE_URL}/${locale}`;
  return (
    <JsonLd
      data={[
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          inLanguage: locale === "ar" ? "ar-TN" : "fr-TN",
          mainEntity: faqItems(locale).map(({ q, a }) => ({
            "@type": "Question",
            name: q,
            acceptedAnswer: { "@type": "Answer", text: a },
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Tnajem", item: home },
            { "@type": "ListItem", position: 2, name: copy[locale].crumb, item: `${home}/pour-les-profs` },
          ],
        },
      ]}
    />
  );
}
