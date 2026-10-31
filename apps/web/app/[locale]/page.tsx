import type { Metadata } from "next";
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { Reveal } from "@/components/Reveal";
import { Verified } from "@/components/ui";
import { Shield, Gift, Forward, Search, Video, Wallet, Users } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import { PaymentStory } from "@/components/PaymentStory"; // phase-a lane L3 (A22)
import { PilotTag } from "@/components/PilotTag"; // Phase A+ (P4)
import "@/components/home/home.css"; // home v2 · E: was an inline <style> string

/* ── SERVER COMPONENT (home v2 · E) ────────────────────────────────────────────
   This page was one big "use client" module: the whole page — copy for BOTH
   locales included — shipped as JavaScript and hydrated, to render text. It now
   renders on the server; the only client code left is what needs the browser:
     • <Link> (locale-aware next/link, client by construction),
     • <PilotTag> (asks /api/pilot after hydration — the flag is the running
       server's, never the build's),
     • <Reveal> (components/Reveal.tsx — the shared reveal-on-scroll; it starts
       visible and only arms sections that are off-screen at hydration).
   The locale comes from the URL segment, like the layout and /explore.

   STATIC + ISR. Prerendered per locale at build (the layout's generateStaticParams),
   re-rendered at most once a minute. Reads no cookies() / headers() /
   searchParams — any of those would silently make /fr dynamic (static-render.spec
   asserts x-nextjs-cache: HIT on /fr and /ar). Data for this page must come
   through callAnonymous() (lib/api.ts) and must FAIL SOFT: `next build` runs with
   no API, and a throw there fails the build. */
export const revalidate = 60;

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
   the bottom of components/home/home.css.
   ===================================================================== */

const copy = bilingual({
  fr: {
    // <head>: the title and description the layout already gave the home page (unchanged).
    metaTitle: "Tnajem — apprends avec ton prof",
    metaDescription:
      "Trouve un prof en direct, du primaire au Bac — toutes les matières, avec des profs tunisiens vérifiés un par un.",

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
    metaTitle: "Tnajem — تعلّم مع أستاذك",
    metaDescription:
      "لقّي أستاذ دايركت، من الابتدائي للباك — كل المواد، مع أساتذة توانسة مؤكّدين واحد واحد.",

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

/* Reveal-on-scroll — the SHARED components/Reveal.tsx (home v2 · E deleted the
   page-local copy of the same rule). Progressive enhancement, never a
   prerequisite: `.lp-rv` renders at its FINAL state in the server HTML, and the
   island only arms (`.lp-armed`) a section that is off-screen at hydration. One
   per section below the hero — not per card — so the page settles fast. */
const RV = { base: "lp-rv", armedClass: "lp-armed", delayVar: "--lp-d" } as const;

function localeOf(raw: string): AppLocale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/* <head>. Through pageMetadata like every other public route, so the home page
   gets its canonical and its hreflang set (fr-TN · ar-TN · x-default → /fr) —
   as a client page it could export no metadata and had neither. The title stays
   the layout's own (absolute: no "· Tnajem" suffix on the brand page), and the
   OG image / twitter card are pageMetadata's (the same /og.png as the layout).

   JSON-LD: nothing page-level. The layout already emits Organization + WebSite on
   every page; a second Organization node here would be a duplicate entity. No
   WebSite SearchAction either: /explore does NOT read ?q= from the URL today
   (ExploreClient seeds only ?subject= and ?level=), so a SearchAction pointing at
   /explore?q={search_term_string} would promise a search that lands on the
   unfiltered list. Add it to the layout's WebSite node once ?q= works. */
export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = localeOf((await props.params).locale);
  const c = copy[locale];
  const m = pageMetadata({ locale, path: "", title: c.metaTitle, description: c.metaDescription });
  return {
    ...m,
    title: { absolute: c.metaTitle },
    openGraph: { ...m.openGraph, title: c.metaTitle },
    twitter: { ...m.twitter, title: c.metaTitle },
  };
}

export default async function HomePage(props: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await props.params).locale);
  const c = copy[locale];
  const isAr = locale === "ar";

  // lane B: tutors fetch goes here — `const tutors = await getHomeTutors();`
  // (callAnonymous only — no cookies()/headers(), or /fr turns dynamic — and it
  // must resolve to [] when the API is down: `next build` runs with no API.)

  return (
    <SiteShell>
      {/* ── HERO (lane B) ── */}
      {/* ── 1) HERO — what it is · one CTA · the subject picker ────────── */}
      <section className="lp-hero">
        <div className="lp-wash" aria-hidden="true" />
        <div className="container">
          <div className="web-hero">
            {/* LEFT — headline, one primary CTA, the payment truth */}
            <div className="flex min-w-0 flex-col gap-5">
              {/* Phase A+ (P4): the adults-only pilot tag beside the eyebrow. It arrives after
                  hydration; `reserve` keeps its box (invisible) from the first paint, so its
                  arrival shifts nothing at any width (home v2 · E). Keep `reserve` when restyling. */}
              <div className="lp-eyebrow-row">
                <p className="web-eyebrow">{c.eyebrow}</p>
                <PilotTag reserve />
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
        </div>
      </section>

      {/* ── SECTIONS (lane C) ── */}
      {/* Subject picker — the utility, right where the eye lands next. Its own
          section since home v2 · E (it sat inside the hero <section>), so the hero
          and the body sections are separate regions; .lp-subjects clips the chip
          scroller's edge bleed, as .lp-hero did. Spacing unchanged. */}
      <section className="lp-subjects">
        <div className="container">
          <div>
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
          <Reveal {...RV}>
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
          </Reveal>
        </div>
      </section>

      {/* ── 3) THE 3 FACTS — price, trust and the honest pre-launch note ──
          Replaces the old trust / pre-launch / pricing trio. Everything the
          visitor still needs after the steps, said once. The note keeps the
          promise we made ourselves: zero lessons, zero reviews, no fakes. */}
      <section className="lp-sec border-y border-solid border-line bg-band">
        <div className="container">
          <Reveal {...RV}>
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
          </Reveal>
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
          <Reveal {...RV} className="u-card u-card-pad lp-outro flex-row flex-wrap items-center justify-between gap-4">
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
          </Reveal>
        </div>
      </section>
      {/* ── /SECTIONS (lane C) ── */}
    </SiteShell>
  );
}
