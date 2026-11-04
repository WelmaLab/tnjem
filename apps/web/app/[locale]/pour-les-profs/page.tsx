"use client";
/* ───────────────────────────────────────────────────────────────────────────
   /pour-les-profs — Tnajem TUTOR (teacher) landing page.
   "Shopify for Tunisian tutors": branded page, live classes, you set your price.

   FREE PILOT: Tnajem processes no money; we take 0 % commission and issue no
   payouts. The one payment story (D4, phase-a lane L3 A22) is <PaymentStory>:
   online, through Tnajem, before the session — labelled "Bientôt". Online payment, the
   subscription plans and the 10 % commission are FUTURE — every mention of them
   on this page is time-qualified ("plus tard", "quand…"), never stated as a
   current feature. Equally, the 0 % is never promised as permanent: it is a
   property of the pilot. Full model on /tarifs.
   Zero lessons taught, zero tutors, zero reviews → no counts, no testimonials,
   no ratings, no earnings claimed as real. The only money figure on the page is
   an arithmetic EXAMPLE, labelled as one.

   SIMPLIFIED PASS: the page used to run seven sections (hero, share loop,
   income, features, how, founding tutors, FAQ, final). A tutor needs five
   answers — free page in 2 minutes · you set your price · you keep 100 % · we
   verify you by hand · you teach live — so it now runs five sections and one
   repeated CTA (→ /signup/prof). The hero (components/landing/ProfsHero) shows the
   TUTOR'S PAGE, not a money counter: what you get, not what you might earn.

   Self-contained: bilingual copy (FR + Tunisian Derija) lives in `copy` below.
   Uses the app design system (globals.css tokens + classes), SiteShell, useLocale.
   RTL-safe (logical properties only). Honors prefers-reduced-motion.
   ─────────────────────────────────────────────────────────────────────────── */
import React, { useState } from "react";
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { Wallet, Video, Share, Shield, Users, Bolt, Forward } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { Reveal as SharedReveal, useReveal } from "@/components/Reveal";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)
import { ProfsHero } from "@/components/landing/ProfsHero";
import { classLimitRule, COMMISSION_PCT, commissionOn, PLANS, requirePlan, tnd } from "@tnajem/shared";

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

/* ═══════════════════════════════════════════════════════════════════════════
   COPY — FR + Tunisian Derija (ar). Warm, tutor-first, structurally parallel.
   ═══════════════════════════════════════════════════════════════════════════ */
