"use client";
import { Link } from "@/components/Link";
import { useEffect } from "react";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { Verified } from "@/components/ui";
import { Shield, Gift, Forward, Search, Video, Wallet, Users } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)
import { PilotTag } from "@/components/PilotTag"; // Phase A+ (P4)

/* =====================================================================
   STUDENT / PARENT LANDING — Tnajem (تنجّم)
   Public home page at "/". Wrapped in <SiteShell> (header + footer come
   from there). All copy is self-contained below in `copy` (fr/ar) — we do
   NOT touch lib/i18n.ts. RTL is global (LocaleProvider sets dir), so the
   layout uses logical CSS props throughout and flips automatically.

   INFORMATION ARCHITECTURE — 5 blocks, deliberately. A parent must get
   "what is this / what does it do for me / what do I click" in 5 seconds:
     1. HERO      — what it is, one CTA, and the subject chips (the tool)
     2. STEPS     — the backbone: search → book free → live → pay the tutor
     3. 3 FACTS   — free trial · hand-verified tutors · you pay the tutor
     4. FINAL CTA — one line, one button
     5. TEACHER   — cross-link for the other audience (bottom, not top)
   Each promise is stated ONCE. If you add a section, delete one.

   HONESTY RULES (load-bearing — do not break):
   • Zero lessons taught, zero reviews. The page says so out loud.
   • Never invent tutor names, ratings, review counts, student counts or
     testimonials. The hero illustration is deliberately generic.
   • The only number we show is 0 TND for the 1st session, which is real.

   MOTION BUDGET: one entrance on the hero panel + one reveal-on-scroll
   per section. Nothing else. Both are killed by prefers-reduced-motion at
   the bottom of the scoped <style> block.
   ===================================================================== */

