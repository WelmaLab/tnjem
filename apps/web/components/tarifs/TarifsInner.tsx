"use client";

import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { Card, CardFooter, Tag } from "@/components/ui";
import { Check, Info, Wallet, Star } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { Reveal } from "@/components/Reveal";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)
import {
  planByCode, classLimitLabel, classLimitRule, monthsOffered, tnd, requirePlan,
  COMMISSION_PCT, commissionOn,
} from "@tnajem/shared";

/* THE WORKED EXAMPLE. "10 % plus un abonnement" is two numbers a tutor has to
   combine in their head, and the one thing everybody gets wrong is thinking it is
   one or the other. So show both on one month, with the cash case beside it.

   Every figure is derived: change a price in the catalogue and this moves with
   it. A month of 1 000 TND is a round number chosen to make the arithmetic
   readable, not a claim about what anyone earns — the copy says so. */
const EX_PROCESSED_TND = 1000;
const EX_PLAN = requirePlan("pro");
const EX_FEE = commissionOn(EX_PROCESSED_TND);
const EX_SUB = tnd(EX_PLAN.monthlyMillimes);
const EX_NET = EX_PROCESSED_TND - EX_FEE - EX_SUB;
const nf = (v: number) => v.toLocaleString("fr-FR");

/* ═══════════════════════════════════════════════════════════════════════════
   /tarifs — the pricing page.

   HONESTY RULES (load-bearing — do not break):
   • Tnajem processes NO money today (lib/payments.ts, PAYMENTS_ENABLED unset).
     Every plan below is FREE right now. The banner and the per-card "pas encore
     facturé" chip are driven by the real `paymentsEnabled` flag handed down by
     the server shell — not by a hardcoded assumption — so this page cannot drift
     out of sync with the switch.
   • The prices are real and final, but they are FUTURE. Nothing here may read as
     a charge that is happening now.
   • Equally, nothing here promises 0 % forever. The 0 % is a property of the
     pilot and is labelled as such.
   • THE NUMBERS ARE NOT WRITTEN HERE. Since Step 16 the price, the annual price
     and the class-limit bullet are derived from PLANS in @tnajem/shared — the
     same catalogue the API enforces. They used to be strings in the copy object
     below, which meant this page could advertise "jusqu'à 5 cours" while the
     server allowed three, and nothing would have caught it. The one number a
     tutor would litigate is now impossible to state wrongly here.
   • Competitor rates are quoted ONLY where the platform publishes them itself.
     GoStudent does not publish a tutor commission, so no number is given for it
     — an invented one would be exactly the kind of claim this page exists to
     avoid. Preply and Wyzant figures come from their own help centres.

   SCROLL-REVEAL: only the shared, INVERTED one (components/Reveal.tsx). The
   server HTML is the final visible state and JS merely arms the animation for
   off-screen elements, so with JS off nothing on this page is hidden — nojs.mjs
   is the gate that proves it.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = bilingual({
  fr: {
    eyebrow: "Tarifs",
    h1: "Nos tarifs, en clair.",
    lead: "Tnajem est gratuit pendant le pilote. Voici ce que ça coûtera quand les paiements en ligne s'ouvriront — pour que tu puisses décider en connaissance de cause, dès aujourd'hui.",
    ctaPrimary: "Crée ta page de prof",
    heroMicro: "Rien n'est facturé aujourd'hui.",

    // Banner — which one shows depends on the real PAYMENTS_ENABLED flag.
    pilotBanner:
      "Gratuit pendant le pilote — aucune de ces offres n'est encore facturée. Les paiements en ligne sont désactivés : Tnajem n'encaisse rien, ne prélève aucune commission et ne te facture aucun abonnement. On te préviendra avant que ça change.",
    liveBanner:
      "Les paiements en ligne sont actifs. Les formules ci-dessous sont facturées, et la commission de 10 % s'applique aux paiements traités par Tnajem.",

    plansTitle: "Les formules",
    plansLead: "Tnajem coûte deux choses au prof, et jamais l'une sans l'autre : un abonnement mensuel, plus 10 % sur chaque élève payant — uniquement sur les paiements que Tnajem traite.", // phase-a lane L3 (A22): the student DOES pay via Tnajem (D4)
    /* WHICH NUMBER IS THE RULE. The "convient à N élèves" line is a sizing hint
       and nothing counts your students; what the server actually enforces is the
       number of cours you keep open at once. Saying so here is what stops a tutor
       being refused a second cours while believing they are inside "1 à 14". */
    // The same sentence /pour-les-profs shows — one source, so the two cannot drift.
    plansRule: classLimitRule("fr"),
    plusComm: "+ 10 % sur chaque élève payant",
    plusCommNote: "Uniquement sur les paiements traités par Tnajem.", // phase-a lane L3 (A22)
    recommended: "Recommandé",
    perMonth: "/ mois",
    planCta: "Commencer gratuitement",
    // espace prof v2 · phase 6: one CTA per plan, saying the plan's state.
    planCtaPilot: "Inclus pendant le pilote",
    planCtaPaid: (name: string) => `Choisir ${name}`,
    planCtaAria: (name: string) => `${name} — inclus pendant le pilote : crée ta page`,
    /* Derived-number formatting. The VALUES come from the shared catalogue; only
       the words are copy. */
    priceUnit: (n: number) => `${nf(n)} TND`,
    yearLine: (n: number) => `${n} TND / an`,
    monthsFree: (n: number) => ` — ${n} ${n === 1 ? "mois offert" : "mois offerts"}`,

    soonChip: "Bientôt",
    soonNote: "Ces fonctionnalités ne sont pas encore disponibles. On te dira quand elles arrivent.",

    plans: [
      {
        id: "gratuit",
        name: "Gratuit",
        who: "Convient à 1–14 élèves",
        billed: false,
        /* THE FREE PLAN LISTS EVERYTHING IT REALLY GIVES, at the founder's
           request. Only two things are gated by a plan in the whole product — the
           class limit and the Explore boost — so a free tutor genuinely gets the
           rest of Tnajem. Listing three bullets made it look like a stub. */
        features: [
          "Ta page de prof et ton lien à partager",
          "Vérification d'identité à la main, et le badge qui va avec",
          "Tu apparais dans Explorer",
          "Réservations, avis et note",
          "Ta photo de profil (vérifiée avant publication)",
          "Messagerie avec tes élèves",
          "Tes fiches et vidéos pour tes élèves",
          // phase-a lane L3 (A22): "Paiement en main propre" removed — one payment story (D4).
        ],
        soon: [],
      },
      {
        id: "essentiel",
        name: "Essentiel",
        who: "Convient à 15–20 élèves",
        billed: true,
        features: ["Tout ce qu'il y a dans Gratuit"],
        soon: ["Rappels SMS et WhatsApp", "Statistiques de base"],
      },
      {
        id: "pro",
        name: "Pro",
        who: "Convient à 21–35 élèves",
        billed: true,
        features: ["Mis en avant dans Explorer", "Tout ce qu'il y a dans Essentiel"],
        soon: ["Vends tes fiches et enregistrements", "Statistiques complètes"],
      },
      {
        id: "prestige",
        name: "Prestige",
        who: "Convient à 36 élèves et plus",
        billed: true,
        features: ["Placement prioritaire dans Explorer", "Tout ce qu'il y a dans Pro"],
        soon: ["Replays de tes séances", "Vérification prioritaire (48 h)", "Support prioritaire"],
      },
    ],

    exTitle: "Ce que Tnajem te coûte, sur un mois",
    exLead: `Les deux frais ensemble, sur un exemple. ${EX_PROCESSED_TND} TND est un chiffre rond choisi pour que le calcul se lise — pas une promesse de revenu.`,
    exRowProcessed: "Encaissé via Tnajem",
    exRowFee: `Commission Tnajem (${COMMISSION_PCT} %)`,
    exRowSub: (name: string) => `Abonnement ${name}`,
    exRowNet: "Tu reçois",
    // phase-a lane L3 (A22): the cash-in-hand case is gone — one payment story (D4).
    exToday: "Aujourd'hui, rien de tout ça n'est prélevé : les paiements en ligne sont désactivés, donc la commission est de 0 TND et aucun abonnement n'est facturé.",

    commTitle: "La commission",
    commLine: "10 %, sur une seule chose : les paiements que Tnajem traite lui-même.",
    commPoints: [
      "Le même taux sur toutes les formules — 10 %, quel que soit ton volume.",
      // phase-a lane L3 (A22): the cash-in-hand point is gone — one payment story (D4).
      // phase-a lane L3 (A5): it is the tutor's opt-in (off by default), once per student per tutor (D2).
      "Si ton prof l'offre, ta 1ʳᵉ séance avec lui est gratuite.",
    ],

    cmpTitle: "Ce que prennent les autres",
    cmpLead: "Taux publiés par les plateformes elles-mêmes, relevés en août 2026. Les modèles diffèrent — à toi de juger.",
    cmpUs: "Tnajem",
    cmpUsRate: `${COMMISSION_PCT} %`,
    cmpUsBody: "10 %, uniquement sur les paiements traités par Tnajem.", // phase-a lane L3 (A22)
    /* THE RATE LEADS. This is the strongest argument the business has — 10 %
       against 18-33 % and 25 %+9 % — and it was set in 13.5px body copy in
       section five. Splitting the rate out lets it be typeset at display size
       and, more importantly, keeps the four rates in one scannable column at
       320px, where the old two-column grid collapsed and made comparison
       impossible on the exact device this page is built for. */
    cmpRows: [
      { name: "Preply", rate: "18–33 %", body: "Selon le nombre d'heures enseignées — et 100 % de chaque séance d'essai avec un nouvel élève." },
      { name: "Wyzant", rate: "25 % + 9 %", body: "25 % de commission — le prof garde 75 % — plus 9 % de frais de service sur chaque séance." },
      { name: "GoStudent", rate: "—", body: "Formules par abonnement côté famille. La commission prof n'est pas publiée, donc on ne lui prête aucun chiffre." },
    ],
    cmpNote: "Sources : centres d'aide publics de Preply et Wyzant. On ne cite aucun chiffre qu'une plateforme n'a pas publié elle-même.",

    finalTitle: "Prêt à créer ta page ?",
    finalSub: "C'est gratuit, et ça prend 2 minutes.",
    finalMicro: "Gratuit pendant le pilote · sans engagement · supprimable à tout moment.",
    backToProfs: "Tout savoir sur Tnajem pour les profs",
  },

  ar: {
    eyebrow: "الأسعار",
    h1: "أسعارنا، واضحة.",
    lead: "Tnajem فابور في فترة التجربة. هاذي هي الأثمنة اللي باش تولّي كي يتحل الخلاص أونلاين — باش تعرف من توّا على شنوّة داخل.",
    ctaPrimary: "اعمل صفحتك متاع أستاذ",
    heroMicro: "اليوم ما فما حتى فاتورة.",

    pilotBanner:
      "فابور في فترة التجربة — ما زال ما نفوترو حتى خطة. الخلاص أونلاين مطفي : Tnajem ما تحصّل والو، ما تاخذ حتى عمولة، وما تفوترك حتى اشتراك. باش نعلموك قبل ما يتبدّل الحال.",
    liveBanner:
      "الخلاص أونلاين خدّام. الخطط اللي تحت ولّاو يتفوترو، والعمولة متاع \u206610 %\u2069 تنطبق على الخلاص اللي يعدّي من Tnajem.",

    plansTitle: "الخطط",
    plansLead: "Tnajem تكلّف الأستاذ زوز حاجات، وعمرها وحدة بلا لأخرى : اشتراك شهري، زائد \u206610 %\u2069 على كل تلميذ خلّص — كان على الخلاص اللي تعدّيه Tnajem.", // phase-a lane L3 (A22)
    plansRule: classLimitRule("ar"),
    plusComm: "\u2066+ 10 %\u2069 على كل تلميذ خلّص",
    plusCommNote: "كان على الخلاص اللي يعدّي من Tnajem.", // phase-a lane L3 (A22)
    recommended: "ننصحو بيها",
    perMonth: "/ في الشهر",
    planCta: "ابدا فابور",
    planCtaPilot: "موجود في فترة التجربة",
    planCtaPaid: (name: string) => `اختار ${name}`,
    planCtaAria: (name: string) => `${name} — موجود في فترة التجربة : اعمل صفحتك`,
    priceUnit: (n: number) => `${nf(n)} دينار`,
    yearLine: (n: number) => `${n} دينار / في العام`,
    /* Arabic has a dual. "شهرين" is two months; anything else takes a number. */
    monthsFree: (n: number) =>
      ` — ${n === 1 ? "شهر" : n === 2 ? "شهرين" : `${n} أشهر`} فابور`,

    soonChip: "قريب",
    soonNote: "الخاصيات هاذوم ما زالوش موجودين. باش نعلموك وقتلي يوصلو.",

    plans: [
      {
        id: "gratuit",
        name: "فابور",
        who: "يناسب من 1 لـ 14 تلميذ",
        billed: false,
        features: [
          "صفحتك متاع أستاذ واللينك متاعك",
          "التثبّت من هويتك باليدين، والشارة اللي معاه",
          "تبان في «اكتشف»",
          "الحجوزات، الآراء والنقطة",
          "تصويرتك (تتثبّت قبل ما تتنشر)",
          "مراسلة مع تلامذتك",
          "الفيشات والفيديوهات متاع تلامذتك",
          // phase-a lane L3 (A22)
        ],
        soon: [],
      },
      {
        id: "essentiel",
        name: "الأساسي",
        who: "يناسب من 15 لـ 20 تلميذ",
        billed: true,
        features: ["كل اللي في فابور"],
        soon: ["تذكير بالـ SMS والواتساب", "إحصائيات أساسية"],
      },
      {
        id: "pro",
        name: "برو",
        who: "يناسب من 21 لـ 35 تلميذ",
        billed: true,
        features: ["تبان في «اكتشف»", "كل اللي في الأساسي"],
        soon: ["بيع الفيشات والتسجيلات", "إحصائيات كاملة"],
      },
      {
        id: "prestige",
        name: "بريستيج",
        who: "يناسب 36 تلميذ وأكثر",
        billed: true,
        features: ["مركز أول في «اكتشف»", "كل اللي في برو"],
        soon: ["تسجيلات حصصك", "تثبّت بالأولوية (48 ساعة)", "دعم بالأولوية"],
      },
    ],

    exTitle: "قدّاش تكلّفك Tnajem في الشهر",
    exLead: `الزوز فريسي مع بعضهم، في مثال. ${EX_PROCESSED_TND} دينار رقم مدوّر باش يتقرا الحساب — موش وعد بمدخول.`,
    exRowProcessed: "تحصّل عبر Tnajem",
    exRowFee: `عمولة Tnajem (\u2066${COMMISSION_PCT} %\u2069)`,
    exRowSub: (name: string) => `اشتراك ${name}`,
    exRowNet: "يوصلك",
    // phase-a lane L3 (A22)
    exToday: "اليوم ما يتخلّص حتى شي من هذا : الخلاص أونلاين مطفي، معناها العمولة 0 دينار وحتى اشتراك ما يتفوتر.",

    commTitle: "العمولة",
    commLine: "\u206610 %\u2069، على حاجة وحيدة : الخلاص اللي Tnajem تعدّيه هي بروحها.",
    commPoints: [
      "نفس النسبة في الخطط الكل — \u206610 %\u2069، مهما كان حجمك.",
      // phase-a lane L3 (A22)
      "كان أستاذك يعطيها، أول حصة معاه تكون فابور.", // phase-a lane L3 (A5)
    ],

    cmpTitle: "شنوّة ياخذو الآخرين",
    cmpLead: "نسب نشروها المنصّات بأنفسهم، مأخوذة في أوت 2026. النماذج تختلف — وإنتي احكم.",
    cmpUs: "Tnajem",
    cmpUsRate: `${COMMISSION_PCT} %`,
    cmpUsBody: "\u206610 %\u2069، كان على الخلاص اللي يعدّي من Tnajem.", // phase-a lane L3 (A22)
    cmpRows: [
      { name: "Preply", rate: "\u206618–33 %\u2069", body: "حسب عدد الساعات اللي قرّيتها — و \u2066100 %\u2069 من كل حصة تجريبية مع تلميذ جديد." },
      { name: "Wyzant", rate: "\u206625 % + 9 %\u2069", body: "\u206625 %\u2069 عمولة — الأستاذ يحتفظ بـ \u206675 %\u2069 — وزيد \u20669 %\u2069 فريسي خدمة على كل حصة." },
      { name: "GoStudent", rate: "—", body: "اشتراكات شهرية على العائلة. عمولة الأستاذ ما هيش منشورة، وعلى هكّاكا ما نعطيوهاش رقم." },
    ],
    cmpNote: "المصادر : مراكز المساعدة العمومية متاع Preply و Wyzant. ما نذكرو حتى رقم ما نشرتوش المنصّة بروحها.",

    finalTitle: "حاضر باش تعمل صفحتك ؟",
    finalSub: "فابور، وتاخذ دقيقتين.",
    finalMicro: "فابور في فترة التجربة · بلا التزام · تنجم تمسحها وقتلي تحب.",
    backToProfs: "اعرف الكل على Tnajem للأساتذة",
  },
});

