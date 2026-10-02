"use client";
/* ───────────────────────────────────────────────────────────────────────────
   /explore CLIENT ISLAND — the interactive layer of the marketplace feed.

   The page (app/explore/page.tsx) is now a SERVER component: it fetches the
   unfiltered verified tutors and passes them here as `initial`, so the real
   catalogue is in the SSR HTML — crawlers (and the first paint on a 3G phone) see
   the tutors, not an empty grid that only fills in after client JS runs. This
   island then owns the interactive filtering (subject chips + search).

   `initial` mirrors getExploreTutors()'s contract:
     null → demo mode (no API_URL): clearly-badged static preview. Every card's
            slug has its own fixture in lib/demo.ts, so none of them 404s.
     []   → real DB, no verified tutor yet: honest empty state + CTA.
     [..] → results. Rating/review_count come from the reviews table; 0 reviews →
            "Nouveau", never a fabricated star score.

   The subject chips + search box re-query server-side (ilike over
   name/subject/level/bio), debounced, with a race guard on stale responses.
   Copy is page-local (FR + Tunisian Derija) — lib/i18n.ts is owned elsewhere.
   ─────────────────────────────────────────────────────────────────────────── */
import { useEffect, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Verified, Tag } from "@/components/ui";
import { Search, Users, Bolt } from "@/components/icons";
import { SiteShell } from "@/components/SiteShell";
import { TutorStanding } from "@/components/TutorStanding";
import { UserText } from "@/components/UserText";
import { getExploreTutors } from "@/app/actions";
import { PilotTag } from "@/components/PilotTag"; // Phase A+ (P4)
import { demoStorefrontList } from "@/lib/demo";
import { tutorStanding, formatNumericDate, type ExploreTutor } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { LEVEL_CODES, LEVEL_LABELS, isLevelCode } from "@tnajem/shared"; // phase-a lane L5 (A18.7)
import { displaySubject } from "@tnajem/shared"; // live-fixes-1 · C2

/* ── Page-local copy (FR + Tunisian Derija) ── */
const copy = bilingual({
  fr: {
    heroSub: "Des profs tunisiens vérifiés, un par un. Chacun fixe ses tarifs.",
    from: "à partir de",
    tnd: "TND",
    verifiedOnly: "Profs vérifiés",
    /* Screen-reader name for the blue tick — the badge carried meaning no AT could read. */
    verifiedBadge: "Prof vérifié",
    /* PAID PLACEMENT, SAID OUT LOUD (Step 16). A tutor on the Pro or Prestige
       offer is ordered above the rest. The mark and this note only ever appear
       when a card on screen actually is one — a disclosure of something that is
       not happening is noise, and a boost with no disclosure is an advert
       pretending to be a recommendation. */
    featuredBadge: "Mis en avant",
    featuredNote:
      "« Mis en avant » : ce prof est sur une offre payante, ce qui le place plus haut dans la liste. Ça ne change ni sa note ni ses avis — ils viennent uniquement de ses élèves.",
    emptyTitle: "Aucun prof pour l'instant",
    emptyBody:
      "On vérifie chaque prof à la main, un par un. Les premiers arrivent bientôt. Tu es prof ? Ouvre ta page en 5 minutes — c'est gratuit.",
    emptyCta: "Crée ta page de prof",
    noResultsBody: "Essaie une autre matière, ou un autre mot.",
    clear: "Effacer les filtres",
    loading: "On cherche…",
    // phase-a lane L5 (A18.7)
    levelsLabel: "Niveau",
    allLevels: "Tous niveaux",
    // espace prof v2 · growth (P5): a public promotion on the "from" price.
    was: "au lieu de",
    until: (d: string) => `jusqu'au ${d}`,
  },
  ar: {
    heroSub: "أساتذة توانسة، منقّحين واحد واحد. كل واحد يحدد أسعارو.",
    from: "من",
    tnd: "د.ت",
    verifiedOnly: "أساتذة مؤكّدين",
    verifiedBadge: "أستاذ مؤكّد",
    featuredBadge: "مقدّم",
    featuredNote:
      "« مقدّم » : الأستاذ هذا عندو اشتراك مدفوع، وعلى هكّاكا يتقدّم في القائمة. هذا ما يبدّل لا نقطتو لا آراء تلامذتو — هاذوكم يجيو من التلامذة برك.",
    emptyTitle: "ما فماش أساتذة توّا",
    emptyBody:
      "نأكّدو في كل أستاذ بيدينا، واحد واحد. الأوّلين جايين قريب. إنت أستاذ؟ اعمل صفحتك في 5 دقايق — بلاش.",
    emptyCta: "اعمل صفحتك كأستاذ",
    noResultsBody: "جرّب مادة أخرى، ولا كلمة أخرى.",
    clear: "امسح الفلاتر",
    loading: "قاعدين نلوّجو…",
    // phase-a lane L5 (A18.7)
    levelsLabel: "المستوى",
    allLevels: "المستويات الكل",
    was: "عوض",
    until: (d: string) => `حتى لـ ${d}`,
  },
});

