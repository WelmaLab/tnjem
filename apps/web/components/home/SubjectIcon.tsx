/* home v2 · A — the nine subject icons of the home page (« Choisis ta matière »).
   One set: 24×24 viewBox, a 1.8 stroke in currentColor, round caps and joins — the
   same line style as components/icons.tsx (it reuses the .ic class for size and caps).
   Decorative: every use sits next to the subject's written name. None of them has a
   direction, so none is mirrored in Arabic. Server component. */
import type { ReactNode } from "react";

export type SubjectSlug =
  | "maths"
  | "physique"
  | "svt"
  | "francais"
  | "anglais"
  | "arabe"
  | "philo"
  | "histoire-geo"
  | "technique";

/** In the order the home page lists them. */
export const SUBJECT_SLUGS: SubjectSlug[] = [
  "maths",
  "physique",
  "svt",
  "francais",
  "anglais",
  "arabe",
  "philo",
  "histoire-geo",
  "technique",
];

/* A dot drawn as a filled disc, so it does not depend on the stroke's caps. */
const Dot = ({ cx, cy, r = 1.1 }: { cx: number; cy: number; r?: number }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

const GLYPHS: Record<SubjectSlug, ReactNode> = {
  // a calculator
  maths: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2.6" />
      <rect x="8" y="6" width="8" height="3.6" rx="1" />
      <Dot cx={8.9} cy={13.2} />
      <Dot cx={12} cy={13.2} />
      <Dot cx={15.1} cy={13.2} />
      <Dot cx={8.9} cy={17} />
      <Dot cx={12} cy={17} />
      <Dot cx={15.1} cy={17} />
    </>
  ),
  // a conical flask, with its liquid line
  physique: (
    <>
      <path d="M9 3.5h6" />
      <path d="M10.2 3.5v5.6L5.1 17.7a1.9 1.9 0 0 0 1.6 2.8h10.6a1.9 1.9 0 0 0 1.6-2.8l-5.1-8.6V3.5" />
      <path d="M7.4 14.5h9.2" />
    </>
  ),
  // a leaf and its vein
  svt: (
    <>
      <path d="M19.5 4.5C11.2 4.6 5.5 9.4 5.5 16.2c0 1.1.1 2.2.4 3.3 7.8-.2 13.6-5.2 13.6-15z" />
      <path d="M4.5 20.5 14 11" />
    </>
  ),
  // an open book (the same book as icons.tsx)
  francais: (
    <>
      <path d="M12 6.6C10.4 5.1 7.8 4.6 4 5.2v12.6c3.8-.6 6.4-.1 8 1.4 1.6-1.5 4.2-2 8-1.4V5.2c-3.8-.6-6.4-.1-8 1.4z" />
      <path d="M12 6.6v12.6" />
    </>
  ),
  // a speech bubble with a Latin « A »
  anglais: (
    <>
      <path d="M5.5 4.5h13a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H11l-4.5 3.5V17h-1a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2z" />
      <path d="M9.4 14 12 7.6l2.6 6.4" />
      <path d="M10.3 11.9h3.4" />
    </>
  ),
  // the letter « ع » — the same letter the header's FR / ع switch uses for Arabic
  arabe: (
    <path d="M16 5.6c-1.8-1.7-6.2-1.5-6.2 1.6 0 2.4 2.8 3.2 5.8 2.9-4.6.7-8 3.3-8 6.5 0 2.7 2.4 4 5.4 4 1.8 0 3.5-.4 4.8-1.1" />
  ),
  // a thought bubble with a question mark
  philo: (
    <>
      <path d="M12 4c4.4 0 7.8 2.8 7.8 6.3s-3.4 6.3-7.8 6.3c-1 0-1.9-.1-2.8-.4L5.4 18l1.1-3.2a5.9 5.9 0 0 1-2.3-4.5C4.2 6.8 7.6 4 12 4z" />
      <path d="M10.2 8.9a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" />
      <Dot cx={12} cy={14.1} r={0.95} />
      <Dot cx={4.4} cy={20.6} r={1} />
    </>
  ),
  // a globe: one meridian and the equator
  "histoire-geo": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5c-2.4 2.3-3.6 5.1-3.6 8.5s1.2 6.2 3.6 8.5c2.4-2.3 3.6-5.1 3.6-8.5S14.4 5.8 12 3.5z" />
      <path d="M3.5 12h17" />
    </>
  ),
  // a cog: eight teeth around a hub
  technique: (
    <>
      <circle cx="12" cy="12" r="5.6" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.9 5.9l1.6 1.6M16.5 16.5l1.6 1.6M5.9 18.1l1.6-1.6M16.5 7.5l1.6-1.6" />
    </>
  ),
};

export function SubjectIcon({ subject, className }: { subject: SubjectSlug; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`ic hv2-sic${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[subject]}
    </svg>
  );
}
