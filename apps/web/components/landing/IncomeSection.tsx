import { Reveal } from "@/components/Reveal";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)
import { Shield, Users, Video, Wallet } from "@/components/icons";
import { HS_RV } from "@/components/home/reveal";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { classLimitRule, COMMISSION_PCT, commissionOn, PLANS, tnd } from "@tnajem/shared";
import "@/components/home/home.css"; // .lp-rv / .lp-armed, the classes HS_RV names
import "./profs-sections.css";

/* profs-v2 · C — « Combien tu peux gagner ». The calculator of the page before v2:
   same constants, same formulae, same copy, same <PaymentStory>. Only the look is new,
   and <Reveal> replaces useReveal, so this has no client code of its own.
   Pinned by e2e/plans.spec.ts (gross and net), e2e/payment-story.spec.ts and
   e2e/lf3-f-price-font.spec.ts (.lpp-amount, data-e2e="lpp-later-net"; the old class
   names stay for those two). */

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY NUMBER ON THIS PAGE COMES FROM THE PLAN CATALOGUE.

   They used to be strings in the copy below — "1 280 TND", "- 128 (10 %) - 29
   (abonnement)", and a subscription floor stated as 29 TND. Step 16 made
   packages/shared/plans.ts
   the single source for exactly these figures and /tarifs already renders from
   it; this page did not, so it was free to drift, and it had: it advertised a
   subscription floor of 29 TND while /tarifs shows a 0 TND tier as its first card.
   ═══════════════════════════════════════════════════════════════════════════ */
/** The cheapest LISTED plan that allows `n` classes open at once. */
function planForOpenClasses(n: number) {
  return [...PLANS]
    .filter((p) => p.listed)
    .sort((a, b) => a.monthlyMillimes - b.monthlyMillimes)
    .find((p) => p.maxClasses === null || p.maxClasses >= n);
}

/* THE WORKED EXAMPLE. Inputs are a choice; every figure after them is arithmetic.

   The plan is picked by OPEN CLASSES, not by student count — that is the rule the
   server actually enforces (POST /classes). The example used to be "8 students,
   two sessions a week" and then needed a paragraph to argue why two sessions with
   the same group are two classes open at once. It is now a tutor teaching TWO
   DIFFERENT COURSES (Maths and Physique) to the same 8 students, one session a
   week each: two courses open at once, so the free tier (one) does not cover it —
   self-evident, no argument. Same figures, so e2e/plans.spec.ts still holds. */
const EX = { students: 8, courses: 2, priceTnd: 20, weeks: 4 } as const;
const EX_GROSS = EX.students * EX.courses * EX.priceTnd * EX.weeks;
const EX_COMMISSION = commissionOn(EX_GROSS);
const EX_PLAN = planForOpenClasses(EX.courses);
const EX_SUB = EX_PLAN ? tnd(EX_PLAN.monthlyMillimes) : 0;
const EX_NET = EX_GROSS - EX_COMMISSION - EX_SUB;
/** Western digits with a thin thousands separator, in both locales — the Arabic
    copy has always used Western numerals and changing that is not this change. */
const nf = (v: number) => v.toLocaleString("fr-FR");

