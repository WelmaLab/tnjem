import { Reveal } from "@/components/Reveal";
import { IconPlus as Plus } from "./landing-icons";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { faqItems } from "./profs-faq";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Les questions qu'on nous pose ». A native <details> accordion with
   the first answer open: no client code, and it opens and closes with JS off. The
   questions and answers live in profs-faq.ts, shared with the JSON-LD. */

const copy = bilingual({
  fr: {
    eyebrow: "Avant de te lancer",
    title: "Les questions qu'on nous pose",
  },
  ar: {
    eyebrow: "قبل ما تبدا",
    title: "الأسئلة اللي يسقسيونا عليها",
  },
});

export function FaqSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ps-sec ps-band" aria-labelledby="ps-faq-title" data-e2e="profs-faq">
      <div className="container container-narrow">
        <Reveal {...HS_RV}>
          <div className="ps-center">
            <p className="web-eyebrow ps-eyebrow">{c.eyebrow}</p>
            <h2 id="ps-faq-title" className="web-h2 ps-h2">{c.title}</h2>
          </div>
          <div className="ps-faq-list">
            {faqItems(locale).map((f, i) => (
              <details key={i} className="ps-faq" open={i === 0}>
                <summary className="ps-faq-sum">
                  <h3 className="ps-faq-q">{f.q}</h3>
                  <span className="ps-faq-ic" aria-hidden="true">
                    <Plus />
                  </span>
                </summary>
                <p className="ps-faq-a">{f.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
