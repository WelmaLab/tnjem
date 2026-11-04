/* home v2 · A — the nine subject icons of the home page (« Choisis ta matière »).
   One set: 24×24 viewBox, a 1.8 stroke in currentColor, round caps and joins — the
   same line style as components/icons.tsx. The drawings live in globals.css as CSS
   masks (`.hv2-sic-<slug>`, home v2 · G); edit them there.
   Decorative: every use sits next to the subject's written name. None of them has a
   direction, so none is mirrored in Arabic. Server component. */
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

export function SubjectIcon({ subject, className }: { subject: SubjectSlug; className?: string }) {
  // The drawing is a CSS mask (globals.css, `.hv2-sic-<slug>`): one cacheable copy instead
  // of an inline <svg> in the HTML and again in the RSC payload (home v2 · G).
  return <span className={`hv2-sic hv2-sic-${subject}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}
