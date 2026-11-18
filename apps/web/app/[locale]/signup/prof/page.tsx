/* /signup/prof — tutor signup. SERVER shell.

   ?next= is read here rather than with the client search-params hook, for the
   reason app/[locale]/auth/page.tsx documents in full: that hook forces the form
   into a <Suspense> boundary, and Next bails such a boundary to client-only
   rendering, so the shipped HTML carries no heading, no phone field and no submit
   button. This is the top of the tutor funnel on Tunisian 3G — it renders in the
   first HTML payload or it does not render at all. tools/ui-audit/nojs.mjs
   asserts exactly that.

   Reading searchParams makes the route dynamic, which is correct: a signup page is
   never cacheable and its content genuinely depends on the query string.
   The OTP CHANNEL is resolved here too. otpChannel() is server-only, and reading
   it on the server keeps OTP_CHANNEL a runtime env var — a NEXT_PUBLIC_ value
   would be baked in at build time, so reverting to SMS would mean a rebuild
   rather than a restart. */
import type { Metadata } from "next";
import { SignupInner } from "@/components/auth/SignupInner";
import { safeNext, COMMISSION_PCT } from "@tnajem/shared";
import { otpChannel } from "@/lib/auth";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";

/* REQUEST-TIME ONLY. The OTP channel is a runtime environment switch and ?next=
   differs per visitor; prerendered, both would be frozen at build. It used to be
   dynamic only by accident (app/[locale]/not-found.tsx called headers()). */
export const dynamic = "force-dynamic";

/* december-sprint · A (D17): the pricing clause is the approved short line of
   DECEMBER_SPRINT.md (gate amendment 6: « 10 % sur chaque élève payant »). It
   replaces the old « free during the pilot » clause, which described what a tutor pays. */
const meta = bilingual({
  fr: {
    title: "Créer ma page de prof",
    description:
      `Crée ta page de prof sur Tnajem : ton lien à partager, tes cours en direct, ton tarif. 3 mois sans abonnement. ${COMMISSION_PCT} % sur chaque élève payant, dès que le paiement passe par Tnajem.`,
  },
  ar: {
    title: "اعمل صفحتك متاع أستاذ",
    description: `اعمل صفحتك متاع أستاذ في Tnajem : لينك تشاركو، دروسك مباشرة، وتعريفتك. 3 شهور بلا اشتراك. ${COMMISSION_PCT} % على كل تلميذ خالص، كي الخلاص يعدّي من Tnajem.`,
  },
});

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  /* december-sprint · A (D17, gate amendment 3): noindex, FOLLOW — kept crawlable
     (robots.ts does not block it), so a crawler can read this tag and still follow
     the links out to the pages we do want ranked. */
  return { ...pageMetadata({ locale, path: "/signup/prof", ...meta[locale] }), robots: { index: false, follow: true } };
}

export default async function SignupTutorPage(props: { searchParams: Promise<{ next?: string | string[] }> }) {
  const searchParams = await props.searchParams;
  const raw = Array.isArray(searchParams.next) ? searchParams.next[0] : searchParams.next;
  return <SignupInner role="tutor" next={safeNext(raw ?? null)} channel={otpChannel()} />;
}
