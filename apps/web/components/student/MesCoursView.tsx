"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Close, Video } from "@/components/icons";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { getStudentClasses, type StudentClassesResult } from "@/app/actions-student";
import type { StudentClassRow } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { ClassDetailPanel } from "./ClassDetailPanel";
import { StatusTag, lateNote } from "./ClassStatus";
import { minutesLabel, priceLabel, tileOf } from "./format";
import { COURS_TABS, type CoursTab } from "./cours-tabs";

/* MES COURS (/student/cours) — student-space-v1 · C (mockup 2a).

   Three tabs with their counts — À venir · Passées · Annulées (?tab=avenir|passees|
   annulees, &prof=<tutorId> narrows to one prof) — and the rows: a date tile, the
   title, the prof, the duration, the price or « offerte » / « couverte par
   l'abonnement », and the status tag (ClassStatus.tsx: « Inscrit », « Passée »,
   « Annulée par toi / par le prof » + the late-cancellation note). No attendance: we
   do not track it.

   The detail (ClassDetailPanel) is the right column on a computer (≥ 1000 px); on a
   phone each row is a link to its own page, /student/cours/<bookingId>. A row IS that
   link in both cases — on a computer the click shows it in the column instead. */

const copy = bilingual({
  fr: {
    title: "Mes cours",
    sub: "Tes séances à venir et ton historique.",
    tabs: { avenir: "À venir", passees: "Passées", annulees: "Annulées" } as Record<CoursTab, string>,
    label: "Mes séances",
    withProf: (n: string) => `Avec ${n}`,
    allProfs: "Voir tous les profs",
    emptyAvenirT: "Aucune séance à venir",
    emptyAvenirB: "Réserve une séance avec un prof : elle apparaît ici, avec le lien pour rejoindre le direct.",
    emptyAvenirCta: "Trouver une séance",
    emptyPasseesT: "Pas encore de séance passée",
    emptyPasseesB: "Après chaque séance, tu la retrouves ici avec ses fiches, et tu peux noter ton prof.",
    emptyAnnuleesT: "Aucune séance annulée",
    emptyAnnuleesB: "Si une séance est annulée, par toi ou par ton prof, elle s'affiche ici.",
    seeAhead: "Voir mes séances à venir",
    pick: "Choisis une séance pour voir son détail.",
  },
  ar: {
    title: "حصصي",
    sub: "حصصك الجاية والتاريخ متاعك.",
    tabs: { avenir: "الجاية", passees: "اللي فاتت", annulees: "الملغية" } as Record<CoursTab, string>,
    label: "حصصي",
    withProf: (n: string) => `مع ${n}`,
    allProfs: "شوف الأساتذة الكل",
    emptyAvenirT: "ما فمّا حتى حصة جاية",
    emptyAvenirB: "احجز حصة مع أستاذ : تبان هوني، مع اللينك باش تدخل للدايركت.",
    emptyAvenirCta: "لقّى حصة",
    emptyPasseesT: "ما فمّا حتى حصة فاتت لتوّا",
    emptyPasseesB: "بعد كل حصة، تلقاها هوني بالملفات متاعها، وتنجّم تقيّم أستاذك.",
    emptyAnnuleesT: "ما فمّا حتى حصة ملغية",
    emptyAnnuleesB: "كان حصة تتلغى، منك ولا من أستاذك، تبان هوني.",
    seeAhead: "شوف حصصي الجاية",
    pick: "اختار حصة باش تشوف التفاصيل متاعها.",
  },
});

const WIDE = "(min-width: 1000px)";

function Row({ r, selected, onSelect }: { r: StudentClassRow; selected: boolean; onSelect: (e: MouseEvent, id: string) => void }) {
  const { locale } = useLocale();
  const tile = tileOf(r.startsAt, locale);
  const late = lateNote(r, locale);
  return (
    <li className={selected ? "ssv-crow is-sel" : "ssv-crow"} data-e2e="class-row" data-booking-id={r.bookingId} data-state={r.state}>
      <Link
        href={`/student/cours/${r.bookingId}`}
        className="ssv-crow-a"
        aria-current={selected ? "true" : undefined}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => onSelect(e, r.bookingId)}
      >
        <span className="thumb ssv-tile" aria-hidden="true"><b className="hp-num">{tile.day}</b><span>{tile.month}</span></span>
        <span className="ssv-row-main">
          <UserText as="span" className="ssv-row-t">{r.title}</UserText>
          <span className="ssv-row-m">
            <UserText>{r.tutor.name}</UserText> · <span className="hp-num">{minutesLabel(r.durationMin, locale)}</span> · <span className={r.price.kind === "paid" ? "hp-num" : undefined}>{priceLabel(r.price, locale)}</span>
          </span>
          {late ? <span className="ssv-late ssv-late-row">{late}</span> : null}
        </span>
        <StatusTag row={r} />
      </Link>
    </li>
  );
}