type Copy = (typeof copy)[keyof typeof copy];

/* Page-scoped CSS. Prefixed `tf-`, injected with dangerouslySetInnerHTML — an
   inline <style>{`…`}</style> in a client component triggers hydration errors.
   Unlayered on purpose, so it beats globals.css's @layer components without
   needing !important. Logical properties only (guardrails.mjs check #1). */
const CSS = `
/* E. THE PRICE HAS TO WIN. It was clamp(30px,4vw,38px) against .web-h2's
   clamp(24px,3.6vw,38px) — identical at 1280, so five section headings and four
   prices were nine equal-weight 38px objects and nothing on a PRICING page was
   allowed to be the biggest thing on screen. */
.tf-price{font-family:var(--fn);font-variant-numeric:tabular-nums;font-size:clamp(34px,5vw,46px);line-height:1.02;letter-spacing:-1.5px;color:var(--ink)}
html[dir="rtl"] .tf-price{font-family:var(--fa);letter-spacing:normal}
.tf-per{font-size:14px;font-weight:700;color:var(--muted)}
/* The annual saving is a real ~17 % discount and was the SMALLEST type in the
   card — set below the disclaimer above it. It is a reason to commit; give it
   the weight of one. */
.tf-year{font-size:13.5px;color:var(--ink2);line-height:1.5}
.tf-year b{font-weight:700;color:var(--green-ink)}
/* UI Option A (A7): five colours per card became three. "Convient à" is plain
   information (ink2, was cobalt); the saving stays green (.tf-year b); the +10 % is
   neutral (paper + line, was an ochre wash); "Bientôt"/"Pas encore facturé" are
   .tag-soon; the Pro card keeps the one ochre button. */
.tf-who{font-size:13px;font-weight:700;color:var(--ink2)}
/* espace prof v2 · phase 6: the commission and its « Bientôt », once above the grid. */
.tf-once{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px;margin-block-end:16px;padding:10px 14px;
  border-radius:var(--r-s);background:var(--paper);border:1px solid var(--line);width:fit-content;max-width:100%}
.tf-once b{font-size:14px;font-weight:700;color:var(--ink2)}
.tf-feats{list-style:none;display:flex;flex-direction:column;gap:9px;margin-block-start:16px}
.tf-feats li{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;line-height:1.5;color:var(--ink2);min-width:0}
.tf-feats .ic{width:17px;height:17px;flex:none;color:var(--green-ink);margin-block-start:2px}
/* A not-yet-built row reads as pending, not as delivered: the tick loses the
   green it earns for a shipped feature, and the label sits beside it. */
.tf-feats li.tf-soon{color:var(--muted)}
.tf-feats li.tf-soon .ic{color:var(--muted)}
/* The group divider: a hairline that runs to the chip, so "Bientôt" reads as a
   heading over the rows beneath it rather than a tag floating beside one. */
.tf-feats li.tf-soon-head{align-items:center;gap:9px;margin-block-start:5px}
.tf-soon-rule{flex:1;height:1px;background:var(--line);min-width:12px}
/* Said ONCE, under the grid, instead of verbatim inside three or four cards. */
.tf-under{display:flex;flex-direction:column;gap:7px;margin-block-start:18px}
.tf-under p{font-size:13.5px;line-height:1.6;color:var(--muted);max-width:70ch}
/* The recommended plan. A ring rather than a scale transform: at 320px the cards
   are already full-bleed, and a transform would clip against the container. */
/* A REAL elevation, not a pale ring. --blue100 at 2px is invisible on a
   mid-range Android outdoors, which is the device this page is for. Still no
   scale() — the note above is right that a transform clips at 320px where the
   cards are already full-bleed; the recommended card gains its prominence from
   shadow, a solid border and, once there is room for a row, a lifted baseline. */
.tf-hi{border-color:var(--blue);border-width:2px;box-shadow:var(--sh)}
@media (min-width:768px){
  .tf-hi{margin-block:-10px}
}
/* Gratuit is the baseline the paid tiers build on, not a competing purchase.
   Quieter surface, no shadow — it recedes without losing a single feature. */
.tf-base{background:var(--cream);box-shadow:none}
/* MOTION. The page had none, and said so — because the first attempt at a reveal
   on /pour-les-profs shipped a blank hero. The shared hook in components/Reveal
   is the inverted version: this HTML is already the final visible state and JS
   only ARMS the offset, so with JS off nothing here is hidden. nojs.mjs is the
   gate that proves it. */
.tf-reveal{transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1);
  transition-delay:var(--tf-d,0ms)}
.tf-reveal.tf-armed{opacity:0;transform:translateY(14px)}
/* The reveal wrapper becomes the grid item, so it has to pass the stretch
   through: without this the .u-card inside loses its height:100% and the row
   stops sharing a baseline — the footers would ladder. */
.tf-cell{display:flex;min-width:0}
.tf-cell>*{flex:1;min-width:0}
@media (prefers-reduced-motion:reduce){
  .tf-reveal,.tf-reveal.tf-armed{opacity:1 !important;transform:none !important;transition:none !important}
}
.tf-cmp{display:flex;flex-direction:column;gap:10px}
/* The rate column holds at EVERY width — 84px is enough for "25 % + 9 %" at
   320px, and keeping it means the four rates line up vertically and can actually
   be compared on a phone. Only the explanation wraps. */
.tf-cmp-row{display:grid;grid-template-columns:auto 1fr;gap:4px 14px;padding:14px 16px;
  border:1px solid var(--line);border-radius:var(--r-s);background:var(--paper);min-width:0;align-items:baseline}
/* live-fixes-3 · F: rates and amounts are figures — --fn with tabular figures (C1), never --fd. */
.tf-cmp-rate{font-family:var(--fn);font-variant-numeric:tabular-nums;font-weight:700;font-size:clamp(20px,3.4vw,26px);
  line-height:1.1;color:var(--ink);min-width:84px;white-space:nowrap}
html[dir="rtl"] .tf-cmp-rate{font-family:var(--fa)}
.tf-cmp-row.is-us .tf-cmp-rate{color:var(--blue)}
.tf-cmp-text{min-width:0}
.tf-cmp-row.is-us{border-color:var(--blue);background:var(--blue50)}
.tf-cmp-name{font-family:var(--fd);font-weight:700;font-size:15px;color:var(--ink);min-width:0}
html[dir="rtl"] .tf-cmp-name{font-family:var(--fa)}
.tf-cmp-body{font-size:13.5px;line-height:1.6;color:var(--ink2);min-width:0;overflow-wrap:anywhere}
.tf-note{font-size:13px;line-height:1.6;color:var(--muted);margin-block-start:12px}
/* The cost breakdown. Rows, not a table: at 320px a 2-column table either
   overflows or crushes the label, and this has to be readable on a phone. */
/* ON THE BLUE SURFACE. Every colour here is a token that contrast.mjs already
   audits against --blue / --blue900: --on-blue 6.14 / 12.04, --on-blue-soft
   5.15 / 10.10, --mint 7.50. */
.tf-ex{border-radius:var(--r-s);overflow:hidden}
.tf-ex-row{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
  padding:13px 0;font-size:14.5px;color:var(--on-blue-soft);
  border-block-end:1px solid var(--on-blue-hairline);min-width:0}
.tf-ex-row:last-child{border-block-end:none}
.tf-ex-row b{font-family:var(--fn);font-variant-numeric:tabular-nums;font-weight:700;color:var(--on-blue);white-space:nowrap} /* live-fixes-3 · F */
html[dir="rtl"] .tf-ex-row b{font-family:var(--fa)}
/* THE PAYOFF LINE. The one number on the page that says what a tutor RECEIVES,
   so it is the one number allowed to be large. */
.tf-ex-net{border-block-start:1px solid var(--on-blue-rule);margin-block-start:4px;padding-block-start:16px}
.tf-ex-net span{color:var(--on-blue);font-weight:700}
.tf-ex-net b{font-size:clamp(26px,4.4vw,34px);line-height:1.05;color:var(--mint)}
.tf-ex-cash{margin-block-start:18px;padding:14px 16px;border-radius:var(--r-s);background:var(--on-blue-fill)}
.tf-ex-cash-t{font-size:14px;font-weight:700;color:var(--on-blue);margin-block-end:3px}
.tf-ex-cash p{font-size:13.5px;line-height:1.6;color:var(--on-blue-soft)}
.tf-ex-today{font-size:13px;line-height:1.6;color:var(--on-blue-soft);margin-block-start:14px}
.tf-comm{list-style:none;display:flex;flex-direction:column;gap:11px;margin-block-start:16px}
.tf-comm li{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.55;color:var(--ink2);min-width:0}
.tf-comm .ic{width:19px;height:19px;flex:none;color:var(--blue);margin-block-start:1px}
`;

