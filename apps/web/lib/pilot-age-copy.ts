import { bilingual } from "@/lib/i18n";

/* december-sprint · D (D16) — THE AGE MESSAGE, in one place: the home page
   (components/home/PilotAgeLine.tsx) and the student signup (components/auth/
   SignupInner.tsx) say the same words.

   Both are true only while the pilot is adults-only (ALLOW_MINORS off): the home
   line asks /api/pilot at runtime like <PilotTag>, the signup reads the server's
   flag. The rule itself (packages/shared/src/age.ts, the API's « adults-only »
   refusal) is unchanged. The Arabic reuses the consent page's spelling
   (« للّي عمرهم 18 سنة وفوق ») and the centre page's « أقسام الباك ». */
export const PILOT_AGE = bilingual({
  fr: {
    /** Who the pilot is open to. */
    open: "Pendant le pilote, Tnajem est ouvert aux élèves de 18 ans et plus : classes de Bac, étudiants et adultes.",
    /** What a student under 18 sees on the signup, instead of the rest of the form. */
    minor: "Pour l'instant, Tnajem est réservé aux 18 ans et plus.",
    home: "Retour à l'accueil",
  },
  ar: {
    open: "في فترة التجربة، Tnajem مفتوح للتلامذة اللّي عمرهم 18 سنة وفوق: أقسام الباك، الطلبة والكبار.",
    minor: "توّا، Tnajem كان للّي عمرهم 18 سنة وفوق.",
    home: "ارجع للصفحة الرئيسية",
  },
});
