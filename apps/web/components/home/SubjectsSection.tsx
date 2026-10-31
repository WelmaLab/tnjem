import { Link } from "@/components/Link";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { SubjectChip } from "./SubjectChip";
import { SUBJECT_SLUGS, type SubjectSlug } from "./SubjectIcon";
import "./sections.css";

/* home v2 · C — « Choisis ta matière ».

   Each chip is a plain link to /explore?subject=<slug>. The slugs are the URL
   contract that components/explore/ExploreClient.tsx reads on mount
   (SUBJECT_FILTERS there): the same nine, in the same order — keep them in sync.
   « Maths » is the active chip by default, as in the mockup; it is a visual
   default only (every chip is a link, none is a toggle), so no aria-pressed.

   Phone: one row that scrolls sideways and bleeds to the screen edges; the
   section clips it (overflow-x: clip), so the PAGE never scrolls sideways.
   From 900px up: two fixed rows of five (a grid, so no font swap can move a chip
   to another row — see sections.css). */

const copy = bilingual({
  fr: {
    title: "Choisis ta matière",
    all: "Toutes les matières",
    arrow: "→",
    labels: {
      maths: "Maths",
      physique: "Physique",
      svt: "SVT",
      francais: "Français",
      anglais: "Anglais",
      arabe: "Arabe",
      philo: "Philo",
      "histoire-geo": "Histoire-Géo",
      technique: "Technique",
    } satisfies Record<SubjectSlug, string>,
  },
  ar: {
    title: "اختار المادة",
    all: "المواد الكل",
    arrow: "←",
    labels: {
      maths: "رياضيات",
      physique: "فيزياء",
      svt: "علوم",
      francais: "فرنسية",
      anglais: "إنڨليزية",
      arabe: "عربية",
      philo: "فلسفة",
      "histoire-geo": "تاريخ-جغرافيا",
      technique: "تقني",
    } satisfies Record<SubjectSlug, string>,
  },
});

export function SubjectsSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="hs-subjects" aria-labelledby="hs-subjects-title" data-e2e="home-subjects">
      <div className="container">
        {/* Body font, no tracking: uppercase/letter-spacing mean nothing in Arabic. */}
        <h2 id="hs-subjects-title" className="hs-subjects-title">{c.title}</h2>
        <nav className="hs-chips" aria-labelledby="hs-subjects-title">
          {SUBJECT_SLUGS.map((slug) => (
            <SubjectChip
              key={slug}
              href={`/explore?subject=${slug}`}
              subject={slug}
              label={c.labels[slug]}
              active={slug === "maths"}
            />
          ))}
          <Link href="/explore" className="hs-chip-all" data-e2e="home-subjects-all">
            {c.all} <span aria-hidden="true">{c.arrow}</span>
          </Link>
        </nav>
      </div>
    </section>
  );
}
