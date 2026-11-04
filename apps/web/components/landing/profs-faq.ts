import { requirePlan, tnd } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";

/* profs-v2 · C — the /pour-les-profs FAQ. THE single source for the accordion
   (FaqSection) AND the FAQPage JSON-LD (lane D): one question list, so what a search
   engine reads cannot drift from what the page shows.

   The answers are WORD FOR WORD those of the page before v2 (PROFS_V2 §C.5). The
   subscription floor comes from the plan catalogue, as it always did: a typed-in
   « 29 » is how this page once contradicted /tarifs. A plain module, no JSX and no
   hooks, so a Server Component and the JSON-LD can both call it. */

/** Western digits with a thin thousands separator, in both locales: the Arabic copy
    has always used Western numerals. */
const nf = (v: number) => v.toLocaleString("fr-FR");

const copy = bilingual({
  fr: {
    q1: "Combien Tnajem prend ?",
    // phase-a lane L3 (A22)
    a1: `Rien, aujourd'hui. Pendant le pilote, tu gardes 100 % : Tnajem ne touche pas à l'argent. Plus tard, il y aura deux choses, et jamais l'une sans l'autre : 10 % sur chaque élève payant, uniquement sur les paiements traités par Tnajem, plus un abonnement — gratuit avec une seule séance publiée à la fois, à partir de ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} TND/mois au-delà. Rien sur une séance que tu as choisi d'offrir. On te préviendra avant.`,
    q2: "Faut-il un diplôme ?",
    a2: "Non. Maîtrise ta matière, une bonne connexion, et tu démarres aujourd'hui. On vérifie ton identité à la main avant que ta page soit publiée.",
    q3: "Si un élève ne vient pas ?",
    a3: "Tu peux déplacer la séance depuis ton tableau de bord — tes élèves sont prévenus, et ceux qui avaient réservé l'ancien horaire peuvent annuler sans frais.", // phase-a lane L3 (A22)
  },
  ar: {
    q1: "قدّاش تاخذ Tnajem ؟",
    // phase-a lane L3 (A22)
    a1: `والو، اليوم. في فترة التجربة تحتفظ بـ \u2066100 %\u2069 : Tnajem ما تلمسش الفلوس. من بعد باش يوليو زوز حاجات، وعمرها وحدة بلا لأخرى : \u206610 %\u2069 على كل تلميذ خلّص، كان على الخلاص اللي يعدّي من Tnajem، زائد اشتراك — فابور بحصة وحدة منشورة في نفس الوقت، ومن ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} دينار في الشهر لفوق. والو على حصة إنتي اخترت تعطيها بلاش. ونعلموك قبل.`,
    q2: "يلزم شهادة ؟",
    a2: "لا. اتقن مادتك، كنكسيون مليحة، وتبدا اليوم. نتثبّتو من هويتك بيدينا قبل ما تتنشر صفحتك.",
    q3: "كان التلميذ ما جاش ؟",
    a3: "تنجّم تبدّل وقت الحصة من لوحتك — تلامذتك يتعلمو، واللي كانو حاجزين الوقت القديم ينجّمو يلغيو بلا خسارة.", // phase-a lane L3 (A22)
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
