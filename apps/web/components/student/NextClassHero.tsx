"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Calendar, Book, Play } from "@/components/icons";
import type { StudentClassRow } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { MessageLink } from "./MessageLink";
import { SeatMenu, type CancelOutcome } from "./SeatMenu";
import { minutesLabel, subjectOf, whenLabel } from "./format";

/* Accueil's next-class hero — student-space-v1 · pages (letter B, mockup 1).

   One booked class, the soonest still ahead (or the one live right now): the real
   countdown to ITS start, « Rejoindre le direct » (the page's one ochre action →
   /live/<id>), « Fiches (n) » → that class's fiches, Message → the prof's one
   conversation, Calendrier → the same .ics the confirmation e-mail attaches, and
   « Annuler ma place » behind « ⋯ ». Every figure is the booking's own; nothing here
   is a placeholder. */

const copy = bilingual({
  fr: {
    liveNow: "En direct maintenant",
    liveIn: (s: string) => `En direct dans ${s}`,
    with: (n: string, s: string) => (s ? `avec ${n} · ${s}` : `avec ${n}`),
    fichesN: (n: number) => (n === 1 ? "1 fiche jointe" : `${n} fiches jointes`),
    join: "Rejoindre le direct",
    fiches: (n: number) => `Fiches (${n})`,
    calendar: "Calendrier",
    calendarAria: "Ajouter au calendrier",
    countdown: "Compte à rebours",
    d: "j", h: "h", m: "min", s: "s",
    unitsLong: { d: "jours", h: "heures", m: "minutes", s: "secondes" },
  },
  ar: {
    liveNow: "الدايركت بدا توّا",
    liveIn: (s: string) => `الدايركت بعد ${s}`,
    with: (n: string, s: string) => (s ? `مع ${n} · ${s}` : `مع ${n}`),
    fichesN: (n: number) => `${n} ملفات مرفوقة`,
    join: "ادخل للدايركت",
    fiches: (n: number) => `الملفات (${n})`,
    calendar: "الأجندة",
    calendarAria: "زيدها للأجندة",
    countdown: "العدّ التنازلي",
    d: "ي", h: "س", m: "دق", s: "ث",
    unitsLong: { d: "أيام", h: "ساعات", m: "دقايق", s: "ثواني" },
  },
});

const pad = (n: number) => String(n).padStart(2, "0");

/** « 9 h » / « 2 j » — the badge's short « dans … ». */
function shortIn(ms: number, locale: "fr" | "ar"): string {
  const c = copy[locale];
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  if (mins < 60) return `${mins} ${c.m}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${c.h}`;
  return `${Math.floor(hours / 24)} ${c.d}`;
}

export function NextClassHero({ row, onCancelled }: { row: StudentClassRow; onCancelled: (o: CancelOutcome) => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const start = Date.parse(row.startsAt);
  const left = start - now;
  const live = left <= 0;
  const units = left >= 86_400_000
    ? ([["d", Math.floor(left / 86_400_000)], ["h", Math.floor((left % 86_400_000) / 3_600_000)], ["m", Math.floor((left % 3_600_000) / 60_000)]] as const)
    : ([["h", Math.floor(left / 3_600_000)], ["m", Math.floor((left % 3_600_000) / 60_000)], ["s", Math.floor((left % 60_000) / 1000)]] as const);

  return (
    <section className="ssv-hero zellige" aria-labelledby="ssv-hero-t" data-e2e="next-class">
      <div className="ssv-hero-top">
        <span className={`ssv-badge${live ? " is-live" : ""}`} data-e2e="next-class-badge">
          <span className="ssv-dot" aria-hidden="true" />
          {live ? c.liveNow : c.liveIn(shortIn(left, locale))}
        </span>
        <span className="ssv-hero-with">
          <UserText>{c.with(row.tutor.name, subjectOf(row.tutor.subject, locale))}</UserText>
        </span>
      </div>

      <UserText as="h2" id="ssv-hero-t" className="ssv-hero-t">{row.title}</UserText>
      <p className="ssv-hero-m">
        <time dateTime={row.startsAt}>{whenLabel(row.startsAt, locale)}</time>
        {" · "}<span className="hp-num">{minutesLabel(row.durationMin, locale)}</span>
        {row.fiches > 0 ? <> · {c.fichesN(row.fiches)}</> : null}
      </p>

      {!live && (
        <div className="ssv-count" role="timer" aria-label={c.countdown} data-e2e="countdown">
          {units.map(([u, v]) => (
            <div key={u} className="ssv-count-box">
              <b className="hp-num">{pad(v)}</b>
              <span aria-hidden="true">{c[u]}</span>
              <span className="sr-only">{c.unitsLong[u]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ssv-hero-actions">
        {/* ONE link styled as a button (live-fixes-3 · H): never a control inside another. */}
        <Link href={`/live/${row.classId}`} className="btn btn-primary ssv-join" data-e2e="join-live">
          <Play /> {c.join}
        </Link>
        <Link href={`/student/fiches?class=${encodeURIComponent(row.classId)}`} className="btn ssv-btn-dark" data-e2e="next-class-fiches">
          <Book /> {c.fiches(row.fiches)}
        </Link>
        <MessageLink tutorId={row.tutor.id} tutorName={row.tutor.name} className="btn ssv-btn-dark" />
        {/* A plain <a>, not <Link>: /api/calendar is not a localized page. */}
        <a
          href={`/api/calendar/${encodeURIComponent(row.bookingId)}?l=${locale}`}
          download
          className="btn ssv-btn-dark"
          aria-label={c.calendarAria}
          data-e2e="add-to-calendar"
        >
          <Calendar /> {c.calendar}
        </a>
        <SeatMenu row={row} onCancelled={onCancelled} tone="dark" />
      </div>
    </section>
  );
}