/* Static preview used ONLY in demo mode (no API_URL). Never rendered when a
   DB is connected — see the `demo` flag below.

   BUILT FROM the demo storefronts, not typed out beside them. The hand-written
   cards claimed "37 avis" for a tutor whose own demo page had no reviews at all.
   Each card now says what the API would say about that fixture: the rating and
   review count come from reviews, and demo mode has none (getTutorReviews returns
   an empty feed), so every demo tutor is "Nouveau"; the price is the cheapest of
   the tutor's own demo classes, or nothing. */
const DEMO_PREVIEW: ExploreTutor[] = demoStorefrontList().map(({ tutor, classes }) => ({
  slug: tutor.slug,
  full_name: tutor.full_name,
  subject: tutor.subject,
  level: tutor.level,
  levels: tutor.levels, // phase-a lane L5 (A18.7)
  bio: tutor.bio,
  avatar_initials: tutor.avatar_initials,
  rating: 0,
  review_count: 0,
  students_count: tutor.students_count,
  price_from_tnd: classes.length ? Math.min(...classes.map((k) => k.price_tnd)) : null,
  /* NEVER featured: the preview must not model paid placement, and no demo
     tutor has ever paid for anything. */
  featured: false,
}));

/* Subject filters — the URL contract shared with the home page's subject chips
   (/explore?subject=<slug>). `term` is what we match against tutors.subject, which
   is free text like "Prof de Maths · Lycée & Bac", so it stays French even in the
   Arabic UI or the ilike in getExploreTutors would never hit. Keep the slugs in
   sync with SUBJECTS in app/[locale]/page.tsx — they are the same nine chips. */
const SUBJECT_FILTERS = [
  { slug: "maths", term: "Math", fr: "Maths", ar: "رياضيات" },
  { slug: "physique", term: "Physique", fr: "Physique", ar: "فيزياء" },
  { slug: "svt", term: "SVT", fr: "SVT", ar: "علوم" },
  { slug: "francais", term: "Français", fr: "Français", ar: "فرنسية" },
  { slug: "anglais", term: "Anglais", fr: "Anglais", ar: "إنڨليزية" },
  { slug: "arabe", term: "Arabe", fr: "Arabe", ar: "عربية" },
  { slug: "philo", term: "Philo", fr: "Philo", ar: "فلسفة" },
  { slug: "histoire-geo", term: "Histoire", fr: "Histoire-Géo", ar: "تاريخ-جغرافيا" },
  { slug: "technique", term: "Technique", fr: "Technique", ar: "تقني" },
] as const;

/* undefined for "all" (and for an unknown slug) — which is exactly the "no subject
   filter" value getExploreTutors expects, so callers don't special-case "all". */
const termFor = (slug: string): string | undefined =>
  SUBJECT_FILTERS.find((s) => s.slug === slug)?.term;

