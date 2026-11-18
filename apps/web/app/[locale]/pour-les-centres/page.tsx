import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { CentresHero } from "@/components/centres/CentresHero";
import { CentresJsonLd } from "@/components/centres/CentresJsonLd";
import { CentreLeadSection } from "@/components/centres/CentreLeadSection";
import { CentresPacks, CentresPoints } from "@/components/centres/CentresSections";
import { PAGE_PATH, pageCopy } from "@/components/centres/centres-copy";
import { DEFAULT_LOCALE, isLocale, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* ── /pour-les-centres (december-sprint · B, D12) ──────────────────────────────
   The page a tutoring centre is sent to: the December camp, online, ready in 72
   hours, and a lead form (D13). Built like /pour-les-profs: a SERVER COMPONENT,
   prerendered per locale (the layout's generateStaticParams). It reads no cookies(),
   headers() or searchParams — the UTM parameters are read in the browser by the form
   (components/centres/CentreLeadForm.tsx), so the page stays static.

   HONESTY. The French copy is DECEMBER_SPRINT.md's, word for word. No price while
   SHOW_PACK_PRICES is off (not in the HTML, not in the JSON-LD), no refund line while
   SHOW_REFUND_GUARANTEE is off, no commission promise beyond « ce pack ». The 18+
   pilot rule is stated, not hidden. No count, rating or testimonial. */

function localeOf(raw: string): AppLocale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = localeOf((await props.params).locale);
  const c = pageCopy[locale];
  return pageMetadata({ locale, path: PAGE_PATH, title: c.metaTitle, description: c.metaDescription });
}

export default async function PourLesCentresPage(props: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await props.params).locale);
  return (
    <SiteShell>
      <CentresJsonLd locale={locale} />
      <CentresHero locale={locale} />
      <CentresPoints locale={locale} />
      <CentresPacks locale={locale} />
      <CentreLeadSection locale={locale} />
    </SiteShell>
  );
}
