"use client";
/* ───────────────────────────────────────────────────────────────────────────
   /pour-les-profs — Tnajem TUTOR (teacher) landing page.
   "Shopify for Tunisian tutors": branded page, live classes, you set your price.

   FREE PILOT: Tnajem processes no money; we take 0 % commission and issue no
   payouts. The one payment story (D4, phase-a lane L3 A22) is <PaymentStory>:
   online, through Tnajem, before the session — labelled "Bientôt". Online payment, the
   subscription plans and the 10 % commission are FUTURE — every mention of them
   on this page is time-qualified ("plus tard", "quand…"), never stated as a
   current feature. Equally, the 0 % is never promised as permanent: it is a
   property of the pilot. Full model on /tarifs.
   Zero lessons taught, zero tutors, zero reviews → no counts, no testimonials,
   no ratings, no earnings claimed as real. The only money figure on the page is
   an arithmetic EXAMPLE, labelled as one.

   profs-v2: every section is a component in components/landing/ with its own
   FR/AR copy and stylesheet — the hero (B), then the roles, features, steps,
   calculator, FAQ, pilot banner and student line (C). One CTA, repeated
   (→ /signup/prof).
   ─────────────────────────────────────────────────────────────────────────── */
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { ProfsHero } from "@/components/landing/ProfsHero";
import { RoleChoiceSection } from "@/components/landing/RoleChoiceSection";
import { FeaturesSection } from "@/components/landing/FeaturesSection";
import { ProfsStepsSection } from "@/components/landing/ProfsStepsSection";
import { IncomeSection } from "@/components/landing/IncomeSection";
import { FaqSection } from "@/components/landing/FaqSection";
import { PilotSection } from "@/components/landing/PilotSection";
import { StudentLine } from "@/components/landing/StudentLine";

export default function PourLesProfsPage() {
  const { locale } = useLocale();
  return (
    <SiteShell>
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