const copy = bilingual({
  fr: {
    eyebrow: "Cours particuliers en ligne · Tunisie",
    h1a: "Un prof ",
    h1Hi: "vérifié",
    h1b: ", en ligne, du primaire au Bac.",
    sub: "Choisis ta matière, réserve une séance en vidéo. Le tarif est affiché avant que tu réserves.",
    ctaPrimary: "Trouve ton prof",
    ctaSecondary: "Comment ça marche ?",
    // phase-a lane L3 (A22): one payment story (D4) — it lives in <PaymentStory>, labelled "Bientôt".
    heroMicro:
      "Sans engagement. Tnajem ne prend rien pendant le pilote.",

    // hero illustration (NOT a real listing — generic on purpose)
    heroAria:
      "Illustration : une recherche « Maths · Bac » qui affiche des profs vérifiés, chacun avec un lien vers sa page.",
    heroSearch: "Maths · Bac",
    cardCta: "Voir la page",

    subjectsLabel: "Choisis ta matière",
    seeAll: "Toutes les matières",
    arrow: "→",

    howTitle: "Du premier clic au cours en direct, en 4 étapes.",
    steps: [
      { t: "Cherche ton prof", p: "Par matière et par niveau, du primaire au Bac." },
      { t: "Réserve ta séance", p: "Tu vois le tarif, tu choisis l'horaire." },
      { t: "Suis le cours en direct", p: "En vidéo, depuis ton téléphone ou ton PC." },
      { t: "Continue si ça te plaît", p: "Le prof affiche son tarif avant que tu réserves." }, // phase-a lane L3 (A22)
    ],

    knowTitle: "3 choses à savoir avant de réserver.",
    know: [
      {
        t: "Tu sais ce que tu paies, avant de réserver",
        p: "Le prof affiche son tarif sur sa page. Certains offrent la 1ʳᵉ séance — c'est leur choix, et c'est écrit chez eux.",
      },
      {
        t: "Chaque prof est vérifié à la main",
        p: "On contrôle son identité, ses matières et ses niveaux, et on relit sa page avant de la publier.",
      },
      {
        // phase-a lane L3 (A22): the how-you-pay sentence is <PaymentStory> under this item.
        t: "Le paiement, en clair",
        p: "Il fixe son tarif et l'affiche avant que tu réserves. Sans engagement.",
      },
    ],
    honestNote:
      "Tnajem vient d'ouvrir : aucune séance n'a encore eu lieu, donc aucun avis n'est affiché. Ceux qui viendront sortiront de vraies séances — on n'en inventera aucun.",

    finalTitle: "Choisis ton prof. Le tarif est affiché avant de réserver.",
    finalCta: "Trouve ton prof",
    finalMicro: "Sans engagement · annulation libre jusqu'à 48h avant.", // phase-a lane L3 (A22)

    profTitle: "Tu es prof ?",
    profBody: "Donne tes cours en direct, fixe ton tarif, et garde 100 % pendant le pilote.",
    profCta: "Commence à enseigner →",
  },

  ar: {
    eyebrow: "دروس خصوصية أونلاين · تونس",
    h1a: "أستاذ ",
    h1Hi: "متثبّت منّو",
    h1b: "، أونلاين، من الابتدائي للباك.",
    sub: "اختار المادة، واحجز حصة بالفيديو. الثمن يبان قبل ما تحجز.",
    ctaPrimary: "لقّي أستاذك",
    ctaSecondary: "كيفاش يخدم؟",
    heroMicro: "بلا التزام. Tnajem ما تاخذ والو في فترة التجربة.", // phase-a lane L3 (A22)

    // الرسم التوضيحي متاع الهيرو (موش أساتذة حقيقيين)
    heroAria: "رسم توضيحي: بحث «رياضيات · باك» يورّي أساتذة متثبّت منهم، وكل واحد فيهم عندو رابط لصفحتو.",
    heroSearch: "رياضيات · باك",
    cardCta: "شوف الصفحة",

    subjectsLabel: "اختار المادة",
    seeAll: "المواد الكل",
    arrow: "←",

    howTitle: "من أول كليك للحصة الدايركت، في 4 مراحل.", // phase-a lane L6 (A18.derija-2)
    steps: [
      { t: "لوّج على أستاذك", p: "حسب المادة والمستوى، من الابتدائي للباك." },
      { t: "احجز حصتك", p: "تشوف الثمن، وإنتي تختار الوقت." },
      { t: "احضر الدرس مباشرة", p: "بالفيديو، من تليفونك ولا من الكمبيوتر." },
      { t: "كمّل كان عجبك", p: "الأستاذ يبيّن ثمنو قبل ما تحجز." }, // phase-a lane L3 (A22)
    ],

    knowTitle: "3 حاجات لازم تعرفهم قبل ما تحجز.",
    know: [
      {
        t: "تعرف شنوة باش تخلّص، قبل ما تحجز",
        p: "الأستاذ يبيّن ثمنو في صفحتو. فمّا اللي يعطي الحصة الأولى بلاش — هذا اختيارو هو، ومكتوب عندو.",
      },
      {
        t: "كل أستاذ متثبّت منّو بيدينا",
        p: "نتثبّتو من هويتو، من المواد والمستويات اللي يقرّيهم، ونقراو صفحتو قبل ما ننشروها.",
      },
      {
        // phase-a lane L3 (A22)
        t: "الخلاص، بالواضح",
        p: "هو اللي يحدّد ثمنو ويبيّنو قبل ما تحجز. بلا التزام.",
      },
    ],
    honestNote:
      "Tnajem كيف ما تحلّت: حتى حصة ما صارت لتوّا، وعلى هكّاكا ما فماش آراء. الآراء اللي باش تجي تكون من حصص حقيقية — ما نخترعو حتى وحدة.",

    finalTitle: "اختار أستاذك. الثمن يبان قبل ما تحجز.",
    finalCta: "لقّي أستاذك",
    finalMicro: "بلا التزام · تنجّم تلغي حتى 48 ساعة قبل.", // phase-a lane L3 (A22)

    profTitle: "إنتي أستاذ؟",
    profBody: "قرّي مباشرة، حدّد ثمنك، واحتفظ بـ \u2066100 %\u2069 في فترة التجربة.",
    profCta: "ابدا تقرّي ←",
  },
});

// Subject chips → /explore?subject=<slug>. Labels per locale, slug shared.
const SUBJECTS: { slug: string; fr: string; ar: string }[] = [
  { slug: "maths", fr: "Maths", ar: "رياضيات" },
  { slug: "physique", fr: "Physique", ar: "فيزياء" },
  { slug: "svt", fr: "SVT", ar: "علوم" },
  { slug: "francais", fr: "Français", ar: "فرنسية" },
  { slug: "anglais", fr: "Anglais", ar: "إنڨليزية" },
  { slug: "arabe", fr: "Arabe", ar: "عربية" },
  { slug: "philo", fr: "Philo", ar: "فلسفة" },
  { slug: "histoire-geo", fr: "Histoire-Géo", ar: "تاريخ-جغرافيا" },
  { slug: "technique", fr: "Technique", ar: "تقني" },
];

