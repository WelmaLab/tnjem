import { Reveal } from "@/components/Reveal";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { FeatureGrid, FeatureItem } from "./FeatureItem";
import { IconCalendar, IconChart, IconShieldCheck, IconUsers, IconVideo } from "./landing-icons";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Tout ce dont tu as besoin pour enseigner ».

   HONESTY (PROFS_V2 rule 6): « Cours en ligne » names the tools because that is what
   happens: a tutor pastes their own link, otherwise Tnajem opens a room. « Visibilité »
   stops at « référencé sur Tnajem »: the mockup's « et touche plus d'élèves » is a reach
   claim nothing backs.
   « Gestion des élèves » is blue, not the mockup's green: the product keeps green for
   Vérifié and success, so only « Vérification » is green here. */

const copy = bilingual({
  fr: {
    title: "Tout ce dont tu as besoin pour enseigner",
    planningT: "Planning & réservations",
    planningP: "Publie tes séances et gère tes réservations.",
    onlineT: "Cours en ligne",
    onlineP: "En visioconférence (Zoom, Meet, etc.).",
    studentsT: "Gestion des élèves",
    studentsP: "Suis tes élèves et leurs séances.",
    visibilityT: "Visibilité",
    visibilityP: "Sois référencé sur Tnajem.",
    verifiedT: "Vérification",
    verifiedP: "Un profil vérifié qui inspire confiance.",
  },
  ar: {
    title: "كل شي تحتاجو باش تقرّي",
    planningT: "البرنامج والحجوزات",
    planningP: "انشر حصصك وتصرّف في حجوزاتك.",
    onlineT: "دروس أونلاين",
    onlineP: "بالفيديو (Zoom، Meet وغيرهم).",
    studentsT: "متابعة التلامذة",
    studentsP: "تابع تلامذتك وحصصهم.",
    visibilityT: "الظهور",
    visibilityP: "خلّي صفحتك تبان في Tnajem.",
    verifiedT: "التثبّت",
    verifiedP: "بروفيل متثبّت منّو يطمّن الناس.",
  },
});

export function FeaturesSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ps-sec" aria-labelledby="ps-features-title" data-e2e="profs-features">
      <div className="container">
        <Reveal {...HS_RV}>
          <h2 id="ps-features-title" className="web-h2 ps-h2 ps-features-h2">{c.title}</h2>
          <FeatureGrid>
            <FeatureItem icon={<IconCalendar />} tone="blue" title={c.planningT} text={c.planningP} />
            <FeatureItem icon={<IconVideo />} tone="teal" title={c.onlineT} text={c.onlineP} />
            <FeatureItem icon={<IconUsers />} tone="blue" title={c.studentsT} text={c.studentsP} />
            <FeatureItem icon={<IconChart />} tone="violet" title={c.visibilityT} text={c.visibilityP} />
            <FeatureItem icon={<IconShieldCheck />} tone="green" title={c.verifiedT} text={c.verifiedP} />
          </FeatureGrid>
        </Reveal>
      </div>
    </section>
  );
}
