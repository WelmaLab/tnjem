import { COMMISSION_PCT } from "@tnajem/shared";

/* december sprint · C (D23) — THE PRICING WORDS, once.

   The founder's pricing rule (DECEMBER_SPRINT.md, "Pricing rule", as amended at the
   gate on 18 Nov) replaced the « gratuit pendant le pilote / 0 % / tu gardes 100 % »
   framing. Every surface that states what a tutor pays Tnajem reads its sentences
   from here, so the home band, /pour-les-profs, /tarifs, /aide, onboarding and the
   dashboard cannot drift into different versions of the rule.

   THE RULE, in short: no subscription for the first FREE_MONTHS months, then a plan
   from /tarifs (Gratuit stays); 10 % on every paying student, the same on every plan,
   nothing on a session the tutor offers; the 10 % is taken only on payments that go
   through Tnajem, and online payment is not open yet, so Tnajem takes nothing today.

   TEXT ONLY. Nothing here drives behaviour: the plans, their limits, the `pilot`
   default and PAYMENTS_ENABLED are untouched (R4). FREE_MONTHS is the number in the
   sentence, not an entitlement — no code compares a date to it (audit §2, D24).

   GUARDRAIL. No sentence here says how a student pays a tutor today
   (e2e/payment-story.spec.ts, apps/api/test/payment-story.test.ts). */

/** The free period the copy announces. Display only. */
export const FREE_MONTHS = 3;

const PCT_FR = `${COMMISSION_PCT} %`;
/* The Arabic copy isolates every percentage (LRI … PDI), or « % » drifts to the far
   side of the figure in a right-to-left line. */
const PCT_AR = `⁦${COMMISSION_PCT} %⁩`;
const PLUS_PCT_AR = `\u2066+ ${COMMISSION_PCT} %\u2069`;

/* Plain objects, not bilingual() from ./i18n: lib/i18n.ts reads its onboarding lines
   from here, and an import back would be a cycle. The `satisfies` keeps the AR keys
   identical to the FR ones, which is all bilingual() does. */
const FR = {
  badge: `${FREE_MONTHS} mois sans abonnement`,
  commission: `${PCT_FR} sur chaque élève payant`,
  plusCommission: `+ ${PCT_FR} sur chaque élève payant`,
  commissionWhen: `${PCT_FR} sur chaque élève payant, dès que le paiement passe par Tnajem`,
  plusCommissionWhen: `+ ${PCT_FR} sur chaque élève payant, dès que le paiement passe par Tnajem`,
  offered: "Rien sur une séance que tu offres",
  short: `${FREE_MONTHS} mois sans abonnement. ${PCT_FR} sur chaque élève payant, dès que le paiement passe par Tnajem.`,
  long1: `Tnajem coûte deux choses au prof. Un abonnement mensuel, offert pendant tes ${FREE_MONTHS} premiers mois. Et ${PCT_FR} sur chaque élève payant. Rien sur une séance que tu offres.`,
  long2: `Les ${PCT_FR} sont prélevés sur les paiements qui passent par Tnajem. Le paiement en ligne n'est pas encore ouvert. D'ici là, Tnajem ne prélève rien.`,
  /* The hero's small print: the long version's two costs in one line, kept short so
     the H1 stays the page's LCP at 320 px (the full long version is the FAQ's). */
  costs: `Un abonnement mensuel, offert pendant tes ${FREE_MONTHS} premiers mois. Et ${PCT_FR} sur chaque élève payant, dès que le paiement passe par Tnajem.`,
  planButton: `Offert tes ${FREE_MONTHS} premiers mois`,
  notice: "On te préviendra avant l'ouverture du paiement en ligne.",
  calcNote: "Calcul valable dès que le paiement en ligne est ouvert. D'ici là, Tnajem ne prélève rien.",
};

const AR = {
  badge: `${FREE_MONTHS} شهور بلا اشتراك`,
  commission: `${PCT_AR} على كل تلميذ خلّص`,
  /* The « + » inside the isolate, as the old copy did (⁦+ 10 %⁩): outside it, it
     drifts to the wrong end of the figure in a right-to-left line. */
  plusCommission: `${PLUS_PCT_AR} على كل تلميذ خلّص`,
  commissionWhen: `${PCT_AR} على كل تلميذ خلّص، كي الخلاص يعدّي من Tnajem`,
  plusCommissionWhen: `${PLUS_PCT_AR} على كل تلميذ خلّص، كي الخلاص يعدّي من Tnajem`,
  offered: "والو على حصة إنتي تعطيها بلاش",
  short: `${FREE_MONTHS} شهور بلا اشتراك. ${PCT_AR} على كل تلميذ خلّص، كي الخلاص يعدّي من Tnajem.`,
  long1: `Tnajem تكلّف الأستاذ زوز حاجات. اشتراك شهري، فابور في أول ${FREE_MONTHS} شهور متاعك. و ${PCT_AR} على كل تلميذ خلّص. والو على حصة إنتي تعطيها بلاش.`,
  long2: `العمولة متاع ${PCT_AR} تتخصم من الخلاص اللي يعدّي من Tnajem. الخلاص أونلاين ما زال ما تحلّش. لين يتحلّ، Tnajem ما تاخذ حتى شي.`,
  costs: `اشتراك شهري، فابور في أول ${FREE_MONTHS} شهور متاعك. و ${PCT_AR} على كل تلميذ خلّص، كي الخلاص يعدّي من Tnajem.`,
  planButton: `فابور في أول ${FREE_MONTHS} شهور متاعك`,
  notice: "باش نعلموك قبل ما يتحلّ الخلاص أونلاين.",
  calcNote: "الحساب هذا صالح من وقت اللي يتحلّ الخلاص أونلاين. لين يتحلّ، Tnajem ما تاخذ حتى شي.",
} satisfies Record<keyof typeof FR, string>;

export const PRICING: { fr: typeof FR; ar: typeof FR } = { fr: FR, ar: AR };

/** The English twin for plain-text surfaces (llms.txt). */
export const PRICING_EN = {
  short: `${FREE_MONTHS} months without a subscription. ${COMMISSION_PCT} % on each paying student, once payment goes through Tnajem.`,
  long1: `Tnajem costs a tutor two things. A monthly subscription, free for the first ${FREE_MONTHS} months. And ${COMMISSION_PCT} % on each paying student. Nothing on a session the tutor offers for free.`,
  long2: `The ${COMMISSION_PCT} % is taken on payments that go through Tnajem. Online payment is not open yet. Until then, Tnajem takes nothing.`,
} as const;
