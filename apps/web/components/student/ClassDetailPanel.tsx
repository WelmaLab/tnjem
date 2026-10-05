"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Verified } from "@/components/ui";
import { Calendar, Play } from "@/components/icons";
import { ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { getStudentClass, type StudentClassDetailResult } from "@/app/actions-student";
import type { StudentClassDetail } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { FicheItem } from "./FicheItem";
import { MessageLink } from "./MessageLink";
import { ProfAvatar } from "./ProfAvatar";
import { ReviewBox } from "./ReviewBox";
import { SeatMenu, cancelOutcomeText } from "./SeatMenu";
import { StatusTag, lateNote } from "./ClassStatus";
import { dayLabel, priceLabel, rangeLabel, subjectOf } from "./format";

/* THE DETAIL OF ONE BOOKING — student-space-v1 · C (mockup 2a, right column).

   The right column of « Mes cours » on a computer, its own page on a phone
   (/student/cours/<bookingId>). Date and time range, the prof card (« Voir sa
   page »), « Fiches de la séance » (the materials of THIS class the student may
   open — the one access rule), « Ton avis » (the existing review flow, inline),
   « Réserver la prochaine » (the prof's next class, else their page) and Message.
   An upcoming class gets « Rejoindre le direct », Calendrier and « ⋯ » instead of
   « Réserver la prochaine ». No attendance, no recording: we track neither. */

const copy = bilingual({
  fr: {
    seePage: "Voir sa page",
    verified: "Vérifié",
    verifiedAria: "Prof vérifié",
    fiches: "Fiches de la séance",
    noFiches: "Pas de fiche pour cette séance pour l'instant.",
    bookNext: "Réserver la prochaine",
    bookNextAria: (t: string, d: string) => `Réserver la prochaine séance : « ${t} », ${d}`,
    join: "Rejoindre le direct",
    calendar: "Calendrier",
    calendarAria: "Ajouter au calendrier",
    notFound: "Cette séance n'est pas dans tes cours.",
    backToList: "Retour à mes cours",
  },
  ar: {
    seePage: "شوف صفحتو",
    verified: "متثبّت منّو",
    verifiedAria: "أستاذ متثبّت منّو",
    fiches: "ملفات الحصة",
    noFiches: "ما فمّا حتى ملف للحصة هاذي لتوّا.",
    bookNext: "احجز الجاية",
    bookNextAria: (t: string, d: string) => `احجز الحصة الجاية : « ${t} »، ${d}`,
    join: "ادخل للدايركت",
    calendar: "الأجندة",
    calendarAria: "زيدها للأجندة",
    notFound: "الحصة هاذي موش في حصصك.",
    backToList: "ارجع لحصصي",
  },
});

export function ClassDetailBody({
  d,
  onChanged,
  onFlash,
  headingLevel = 2,
}: {
  d: StudentClassDetail;
  onChanged: () => void;
  onFlash: (m: string) => void;
  /** 2 on its own page (under the page's h1 «  Mes cours »), 2 in the column too. */
  headingLevel?: 1 | 2;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const r = d.row;
  const H = headingLevel === 1 ? "h1" : "h2";
  const subject = subjectOf(r.tutor.subject, locale);
  const late = lateNote(r, locale);
  const ahead = r.state === "upcoming" || r.state === "live";
  return (
    <article className="ssv-detail" aria-labelledby="ssv-detail-t" data-e2e="class-detail" data-booking-id={r.bookingId}>
      <p className="ssv-detail-when">
        <time dateTime={r.startsAt}>{dayLabel(r.startsAt, locale)}</time> · <span className="hp-num" dir="ltr">{rangeLabel(r.startsAt, r.endsAt)}</span>
      </p>
      <div className="ssv-detail-head">
        <UserText as={H} id="ssv-detail-t" className="ssv-detail-t">{r.title}</UserText>
        <StatusTag row={r} />
      </div>
      <p className="ssv-row-m">{priceLabel(r.price, locale)}</p>
      {late ? <p className="ssv-late" data-e2e="late-note">{late}</p> : null}

      <div className="ssv-prof" data-e2e="detail-prof">
        <ProfAvatar tutor={r.tutor} size={42} />
        <div className="ssv-row-main">
          <UserText as="span" className="ssv-row-t">{r.tutor.name}</UserText>
          <span className="ssv-row-m">
            {subject}
            {r.tutor.verified ? <>{subject ? " · " : ""}<span className="ssv-verified"><Verified label={c.verifiedAria} /> {c.verified}</span></> : null}
          </span>
        </div>
        <Link href={`/${r.tutor.slug}`} className="btn btn-ghost btn-sm" data-e2e="detail-see-page">{c.seePage}</Link>
      </div>

      <section className="ssv-dsec" aria-labelledby="ssv-fiches-t" data-e2e="class-fiches">
        <h3 id="ssv-fiches-t" className="ssv-dsec-t">{c.fiches}</h3>
        {d.fiches.length ? (
          <ul className="ssv-list">{d.fiches.map((f) => <FicheItem key={f.id} f={f} />)}</ul>
        ) : (
          <p className="ssv-muted">{c.noFiches}</p>
        )}
      </section>

      <ReviewBox detail={d} onDone={onChanged} />

      <div className="ssv-detail-actions">
        {ahead ? (
          <>
            <Link href={`/live/${r.classId}`} className="btn btn-primary btn-sm" data-e2e="detail-join"><Play /> {c.join}</Link>
            <MessageLink tutorId={r.tutor.id} tutorName={r.tutor.name} />
            <a href={`/api/calendar/${encodeURIComponent(r.bookingId)}?l=${locale}`} download className="btn btn-ghost btn-sm" aria-label={c.calendarAria} data-e2e="add-to-calendar">
              <Calendar /> {c.calendar}
            </a>
            <SeatMenu
              row={r}
              onCancelled={(o) => {
                onFlash(cancelOutcomeText(o, locale));
                onChanged();
              }}
            />
          </>
        ) : (
          <>
            <Link
              href={d.nextClass ? `/checkout?class=${encodeURIComponent(d.nextClass.classId)}` : `/${r.tutor.slug}`}
              className="btn btn-primary btn-sm"
              aria-label={d.nextClass ? c.bookNextAria(d.nextClass.title, dayLabel(d.nextClass.startsAt, locale)) : undefined}
              data-e2e="detail-book-next"
            >
              {c.bookNext}
            </Link>
            <MessageLink tutorId={r.tutor.id} tutorName={r.tutor.name} />
          </>
        )}
      </div>
    </article>
  );
}

/** Loads one booking and shows it. */
export function ClassDetailPanel({
  bookingId,
  onChanged,
  onFlash,
  headingLevel,
}: {
  bookingId: string;
  onChanged?: () => void;
  onFlash: (m: string) => void;
  headingLevel?: 1 | 2;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [res, setRes] = useState<StudentClassDetailResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    getStudentClass(bookingId)
      .then(setRes)
      .catch(() => setFailed(true));
  }, [bookingId]);
  useEffect(() => {
    setRes(undefined);
    load();
  }, [load]);

  if (failed) return <ErrorState onRetry={load} />;
  if (res === undefined) return <PageSkeleton rows={3} />;
  if (!res.ok) {
    return (
      <div className="aps-empty" data-e2e="class-detail-missing">
        <div className="min-w-0">
          <p className="aps-empty-t">{c.notFound}</p>
          <div className="aps-empty-a"><Link href="/student/cours" className="btn btn-primary btn-sm">{c.backToList}</Link></div>
        </div>
      </div>
    );
  }
  return (
    <ClassDetailBody
      d={res}
      headingLevel={headingLevel}
      onFlash={onFlash}
      onChanged={() => {
        load();
        onChanged?.();
      }}
    />
  );
}
