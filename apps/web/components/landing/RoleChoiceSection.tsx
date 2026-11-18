import { Reveal } from "@/components/Reveal";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { IconBuilding, IconPerson } from "./landing-icons";
import { RoleChoiceCard } from "./RoleChoiceCard";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Tu enseignes à titre individuel ou au sein d'un centre ? »

   december-sprint · B (D12): the centre offer EXISTS now — the setup pack for the
   December camp, on /pour-les-centres, with its lead form. So the card keeps its place
   and opens that page instead of a mailto waitlist, and it no longer says « Bientôt »
   (twice: in its text and in the pill). Its text describes only what the pack does
   today; the private organisation space is still not built (R2) and is not promised.
   No green « Nouveau » either: the mockup's tag would be a claim of novelty, not
   information, and green is the product's Vérifié/success colour. */

const copy = bilingual({
  fr: {
    title: "Tu enseignes à titre individuel ou au sein d'un centre ?",
    indepTitle: "Prof indépendant",
    indepText: "Crée ta page, publie tes séances et gagne en visibilité.",
    centreTitle: "Centre de soutien / Organisation",
    centreText: "Mets les cours de ton centre en ligne pour le stage de décembre, prêts en 72 heures.",
  },
  ar: {
    title: "تقرّي وحدك ولا في مركز ؟",
    indepTitle: "أستاذ مستقل",
    indepText: "اعمل صفحتك، انشر حصصك، وولّي ظاهر أكثر.",
    centreTitle: "مركز دعم / مؤسسة",
    centreText: "حطّ دروس مركزك أونلاين لستاج ديسمبر، حاضرين في 72 ساعة.",
  },
});

export function RoleChoiceSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ps-sec ps-sec-roles" aria-labelledby="ps-roles-title" data-e2e="profs-roles">
      <div className="container">
        <Reveal {...HS_RV} className="ps-roles">
          <h2 id="ps-roles-title" className="web-h2 ps-h2">{c.title}</h2>
          <div className="ps-roles-grid">
            <RoleChoiceCard
              href="/signup/prof"
              icon={<IconPerson />}
              title={c.indepTitle}
              text={c.indepText}
              accent="blue"
              dataE2e="profs-role-indep"
            />
            <RoleChoiceCard
              href="/pour-les-centres"
              icon={<IconBuilding />}
              title={c.centreTitle}
              text={c.centreText}
              accent="ochre"
              dataE2e="profs-role-centre"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
