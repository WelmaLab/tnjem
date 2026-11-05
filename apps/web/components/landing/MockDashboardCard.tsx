/* profs-v2 · A — the floating « Ma page de prof » card of the hero. A PICTURE of the
   prof space, so aria-hidden, no links, nothing focusable. Honesty rule 4: only rows
   the prof space really has (no « Mes revenus », earnings are not tracked while
   payments are off), a silhouette and grey lines instead of a person, no number.

   The labels are the prof space's own, all four from components/app/nav.tsx: « Ma
   vitrine », « Mes classes », « Mes élèves », « Mes fiches ». Change them there, change
   them here.

   Size and place it from the caller (`className`); --lk-dash-tilt overrides the
   tilt, which mirrors in Arabic. Server component. */
import { IconBook as Book, IconForward as Forward } from "./landing-icons";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { IconCalendar, IconPerson, IconStore, IconUsers } from "./landing-icons";
import "./kit.css";

const copy = bilingual({
  fr: {
    title: "Ma page de prof",
    storefront: "Ma vitrine",
    classes: "Mes classes",
    students: "Mes élèves",
    fiches: "Mes fiches",
  },
  ar: {
    title: "صفحتي كأستاذ",
    storefront: "واجهتي",
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
          <span className="lk-tile lk-dash-tile lk-tone-teal">
            <IconStore />
          </span>
          {c.storefront}
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