const copy = bilingual({
  fr: {
    ctaPrimary: "Crée ta page de prof",
    // ce que tu obtiens
    featEyebrow: "Ce que tu obtiens",
    featTitle: "Une boutique de prof, prête en 2 minutes",
    f1t: "Ta page, ton lien",
    f1b: "Ton nom, ta matière, tes cours. Un seul lien à coller sur WhatsApp, Insta ou TikTok — c'est là que tes élèves réservent.",
    f2t: "Ton tarif — 100 % pour toi pendant le pilote",
    f2b: `Tu fixes ton prix, cours par cours, sans plafond. Pendant le pilote, Tnajem ne prend rien. Plus tard, Tnajem coûtera deux choses : 10 % sur chaque élève payant — uniquement sur les paiements traités par Tnajem — plus un abonnement — gratuit tant que tu ne publies qu'une séance à la fois, à partir de ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} TND/mois au-delà.`, // phase-a lane L3 (A22)
    f3t: "Vérifié à la main",
    f3b: "On regarde ta pièce d'identité nous-mêmes, une par une. Une fois validé, ta page passe en ligne et apparaît dans Explorer. On te prévient dès que c'est fait.",
    f4t: "Cours en direct",
    f4b: "Colle tes liens — ta salle vidéo, ton tableau blanc, ton quiz. Tes élèves les ouvrent en un tap depuis la page du cours, sans chercher de lien dans un groupe WhatsApp.",

    // comment ça marche
    howEyebrow: "Comment ça marche",
    howTitle: "De zéro à ta 1ʳᵉ réservation",
    s1t: "Crée ta page",
    s1b: "Nom, matière, une phrase sur toi. Deux minutes, sans engagement.",
    s2t: "Fais-toi vérifier",
    s2b: "Envoie ta pièce d'identité. On vérifie à la main, puis ta page est publique.",
    s3t: "Partage et enseigne",
    // phase-a lane L3 (A22)
    s3b: "Poste ton lien, publie ton cours, au tarif que tu affiches. Tu veux offrir la 1ʳᵉ séance ? Tu l'actives depuis ton tableau de bord — c'est ton choix, pas une règle Tnajem.",

    // l'exemple chiffré
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

    // faq
    faqEyebrow: "Avant de te lancer",
    faqTitle: "Les questions qu'on nous pose",
    q1: "Combien Tnajem prend ?",
    // phase-a lane L3 (A22)
    a1: `Rien, aujourd'hui. Pendant le pilote, tu gardes 100 % : Tnajem ne touche pas à l'argent. Plus tard, il y aura deux choses, et jamais l'une sans l'autre : 10 % sur chaque élève payant, uniquement sur les paiements traités par Tnajem, plus un abonnement — gratuit avec une seule séance publiée à la fois, à partir de ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} TND/mois au-delà. Rien sur une séance que tu as choisi d'offrir. On te préviendra avant.`,
    q2: "Faut-il un diplôme ?",
    a2: "Non. Maîtrise ta matière, une bonne connexion, et tu démarres aujourd'hui. On vérifie ton identité à la main avant que ta page soit publiée.",
    q3: "Si un élève ne vient pas ?",
    a3: "Tu peux déplacer la séance depuis ton tableau de bord — tes élèves sont prévenus, et ceux qui avaient réservé l'ancien horaire peuvent annuler sans frais.", // phase-a lane L3 (A22)

    // final
    finalTitle: "Ta page de prof t'attend.",
    finalSub: "Crée-la en 2 minutes.",
    finalReassure: "Gratuit pendant le pilote · sans engagement · supprimable à tout moment.",
    crossBottom: "Tu es élève ? Trouve ton prof",
  },
  ar: {
    ctaPrimary: "اعمل صفحتك متاع أستاذ",
    featEyebrow: "شنوّة باش تاخذ",
    featTitle: "بوتيك متاع أستاذ، حاضرة في دقيقتين",
    f1t: "صفحتك، ولينكك",
    f1b: "إسمك، مادتك، دروسك. لينك وحيد تلصقو في واتساب، إنستا ولا تيكتوك — ومن غادي تلامذتك يحجزو.",
    f2t: "ثمنك إنتي — \u2066100 %\u2069 متاعك في فترة التجربة",
    f2b: `إنتي تحدّد ثمنك، درس بدرس، بلا سقف. في فترة التجربة، Tnajem ما تاخذ والو. من بعد، Tnajem باش تكلّف زوز حاجات : \u206610 %\u2069 على كل تلميذ خلّص — كان على الخلاص اللي يعدّي من Tnajem — زائد اشتراك — فابور مادام عندك حصة وحدة منشورة، ومن ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} دينار في الشهر لفوق.`, // phase-a lane L3 (A22)
    f3t: "التثبّت يتعمل بيدينا",
    f3b: "نشوفو بطاقة تعريفك بيدينا، وحدة وحدة. كي تتقبل، صفحتك تولّي أونلاين وتبان في «اكتشف». نعلموك كي يكمل الأمر.",
    f4t: "دروس مباشرة",
    f4b: "الصق لينكاتك — القاعة متاع الفيديو، السبورة، والكويز. تلامذتك يحلّوهم بنقرة من صفحة الدرس، بلا ما يلوّجو على لينك في ڤروب واتساب.",

    howEyebrow: "كيفاش يخدم",
    howTitle: "من الصفر لأول حجز متاعك",
    s1t: "اعمل صفحتك",
    s1b: "إسم، مادة، وجملة عليك. دقيقتين، بلا التزام.",
    s2t: "تثبّت من هويتك",
    s2b: "ابعث بطاقة تعريفك. نتثبّتو بيدينا، ومن بعد صفحتك تولّي ظاهرة للناس.",
    s3t: "شارك وقرّي",
    // phase-a lane L3 (A22)
    s3b: "انشر لينكك، وانشر درسك، بالثمن اللي تبيّنو. وكان تحب تعطي الحصة الأولى بلاش، تفعّلها من لوحتك — هذا اختيارك إنتي، موش قاعدة متاع Tnajem.",

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
    inFee: "Tnajem · 0 %",
    inLaterLbl: "من بعد، كي يخلّص التلميذ على Tnajem", // phase-a lane L3 (A22)
    inLater: `${nf(EX_NET)} دينار`,
    inLaterFee: `− ${nf(EX_COMMISSION)} (\u2066${COMMISSION_PCT} %\u2069) − ${nf(EX_SUB)} (اشتراك، ${EX.courses} دروس)`,
    // phase-a lane L3 (A22)
    inLaterNote: "اليوم : \u20660 %\u2069، ما يتخصم حتى شي.",
    inWithdraw:
      "في فترة التجربة، Tnajem ما تاخذ حتى عمولة وما تلمسش فلوسك.",

    faqEyebrow: "قبل ما تبدا",
    faqTitle: "الأسئلة اللي يسقسيونا عليها",
    q1: "قدّاش تاخذ Tnajem ؟",
    // phase-a lane L3 (A22)
    a1: `والو، اليوم. في فترة التجربة تحتفظ بـ \u2066100 %\u2069 : Tnajem ما تلمسش الفلوس. من بعد باش يوليو زوز حاجات، وعمرها وحدة بلا لأخرى : \u206610 %\u2069 على كل تلميذ خلّص، كان على الخلاص اللي يعدّي من Tnajem، زائد اشتراك — فابور بحصة وحدة منشورة في نفس الوقت، ومن ${nf(tnd(requirePlan("essentiel").monthlyMillimes))} دينار في الشهر لفوق. والو على حصة إنتي اخترت تعطيها بلاش. ونعلموك قبل.`,
    q2: "يلزم شهادة ؟",
    a2: "لا. اتقن مادتك، كنكسيون مليحة، وتبدا اليوم. نتثبّتو من هويتك بيدينا قبل ما تتنشر صفحتك.",
    q3: "كان التلميذ ما جاش ؟",
    a3: "تنجّم تبدّل وقت الحصة من لوحتك — تلامذتك يتعلمو، واللي كانو حاجزين الوقت القديم ينجّمو يلغيو بلا خسارة.", // phase-a lane L3 (A22)

    finalTitle: "صفحتك متاع أستاذ تستنّى فيك.",
    finalSub: "اعملها في دقيقتين.",
    finalReassure: "فابور في فترة التجربة · بلا التزام · تنجم تمسحها وقتلي تحب.",
    crossBottom: "إنتي تلميذ ؟ لقا أستاذك",
  },
});

