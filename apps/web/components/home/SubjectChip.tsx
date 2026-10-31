/* home v2 · A — a subject pill of « Choisis ta matière »: a link with the subject's
   icon and name, at least 44px tall. `active` fills it cobalt (Maths, by default, on
   the home page). It is a highlight, not « the current page », so it is not
   aria-current; data-active lets a test find it.

   `href` goes through the locale-aware Link (/explore?subject=… → /fr/explore?…).
   The scroller / wrap of a row of chips belongs to the section that lays them out.
   Server component (Link is a client component it may render). */
import { Link } from "@/components/Link";
import { SubjectIcon, type SubjectSlug } from "./SubjectIcon";

export function SubjectChip({ href, subject, label, active }: { href: string; subject: SubjectSlug; label: string; active?: boolean }) {
  return (
    <Link href={href} className={active ? "hv2-chip is-active" : "hv2-chip"} data-active={active ? "true" : undefined}>
      <SubjectIcon subject={subject} />
      <span>{label}</span>
    </Link>
  );
}
