import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { PilotBanner } from "./PilotBanner";
import "./profs-sections.css";

/* profs-v2 · C — the closing banner, in place of the old final-CTA panel.

   HONESTY (PROFS_V2 rule 1): the mockup says « Aucune commission · Aucun abonnement » with
   no end date. All three checks hang off the title's « Pendant le pilote », and what comes
   later stays on the page: the hero's « plus tard » line, the calculator and the FAQ. */

const copy = bilingual({
  fr: {
    titleLead: "Pendant le pilote, tu gardes",
    titleFigure: "100 %",
    checks: ["Création gratuite", "0 % de commission", "Pas d'abonnement"],
    cta: "Créer ma page maintenant",
  },
  ar: {
    titleLead: "في فترة التجربة، تحتفظ بـ",
    titleFigure: "\u2066100 %\u2069",
    checks: ["صفحتك فابور", "\u20660 %\u2069 عمولة", "بلا اشتراك"],
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
              {c.titleLead} <b>{c.titleFigure}</b>
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
