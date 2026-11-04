import { Reveal } from "@/components/Reveal";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { IconBuilding, IconPerson } from "./landing-icons";
import { RoleChoiceCard } from "./RoleChoiceCard";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Tu enseignes à titre individuel ou au sein d'un centre ? »

   HONESTY (PROFS_V2 rule 2): a centre or organisation cannot sign up yet. The mockup's
   « Nouveau » would read as available today, so its card carries « Bientôt » and its
   text is in the future tense. There is no contact page (/aide is help, and the footer's
   « Contact » is this same address), so the waitlist is a mailto with a prefilled subject,
   the same in both locales so the inbox can filter on it. No backend. */

const CONTACT_EMAIL = "contact@tnajem.com";
const CENTRE_WAITLIST = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Tnajem pour les centres")}`;

const copy = bilingual({
  fr: {
    title: "Tu enseignes à titre individuel ou au sein d'un centre ?",
    indepTitle: "Prof indépendant",
    indepText: "Crée ta page, publie tes séances et gagne en visibilité.",
    centreTitle: "Centre de soutien / Organisation",
    centreText: "Bientôt : gère tes enseignants, invite tes élèves et organise tes cours dans un espace privé. Écris-nous pour être prévenu.",
    soon: "Bientôt",
  },
  ar: {
    title: "تقرّي وحدك ولا في مركز ؟",
    indepTitle: "أستاذ مستقل",
    indepText: "اعمل صفحتك، انشر حصصك، وولّي ظاهر أكثر.",
    centreTitle: "مركز دعم / مؤسسة",
    centreText: "قريب : تتصرّف في أساتذتك، تستدعي تلامذتك، وتنظّم دروسك في فضاء خاص. ابعثلنا باش نعلموك.",
    soon: "قريب",
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
              href={CENTRE_WAITLIST}
              external
              icon={<IconBuilding />}
              title={c.centreTitle}
              text={c.centreText}
              pill={c.soon}
              accent="ochre"
              dataE2e="profs-role-centre"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
