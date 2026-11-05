import { Reveal } from "@/components/Reveal";
import { IconPencil as Pencil, IconShare as Share, IconShieldCheck as Shield } from "./landing-icons";
import { StepCard } from "@/components/home/StepCard";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Comment ça marche »: the page's 3 steps, word for word, in the home
   page's step cards. .ps-steps gives them three columns instead of .hv2-steps' four. */

const copy = bilingual({
  fr: {
    eyebrow: "Comment ça marche",
    title: "De zéro à ta 1re réservation",
    steps: [
      { t: "Crée ta page", p: "Nom, matière, une phrase sur toi. Deux minutes, sans engagement." },
      { t: "Fais-toi vérifier", p: "Envoie ta pièce d'identité. On vérifie à la main, puis ta page est publique." },
      // phase-a lane L3 (A22)
      { t: "Partage et enseigne", p: "Poste ton lien, publie ton cours, au tarif que tu affiches. Tu veux offrir la 1re séance ? Tu l'actives depuis ton tableau de bord — c'est ton choix, pas une règle Tnajem." },
    ],
  },
  ar: {
    eyebrow: "كيفاش يخدم",
    title: "من الصفر لأول حجز متاعك",
    steps: [
      { t: "اعمل صفحتك", p: "إسم، مادة، وجملة عليك. دقيقتين، بلا التزام." },
      { t: "تثبّت من هويتك", p: "ابعث بطاقة تعريفك. نتثبّتو بيدينا، ومن بعد صفحتك تولّي ظاهرة للناس." },
      // phase-a lane L3 (A22)
      { t: "شارك وقرّي", p: "انشر لينكك، وانشر درسك، بالثمن اللي تبيّنو. وكان تحب تعطي الحصة الأولى بلاش، تفعّلها من لوحتك — هذا اختيارك إنتي، موش قاعدة متاع Tnajem." },
    ],
  },
});

const ICONS = [Pencil, Shield, Share];

export function ProfsStepsSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ps-sec ps-band" aria-labelledby="ps-steps-title" data-e2e="profs-steps">
      <div className="container">
        <Reveal {...HS_RV}>
          <p className="web-eyebrow ps-eyebrow">{c.eyebrow}</p>
          <h2 id="ps-steps-title" className="web-h2 ps-h2">{c.title}</h2>
          <ol className="hv2-steps ps-steps">
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
