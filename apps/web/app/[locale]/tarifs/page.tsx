import type { Metadata } from "next";
import { TarifsInner } from "@/components/tarifs/TarifsInner";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { requirePlan, tnd } from "@tnajem/shared";
import { PRICING } from "@/lib/pricing-copy";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* REQUEST-TIME ONLY. paymentsEnabled() is a runtime switch: prerendered, the
   banner would state whatever PAYMENTS_ENABLED was on the build box — a claim about
   money frozen into HTML. It used to be dynamic only by accident
   (app/[locale]/not-found.tsx called headers()). */
export const dynamic = "force-dynamic";

/* /tarifs — the public pricing page.

   SERVER shell + client island, like /explore. Two reasons it is not a plain
   "use client" page like /pour-les-profs:

   1. Pricing is the page people search for and link to, so it needs a real
      <title>, canonical and hreflang. A client component cannot export metadata.
   2. It lets the banner be driven by the ACTUAL payment switch instead of a
      hardcoded assumption. paymentsEnabled() is server-only, so the shell reads
      it here and hands the island a boolean. The day PAYMENTS_ENABLED flips, the
      page stops saying "nothing is billed yet" on its own — nobody has to
      remember to come back and edit this copy.

   The prices below are the FINAL model but are NOT being charged. Every surface
   that names them must label them as future; see TarifsInner. */

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const ar = locale === "ar";
  const title = ar ? "الأسعار" : "Tarifs";
  /* DERIVED, not typed out. This is the sentence Google shows, and it said the
     subscription starts at 29 TND while the page below it renders a 0 TND tier as
     its first card — the search result contradicted the page it linked to. */
  const from = tnd(requirePlan("essentiel").monthlyMillimes);
  /* phase-a/verify-fix (D2): it also said "L'élève ne paie jamais Tnajem" — the
     opposite of D4 (the student will pay online, through Tnajem, before the
     session). Payment is not described here at all; /tarifs itself carries the one
     payment sentence, labelled "Bientôt" while payments are off. */
  const description = ar
    ? `أسعار Tnajem للأساتذة : ${PRICING.ar.short} من بعد، اشتراك فابور بحصة وحدة منشورة ومن ${from} دينار في الشهر لفوق.`
    : `Les tarifs Tnajem pour les profs : ${PRICING.fr.short} Ensuite, un abonnement gratuit pour une séance publiée à la fois, puis à partir de ${from} TND/mois.`;
  // Through pageMetadata: a bare openGraph object here replaced the layout's and
  // dropped the og:image, siteName and twitter card from every shared /tarifs link.
  return pageMetadata({ locale, path: "/tarifs", title, description });
}

export default function TarifsPage() {
  return <TarifsInner paymentsEnabled={paymentsEnabled()} />;
}