function PlanCard({
  plan,
  c,
  locale,
  paymentsEnabled,
}: {
  plan: Copy["plans"][number];
  c: Copy;
  locale: "fr" | "ar";
  paymentsEnabled: boolean;
}) {
  /* THE GRID USED TO RECOMMEND THE FREE PLAN. Every card carried the same ghost
     button and the same label, so "recommended" rested entirely on a 13px chip
     and a 2px --blue100 ring — invisible on a mid-range Android outdoors. The eye
     defaulted to the leftmost card, which is 0 TND.

     Two changes fix it, and neither invents anything: the recommended tier gets
     the page's one FILLED call to action, and Gratuit gets a quieter surface
     because it is not a purchase. It still lists all nine things it really gives
     — that was the point of the last change — it just stops winning the grid on
     visual generosity, which is the only reading an identical column format
     allows. */
  const highlighted = plan.id === "pro";
  const isFree = !plan.billed;
  /* THE NUMBERS COME FROM THE CATALOGUE, not from the copy above. A card whose
     plan is missing from PLANS renders nothing rather than a price with no
     entitlements behind it — a plan the server does not know is not a plan we
     may sell. */
  const spec = planByCode(plan.id);
  if (!spec) return null;
  const free = monthsOffered(spec);
  return (
    <Card className={highlighted ? "tf-hi" : isFree ? "tf-base" : ""}>
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-display font-bold text-[17px] text-ink">{plan.name}</span>
        {/* "Recommandé", never "le plus populaire": no tutor is on any plan yet,
            so a popularity claim would be fabricated social proof. */}
        {highlighted && <Tag kind="neutral">{c.recommended}</Tag>}
      </div>

      <div className="tf-who mb-3">{plan.who}</div>

      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="tf-price">{c.priceUnit(tnd(spec.monthlyMillimes))}</span>
        <span className="tf-per">{c.perMonth}</span>
      </div>
      {/* "2 mois offerts" is DERIVED from the two prices, so it cannot survive a
          price change that makes it untrue. */}
      <div className="tf-year mt-1">
        {c.yearLine(tnd(spec.yearlyMillimes))}
        {free > 0 ? <b>{c.monthsFree(free)}</b> : null}
      </div>

      {/* espace prof v2 · phase 6 (spec §6): the « + 10 % par élève payant » and the
          « Bientôt » are said ONCE, above the grid, instead of inside every card. */}

      <ul className="tf-feats">
        {/* THE CLASS LIMIT, first and derived. This is the entitlement the API
            actually enforces (POST /classes), and the only bullet on this page a
            tutor could hold us to. It is generated from the same number, so the
            page and the server cannot say different things. */}
        <li>
          <Check />
          <span className="min-w-0">{classLimitLabel(spec.maxClasses, locale)}</span>
        </li>
        {plan.features.map((f) => (
          <li key={f}>
            <Check />
            <span className="min-w-0">{f}</span>
          </li>
        ))}
        {/* NOT YET BUILT, and said so on the tier that sells them. Six features
            across the three paid plans do not exist: SMS/WhatsApp reminders have
            no channel, `replay_url` is written by nothing, materials have no
            price, the verification queue is plain FIFO, there is no support
            system and stats are not gated by plan. Listing them unmarked is how a
            tutor pays 99 TND for replays and finds nothing. The truth rule allows
            a future claim — unmistakably labelled. This is the label. */}
        {/* ONE label for the group, not a chip per row. Per-row chips wrapped onto
            their own line as soon as the feature text was longer than the card was
            wide — which was most of them — leaving an orphaned "Bientôt" floating
            under the feature it was supposed to label, and in one card separating
            the tick from its own text. Seven chips became visual noise that made
            the paid tiers look unfinished rather than forthcoming. */}
        {plan.soon.length > 0 && (
          <li className="tf-soon-head" aria-hidden="true">
            <span className="tf-soon-rule" />
            <Tag kind="soon">{c.soonChip}</Tag>
          </li>
        )}
        {plan.soon.map((f) => (
          <li key={f} className="tf-soon">
            <Check />
            {/* The group label above is aria-hidden, so each row still carries the
                word for a screen reader — the marker must not be visual-only. */}
            <span className="min-w-0">
              {f} <span className="sr-only">— {c.soonChip}</span>
            </span>
          </li>
        ))}
      </ul>

      <CardFooter className="pt-4">
        {/* The one filled CTA in the grid. The page's other primary buttons sit
            above and below the grid, so until now its own calls to action
            competed with the thing it was selling. */}
        {/* ONE CTA per plan, saying where the plan stands: while payments are off,
            every plan is included in the pilot (nothing is sold); once they open,
            the free plan starts free and the others are chosen. */}
        <Link
          href="/signup/prof"
          className={`btn ${highlighted ? "btn-primary" : "btn-ghost"} w-full`}
          aria-label={paymentsEnabled ? undefined : c.planCtaAria(plan.name)}
          data-e2e="plan-cta"
        >
          {!paymentsEnabled ? c.planCtaPilot : isFree ? c.planCta : c.planCtaPaid(plan.name)}
        </Link>
      </CardFooter>
    </Card>
  );
}

