/* home v2 · B — WHAT THE HERO CARD SAYS, row by row. Pure: no React, no Next, no
   "@/" alias (apps/api/test/hv2-b-hero-rows.test.ts imports it as a plain module).

   Three rows, always:
     • one per REAL tutor GET /tutors/home returned (at most 3) — one link to their
       page, their approved photo or their initials, « Prof de {matière} », their
       levels, and a price or a rating ONLY when the payload carries one;
     • then NEUTRAL subject rows up to 3 — no person, no photo, no price, no rating:
       « Prof de Physique · Lycée · en ligne » and « Voir les profs », a link to
       /explore filtered on that subject and level. A subject a real row already
       shows is skipped, so the card never lists « Prof de Maths » twice.

   Every figure on the card comes from the payload, formatted here. Nothing is
   invented, nothing is defaulted. */
import {
  HOME_RATING_MIN_REVIEWS,
  HOME_TUTORS_MAX,
  LEVEL_LABELS,
  SUBJECT_LABELS,
  type HomeTutor,
  type LevelCode,
  type SubjectCode,
} from "@tnajem/shared";
import { bilingual } from "../../lib/i18n";

type Loc = "fr" | "ar";

const copy = bilingual({
  fr: {
    // Elided before a vowel or a mute h: « Prof d'Anglais », « Prof d'Histoire-Géo ».
    profOf: (subject: string) => (/^[aeiouyhàâäéèêëîïôöûüœ]/i.test(subject) ? `Prof d'${subject}` : `Prof de ${subject}`),
    online: "en ligne",
    tnd: "TND",
    perSession: "/ séance",
    perMonth: "/ mois",
    reviews: (n: string) => `(${n} avis)`,
    seeProfs: "Voir les profs",
    lycee: "Lycée",
  },
  ar: {
    profOf: (subject: string) => `أستاذ ${subject}`,
    online: "أونلاين",
    tnd: "د.ت",
    perSession: "للحصة",
    perMonth: "في الشهر",
    reviews: (n: string) => `(${n} تقييم)`,
    seeProfs: "شوف الأساتذة",
    lycee: "ثانوي",
  },
});

/** The /explore chip slug for a subject code (ExploreClient's SUBJECT_FILTERS). */
const EXPLORE_SLUG: Partial<Record<SubjectCode, string>> = {
  math: "maths", physique: "physique", svt: "svt", francais: "francais", anglais: "anglais",
  arabe: "arabe", philosophie: "philo", "histoire-geo": "histoire-geo", technique: "technique",
};

/* The neutral rows — today's three (Maths · Bac, Physique · Lycée, Français ·
   Primaire). k real tutors cover at most k of them and leave 3 − k to fill, so
   three is always enough. « Lycée » links to the « secondaire » level code. */
/** SubjectIcon slugs (components/home/SubjectIcon.tsx) — a .tsx this plain module cannot import. */
type NeutralIcon = "maths" | "physique" | "francais";

const NEUTRAL: { code: SubjectCode; icon: NeutralIcon; level: LevelCode; lyceeLabel?: boolean }[] = [
  { code: "math", icon: "maths", level: "bac" },
  { code: "physique", icon: "physique", level: "secondaire", lyceeLabel: true },
  { code: "francais", icon: "francais", level: "primaire" },
];

export type HeroRow =
  | {
      kind: "tutor";
      key: string;
      /** Locale-free; the locale-aware <Link> prefixes it. */
      href: string;
      name: string;
      initials: string;
      avatarUrl: string | null;
      title: string;
      meta: string;
      price: { amount: string; currency: string; unit: string } | null;
      rating: { value: string; count: string } | null;
    }
  | {
      kind: "subject";
      key: string;
      href: string;
      /** A subject icon, not a letter: the row is no person, and a Latin initial
          (« M », « P ») read wrong on the Arabic page (home v2 · G). */
      icon: NeutralIcon;
      title: string;
      meta: string;
      cta: string;
    };

const intl = (locale: Loc) => (locale === "ar" ? "ar-TN" : "fr-TN");

function levelsText(levels: readonly LevelCode[], locale: Loc): string {
  const l = levels.map((code) => LEVEL_LABELS[code][locale]);
  if (l.length <= 2) return l.join(" · ");
  return `${l[0]}–${l[l.length - 1]}`; // ladder order: « Collège–Université »
}

/** The explore link for a subject (and a level): the chip slug the /explore filter reads. */
export function exploreHref(code: SubjectCode | null, level?: LevelCode): string {
  const qs = new URLSearchParams();
  const slug = code ? EXPLORE_SLUG[code] : undefined;
  if (slug) qs.set("subject", slug);
  if (level) qs.set("level", level);
  const s = qs.toString();
  return s ? `/explore?${s}` : "/explore";
}

export function heroRows(tutors: readonly HomeTutor[], locale: Loc): HeroRow[] {
  const c = copy[locale];
  const real = tutors.slice(0, HOME_TUTORS_MAX);

  const rows: HeroRow[] = real.map((t) => {
    const subject = t.subject.code ? c.profOf(t.subject[locale]) : t.subject[locale];
    const levels = levelsText(t.levels, locale);
    const price =
      t.price && t.price.tnd > 0
        ? {
            amount: new Intl.NumberFormat(intl(locale), { maximumFractionDigits: 2 }).format(t.price.tnd),
            currency: c.tnd,
            unit: t.price.per === "month" ? c.perMonth : c.perSession,
          }
        : null;
    const rating =
      t.reviews && t.reviews.count >= HOME_RATING_MIN_REVIEWS
        ? {
            value: new Intl.NumberFormat(intl(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(t.reviews.average),
            count: c.reviews(new Intl.NumberFormat(intl(locale)).format(t.reviews.count)),
          }
        : null;
    return {
      kind: "tutor",
      key: `t-${t.slug}`,
      href: `/${t.slug}`,
      name: t.name,
      initials: t.initials,
      avatarUrl: t.avatar_url,
      title: subject,
      meta: levels ? `${levels} · ${c.online}` : c.online,
      price,
      rating,
    };
  });

  const taken = new Set(real.map((t) => t.subject.code).filter(Boolean));
  for (const n of NEUTRAL) {
    if (rows.length >= HOME_TUTORS_MAX) break;
    if (taken.has(n.code)) continue;
    const label = SUBJECT_LABELS[n.code][locale];
    rows.push({
      kind: "subject",
      key: `s-${n.code}`,
      href: exploreHref(n.code, n.level),
      icon: n.icon,
      title: c.profOf(label),
      meta: `${n.lyceeLabel ? c.lycee : LEVEL_LABELS[n.level][locale]} · ${c.online}`,
      cta: c.seeProfs,
    });
  }
  return rows;
}
