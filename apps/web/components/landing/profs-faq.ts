import { bilingual } from "@/lib/i18n";
import { PRICING } from "@/lib/pricing-copy";
import type { AppLocale } from "@/lib/locale";

/* profs-v2 · C — the /pour-les-profs FAQ. THE single source for the accordion
   (FaqSection) AND the FAQPage JSON-LD (lane D): one question list, so what a search
   engine reads cannot drift from what the page shows.

   december sprint · C (D23): a1 is the founder's long version of the pricing rule,
   both parts (lib/pricing-copy.ts). a2 is word for word that of the page before v2
   (PROFS_V2 §C.5); a3 is the
   founder's rewrite, which answers the no-show it is asked about. True as of writing:
   nothing releases a no-show's seat, and the booking's conversation stays open
   THREAD_CLOSE_DAYS after the class. A plain module, no JSX and no
   hooks, so a Server Component and the JSON-LD can both call it. */

const copy = bilingual({
  fr: {
    q1: "Combien Tnajem prend ?",
    // phase-a lane L3 (A22)
    a1: `${PRICING.fr.long1} ${PRICING.fr.long2} ${PRICING.fr.notice}`,
    q2: "Faut-il un diplôme ?",
    a2: "Non. Maîtrise ta matière, une bonne connexion, et tu démarres aujourd'hui. On vérifie ton identité à la main avant que ta page soit publiée.",
    q3: "Si un élève ne vient pas ?",
    a3: "Pendant le pilote, aucun paiement ne passe par Tnajem, donc personne ne perd d'argent. Sa place reste réservée jusqu'à la fin de la séance, et tu peux lui écrire depuis Messages pour proposer une autre date.",
  },
  ar: {
    q1: "قدّاش تاخذ Tnajem ؟",
    // phase-a lane L3 (A22)
    a1: `${PRICING.ar.long1} ${PRICING.ar.long2} ${PRICING.ar.notice}`,
    q2: "يلزم شهادة ؟",
    a2: "لا. اتقن مادتك، كنكسيون مليحة، وتبدا اليوم. نتثبّتو من هويتك بيدينا قبل ما تتنشر صفحتك.",
    q3: "كان التلميذ ما جاش ؟",
    a3: "في فترة التجربة، حتى خلاص ما يعدّي من Tnajem، يعني حتى حد ما يخسر فلوس. بلاصتو تقعد محجوزة لين توفى الحصة، وتنجم تبعثلو من الرسائل باش تقترح عليه وقت آخر.", // phase-a lane L3 (A22)
  },
});

export function faqItems(locale: AppLocale): { q: string; a: string }[] {
  const c = copy[locale];
  return [
    { q: c.q1, a: c.a1 },
    { q: c.q2, a: c.a2 },
    { q: c.q3, a: c.a3 },
  ];
}