type Copy = (typeof copy)[keyof typeof copy];

/* The reveal lives in components/Reveal.tsx — /tarifs needs the same behaviour, and
   a second copy of a rule about whether content is VISIBLE is the duplication this
   codebase least wants. The class names stay `lpp-` prefixed and page-scoped; only
   the logic is shared. */
function Reveal(props: {
  children: React.ReactNode;
  delay?: number;
  as?: React.ElementType;
  className?: string;
  style?: React.CSSProperties;
}) {
  return <SharedReveal {...props} base="lpp-reveal" armedClass="lpp-armed" delayVar="--lpp-d" />;
}

/* Feature card — equal heights inside a grid row (h-full + column + mt-auto). */
function FeatureCard({
  icon, bg, fg, title, body,
}: {
  icon: React.ReactNode;
  bg: string;
  fg: string;
  title: string;
  body: string;
}) {
  return (
    <div className="panel panel-pad lpp-feature flex flex-col gap-3.5 h-full">
      <div aria-hidden="true" className="lpp-feature-ic" style={{ width: 52, height: 52, flex: "none", borderRadius: 15, background: bg, color: fg, display: "grid", placeItems: "center" }}>
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="lpp-feature-t">{title}</h3>
        <p className="text-[14px] text-ink2 leading-[1.6]">{body}</p>
      </div>
    </div>
  );
}

