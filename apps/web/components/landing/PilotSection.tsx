import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { FREE_MONTHS, PRICING } from "@/lib/pricing-copy";
import { PilotBanner } from "./PilotBanner";
import "./profs-sections.css";

/* profs-v2 · C — the closing banner, in place of the old final-CTA panel.

   december sprint · C (D23): the free-pilot framing (« Pendant le pilote, tu gardes
   100 % », « 0 % de commission », « Pas d'abonnement ») is gone. The banner says the
   approved short line — the title is its first half, the second check its second —
   plus what the long version adds: nothing on a session the tutor offers. */

const copy = bilingual({
  fr: {
    titleFigure: `${FREE_MONTHS} mois`,
    titleRest: "sans abonnement",
    checks: ["Création gratuite", PRICING.fr.commissionWhen, PRICING.fr.offered],
    cta: "Créer ma page maintenant",
  },
  ar: {
    titleFigure: `${FREE_MONTHS} شهور`,
    titleRest: "بلا اشتراك",
    checks: ["صفحتك فابور", PRICING.ar.commissionWhen, PRICING.ar.offered],
    cta: "اعمل صفحتك توّا",
  },
});

export function PilotSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ps-sec ps-sec-pilot">
      <div className="container">
        <PilotBanner
          title={
            <>
              <b>{c.titleFigure}</b> {c.titleRest}
            </>
          }
          checks={c.checks}
          ctaLabel={c.cta}
          ctaHref="/signup/prof"
          dataE2e="profs-banner"
        />
      </div>
    </section>
  );
}
