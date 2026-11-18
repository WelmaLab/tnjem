import { Reveal } from "@/components/Reveal";
import { Link } from "@/components/Link";
import { Users } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { PRICING } from "@/lib/pricing-copy";
import type { AppLocale } from "@/lib/locale";
import { HS_RV } from "./reveal";
import "./sections.css";

/* home v2 · C — « Tu es prof ? », the cross-link for the other audience. Bottom of
   the page, not the top: the top belongs to the student/parent.

   december sprint · C (D23): the founder's pricing rule. The page is free to create,
   in about 2 minutes; then the approved short line — 3 months without a
   subscription, 10 % per paying student once payment goes through Tnajem. */

const copy = bilingual({
  fr: {
    title: "Tu es prof ?",
    body: `Crée ta page gratuitement en 2 minutes et fixe ton tarif. ${PRICING.fr.short}`,
    cta: "Commence à enseigner",
    arrow: "→",
  },
  ar: {
    title: "إنتي أستاذ؟",
    body: `اعمل صفحتك فابور في دقيقتين وحدّد ثمنك. ${PRICING.ar.short}`,
    cta: "ابدا تقرّي",
    arrow: "←",
  },
});

export function ProfBand({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="hs-sec hs-sec-tight" aria-labelledby="hs-prof-title" data-e2e="home-prof">
      <div className="container">
        <Reveal {...HS_RV} className="hs-prof">
          <div className="hs-prof-main">
            <span className="hs-prof-tile" aria-hidden="true">
              <Users />
            </span>
            <div className="min-w-0">
              <h2 id="hs-prof-title" className="hs-prof-title">{c.title}</h2>
              <p className="hs-prof-body">{c.body}</p>
            </div>
          </div>
          <Link href="/pour-les-profs" className="hs-prof-btn">
            {c.cta} <span aria-hidden="true">{c.arrow}</span>
          </Link>
        </Reveal>
      </div>
    </section>
  );
}
