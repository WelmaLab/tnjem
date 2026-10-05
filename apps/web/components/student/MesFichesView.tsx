"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Book, Close, Lock, Search } from "@/components/icons";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { useShell } from "@/components/app/ShellContext";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { getStudentFiches, markFichesSeen, type StudentFichesResult } from "@/app/actions-student";
import type { StudentFiche, StudentTutorRef } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { FicheItem } from "./FicheItem";
import { dayLabel, subjectOf } from "./format";

/* MES FICHES (/student/fiches) — student-space-v1 · E (mockup 3a).

   Every material this student may open under THE rule the file endpoint applies
   (apps/api/src/lib/material-access.ts — one function, so the list and the access
   check can never disagree), from the profs they follow or had a class with. Grouped
   by prof; each item: title, origin (« Séance « … » · date » or « Fiche de sa
   page »), type (PDF / image / YouTube), « Ouvrir » / « Regarder ».

   Chips: Toutes · Mes séances · Vidéos. NOT « Prises sur leur page »: nothing in the
   data model today gives a student their own access to a fiche from a prof's page
   (no pack purchase or claim exists while payments are off) — the chip comes with
   that feature. Search by title. ?class=<classId> narrows to one class (Accueil's
   « Fiches (n) »).

   « Nouveau » = added since the last visit (profiles.last_seen_fiches_at, 0042). The
   page marks everything seen once it has shown the dots, then asks the shell to
   re-read its badge (contract C3/C4). */

const copy = bilingual({
  fr: {
    title: "Mes fiches",
    sub: "Les documents et vidéos de tes profs : ceux de tes séances et ceux qu'ils partagent sur leur page.",
    chips: { all: "Toutes", classes: "Mes séances", videos: "Vidéos" },
    filters: "Filtrer les fiches",
    search: "Chercher une fiche…",
    searchLabel: "Chercher une fiche par son titre",
    seance: "Séance",
    fromPage: "Fiche de sa page",
    tagClass: "Séance",
    tagPage: "Fiche",
    onlyClass: (t: string) => `Séance « ${t} »`,
    allFiches: "Voir toutes mes fiches",
    noMatch: "Aucune fiche ne correspond.",
    clear: "Effacer la recherche",
    emptyT: "Pas encore de fiche",
    emptyB: "Les documents et vidéos que tes profs ajoutent à tes séances, ou partagent sur leur page, arrivent ici.",
    emptyCta: "Voir mes cours",
    note: "Ces fiches sont privées : elles s'ouvrent avec ton compte, jamais par un lien public.",
  },
  ar: {
    title: "ملفّاتي",
    sub: "الوثائق والفيديوات متاع أساتذتك : متاع حصصك واللي يقسموها في صفحتهم.",
    chips: { all: "الكل", classes: "حصصي", videos: "فيديوات" },
    filters: "صفّي الملفات",
    search: "لوّج على ملف…",
    searchLabel: "لوّج على ملف بالعنوان متاعو",
    seance: "حصة",
    fromPage: "ملف من صفحتو",
    tagClass: "حصة",
    tagPage: "ملف",
    onlyClass: (t: string) => `حصة « ${t} »`,
    allFiches: "شوف ملفّاتي الكل",
    noMatch: "حتى ملف ما يتطابق.",
    clear: "فسّخ البحث",
    emptyT: "ما زال ما فمّا حتى ملف",
    emptyB: "الوثائق والفيديوات اللي يزيدوها أساتذتك لحصصك، ولا يقسموها في صفحتهم، يجيو هوني.",
    emptyCta: "شوف حصصي",
    note: "الملفات هاذي خاصّة : تتحلّ بحسابك، عمرها ما تتحل بلينك عمومي.",
  },
});

type Chip = "all" | "classes" | "videos";
const CHIPS: Chip[] = ["all", "classes", "videos"];