/** adultsOnly: read per request by the (force-dynamic) server page — Phase A+ (P4). */
export function ExploreClient({ initial, adultsOnly = false }: { initial: ExploreTutor[] | null; adultsOnly?: boolean }) {
  const { t, locale } = useLocale();
  const c = copy[locale === "ar" ? "ar" : "fr"];

  const [q, setQ] = useState("");
  const [subj, setSubj] = useState("all");
  const [lvl, setLvl] = useState("all"); // phase-a lane L5 (A18.7): a level code, or "all"
  // Seeded from the server render (SSR includes the real tutors → crawlable, no
  // client round-trip for the first paint). null from the server = demo mode.
  const [tutors, setTutors] = useState<ExploreTutor[]>(initial ?? DEMO_PREVIEW);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState(initial === null);

  // Guards against out-of-order responses (fast typing on a slow 3G link).
  const reqId = useRef(0);
  // The server already delivered the unfiltered first page; only hit the network
  // once the user actually changes a filter (skips a redundant fetch on mount).
  const firstRun = useRef(true);

  // Seed the subject filter from ?subject=<slug> — the home page's subject chips
  // link straight here, and without this every one of them landed on the
  // unfiltered list. Read from window on mount rather than useSearchParams(): the
  // hook forces a Suspense boundary and opts this page out of static rendering.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("subject");
    if (slug && termFor(slug)) setSubj(slug);
    // phase-a lane L5 (A18.7): ?level=<code> too.
    const level = new URLSearchParams(window.location.search).get("level");
    if (isLevelCode(level)) setLvl(level);
  }, []);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const debounce = q.trim() ? 320 : 0;

    const timer = setTimeout(() => {
      getExploreTutors({
        subject: termFor(subj),
        q: q.trim() || undefined,
        level: isLevelCode(lvl) ? lvl : undefined, // phase-a lane L5 (A18.7)
      })
        .then((res) => {
          if (id !== reqId.current) return; // stale
          if (res === null) {
            setDemo(true);
            setTutors(DEMO_PREVIEW);
          } else {
            setDemo(false);
            setTutors(res);
          }
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setDemo(false);
          setTutors([]);
        })
        .finally(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, debounce);

    return () => clearTimeout(timer);
  }, [q, subj, lvl]); // phase-a lane L5 (A18.7): + lvl

  const SUBJECTS = [
    { key: "all", label: t.extra.allSubjects },
    ...SUBJECT_FILTERS.map((s) => ({ key: s.slug, label: locale === "ar" ? s.ar : s.fr })),
  ];

  const hasFilters = subj !== "all" || lvl !== "all" || q.trim().length > 0; // phase-a lane L5 (A18.7): + lvl

  // phase-a lane L5 (A18.7): the level chips, labelled in the viewer's language.
  const LEVELS = [
    { key: "all", label: c.allLevels },
    ...LEVEL_CODES.map((code) => ({ key: code as string, label: LEVEL_LABELS[code][locale === "ar" ? "ar" : "fr"] })),
  ];

  // In demo mode the server can't filter for us — filter the preview client-side
  // so the chips and the search box still visibly work.
  const visible = demo
    ? tutors.filter((tu) => {
        const term = termFor(subj);
        if (isLevelCode(lvl) && !tu.levels.includes(lvl)) return false; // phase-a lane L5 (A18.7)
        const matchSubj = !term || tu.subject.includes(term);
        const ql = q.trim().toLowerCase();
        const matchQ =
          !ql ||
          tu.full_name.toLowerCase().includes(ql) ||
          tu.subject.toLowerCase().includes(ql) ||
          tu.bio.toLowerCase().includes(ql);
        return matchSubj && matchQ;
      })
    : tutors;

  function clearFilters() {
    setQ("");
    setSubj("all");
    setLvl("all"); // phase-a lane L5 (A18.7)
  }

  return (
    <SiteShell>
      {/* Hero / filter section */}
      <section className="border-b border-solid border-line bg-band">
        <div className="container py-10 sm:py-12">
          {/* Eyebrow + heading */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-display text-[13px] font-semibold uppercase tracking-[0.16em] text-muted">
              {t.nav.explore}
            </p>
            <PilotTag adultsOnly={adultsOnly} /> {/* Phase A+ (P4) */}
          </div>
          <h1 className="web-h2 mb-2">{t.extra.featured}</h1>
          <p className="mb-6 max-w-[560px] text-[14.5px] leading-relaxed text-muted">{c.heroSub}</p>

          {/* Search bar */}
          <div className="mb-5 max-w-[560px]">
            {/* Vertical padding sits on the INPUT, not the wrapper: with py-2.5
                on the row the field looked 44px tall but the input's own hit box
                was 17px, so a tap anywhere in the padding landed on the div and
                focused nothing. Same fix as .inp in globals.css. */}
            <div className="flex min-h-[44px] items-stretch gap-2.5 rounded-[var(--r)] border border-solid border-line bg-paper px-3.5 shadow-[var(--sh-s)] transition-colors focus-within:border-blue focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-blue">
              <Search className="size-[18px] shrink-0 self-center text-muted" />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t.extra.searchPh}
                aria-label={t.extra.searchPh}
                className="min-h-[44px] min-w-0 flex-1 border-0 bg-transparent py-2.5 text-[15px] text-ink outline-none placeholder:text-muted"
              />
            </div>
          </div>

          {/* Subject filter chips */}
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((s) => {
              const active = subj === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSubj(s.key)}
                  aria-pressed={active}
                  className={`inline-flex min-h-[44px] cursor-pointer items-center whitespace-nowrap rounded-full border border-solid px-4 text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-blue bg-blue text-paper shadow-[var(--sh-s)]"
                      : "border-line bg-paper text-ink2 hover:border-blue hover:text-blue"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* phase-a lane L5 (A18.7): the level filter — the codes each tutor chose. */}
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={c.levelsLabel} data-e2e="level-filter">
            <span className="text-[13px] font-semibold text-muted">{c.levelsLabel}</span>
            {LEVELS.map((l) => {
              const active = lvl === l.key;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setLvl(l.key)}
                  aria-pressed={active}
                  data-level={l.key}
                  className={`inline-flex min-h-[44px] cursor-pointer items-center whitespace-nowrap rounded-full border border-solid px-4 text-[13px] font-semibold transition-colors ${
                    active
                      ? "border-blue bg-blue text-paper shadow-[var(--sh-s)]"
                      : "border-line bg-paper text-ink2 hover:border-blue hover:text-blue"
                  }`}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Results grid */}
      <section className="py-10 sm:py-14">
        <div className="container">
          {/* Demo-mode disclosure: never let a preview masquerade as the real catalogue. */}
          {demo && !loading && (
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-solid border-line bg-sand px-3.5 py-1.5 text-[13px] font-semibold text-ink2">
              <Bolt className="size-4 shrink-0 text-amber" />
              {t.extra.demoPreview}
            </div>
          )}

          {loading ? (
            /* ── Loading ── */
            <div
              className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
              role="status"
              aria-live="polite"
              aria-label={c.loading}
            >
              {/* Skeleton mirrors the real card's box model (u-card + u-card-pad +
                  two-line footer) so nothing jumps when the results land. */}
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="u-card u-card-pad animate-pulse">
                  <div className="flex items-start gap-3.5">
                    <div className="size-16 shrink-0 rounded-[var(--r)] bg-line" />
                    <div className="min-w-0 flex-1 space-y-2 pt-1.5">
                      <div className="h-3.5 w-2/3 rounded bg-line" />
                      <div className="h-3 w-1/2 rounded bg-line" />
                    </div>
                  </div>
                  <div className="mt-4 h-3 w-full rounded bg-line" />
                  <div className="mt-2 h-3 w-4/5 rounded bg-line" />
                  <div className="u-card-foot mt-5 border-t border-solid border-line pt-3.5">
                    <div className="h-3 w-1/2 rounded bg-line" />
                    <div className="mt-3 h-4 w-1/3 rounded bg-line" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            /* ── Empty ── two honest flavours: filtered-to-nothing vs no catalogue yet ── */
            <div className="u-card mx-auto max-w-[520px] items-center px-6 py-12 text-center">
              <div className="mx-auto mb-5 grid size-14 shrink-0 place-items-center rounded-full bg-blue50 text-blue">
                {hasFilters ? <Search className="size-6" /> : <Users className="size-6" />}
              </div>
              <h2 className="mb-2 font-display text-lg font-bold text-ink">
                {hasFilters ? t.extra.noResults : c.emptyTitle}
              </h2>
              <p className="mx-auto mb-6 max-w-[400px] text-[14.5px] leading-relaxed text-muted">
                {hasFilters ? c.noResultsBody : c.emptyBody}
              </p>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-full border border-solid border-line bg-paper px-5 text-[13.5px] font-semibold text-ink2 transition-colors hover:border-blue hover:text-blue"
                >
                  {c.clear}
                </button>
              ) : (
                <Link
                  href="/pour-les-profs"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-blue px-6 py-2.5 text-[14px] font-bold text-paper shadow-[var(--sh-s)] transition-colors hover:bg-blue700"
                >
                  {c.emptyCta}
                </Link>
              )}
            </div>
          ) : (
            /* ── Results ── */
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((tutor) => {
                const standing = tutorStanding({
                  reviewCount: tutor.review_count,
                  rating: tutor.rating,
                  students: tutor.students_count,
                });
                return (
                  /* .u-card = the canonical card primitive (app/globals.css):
                     flex column + height:100% → every card in a row is the same
                     height, and .u-card-foot pins the footer so the price lines
                     up across the whole grid. .u-card-int adds the hover lift. */
                  <Link
                    key={tutor.slug}
                    href={`/${tutor.slug}`}
                    className="u-card u-card-pad u-card-int group"
                  >
                    {/* Top row: square gradient avatar + identity column.
                        The "Nouveau" badge used to be absolutely positioned here
                        (`absolute end-4 top-4`) with a `pe-16` hack on this
                        sibling to dodge it — it collided with the name at narrow
                        widths and duplicated the "Nouveau" already shown in the
                        meta row. It is now rendered ONCE, in flow, in the rating
                        slot below, which is exactly what it stands in for. */}
                    <div className="flex items-start gap-3.5">
                      {/* UI Option A (A6): ONE avatar style for a tutor — the same .avatar
                          (amber → ochre, ink initials) as their own page. It was
                          cobalt here and ochre there for the same person. */}
                      <div className="avatar sq size-16 text-xl font-bold">
                        {tutor.avatar_initials}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <UserText className="min-w-0 truncate font-display text-base font-bold text-ink transition-colors group-hover:text-blue">
                            {tutor.full_name}
                          </UserText>
                          {/* Only verified tutors are ever returned by getExploreTutors.
                              .verified is flex:none, so it stays a circle next to
                              the truncated name instead of squashing to an ellipse. */}
                          <Verified label={c.verifiedBadge} />
                        </div>
                        {/* In flow under the name, not floated over the card:
                            the label has to be readable at 320px, and a mark the
                            layout hides at narrow widths is not a disclosure. */}
                        {tutor.featured && (
                          <div className="mt-1.5">
                            <Tag kind="neutral">{c.featuredBadge}</Tag>
                          </div>
                        )}
                        {/* line-clamp-2, not truncate: "Prof de Maths · Lycée & Bac"
                            (and its longer AR form) needs two lines at 284px. */}
                        <UserText as="div" className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">
                          {displaySubject(tutor.subject, locale === "ar" ? "ar" : "fr")}
                        </UserText>
                        {/* phase-a lane L5 (A18.7): the levels this tutor chose — nothing when none. */}
                        {tutor.levels.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5" data-e2e="card-levels">
                            {tutor.levels.map((code) => (
                              <span key={code} className="tag tag-neutral">
                                {LEVEL_LABELS[code][locale === "ar" ? "ar" : "fr"]}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bio teaser */}
                    {tutor.bio && (
                      <UserText as="p" className="mt-4 line-clamp-2 break-words text-[13px] leading-relaxed text-ink2">
                        {tutor.bio}
                      </UserText>
                    )}

                    {/* Footer — was ONE justify-between row cramming three
                        variable-length items (rating + "(37 avis)", students,
                        "à partir de 15 TND") into a 284px card; in AR the strings
                        are longer and it overflowed. Now two deliberate rows:
                        social proof wraps freely, price gets its own line. */}
                    <div className="u-card-foot mt-5 border-t border-solid border-line pt-3.5">
                      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-muted">
                        <TutorStanding standing={standing} locale={locale === "ar" ? "ar" : "fr"} variant="card" />
                      </div>

                      {tutor.price_from_tnd !== null && (() => {
                        /* espace prof v2 · growth (P5): the "from" price after the best PUBLIC
                           promotion (computed by the API with pricing.ts) — struck original,
                           "−15 %" and the end date. Re-checked against the clock here. */
                        const promo = tutor.price_from_promo && Date.parse(tutor.price_from_promo.ends_at) > Date.now() ? tutor.price_from_promo : null;
                        return (
                          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5" data-e2e="explore-price">
                            <span className="text-[13px] text-muted">{c.from}</span>
                            {promo && (
                              <>
                                <span className="sr-only">{c.was}</span>
                                <del className="text-[13px] text-muted" data-e2e="price-was">{tutor.price_from_tnd} {c.tnd}</del>
                              </>
                            )}
                            <b className="font-num tabular-nums text-[18px] font-bold leading-none text-ink">
                              {promo ? promo.final_tnd : tutor.price_from_tnd}
                            </b>
                            <span className="text-[13px] font-semibold text-muted">{c.tnd}</span>
                            {promo && (
                              <>
                                <span className="tag tag-neutral" dir="ltr" data-e2e="promo-badge">−{promo.percent} %</span>
                                <span className="text-[13px] text-muted">{c.until(formatNumericDate(promo.ends_at))}</span>
                              </>
                            )}
                          </p>
                        );
                      })()}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* THE DISCLOSURE. Rendered only when a card on this screen actually
              carries the mark, so the page never explains a thing that is not
              happening — and never leaves it unexplained when it is. */}
          {visible.some((tu) => tu.featured) && (
            <p className="mt-6 max-w-[640px] text-[13px] leading-relaxed text-muted">
              {c.featuredNote}
            </p>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