export function MesCoursView({ initialTab, prof }: { initialTab: CoursTab; prof: string | null }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [tab, setTab] = useState<CoursTab>(initialTab);
  const [data, setData] = useState<StudentClassesResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [profFilter, setProfFilter] = useState<string | null>(prof);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    setFailed(false);
    getStudentClasses()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const ok = data && data.ok ? data : null;
  const byProf = (rows: StudentClassRow[]) => (profFilter ? rows.filter((r) => r.tutor.id === profFilter) : rows);
  const lists: Record<CoursTab, StudentClassRow[]> = {
    avenir: byProf(ok?.ahead ?? []),
    passees: byProf(ok?.past ?? []),
    annulees: byProf(ok?.cancelled ?? []),
  };
  const rows = lists[tab];
  const profName = profFilter ? [...lists.avenir, ...lists.passees, ...lists.annulees][0]?.tutor.name ?? null : null;
  // The column shows the chosen row, else the first one of the tab.
  const shown = rows.find((r) => r.bookingId === selected)?.bookingId ?? rows[0]?.bookingId ?? null;

  function syncUrl(next: CoursTab, p: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    if (p) url.searchParams.set("prof", p);
    else url.searchParams.delete("prof");
    window.history.replaceState(null, "", url.toString());
  }

  function select(next: CoursTab, focus = false) {
    setTab(next);
    setSelected(null);
    syncUrl(next, profFilter);
    if (focus) tabRefs.current[next]?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = COURS_TABS.indexOf(tab);
    const fwd = locale === "ar" ? -1 : 1;
    const moves: Record<string, number> = { ArrowRight: i + fwd, ArrowLeft: i - fwd, Home: 0, End: COURS_TABS.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(COURS_TABS[(moves[e.key] + COURS_TABS.length) % COURS_TABS.length], true);
  }

  const onSelect = (e: MouseEvent, id: string) => {
    if (!wide) return; // a phone follows the link to the row's own page
    e.preventDefault();
    setSelected(id);
  };

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (data === undefined) body = <PageSkeleton rows={4} />;
  else if (!data.ok) body = <WrongRoleNotice role="guardian" />;
  else {
    const empty =
      tab === "avenir" ? (
        <EmptyState level={2} icon={<Video />} title={c.emptyAvenirT} action={<Link href="/explore" className="btn btn-primary btn-sm">{c.emptyAvenirCta}</Link>}>
          {c.emptyAvenirB}
        </EmptyState>
      ) : (
        <EmptyState
          level={2}
          icon={<Video />}
          title={tab === "passees" ? c.emptyPasseesT : c.emptyAnnuleesT}
          action={<button type="button" className="btn btn-primary btn-sm" onClick={() => select("avenir", true)}>{c.seeAhead}</button>}
        >
          {tab === "passees" ? c.emptyPasseesB : c.emptyAnnuleesB}
        </EmptyState>
      );
    body = (
      <>
        <div className="st-tabs ssv-tabs" role="tablist" aria-label={c.label} onKeyDown={onKey} data-e2e="cours-tabs">
          {COURS_TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={`ssv-tab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls="ssv-cours-panel"
              tabIndex={tab === t ? 0 : -1}
              className="st-tab"
              onClick={() => select(t)}
              data-e2e={`cours-tab-${t}`}
            >
              {c.tabs[t]} · <span className="hp-num">{lists[t].length}</span>
            </button>
          ))}
        </div>
        {profFilter ? (
          <p className="ssv-filter">
            <span className="chip chip-soft">{c.withProf(profName ?? "")}</span>
            <button
              type="button"
              className="ssv-filter-x"
              onClick={() => {
                setProfFilter(null);
                syncUrl(tab, null);
              }}
            >
              <Close /> {c.allProfs}
            </button>
          </p>
        ) : null}
        <div id="ssv-cours-panel" role="tabpanel" aria-labelledby={`ssv-tab-${tab}`} data-e2e={`cours-panel-${tab}`}>
          {rows.length === 0 ? (
            empty
          ) : (
            <div className="ssv-cours">
              <ul className="u-card ssv-clist" aria-label={c.tabs[tab]}>
                {rows.map((r) => <Row key={r.bookingId} r={r} selected={wide && shown === r.bookingId} onSelect={onSelect} />)}
              </ul>
              {wide && shown ? (
                <div className="u-card u-card-pad ssv-cdetail" data-e2e="cours-detail-column">
                  <ClassDetailPanel key={shown} bookingId={shown} onFlash={setFlash} onChanged={load} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <AppPage title={c.title} subtitle={c.sub}>
      {flash ? <div role="status" className="ssv-flash" data-e2e="cancel-flash">{flash}</div> : null}
      {body}
    </AppPage>
  );
}
