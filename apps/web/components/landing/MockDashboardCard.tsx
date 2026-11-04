/* profs-v2 · A — the floating « Ma page de prof » card of the hero. A PICTURE of the
   prof space, so aria-hidden, no links, nothing focusable. Honesty rule 4: only rows
   the prof space really has (no « Mes revenus », earnings are not tracked while
   payments are off), a silhouette and grey lines instead of a person, no number.

   The labels are the prof space's own: « Mes classes », « Mes élèves », « Mes fiches »
   are components/app/nav.tsx; « Cours en direct » / « حصص دايركت » is lib/i18n.ts
   storefront.live. Change them there, change them here.

   Size and place it from the caller (`className`); --lk-dash-tilt overrides the
   tilt, which mirrors in Arabic. Server component. */
import { Book, Forward } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { IconCalendar, IconPerson, IconUsers, IconVideo } from "./landing-icons";
import "./kit.css";

const copy = bilingual({
  fr: {
    title: "Ma page de prof",
    live: "Cours en direct",
    classes: "Mes classes",
    students: "Mes élèves",
    fiches: "Mes fiches",
  },
  ar: {
    title: "صفحتي كأستاذ",
    live: "حصص دايركت",
    classes: "حصصي",
    students: "تلامذتي",
    fiches: "ملفاتي",
  },
});

export function MockDashboardCard({ locale, className }: { locale: AppLocale; className?: string }) {
  const c = copy[locale];
  return (
    <div className={`lk-dash${className ? ` ${className}` : ""}`} aria-hidden="true" data-e2e="profs-dash-card">
      <div className="lk-dash-head">
        <p className="lk-dash-title">{c.title}</p>
        <span className="lk-dash-headline" />
      </div>
      <div className="lk-dash-body">
        <div className="lk-dash-profile">
          <span className="lk-dash-avatar">
            <IconPerson />
          </span>
          <span className="lk-dash-lines">
            <span className="lk-dash-line" />
            <span className="lk-dash-line lk-dash-line-short" />
          </span>
          <Forward className="lk-dash-chev" />
        </div>
        <div className="lk-dash-row">
          <span className="lk-tile lk-dash-tile lk-tone-green">
            <IconVideo />
          </span>
          {c.live}
        </div>
        <div className="lk-dash-row">
          <span className="lk-tile lk-dash-tile lk-tone-blue">
            <IconCalendar />
          </span>
          {c.classes}
        </div>
        <div className="lk-dash-row">
          <span className="lk-tile lk-dash-tile lk-tone-ochre">
            <IconUsers />
          </span>
          {c.students}
        </div>
        <div className="lk-dash-row">
          <span className="lk-tile lk-dash-tile lk-tone-violet">
            <Book />
          </span>
          {c.fiches}
        </div>
      </div>
    </div>
  );
}