/* FAQ accordion item (accessible disclosure, animated height). */
function FaqItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`panel lpp-faq ${open ? "is-open" : ""}`} style={{ overflow: "hidden" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="lpp-faq-btn">
        <span className="lpp-faq-q">{q}</span>
        <span aria-hidden="true" className="lpp-faq-ic" style={{ background: open ? "var(--blue)" : "var(--blue50)", color: open ? "#fff" : "var(--blue)" }}>
          <svg viewBox="0 0 24 24" className="ic" aria-hidden="true" style={{ width: 16, height: 16, transform: open ? "rotate(45deg)" : "none", transition: "transform .2s" }}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </span>
      </button>
      {/* grid-rows trick: animates open/closed smoothly, height-agnostic */}
      <div className="lpp-faq-wrap" data-open={open}>
        <div className="lpp-faq-inner">
          <div className="lpp-faq-a">{a}</div>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ eyebrow, title, center = false }: { eyebrow: string; title: string; center?: boolean }) {
  return (
    <Reveal
      style={{
        marginBottom: "clamp(24px,3.5vw,40px)",
        textAlign: center ? "center" : "start",
        maxWidth: center ? 640 : undefined,
        marginInline: center ? "auto" : undefined,
      }}
    >
      <div className="web-eyebrow mb-2.5">{eyebrow}</div>
      <h2 className="web-h2">{title}</h2>
    </Reveal>
  );
}

/* The one CTA, repeated verbatim. Same label, same destination, everywhere.

   Points at SIGNUP, not at /onboarding. This is a public marketing page, so most
   people who tap it have no session at all — and the ones who do had their account
   silently converted to a tutor account by the old destination. Signing up as a
   tutor is now something you do on a page that says so. */
function Cta({ label, size = "md" }: { label: string; size?: "md" | "lg" }) {
  return (
    <Link
      href="/signup/prof"
      className="btn btn-primary lpp-cta-primary"
      style={{
        width: "auto",
        paddingInline: size === "lg" ? 32 : 26,
        paddingBlock: size === "lg" ? 16 : 15,
        fontSize: size === "lg" ? 16 : 15.5,
        maxWidth: "100%",
      }}
    >
      {label}
      <Forward className="w-[18px] h-[18px] flex-none" />
    </Link>
  );
}

function CrossLink({ label, align = "start" }: { label: string; align?: "start" | "center" }) {
  return (
    <div style={{ textAlign: align }}>
      <Link href="/" className="lpp-cross">
        {label}
        <Forward className="lpp-cross-arrow w-[15px] h-[15px] flex-none" />
      </Link>
    </div>
  );
}

/* Income example panel — arithmetic, labelled as an example, plus the 100/0
   split that is true today (0 % commission, tutor paid directly). */