const copy = bilingual({
  fr: {
    incomeEyebrow: "Combien tu peux gagner",
    incomeTitle: "Fixe ton tarif. Aujourd'hui, tu gardes tout.",
    /* The unit, stated ONCE and up front — the same sentence /tarifs shows. */
    incomeLead: `${classLimitRule("fr")} Un exemple d'arithmétique — pas une promesse, et pas un plafond :`,
    inStudents: "8 élèves",
    inSessions: "2 cours : Maths + Physique",
    inPrice: "20 TND / séance",
    inGross: `Exemple : ${EX.students} élèves × ${EX.courses} cours × ${EX.priceTnd} TND × ${EX.weeks} semaines (1 séance par cours, par semaine)`,
    inKeepLbl: "Tu gardes, aujourd'hui",
    inKeep: `${nf(EX_GROSS)} TND`,
    inYou: "Toi · 100 %",
    inFee: "Tnajem · 0 %",
    inLaterLbl: "Plus tard, quand l'élève paiera via Tnajem", // phase-a lane L3 (A22)
    inLater: `${nf(EX_NET)} TND`,
    inLaterFee: `− ${nf(EX_COMMISSION)} (${COMMISSION_PCT} %) − ${nf(EX_SUB)} (abonnement, ${EX.courses} cours)`,
    // phase-a lane L3 (A22): the HOW is <PaymentStory audience="tutor"> beside inWithdraw.
    inLaterNote: "Aujourd'hui : 0 %, rien n'est prélevé.",
    inWithdraw:
      "Pendant le pilote, Tnajem ne prend aucune commission et ne touche pas à ton argent.",
  },
  ar: {
    incomeEyebrow: "قداش تنجم تربح",
    incomeTitle: "حدّد تعريفتك. اليوم، تحتفظ بالكل.",
    incomeLead: `${classLimitRule("ar")} هاذا مثال حساب — موش وعد، وموش سقف :`,
    inStudents: "8 تلامذة",
    inSessions: "2 دروس : رياضيات + فيزياء",
    inPrice: "20 دينار / حصة",
    inGross: `مثال : ${EX.students} تلامذة × ${EX.courses} دروس × ${EX.priceTnd} دينار × ${EX.weeks} جماعي (حصة وحدة لكل درس، في الجمعة)`,
    inKeepLbl: "تحتفظ بيه، اليوم",
    inKeep: `${nf(EX_GROSS)} دينار`,
    inYou: "إنتي · \u2066100 %\u2069",
    /* The same words as before v2. The isolate is new: bare, the « % » drifted to the far
       side of the line in RTL and it read « % Tnajem · 0 ». */
    inFee: "Tnajem · \u20660 %\u2069",
    inLaterLbl: "من بعد، كي يخلّص التلميذ على Tnajem", // phase-a lane L3 (A22)
    inLater: `${nf(EX_NET)} دينار`,
    inLaterFee: `− ${nf(EX_COMMISSION)} (\u2066${COMMISSION_PCT} %\u2069) − ${nf(EX_SUB)} (اشتراك، ${EX.courses} دروس)`,
    // phase-a lane L3 (A22)
    inLaterNote: "اليوم : \u20660 %\u2069، ما يتخصم حتى شي.",
    inWithdraw:
      "في فترة التجربة، Tnajem ما تاخذ حتى عمولة وما تلمسش فلوسك.",
  },
});

export function IncomeSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  const inputs = [
    { icon: <Users />, text: c.inStudents },
    { icon: <Video />, text: c.inSessions },
    { icon: <Wallet />, text: c.inPrice },
  ];
  return (
    <section className="ps-sec" aria-labelledby="ps-income-title" data-e2e="profs-income">
      <div className="container">
        <Reveal {...HS_RV} className="ps-income">
          <div className="min-w-0">
            <p className="web-eyebrow ps-eyebrow">{c.incomeEyebrow}</p>
            <h2 id="ps-income-title" className="web-h2 ps-h2">{c.incomeTitle}</h2>
            <p className="web-lead ps-income-lead">{c.incomeLead}</p>
            <ul className="ps-eq">
              {inputs.map((x) => (
                <li key={x.text}>
                  <span className="ps-eq-ic" aria-hidden="true">{x.icon}</span>
                  {x.text}
                </li>
              ))}
            </ul>
          </div>

          {/* Arithmetic, labelled as an example, plus the 100/0 split that is true today
              (0 % commission, tutor paid directly). */}
          <div className="ps-calc">
            <p className="ps-calc-note ps-calc-gross">{c.inGross}</p>
            <p className="ps-calc-keep">
              <Wallet />
              {c.inKeepLbl}
            </p>
            <div className="lpp-amount">{c.inKeep}</div>

            {/* 100 / 0 split bar — no commission during the pilot */}
            <div className="ps-split" aria-hidden="true">
              <span className="ps-split-you" />
            </div>
            {/* live-fixes-3 · F: « 100 % » / « 0 % » are figures — --fn, tabular (C1) */}
            <div className="ps-split-labels">
              <span>
                <span className="ps-split-dot" aria-hidden="true" />
                {c.inYou}
              </span>
              <span>{c.inFee}</span>
            </div>

            {/* What Tnajem will cost later, kept visually secondary so today's real
                number stays the headline. Both costs are named — the 10 % AND the
                subscription — because showing one without the other is how a tutor
                ends up feeling misled by the second one. Stating any of it here is
                also what stops "tu gardes 100 %" reading as a permanent promise. */}
            <div className="ps-later">
              <p className="ps-calc-note ps-later-lbl">{c.inLaterLbl}</p>
              <div className="ps-later-row">
                {/* live-fixes-3 · F: amounts — the figure face with tabular figures (C1), not --fd */}
                <span className="ps-later-net" data-e2e="lpp-later-net">{c.inLater}</span>
                <span className="ps-later-fee">{c.inLaterFee}</span>
              </div>
              <p className="ps-calc-note">{c.inLaterNote}</p>
            </div>

            <div className="trust trust-dark ps-calc-trust">
              <Shield />
              <p>
                {c.inWithdraw}{" "}
                {/* phase-a lane L3 (A22): the one payment story, labelled "Bientôt" while payments are off. */}
                <PaymentStory locale={locale} audience="tutor" />
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