/** Case- and accent-insensitive, for « Chercher une fiche ». */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MesFichesView({ classId }: { classId: string | null }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const shell = useShell();
  const [data, setData] = useState<StudentFichesResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [chip, setChip] = useState<Chip>("all");
  const [q, setQ] = useState("");
  const [onlyClass, setOnlyClass] = useState<string | null>(classId);
  const marked = useRef(false);

  const load = useCallback(() => {
    setFailed(false);
    getStudentFiches()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Once the dots are on screen: everything is seen from now on, and the badge follows.
  const refresh = shell?.refreshCounts;
  useEffect(() => {
    if (!data || !data.ok || marked.current) return;
    marked.current = true;
    void markFichesSeen().then(() => refresh?.());
  }, [data, refresh]);

  const all = useMemo(() => (data && data.ok ? data.fiches : []), [data]);
  const scoped = onlyClass ? all.filter((f) => f.origin.kind === "class" && f.origin.classId === onlyClass) : all;
  const counts: Record<Chip, number> = {
    all: scoped.length,
    classes: scoped.filter((f) => f.origin.kind === "class").length,
    videos: scoped.filter((f) => f.type === "youtube").length,
  };
  const needle = fold(q.trim());
  const shown = scoped
    .filter((f) => (chip === "classes" ? f.origin.kind === "class" : chip === "videos" ? f.type === "youtube" : true))
    .filter((f) => !needle || fold(f.title).includes(needle));

  // Grouped by prof, in the order their newest fiche comes.
  const groups: { tutor: StudentTutorRef; items: StudentFiche[] }[] = [];
  for (const f of shown) {
    const g = groups.find((x) => x.tutor.id === f.tutor.id);
    if (g) g.items.push(f);
    else groups.push({ tutor: f.tutor, items: [f] });
  }
  const classTitle = onlyClass ? all.find((f) => f.origin.kind === "class" && f.origin.classId === onlyClass) : null;

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (data === undefined) body = <PageSkeleton rows={4} />;
  else if (!data.ok) body = <WrongRoleNotice role="guardian" />;
  else if (all.length === 0) {
    body = (
      <EmptyState level={2} icon={<Book />} title={c.emptyT} action={<Link href="/student/cours" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}>
        {c.emptyB}
      </EmptyState>
    );
  } else {
    body = (
      <>
        <div className="ssv-ftools">
          <div className="ssv-chips" role="group" aria-label={c.filters} data-e2e="fiche-chips">
            {CHIPS.map((k) => (
              <button
                key={k}
                type="button"
                className={chip === k ? "ssv-chip is-on" : "ssv-chip"}
                aria-pressed={chip === k}
                onClick={() => setChip(k)}
                data-e2e={`fiche-chip-${k}`}
              >
                {c.chips[k]} · <span className="hp-num">{counts[k]}</span>
              </button>
            ))}
          </div>
          <label className="inp ssv-search">
            <Search />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={c.search}
              aria-label={c.searchLabel}
              data-e2e="fiche-search"
            />
          </label>
        </div>
        {onlyClass ? (
          <p className="ssv-filter" data-e2e="fiche-class-filter">
            <span className="chip chip-soft">{c.onlyClass(classTitle && classTitle.origin.kind === "class" ? classTitle.origin.classTitle : "…")}</span>
            <button
              type="button"
              className="ssv-filter-x"
              onClick={() => {
                setOnlyClass(null);
                const url = new URL(window.location.href);
                url.searchParams.delete("class");
                window.history.replaceState(null, "", url.toString());
              }}
            >
              <Close /> {c.allFiches}
            </button>
          </p>
        ) : null}
        {groups.length === 0 ? (
          <div className="ssv-nomatch">
            <p className="ssv-muted">{c.noMatch}</p>
            {q ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQ("")}>{c.clear}</button> : null}
          </div>
        ) : (
          <div className="u-card u-card-pad ssv-card ssv-fgroups" data-e2e="fiche-groups">
            {groups.map((g) => {
              const subject = subjectOf(g.tutor.subject, locale);
              return (
                <section key={g.tutor.id} className="ssv-fgroup" aria-label={g.tutor.name} data-e2e="fiche-group" data-tutor-id={g.tutor.id}>
                  <h2 className="ssv-fgroup-t"><UserText>{g.tutor.name}</UserText>{subject ? ` · ${subject}` : ""}</h2>
                  <ul className="ssv-list">
                    {g.items.map((f) => (
                      <FicheItem
                        key={f.id}
                        f={f}
                        meta={f.origin.kind === "class"
                          ? <>{c.seance} « <UserText>{f.origin.classTitle}</UserText> » · {dayLabel(f.origin.startsAt, locale)}</>
                          : c.fromPage}
                        tag={f.origin.kind === "class"
                          ? <span className="chip chip-sand ssv-ftag">{c.tagClass}</span>
                          : <span className="tag tag-soon ssv-tag-plain ssv-ftag">{c.tagPage}</span>}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <AppPage title={c.title} subtitle={c.sub}>
      {body}
      {data && data.ok && all.length > 0 ? (
        <p className="ssv-fnote" data-e2e="fiche-note"><Lock /> {c.note}</p>
      ) : null}
    </AppPage>
  );
}