// Illustrative (NOT real) result cards for the hero composition. Deliberately
// generic: no invented tutor names, no fabricated ratings, no invented prices —
// they must never read as a real listing. Only the free 1st session is shown,
// which is a real, honoured promise. The three levels (Bac / Lycée / Primaire)
// simply restate the range already claimed in the <h1>.
const HERO_CARDS = [
  { id: "maths", ini: "M", fr: "Prof de Maths", ar: "أستاذ رياضيات", frMeta: "Bac · en ligne", arMeta: "باك · أونلاين" },
  { id: "physique", ini: "P", fr: "Prof de Physique", ar: "أستاذ فيزياء", frMeta: "Lycée · en ligne", arMeta: "ثانوي · أونلاين" },
  { id: "francais", ini: "F", fr: "Prof de Français", ar: "أستاذ فرنسية", frMeta: "Primaire · en ligne", arMeta: "ابتدائي · أونلاين" },
];

// Icon tile tints for the "3 things to know" cards (full class strings so
// Tailwind's content scanner sees them).
const TONES = ["bg-green50 text-green-ink", "bg-blue50 text-blue", "bg-ochre-tint text-ochre-ink"];

/* Hook: reveal-on-scroll — PROGRESSIVE ENHANCEMENT, never a prerequisite.

   `.lp-rv` sections render at their FINAL state by default, so the SSR HTML is
   complete: with the bundle off (or still downloading on 3G) the page is simply
   a static page. This effect then *arms* the animation by adding `.lp-armed`,
   and only to sections that are currently off-screen — arming something the
   reader can already see would be a visible flash-out/flash-in.

   One `.lp-rv` per section below the hero — not per card — so the page settles
   fast instead of staggering in piece by piece. */
function useReveal() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.remove("lp-armed");
            obs.unobserve(e.target);
          }
        });
      },
      /* threshold 0, not 0.1: a section TALLER than the viewport can never reach
         a fractional visibility ratio, so it would stay armed — and invisible —
         forever. The negative bottom rootMargin does the "properly on screen"
         job instead, and is height-independent. */
      { rootMargin: "0px 0px -8% 0px", threshold: 0 }
    );
    for (const n of Array.from(document.querySelectorAll<HTMLElement>(".lp-rv"))) {
      const r = n.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) continue; // already on screen
      n.classList.add("lp-armed");
      io.observe(n);
    }
    return () => io.disconnect();
  }, []);
}