function IncomePanel({ c }: { c: Copy }) {
  const { ref, armed } = useReveal<HTMLDivElement>();
  const { locale } = useLocale(); // phase-a lane L3 (A22)
  return (
    <div
      ref={ref}
      className={`panel panel-pad zellige hero-blue lpp-reveal lpp-dark ${armed ? "lpp-armed" : ""}`}
      style={{ position: "relative", overflow: "hidden", minWidth: 0 }}
    >
      <div className="relative z-[1]">
        <div className="text-[13px] text-on-blue-soft font-semibold mb-2 leading-[1.5]">
          {c.inGross}
        </div>
        <div className="font-display text-[13px] text-on-blue font-semibold mb-1 flex items-center gap-[7px]">
          <Wallet className="w-4 h-4 flex-none" />
          {c.inKeepLbl}
        </div>
        <div className="lpp-amount">{c.inKeep}</div>

        {/* 100 / 0 split bar — no commission during the pilot */}
        <div className="mt-[18px]">
          <div className={`lpp-split ${armed ? "lpp-armed" : ""}`}>
            <span className="lpp-split-you" />
          </div>
          {/* live-fixes-3 · F: « 100 % » / « 0 % » are figures — --fn, tabular (C1) */}
          <div className="flex justify-between gap-2.5 flex-wrap mt-2 font-num tabular-nums font-bold text-[13px]">
            <span className="text-on-blue-soft inline-flex items-center gap-[5px]">
              <span aria-hidden="true" className="w-2 h-2 rounded-[999px] bg-mint flex-none" />
              {c.inYou}
            </span>
            <span className="text-on-blue-soft">{c.inFee}</span>
          </div>
        </div>

        {/* What Tnajem will cost later, kept visually secondary so today's real
            number stays the headline. Both costs are named — the 10 % AND the
            subscription — because showing one without the other is how a tutor
            ends up feeling misled by the second one. Stating any of it here is
            also what stops "tu gardes 100 %" reading as a permanent promise. */}
        <div className="lpp-later">
          <div className="text-[13px] text-on-blue-soft font-semibold leading-[1.5]">
            {c.inLaterLbl}
          </div>
          <div className="flex justify-between gap-2.5 flex-wrap mt-1 items-baseline">
            {/* live-fixes-3 · F: amounts — the figure face with tabular figures (C1), not --fd */}
            <span className="font-num tabular-nums font-bold text-[19px] text-on-blue" data-e2e="lpp-later-net">{c.inLater}</span>
            <span className="font-num tabular-nums font-bold text-[13px] text-on-blue-soft">
              {c.inLaterFee}
            </span>
          </div>
          <div className="text-[13px] text-on-blue-soft mt-1 leading-[1.5]">{c.inLaterNote}</div>
        </div>

        <div className="trust trust-dark relative z-[2] mt-[18px]">
          <Shield />
          <p>
            {c.inWithdraw}{" "}
            {/* phase-a lane L3 (A22): the one payment story, labelled "Bientôt" while payments are off. */}
            <PaymentStory locale={locale} audience="tutor" />
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
export default function PourLesProfsPage() {
  const { locale } = useLocale();
  const c = copy[locale];

  return (
    <SiteShell>
      {/* Page-scoped styles (`lpp-`), injected with dangerouslySetInnerHTML — an
          inline <style>{`…`}</style> in a client component triggers hydration
          errors. UNLAYERED, so it also fixes shared-class problems locally:
          • .panel is defined after .hero-blue in globals, so `panel hero-blue`
            painted WHITE; .lpp-dark forces the intended cobalt surface.
          • --fd (Space Grotesk) has NO Arabic glyphs and its negative tracking
            severs Arabic cursive joins → every display-font block here falls
            back to --fa with normal tracking under html[dir=rtl].
          prefers-reduced-motion guard at the bottom kills all motion. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes lpp-float { 0%,100% { transform: translateY(0) rotate(-.4deg); } 50% { transform: translateY(-12px) rotate(.4deg); } }
        @keyframes lpp-glow { 0%,100% { opacity: .7; transform: scale(1); } 50% { opacity: 1; transform: scale(1.06); } }

        /* ---- scroll reveal ---- */
        /* Default state is the FINAL state, so the SSR HTML is readable with no JS.
           .lpp-armed is added by useReveal only for off-screen elements. */
        .lpp-reveal { transition: opacity .6s cubic-bezier(.2,.7,.2,1), transform .6s cubic-bezier(.2,.7,.2,1); transition-delay: var(--lpp-d, 0ms); }
        .lpp-reveal.lpp-armed { opacity: 0; transform: translateY(18px); }

        /* ---- dark cobalt surfaces (beats .panel's white background) ---- */
        .lpp-dark { background: linear-gradient(158deg,var(--blue),var(--blue900)); color: #fff; border-color: transparent;
          box-shadow: var(--sh-l), 0 30px 60px -40px rgba(14,90,166,.5); border-radius: var(--r-l); }

        /* ---- CTA ---- */
        .lpp-cta-primary { transition: transform .18s cubic-bezier(.2,.7,.2,1), box-shadow .18s, background .16s; }
        .lpp-cta-primary:hover { transform: translateY(-2px); box-shadow: 0 20px 34px -16px rgba(224,133,46,.95); }
        .lpp-cta-primary:active { transform: translateY(0); }
        .lpp-cta-primary:focus-visible { outline: 3px solid var(--blue); outline-offset: 3px; }
        .lpp-cta-primary .ic { transition: transform .2s; }
        .lpp-cta-primary:hover .ic { transform: translateX(3px); }
        html[dir="rtl"] .lpp-cta-primary:hover .ic { transform: translateX(-3px); }

        /* ---- feature cards ---- */
        .lpp-feature { transition: transform .2s cubic-bezier(.2,.7,.2,1), box-shadow .2s, border-color .2s; }
        .lpp-feature:hover { transform: translateY(-4px); box-shadow: var(--sh); border-color: var(--lineCool); }
        .lpp-feature-ic { transition: transform .25s cubic-bezier(.2,.7,.2,1); }
        .lpp-feature:hover .lpp-feature-ic { transform: scale(1.08) rotate(-3deg); }
        .lpp-feature-t { font-family: var(--fd); font-weight: 700; font-size: 17.5px; margin-bottom: 7px; }

        /* ---- stepper ---- */
        .lpp-step { position: relative; transition: transform .2s; height: 100%; }
        .lpp-step:hover { transform: translateY(-3px); }
        .lpp-node {
          width: 46px; height: 46px; flex: none; border-radius: 14px; background: var(--blue); color: #fff; /* UI Option A (A3): step numbers are cobalt */
          display: grid; place-items: center; font-family: var(--fd); font-size: 20px; font-weight: 700;
          box-shadow: var(--sh-s); position: relative; z-index: 2;
        }
        .lpp-step-t { font-family: var(--fd); font-weight: 700; font-size: 17px; }
        .lpp-connector { position: absolute; inset-block-start: 23px; z-index: 0; height: 2px;
          background: repeating-linear-gradient(90deg, var(--line) 0 7px, transparent 7px 14px); display: none; }
        @media (min-width: 1000px) { .lpp-connector { display: block; inset-inline-start: 16%; inset-inline-end: 16%; } }

        /* ---- income ---- */
        .lpp-amount { font-family: var(--fn); font-variant-numeric: tabular-nums; font-size: clamp(34px,5.5vw,52px); font-weight: 700;
          letter-spacing: -1.4px; color: var(--amber); line-height: 1.05; overflow-wrap: anywhere; }
        .lpp-later {
          margin-block-start: 16px; padding-block-start: 14px;
          border-block-start: 1px solid rgba(255,255,255,.18);
        }
        .lpp-split { position: relative; height: 12px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,.18); }
        .lpp-split-you {
          position: absolute; inset-block: 0; inset-inline-start: 0; width: 100%;
          background: linear-gradient(90deg,var(--mint),var(--green));
          transform-origin: left;
          transition: transform 1.1s cubic-bezier(.2,.7,.2,1) .15s;
        }
        html[dir="rtl"] .lpp-split-you { transform-origin: right; }
        /* Full bar is the DEFAULT, so it is drawn correctly with no JS; the
           armed state is the empty bar it grows out of. */
        .lpp-split.lpp-armed .lpp-split-you { transform: scaleX(0); }

        /* ---- faq ---- */
        .lpp-faq { transition: box-shadow .2s, border-color .2s; }
        .lpp-faq.is-open { box-shadow: var(--sh-s); border-color: var(--lineCool); }
        .lpp-faq-btn { width: 100%; display: flex; align-items: center; gap: 14px; text-align: start;
          background: transparent; border: 0; cursor: pointer; color: var(--ink);
          padding: clamp(15px,2vw,20px) clamp(16px,2.4vw,24px); font-family: var(--fb); }
        html[dir="rtl"] .lpp-faq-btn { font-family: var(--fa); }
        .lpp-faq-btn:focus-visible { outline: 3px solid var(--blue); outline-offset: -3px; border-radius: var(--r-l); }
        .lpp-faq-q { font-family: var(--fd); font-weight: 700; font-size: 16px; flex: 1; min-width: 0; }
        .lpp-faq-ic { flex: none; width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center;
          margin-inline-start: auto; transition: background .2s; }
        .lpp-faq-wrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .28s cubic-bezier(.2,.7,.2,1); }
        .lpp-faq-wrap[data-open="true"] { grid-template-rows: 1fr; }
        .lpp-faq-inner { overflow: hidden; }
        .lpp-faq-a { padding: 0 clamp(16px,2.4vw,24px) clamp(15px,2vw,20px); font-size: 14.5px; color: var(--ink2); line-height: 1.65; }

        /* ---- cross-link ---- */
        .lpp-cross { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13.5px;
          color: var(--blue); background: var(--blue50); border-radius: 999px; padding: 10px 16px; min-height: 44px;
          transition: background .16s, transform .16s; }
        .lpp-cross:hover { background: var(--blue100); transform: translateY(-1px); }
        .lpp-cross-arrow { transition: transform .18s; }
        .lpp-cross:hover .lpp-cross-arrow { transform: translateX(3px); }
        html[dir="rtl"] .lpp-cross:hover .lpp-cross-arrow { transform: translateX(-3px); }

        /* ---- final CTA ---- */
        .lpp-final { position: relative; overflow: hidden; text-align: center;
          padding: clamp(36px,6vw,72px) clamp(20px,4vw,48px); }
        .lpp-final::after {
          content: ""; position: absolute; inset-block-start: -40%; inset-inline-start: 50%; translate: -50% 0;
          width: 70%; height: 70%; border-radius: 999px; pointer-events: none; z-index: 0;
          background: radial-gradient(circle, rgba(243,194,75,.30), transparent 70%);
          animation: lpp-glow 7s ease-in-out infinite;
        }
        .lpp-final > * { position: relative; z-index: 1; }
        .lpp-bolt { animation: lpp-float 5s ease-in-out infinite; }

        /* ---- Arabic: --fd has no Arabic glyphs; negative tracking breaks joins ---- */
        html[dir="rtl"] .lpp-node,
        html[dir="rtl"] .lpp-feature-t, html[dir="rtl"] .lpp-step-t, html[dir="rtl"] .lpp-faq-q,
        html[dir="rtl"] .lpp-amount, html[dir="rtl"] .lpp-eq {
          font-family: var(--fa); letter-spacing: normal;
        }

        /* ---- responsive two-column blocks ---- */
        @media (min-width: 880px) { [data-lpp-income="true"] { grid-template-columns: 1.1fr .9fr; } }

        /* ---- reduced motion: freeze everything to final state ---- */
        @media (prefers-reduced-motion: reduce) {
          .lpp-reveal, .lpp-reveal.lpp-armed { opacity: 1 !important; transform: none !important; transition: none !important; }
          .lpp-bolt, .lpp-final::after {
            animation: none !important;
          }
          .lpp-split-you { transition: none; }
        }
      `,
        }}
      />

      <ProfsHero locale={locale} />

      {/* ═══ 2. WHAT YOU GET ═══ */}
      <section
        className="web-section"
        style={{ background: "rgba(255,255,255,.55)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="container">
          <SectionHead eyebrow={c.featEyebrow} title={c.featTitle} />
          <div className="grid-2">
            {[
              { icon: <Share />, bg: "var(--blue50)", fg: "var(--blue)", t: c.f1t, b: c.f1b },
              { icon: <Wallet />, bg: "var(--green50)", fg: "var(--green-ink)", t: c.f2t, b: c.f2b },
              { icon: <Shield />, bg: "var(--ochre-tint)", fg: "var(--ochre-ink)", t: c.f3t, b: c.f3b },
              { icon: <Video />, bg: "var(--blue50)", fg: "var(--blue)", t: c.f4t, b: c.f4b },
            ].map((f, i) => (
              <Reveal key={i} delay={i * 80}>
                <FeatureCard icon={f.icon} bg={f.bg} fg={f.fg} title={f.t} body={f.b} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 3. HOW IT WORKS ═══ */}
      <section className="web-section">
        <div className="container">
          <SectionHead eyebrow={c.howEyebrow} title={c.howTitle} center />
          <div className="grid-3 mb-[clamp(28px,4vw,44px)] relative">
            <div className="lpp-connector" aria-hidden="true" />
            {[
              { n: 1, t: c.s1t, b: c.s1b },
              { n: 2, t: c.s2t, b: c.s2b },
              { n: 3, t: c.s3t, b: c.s3b },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 110}>
                <div className="panel panel-pad lpp-step flex flex-col gap-3">
                  <div className="lpp-node" aria-hidden="true">{s.n}</div>
                  <h3 className="lpp-step-t">{s.t}</h3>
                  <p className="text-[14px] text-ink2 leading-[1.6]">{s.b}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="flex justify-center">
            <Cta label={c.ctaPrimary} />
          </Reveal>
        </div>
      </section>

      {/* ═══ 4. THE MATH ═══ */}
      <section
        className="web-section"
        style={{ background: "rgba(255,255,255,.55)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="container">
          <div
            style={{ display: "grid", gap: "clamp(20px,3vw,40px)", gridTemplateColumns: "1fr", alignItems: "center" }}
            data-lpp-income="true"
          >
            <Reveal className="min-w-0">
              <div className="web-eyebrow mb-2.5">{c.incomeEyebrow}</div>
              <h2 className="web-h2 mb-3">{c.incomeTitle}</h2>
              <p className="web-lead mb-[18px]">{c.incomeLead}</p>

              <div className="cluster gap-2.5">
                {[
                  { ic: <Users className="w-4 h-4" />, txt: c.inStudents },
                  { ic: <Video className="w-4 h-4" />, txt: c.inSessions },
                  { ic: <Wallet className="w-4 h-4" />, txt: c.inPrice },
                ].map((x, i) => (
                  <React.Fragment key={i}>
                    <span
                      className="lpp-eq"
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8, background: "var(--paper)",
                        border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px",
                        fontFamily: "var(--fn)", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 14.5, color: "var(--ink)", // live-fixes-3 · F: « 20 TND / séance » (C1)
                        boxShadow: "var(--sh-s)", minWidth: 0,
                      }}
                    >
                      <span className="text-blue inline-flex flex-none" aria-hidden="true">{x.ic}</span>
                      {x.txt}
                    </span>
                    {i < 2 && (
                      <span aria-hidden="true" className="font-display font-bold text-muted text-[18px]">·</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </Reveal>

            <IncomePanel c={c} />
          </div>
        </div>
      </section>

      {/* ═══ 5. FAQ ═══ */}
      <section className="web-section">
        <div className="container container-narrow">
          <SectionHead eyebrow={c.faqEyebrow} title={c.faqTitle} center />
          <div className="flex flex-col gap-3.5">
            {[
              { q: c.q1, a: c.a1, open: true },
              { q: c.q2, a: c.a2, open: false },
              { q: c.q3, a: c.a3, open: false },
            ].map((f, i) => (
              <Reveal key={i} delay={i * 80}>
                <FaqItem q={f.q} a={f.a} defaultOpen={f.open} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="web-section pt-0">
        <div className="container">
          <Reveal className="panel panel-pad zellige lpp-dark lpp-final">
            <div className="inline-flex mb-[18px]">
              <span
                className="lpp-bolt"
                style={{
                  width: 60, height: 60, borderRadius: 18, background: "var(--ochre)", color: "#fff",
                  display: "grid", placeItems: "center", boxShadow: "0 18px 30px -12px rgba(224,133,46,.95)",
                }}
                aria-hidden="true"
              >
                <Bolt />
              </span>
            </div>
            <h2 className="web-h2 text-white mb-2">{c.finalTitle}</h2>
            <p className="web-lead text-on-blue-soft mb-[26px] max-w-[520px] mx-auto">
              {c.finalSub}
            </p>
            <div className="flex justify-center">
              <Cta label={c.ctaPrimary} size="lg" />
            </div>
            <p className="text-[13px] text-on-blue-soft mt-[18px] flex items-center gap-2 justify-center flex-wrap">
              <Shield className="w-[15px] h-[15px] text-mint flex-none" />
              {c.finalReassure}
            </p>
          </Reveal>

          <div className="mt-[clamp(24px,4vw,40px)] flex justify-center">
            <CrossLink label={c.crossBottom} align="center" />
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
