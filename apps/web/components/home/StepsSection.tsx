import { Reveal } from "@/components/Reveal";
import { Calendar, Search, Video } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { StepCard } from "./StepCard";
import { HS_RV } from "./reveal";
import "./sections.css";

/* home v2 · C — « En 4 étapes, c'est simple. » (#etapes — the hero's
   « Comment ça marche ? » scrolls here; keep the id).

   HONESTY (HOME_V2 rule 3): the mockup's step 4 repeated the price line. It now
   says what a student can actually do next — book the next session, or take the
   tutor's monthly offer (Espace prof v2 · P5: a tutor publishes « S'abonner — X TND
   / mois », the student requests it, the tutor confirms). Careful with the Arabic:
   « بالشهر » is one of the banned old payment stories (payment-story.test.ts), so the
   monthly offer is named by its product label « اشتراك شهري ». */

const copy = bilingual({
  fr: {
    eyebrow: "Du premier clic au cours en direct",
    title: "En 4 étapes, c'est simple.",
    steps: [
      { t: "Cherche ton prof", p: "Par matière et par niveau, du primaire au Bac." },
      { t: "Réserve ta séance", p: "Tu vois le tarif, tu choisis l'horaire." },
      { t: "Suis le cours en direct", p: "En vidéo, depuis ton téléphone ou ton PC." },
      { t: "Continue si ça te plaît", p: "Réserve la suivante ou passe au mois avec ton prof." },
    ],
  },
  ar: {
    eyebrow: "من أول كليك للحصة الدايركت",
    title: "في 4 مراحل، الحكاية ساهلة.",
    steps: [
      { t: "لوّج على أستاذك", p: "حسب المادة والمستوى، من الابتدائي للباك." },
      { t: "احجز حصتك", p: "تشوف الثمن، وإنتي تختار الوقت." },
      { t: "احضر الحصة دايركت", p: "بالفيديو، من تليفونك ولا من الكمبيوتر." },
      { t: "كمّل كان عجبك", p: "احجز الحصة الجاية، ولا اعمل اشتراك شهري مع أستاذك." },
    ],
  },
});

/** A check in a circle — step 4's « continue » mark in the mockup. */
function CheckCircle({ className }: { className?: string }) {
  return (
    <svg className={`ic ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <polyline points="8.4 12.2 10.9 14.6 15.6 9.6" />
    </svg>
  );
}

const ICONS = [Search, Calendar, Video, CheckCircle];

export function StepsSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section id="etapes" className="hs-band hs-sec" aria-labelledby="hs-steps-title" data-e2e="home-steps">
      <div className="container">
        <Reveal {...HS_RV}>
        <p className="web-eyebrow hs-eyebrow">{c.eyebrow}</p>
        <h2 id="hs-steps-title" className="web-h2 hs-h2">{c.title}</h2>
        <ol className="hv2-steps hs-steps">
          {c.steps.map((s, i) => {
            const Icon = ICONS[i];
            return (
              <li key={i}>
                <StepCard
                  n={i + 1}
                  icon={<Icon className="h-[18px] w-[18px]" />}
                  title={s.t}
                  text={s.p}
                  arrow={i < c.steps.length - 1}
                />
              </li>
            );
          })}
        </ol>
        </Reveal>
      </div>
    </section>
  );
}