export default function HomePage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const isAr = locale === "ar";

  useReveal();

  return (
    <SiteShell>
      {/* Scoped styles (prefix lp-). Everything that can be a Tailwind utility
          IS one; this block only holds what utilities can't express: the RTL
          font fallbacks, the edge-bleeding chip scroller, the two surviving
          animations and their reduced-motion kill-switch. */}
      <style dangerouslySetInnerHTML={{ __html: `
        /* ── rhythm ─────────────────────────────────────────────── */
        .lp-sec{padding-block:clamp(40px,6vw,80px)}
        .lp-sec.lp-tight{padding-block:clamp(26px,3.5vw,48px)}
        .lp-sec[id]{scroll-margin-top:84px} /* sticky header clearance for #etapes */

        /* ── titles ─────────────────────────────────────────────────
           --fd (Space Grotesk) has NO Arabic glyphs and its negative
           tracking severs Arabic cursive joins → fall back to --fa in RTL.
           (.web-h1/.web-h2 already do this in globals.css.) */
        .lp-t{font-family:var(--fd);font-weight:700;letter-spacing:-.2px}
        html[dir=rtl] .lp-t{font-family:var(--fa);letter-spacing:normal}

        /* Every card on this page is the canonical .u-card + .u-card-pad from
           globals.css — no local card surface, and no .u-card-int on the
           step/fact cards because they are not clickable (a hover lift on
           static content reads as a broken link). One exception below: the
           teacher cross-link keeps its warm gradient. Unlayered, so it beats
           .u-card's flat background. */
        .lp-outro{background:linear-gradient(135deg,var(--paper),var(--blue50))}

        /* ── hero ───────────────────────────────────────────────── */
        .lp-hero{position:relative;overflow:hidden;isolation:isolate;
          padding-block:clamp(28px,5vw,64px) clamp(34px,6vw,72px)}
        .lp-wash{position:absolute;inset:0;z-index:-1;pointer-events:none;
          background:
            radial-gradient(720px 420px at 8% 0%,rgba(224,133,46,.10),transparent 60%)}
        /* UI Option A (A1): the blue radial is gone — no cobalt haze behind the hero;
           only the faint warm wash stays. */

        /* primary CTA: lift + arrow nudge. In RTL the arrow already carries
           .flip (scaleX(-1)); re-declaring transform would silently un-flip
           it, so the RTL rule composes both. */
        .lp-cta:hover{transform:translateY(-2px);
          box-shadow:0 20px 32px -14px rgba(224,133,46,.9)}
        .lp-cta .ic{transition:transform .18s ease}
        .lp-cta:hover .ic{transform:translateX(3px)}
        html[dir=rtl] .lp-cta:hover .ic{transform:scaleX(-1) translateX(3px)}

        /* ── subject chips ──────────────────────────────────────────
           Scrolls edge-to-edge on phones (negative margin is safe: .lp-hero
           clips it), wraps from 760px up. */
        .lp-chips{display:flex;gap:10px;overflow-x:auto;padding-block:2px 8px;
          scrollbar-width:none;-webkit-overflow-scrolling:touch;
          margin-inline:calc(-1 * clamp(16px,4vw,40px));
          padding-inline:clamp(16px,4vw,40px)}
        .lp-chips::-webkit-scrollbar{display:none}
        .lp-chip{flex:none;display:inline-flex;align-items:center;min-height:44px;
          background:var(--paper);border:1.5px solid var(--line);border-radius:999px;
          padding:10px 17px;font-weight:700;font-size:14px;color:var(--ink);
          white-space:nowrap;box-shadow:var(--sh-s);transition:.16s}
        .lp-chip:hover{border-color:var(--blue);color:var(--blue)}
        .lp-chip-all{background:var(--blue);border-color:transparent;color:#fff}
        .lp-chip-all:hover{background:var(--blue700);border-color:transparent;color:#fff}
        @media (min-width:760px){
          .lp-chips{flex-wrap:wrap;overflow-x:visible;margin-inline:0;padding-inline:0}
        }

        /* ── hero illustration ──────────────────────────────────── */
        .lp-stage{position:relative;display:flex;align-items:center;justify-content:center;
          padding-block:10px}
        .lp-stage-bg{position:absolute;inset:6% 2%;border-radius:var(--r-xl);z-index:0;
          background:linear-gradient(158deg,var(--blue),var(--blue900));opacity:.10}
        .lp-stage-zellige{position:absolute;inset:6% 2%;border-radius:var(--r-xl);z-index:0;opacity:.45}
        .lp-panel{position:relative;z-index:1;width:100%;max-width:376px;
          background:var(--paper);border:1px solid var(--line);border-radius:var(--r-l);
          box-shadow:var(--sh-l);padding:14px;
          animation:lp-rise .6s cubic-bezier(.2,.7,.2,1) both}
        .lp-search{display:flex;align-items:center;gap:9px;border:1.5px solid var(--lineCool);
          border-radius:14px;padding:10px 12px;box-shadow:var(--sh-s)}
        .lp-hcard{display:flex;align-items:center;gap:10px;border:1px solid var(--line);
          border-radius:var(--r);padding:10px 11px}
        @keyframes lp-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

        /* ── reveal-on-scroll (one per section) ─────────────────── */
        /* Default = final state (readable with no JS). .lp-armed is added by
           useReveal only to sections that are still off-screen. */
        .lp-rv{transition:opacity .5s cubic-bezier(.2,.7,.2,1),transform .5s cubic-bezier(.2,.7,.2,1)}
        .lp-rv.lp-armed{opacity:0;transform:translateY(18px)}

        /* ── reduced motion: no motion, final state ─────────────── */
        @media (prefers-reduced-motion: reduce){
          .lp-panel{animation:none !important;opacity:1 !important;transform:none !important}
          .lp-cta:hover{transform:none !important}
          .lp-cta:hover .ic{transform:none !important}
          html[dir=rtl] .lp-cta:hover .ic{transform:scaleX(-1) !important}
          .lp-rv,.lp-rv.lp-armed{opacity:1 !important;transform:none !important;transition:none !important}
        }
      `}} />

      {/* ── 1) HERO — what it is · one CTA · the subject picker ────────── */}
      <section className="lp-hero">
        <div className="lp-wash" aria-hidden="true" />
        <div className="container">
          <div className="web-hero">
            {/* LEFT — headline, one primary CTA, the payment truth */}
            <div className="flex min-w-0 flex-col gap-5">
              {/* Phase A+ (P4): the adults-only pilot tag beside the eyebrow. min-h keeps the
                  row the tag's height either way, so its arrival after hydration shifts nothing. */}
              <div className="flex min-h-[28px] flex-wrap items-center gap-x-3 gap-y-2">
                <p className="web-eyebrow">{c.eyebrow}</p>
                <PilotTag />
              </div>

              <h1 className="web-h1 max-w-[640px]">
                {c.h1a}
                <span className="text-ochre-ink">{c.h1Hi}</span>
                {c.h1b}
              </h1>

              <p className="web-lead max-w-[500px]">{c.sub}</p>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link
                  href="/explore"
                  className="btn btn-primary lp-cta w-auto px-7 py-4 text-[15.5px]"
                >
                  {c.ctaPrimary} <Forward className="h-[18px] w-[18px]" />
                </Link>
                {/* Deliberately NOT a second button: the hero has one action. */}
                <a
                  href="#etapes"
                  className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline"
                >
                  {c.ctaSecondary}
                </a>
              </div>

              <p className="max-w-[440px] text-[13.5px] leading-relaxed text-muted">
                {c.heroMicro}
              </p>
            </div>

            {/* RIGHT — illustration of the actual product (generic on purpose) */}
            <div className="lp-stage" role="img" aria-label={c.heroAria}>
              <div className="bg-gray-800 " aria-hidden="true" />
              <div className="zellige lp-stage-zellige" aria-hidden="true" />

              <div className="lp-panel" aria-hidden="true">
                <div className="lp-search">
                  <Search className="h-[18px] w-[18px] flex-none text-blue" />
                  <span className="lp-t min-w-0 flex-1 truncate text-[13.5px] text-ink">
                    {c.heroSearch}
                  </span>
                  <span className="grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-ochre-btn text-white">
                    <Forward className="h-[15px] w-[15px]" />
                  </span>
                </div>

                <div className="mt-3 flex flex-col gap-2">
                  {HERO_CARDS.map((card) => (
                    <div key={card.id} className="lp-hcard">
                      <div className="avatar sq h-[42px] w-[42px] flex-none text-[16px]">
                        {card.ini}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="lp-t flex flex-wrap items-center gap-1.5 text-[13.5px] text-ink">
                          <span className="min-w-0">{isAr ? card.ar : card.fr}</span>
                          <Verified />
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted">
                          {isAr ? card.arMeta : card.frMeta}
                        </div>
                      </div>
                      {/* WAS a hardcoded "0 TND / 1ère séance" on all three cards.
                          Two problems, and the illustration disclaimer did not
                          cover either: it priced a fictional listing at zero, and
                          it made the free-first-session claim that Step 6 turned
                          into a per-tutor opt-in. Replaced with the affordance
                          the card actually leads to — no number, nothing to be
                          wrong about. */}
                      <div className="flex-none text-end">
                        <div className="text-[13px] text-muted">{c.cardCta}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Subject picker — the utility, right where the eye lands next. */}
          <div className="mt-9 sm:mt-11">
            {/* Body font + no letter-spacing on purpose: uppercase/tracking is
                meaningless in Arabic and positive tracking severs its joins. */}
            <p className="mb-3 text-[13px] font-bold text-ink2">{c.subjectsLabel}</p>
            <nav className="lp-chips" aria-label={c.subjectsLabel}>
              {SUBJECTS.map((s) => (
                <Link key={s.slug} href={`/explore?subject=${s.slug}`} className="lp-chip">
                  {isAr ? s.ar : s.fr}
                </Link>
              ))}
              <Link href="/explore" className="lp-chip lp-chip-all">
                {c.seeAll} {c.arrow}
              </Link>
            </nav>
          </div>
        </div>
      </section>

      {/* ── 2) HOW IT WORKS — the backbone of the page ─────────────────── */}
      <section id="etapes" className="lp-sec">
        <div className="container">
          <div className="lp-rv">
            <h2 className="web-h2 max-w-[620px]">{c.howTitle}</h2>

            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[Search, Gift, Video, Wallet].map((Icon, i) => (
                <div key={i} className="u-card u-card-pad">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="lp-t grid h-10 w-10 flex-none place-items-center rounded-[13px] bg-blue text-[16px] leading-none text-white">
                      {i + 1}
                    </span>
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 flex-none place-items-center rounded-[11px] bg-blue50 text-blue"
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                  </div>
                  <h3 className="lp-t mb-1.5 text-[16px] text-ink">{c.steps[i].t}</h3>
                  <p className="text-[14px] leading-relaxed text-ink2">{c.steps[i].p}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 3) THE 3 FACTS — price, trust and the honest pre-launch note ──
          Replaces the old trust / pre-launch / pricing trio. Everything the
          visitor still needs after the steps, said once. The note keeps the
          promise we made ourselves: zero lessons, zero reviews, no fakes. */}
      <section className="lp-sec border-y border-solid border-line bg-band">
        <div className="container">
          <div className="lp-rv">
            <h2 className="web-h2 max-w-[620px]">{c.knowTitle}</h2>

            <div className="grid-3 mt-7">
              {c.know.map((k, i) => {
                const Icon = [Gift, Shield, Wallet][i];
                return (
                  <div key={i} className="u-card u-card-pad">
                    <span
                      aria-hidden="true"
                      className={`mb-4 grid h-11 w-11 flex-none place-items-center rounded-[14px] ${TONES[i]}`}
                    >
                      <Icon />
                    </span>
                    <h3 className="lp-t mb-1.5 text-[16.5px] text-ink">{k.t}</h3>
                    <p className="text-[14px] leading-relaxed text-ink2">{k.p}</p>
                    {/* phase-a lane L3 (A22): the one payment story, labelled "Bientôt" while payments are off. */}
                    {i === 2 && (
                      <p className="mt-2 text-[14px] leading-relaxed text-ink2">
                        <PaymentStory locale={locale} />
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* <div className="u-card u-card-pad mt-4 flex-row items-start gap-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 flex-none place-items-center rounded-[11px] bg-blue50 text-blue"
              >
                <Shield className="h-[17px] w-[17px]" />
              </span>
              <p className="min-w-0 text-[13.5px] leading-relaxed text-ink2">{c.honestNote}</p>
            </div> */}
          </div>
        </div>
      </section>

      {/* ── 4) FINAL CTA (cobalt + zellige) ───────────────────────────── */}
      <section className="zellige hero-blue">
        <div className="container">
          <div className="flex flex-col items-center gap-5 py-[clamp(42px,7vw,78px)] text-center">
            <h2 className="web-h2 max-w-[620px] text-white">{c.finalTitle}</h2>
            <Link
              href="/explore"
              className="btn btn-primary lp-cta w-auto px-8 py-4 text-[16px]"
            >
              {c.finalCta} <Forward className="h-[18px] w-[18px]" />
            </Link>
            <p className="text-[13px] text-on-blue-soft">{c.finalMicro}</p>
          </div>
        </div>
      </section>

      {/* ── 5) CROSS-LINK — tutors. Bottom, not top: the top of this page
             belongs to the student/parent it was written for (and the header
             already carries a "Devenir prof" link + button). ───────────── */}
      <section className="lp-sec lp-tight">
        <div className="container">
          <div className="u-card u-card-pad lp-outro lp-rv flex-row flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <span
                aria-hidden="true"
                className="grid h-11 w-11 flex-none place-items-center rounded-[14px] bg-blue50 text-blue"
              >
                <Users />
              </span>
              <div className="min-w-0">
                <h2 className="lp-t text-[17px] text-ink">{c.profTitle}</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">{c.profBody}</p>
              </div>
            </div>
            <Link
              href="/pour-les-profs"
              className="btn btn-ghost w-auto flex-none rounded-[13px] px-6 py-3.5 text-[15px]"
            >
              {c.profCta}
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