export function TarifsInner({ paymentsEnabled }: { paymentsEnabled: boolean }) {
  const { locale } = useLocale();
  const c: Copy = copy[locale];

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── HERO ────────────────────────────────────────────────────────── */}
      <section className="web-section pb-0">
        <div className="container">
          <div className="max-w-[760px]">
            <div className="web-eyebrow mb-3">{c.eyebrow}</div>
            <h1 className="web-h1 mb-4">{c.h1}</h1>
            <p className="web-lead mb-6">{c.lead}</p>
            <div className="cluster">
              <Link href="/signup/prof" className="btn btn-primary w-auto px-6 py-[15px] text-[15px] max-w-full">
                {c.ctaPrimary}
              </Link>
            </div>
            <p className="text-[13px] text-muted flex items-center gap-[7px] mt-4">
              <Check className="w-[15px] h-[15px] text-green flex-none" />
              {c.heroMicro}
            </p>
          </div>
        </div>
      </section>

      {/* ── THE HONEST BANNER — driven by the real payments switch ───────── */}
      <section className="web-section tight">
        <div className="container">
          <div className="note-info">{/* Phase A+ (U1) */}
            <Info />
            <p>{paymentsEnabled ? c.liveBanner : c.pilotBanner}</p>
          </div>
        </div>
      </section>

      {/* ── PLANS ───────────────────────────────────────────────────────── */}
      <section className="web-section tight">
        <div className="container">
          <h2 className="web-h2 mb-3">{c.plansTitle}</h2>
          {/* ONE lead, not two. This was `plansLead` (39 words) followed by
              `plansRule` (35), which existed only to retract the "Convient à N
              élèves" model the cards introduce one screen later — the page
              manufactured a misunderstanding and apologised for it in the same
              section. Together with the banner that was 121 words of
              qualification before the reader saw a single digit. The rule the
              server actually enforces now travels WITH the cards, where the
              misunderstanding would otherwise start. */}
          <p className="web-lead mb-6 max-w-[680px]">{c.plansLead}</p>
          {/* Said once for the whole grid (espace prof v2 · phase 6): the commission
              that comes with every price, and — while payments are off — that none
              of it is billed yet. */}
          <div className="tf-once" data-e2e="tarifs-once">
            <b>{c.plusComm}</b>
            {!paymentsEnabled && <Tag kind="soon">{c.soonChip}</Tag>}
          </div>
          <div className="grid-auto">
            {/* Staggered, 70ms apart — the one place on this page where a
                sequence exists, so the one place motion carries meaning rather
                than decorating. Everything else stays still. */}
            {c.plans.map((p, i) => (
              <Reveal
                key={p.id}
                delay={i * 70}
                base="tf-reveal"
                armedClass="tf-armed"
                delayVar="--tf-d"
                className="tf-cell"
              >
                <PlanCard plan={p} c={c} locale={locale} paymentsEnabled={paymentsEnabled} />
              </Reveal>
            ))}
          </div>
          {/* The two notes that used to be typeset inside every card. */}
          <div className="tf-under">
            {/* The limit rule first: it is the one that explains the cards above. */}
            <p>{c.plansRule}</p>
            <p>{c.plusCommNote}</p>
            {/* phase-a lane L3 (A22): the one payment story, gated on the REAL switch. */}
            <p><PaymentStory locale={locale} audience="tutor" enabled={paymentsEnabled} /></p>
            <p>{c.soonNote}</p>
          </div>
        </div>
      </section>

      {/* ── WHAT IT COSTS, ON ONE MONTH ─────────────────────────────────────

          MOVED UP, and onto a different surface. This is the only section that
          tells a tutor what they RECEIVE rather than what is deducted, and it sat
          eight phone-screens down, behind two sections that restate the
          commission. It is now the first thing after the grid.

          .panel.hero-blue is the blue gradient already in globals.css and already
          used by /pour-les-profs for exactly this job. It matters that it is not
          white: before this, the reader's first two colour events on a pricing
          page were a green legal disclaimer and four peach warning boxes. This is
          the page's one colour event that is not a caveat. */}
      <section className="web-section tight">
        <div className="container">
          <div className="max-w-[760px]">
            <h2 className="web-h2 mb-3">{c.exTitle}</h2>
            <p className="web-lead mb-5">{c.exLead}</p>

            <Reveal
              base="tf-reveal"
              armedClass="tf-armed"
              delayVar="--tf-d"
              className="panel panel-pad hero-blue"
            >
              <div className="tf-ex">
                <div className="tf-ex-row">
                  <span>{c.exRowProcessed}</span>
                  <b><bdi>{c.priceUnit(EX_PROCESSED_TND)}</bdi></b>
                </div>
                <div className="tf-ex-row">
                  <span>{c.exRowFee}</span>
                  {/* <bdi>: a bare U+2212 next to a digit run inside an RTL
                      paragraph reorders unpredictably. white-space:nowrap does
                      not help bidi; isolation does. */}
                  <b><bdi>&minus; {c.priceUnit(EX_FEE)}</bdi></b>
                </div>
                <div className="tf-ex-row">
                  <span>{c.exRowSub(c.plans.find((pl) => pl.id === EX_PLAN.code)?.name ?? EX_PLAN.code)}</span>
                  <b><bdi>&minus; {c.priceUnit(EX_SUB)}</bdi></b>
                </div>
                <div className="tf-ex-row tf-ex-net">
                  <span>{c.exRowNet}</span>
                  <b><bdi>{c.priceUnit(EX_NET)}</bdi></b>
                </div>
              </div>

              {/* phase-a lane L3 (A22): the cash-in-hand case was here — one payment story (D4). */}

              {!paymentsEnabled && <p className="tf-ex-today">{c.exToday}</p>}
            </Reveal>
          </div>
        </div>
      </section>


      {/* ── COMMISSION ──────────────────────────────────────────────────── */}
      <section className="web-section tight">
        <div className="container">
          <div className="max-w-[760px]">
            <h2 className="web-h2 mb-3">{c.commTitle}</h2>
            <p className="web-lead">{c.commLine}</p>
            <ul className="tf-comm">
              {c.commPoints.map((p) => (
                <li key={p}>
                  <Wallet />
                  <span className="min-w-0">{p}</span>
                </li>
              ))}
            </ul>
            {/* `commToday` used to sit here — a third restatement of "0 TND is
                taken today", after the flag-driven banner and the line inside the
                breakdown. "Nothing is billed" appeared on THIRTEEN surfaces on
                this page; past about three repetitions reassurance inverts and
                the reader starts wondering what is wrong with the billing. The
                statement stays where the numbers are, and only there. */}
          </div>
        </div>
      </section>

      {/* ── COMPARISON — published rates only ───────────────────────────── */}
      <section className="web-section tight">
        <div className="container">
          <h2 className="web-h2 mb-3">{c.cmpTitle}</h2>
          <p className="web-lead mb-6 max-w-[720px]">{c.cmpLead}</p>

          {/* Rows, not a <table>: at 320px a 2-column table either overflows the
              page (shots.mjs exits 1) or crushes the text.

              THE RATE NOW LEADS EACH ROW, at display size. This is the strongest
              argument the business has and it was typeset as 13.5px body copy —
              and the old grid collapsed to ONE column below 620px, so on the
              phone this page is built for the four rates never shared a column
              and could not be compared at all. The rate column survives at every
              width; only the explanation moves beneath. */}
          <div className="tf-cmp">
            <div className="tf-cmp-row is-us">
              <div className="tf-cmp-rate"><bdi>{c.cmpUsRate}</bdi></div>
              <div className="tf-cmp-text">
                <div className="tf-cmp-name">{c.cmpUs}</div>
                <div className="tf-cmp-body">{c.cmpUsBody}</div>
              </div>
            </div>
            {c.cmpRows.map((r) => (
              <div key={r.name} className="tf-cmp-row">
                <div className="tf-cmp-rate"><bdi>{r.rate}</bdi></div>
                <div className="tf-cmp-text">
                  <div className="tf-cmp-name">{r.name}</div>
                  <div className="tf-cmp-body">{r.body}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="tf-note">{c.cmpNote}</p>
        </div>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────────────────────── */}
      <section className="web-section">
        <div className="container">
          <Card className="text-center">
            <div className="flex justify-center mb-3">
              <Star className="w-6 h-6 text-ochre-ink" />
            </div>
            <h2 className="web-h2 mb-2">{c.finalTitle}</h2>
            <p className="web-lead mb-5">{c.finalSub}</p>
            <div className="cluster justify-center">
              <Link href="/signup/prof" className="btn btn-primary w-auto px-6 py-[15px] text-[15px] max-w-full">
                {c.ctaPrimary}
              </Link>
            </div>
            <p className="text-[13px] text-muted mt-4">{c.finalMicro}</p>
            <p className="mt-3">
              <Link href="/pour-les-profs" className="linklike linklike-inline">
                {c.backToProfs}
              </Link>
            </p>
          </Card>
        </div>
      </section>
    </SiteShell>
  );
}
