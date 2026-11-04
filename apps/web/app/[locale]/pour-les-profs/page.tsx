import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { FaqSection } from "@/components/landing/FaqSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { IncomeSection } from "@/components/landing/IncomeSection";
import { PilotSection } from "@/components/landing/PilotSection";
import { ProfsHero } from "@/components/landing/ProfsHero";
import { ProfsJsonLd } from "@/components/landing/ProfsJsonLd";
import { ProfsStepsSection } from "@/components/landing/ProfsStepsSection";
import { RoleChoiceSection } from "@/components/landing/RoleChoiceSection";
import { StudentLine } from "@/components/landing/StudentLine";
import { bilingual } from "@/lib/i18n";
import { DEFAULT_LOCALE, isLocale, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* ── SERVER COMPONENT (profs-v2 · D) ───────────────────────────────────────────
   /pour-les-profs, the tutor landing page. It used to be one big "use client"
   module: the copy of BOTH locales shipped as JavaScript and hydrated, to render
   text. Each section is now a server component with its own FR/AR copy, and the
   locale comes from the URL segment.

   STATIC. Prerendered per locale at build (the layout's generateStaticParams).
   Reads no cookies() / headers() / searchParams: any of those would silently make
   it dynamic, and e2e/static-render.spec.ts asserts it is served from the cache.

   HONESTY. Tnajem processes no money during the pilot: 0 % is a property of the
   pilot, never promised as permanent, and the commission and subscription are
   always time-qualified. No counts, testimonials, ratings or earnings claimed as
   real: the only money figure is the calculator's arithmetic example. */

/* TUTOR-FACING, on purpose. Tutors forward this page to recruit other tutors, and
   its WhatsApp card used to show the site-wide student pitch. The layout's template
   appends « · Tnajem » to the title. */
const copy = bilingual({
  fr: {
    title: "Donne tes cours en ligne",
    description:
      "Profs : crée ta page, fixe ton tarif et donne tes cours en direct. Pendant le pilote : création gratuite, 0 % de commission, pas d'abonnement.",
  },
  ar: {
    title: "اعطي دروسك أونلاين",
    description:
      "أساتذة : اعمل صفحتك، حدّد تعريفتك واعطي دروسك مباشرة. في فترة التجربة : صفحة فابور، \u20660 %\u2069 عمولة، بلا اشتراك.",
  },
});

function localeOf(raw: string): AppLocale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = localeOf((await props.params).locale);
  return pageMetadata({
    locale,
    path: "/pour-les-profs",
    ...copy[locale],
    ogImage: `/${locale}/pour-les-profs/opengraph-image`, // this folder's opengraph-image.tsx
  });
}

export default async function PourLesProfsPage(props: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await props.params).locale);
  return (
    <SiteShell>
      <ProfsJsonLd locale={locale} />
      <ProfsHero locale={locale} />
      <RoleChoiceSection locale={locale} />
      <FeaturesSection locale={locale} />
      <ProfsStepsSection locale={locale} />
      <IncomeSection locale={locale} />
      <FaqSection locale={locale} />
      <PilotSection locale={locale} />
      <StudentLine locale={locale} />
    </SiteShell>
  );
}
