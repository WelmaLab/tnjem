"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Verified } from "@/components/ui";
import { Info, Search, Video } from "@/components/icons";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { getStudentHome, type StudentHomeResult } from "@/app/actions-student";
import { levelsLabel, type StudentFiche, type StudentHome, type StudentHomeProf, type StudentTutorRef, type StudentWeekItem } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { NextClassHero } from "./NextClassHero";
import { cancelOutcomeText } from "./SeatMenu";
import { ProfAvatar } from "./ProfAvatar";
import { FicheType } from "./FicheType";
import { dayLabel, subjectOf, tileOf, tnd } from "./format";
import { tunisClock } from "@tnajem/shared";

/* ACCUEIL (/student) — student-space-v1 · pages, letter B (mockup 1).

     the next class           hero: countdown, Rejoindre le direct, Fiches (n), Message,
                              Calendrier, « Annuler ma place » behind « ⋯ »
     Cette semaine            my other seats this week + the open classes of the profs
                              I follow, with « Réserver · prix »
     Mes profs                up to 3 followed or past profs, each with their next
                              class or « n nouvelle(s) fiche(s) »
     Nouvelles fiches         the latest 3 fiches I may open
     Profs pour toi           at the bottom, always: up to 3 verified profs matching my
                              level and subjects (Profil), never one I follow; hidden
                              when nothing matches
     nothing at all           ONE card « Trouve ton premier prof » → Explore, then
                              « Profs pour toi » — or, with no match, the newest
                              verified profs

   Everything comes from GET /student/home: no demo class, no invented count. */

const copy = bilingual({
  fr: {
    hello: (n: string) => (n ? `Salut ${n}` : "Salut"),
    sub: "Ta prochaine séance, tes profs et tes fiches — au même endroit.",
    week: "Cette semaine",
    allClasses: "Tous mes cours",
    weekEmpty: "Rien d'autre de prévu cette semaine.",
    booked: "Inscrit",
    book: (p: string) => `Réserver · ${p}`,
    bookAria: (t: string, p: string) => `Réserver « ${t} » · ${p}`,
    free: "gratuit",
    seats: (n: number) => (n === 1 ? "1 place" : `${n} places`),
    profs: "Mes profs",
    seeAll: "Voir tout",
    following: "Suivi",
    isNew: "Nouveau",
    nextOn: (d: string) => `prochaine séance ${d}`,
    newFiches: (n: number) => (n === 1 ? "1 nouvelle fiche" : `${n} nouvelles fiches`),
    noNext: "pas de séance prévue",
    fiches: "Nouvelles fiches",
    myFiches: "Mes fiches",
    fichesEmpty: "Les fiches que tes profs partagent avec toi arriveront ici.",
    forClass: (d: string) => `pour la séance du ${d}`,
    fromPage: "fiche de sa page",
    video: "vidéo",
    tip: "Après chaque séance, note ton prof : ça aide les autres élèves.",
    noUpcomingT: "Aucune séance à venir",
    noUpcomingB: "Réserve ta prochaine séance : elle s'affichera ici, avec le compte à rebours.",
    noUpcomingCta: "Trouver une séance",
    firstT: "Trouve ton premier prof",
    firstB: "Choisis un prof vérifié, suis-le ou réserve une séance : ton espace se remplit dès ta première séance.",
    firstCta: "Explorer les profs",
    suggestMatched: "Profs pour toi",
    suggestNewest: "Les derniers profs vérifiés",
    suggestMatchedSub: "D'après ton niveau et tes matières (Profil).",
    suggestNewestSub: "Ajoute ton niveau et tes matières dans ton profil pour des suggestions faites pour toi.",
    seePage: "Voir sa page",
    verified: "Prof vérifié",
    outT: "Connecte-toi pour voir ton espace",
    outB: "Tes séances, tes profs et tes fiches apparaissent ici une fois connecté.",
    signIn: "Se connecter",
  },
  ar: {
    hello: (n: string) => (n ? `أهلا ${n}` : "أهلا"),
    sub: "حصّتك الجاية، أساتذتك وملفاتك — في بلاصة وحدة.",
    week: "الجمعة هاذي",
    allClasses: "حصصي الكل",
    weekEmpty: "ما فمّا شي آخر مبرمج الجمعة هاذي.",
    booked: "مسجّل",
    book: (p: string) => `احجز · ${p}`,
    bookAria: (t: string, p: string) => `احجز « ${t} » · ${p}`,
    free: "بلاش",
    seats: (n: number) => `${n} بلايص`,
    profs: "أساتذتي",
    seeAll: "شوف الكل",
    following: "تتابعو",
    isNew: "جديد",
    nextOn: (d: string) => `الحصة الجاية ${d}`,
    newFiches: (n: number) => (n === 1 ? "ملف جديد" : `${n} ملفات جديدة`),
    noNext: "ما فمّا حتى حصة مبرمجة",
    fiches: "ملفات جديدة",
    myFiches: "ملفاتي",
    fichesEmpty: "الملفات اللي يقسموها معاك أساتذتك يظهرو هوني.",
    forClass: (d: string) => `لحصة ${d}`,
    fromPage: "ملف من صفحتو",
    video: "فيديو",
    tip: "بعد كل حصة، قيّم أستاذك : هذا يعاون التلامذة الآخرين.",
    noUpcomingT: "ما فمّا حتى حصة جاية",
    noUpcomingB: "احجز حصتك الجاية : تبان هوني، مع العدّ التنازلي.",
    noUpcomingCta: "لقّى حصة",
    firstT: "لقّى أول أستاذ متاعك",
    firstB: "اختار أستاذ متثبّت منّو، تابعو ولا احجز حصة : الفضاء متاعك يتعمّر من أول حصة.",
    firstCta: "اكتشف الأساتذة",
    suggestMatched: "أساتذة ليك",
    suggestNewest: "آخر الأساتذة المتثبّت منهم",
    suggestMatchedSub: "حسب مستواك والمواد متاعك (البروفايل).",
    suggestNewestSub: "زيد مستواك والمواد متاعك في البروفايل باش نقترحولك أساتذة على قياسك.",
    seePage: "شوف صفحتو",
    verified: "أستاذ متثبّت منّو",
    outT: "ادخل باش تشوف الفضاء متاعك",
    outB: "حصصك، أساتذتك وملفاتك يظهرو هوني كي تدخل.",
    signIn: "تسجيل الدخول",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];
type Locale = "fr" | "ar";

function WeekRow({ item, c, locale }: { item: StudentWeekItem; c: Copy; locale: Locale }) {
  const starts = item.kind === "booked" ? item.row.startsAt : item.open.startsAt;
  const title = item.kind === "booked" ? item.row.title : item.open.title;
  const tutor = item.kind === "booked" ? item.row.tutor : item.open.tutor;
  const tile = tileOf(starts, locale);
  return (
    <li className="ssv-row" data-e2e={item.kind === "booked" ? "week-booked" : "week-open"}>
      <span className="thumb ssv-tile" aria-hidden="true"><b className="hp-num">{tile.day}</b><span>{tile.month}</span></span>
      <div className="ssv-row-main">
        <UserText as="span" className="ssv-row-t">{title}</UserText>
        <span className="ssv-row-m">
          <time dateTime={starts}>{dayLabel(starts, locale)} · <span className="hp-num">{tunisClock(starts)}</span></time>
          {" · "}<UserText>{tutor.name}</UserText>
          {item.kind === "open" ? <> · <span className="hp-num">{c.seats(item.open.seatsLeft)}</span></> : null}
        </span>
      </div>
      {item.kind === "booked" ? (
        <span className="tag tag-success">{c.booked}</span>
      ) : (
        <Link
          href={`/checkout?class=${encodeURIComponent(item.open.classId)}`}
          className="btn btn-ghost btn-sm ssv-book"
          aria-label={c.bookAria(item.open.title, item.open.priceTnd > 0 ? tnd(item.open.priceTnd, locale) : c.free)}
          data-e2e="week-book"
        >
          {c.book(item.open.priceTnd > 0 ? tnd(item.open.priceTnd, locale) : c.free)}
        </Link>
      )}
    </li>
  );
}

function ProfRow({ p, c, locale }: { p: StudentHomeProf; c: Copy; locale: Locale }) {
  const subject = subjectOf(p.tutor.subject, locale);
  const line = p.newFiches > 0 ? c.newFiches(p.newFiches) : p.nextClass ? c.nextOn(dayLabel(p.nextClass.startsAt, locale)) : c.noNext;
  return (
    <li className="ssv-row" data-e2e="home-prof">
      <ProfAvatar tutor={p.tutor} />
      <div className="ssv-row-main">
        <Link href={`/${p.tutor.slug}`} className="ssv-row-t ssv-row-link"><UserText>{p.tutor.name}</UserText></Link>
        <span className="ssv-row-m">{subject ? `${subject} · ` : ""}{line}</span>
      </div>
      {p.newFiches > 0 ? <span className="tag tag-soon ssv-tag-plain">{c.isNew}</span> : p.following ? <span className="chip chip-sand">{c.following}</span> : null}
    </li>
  );
}

function FicheRow({ f, c, locale }: { f: StudentFiche; c: Copy; locale: Locale }) {
  const origin = f.origin.kind === "class" ? c.forClass(dayLabel(f.origin.startsAt, locale)) : f.type === "youtube" ? c.video : c.fromPage;
  const body = (
    <>
      <FicheType type={f.type} />
      <span className="ssv-row-main">
        <UserText as="span" className="ssv-row-t">{f.title}</UserText>
        <span className="ssv-row-m"><UserText>{f.tutor.name}</UserText> · {origin}</span>
      </span>
    </>
  );
  return (
    <li data-e2e="home-fiche">
      {f.type === "youtube" ? (
        <Link href="/student/fiches" className="ssv-row ssv-row-a">{body}</Link>
      ) : (
        /* The bytes only ever come through the access-checked pass-through (C8). */
        <a href={`/api/material/${f.id}`} target="_blank" rel="noopener noreferrer" className="ssv-row ssv-row-a">{body}</a>
      )}
    </li>
  );
}

function Suggestion({ t, c, locale }: { t: StudentTutorRef; c: Copy; locale: Locale }) {
  const subject = subjectOf(t.subject, locale);
  const levels = levelsLabel(t.levels, locale);
  return (
    <li className="u-card ssv-sug" data-e2e="suggested-prof">
      <div className="ssv-sug-head">
        <ProfAvatar tutor={t} size={44} />
        <div className="min-w-0">
          <div className="ssv-sug-name"><UserText>{t.name}</UserText>{t.verified ? <Verified label={c.verified} /> : null}</div>
          <div className="ssv-row-m">{[subject, levels].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <Link href={`/${t.slug}`} className="btn btn-ghost btn-sm">{c.seePage}</Link>
    </li>
  );
}

/** « Profs pour toi » (or, for a student with nothing at all and no match, the newest verified profs). */
function ForYou({ home, c, locale }: { home: StudentHome; c: Copy; locale: Locale }) {
  if (!home.suggestions.length) return null;
  return (
    <section aria-labelledby="ssv-sug-t" data-e2e="home-for-you">
      <h2 id="ssv-sug-t" className="hp-card-t">{home.suggestionsMatched ? c.suggestMatched : c.suggestNewest}</h2>
      <p className="ssv-row-m ssv-sug-sub">{home.suggestionsMatched ? c.suggestMatchedSub : c.suggestNewestSub}</p>
      <ul className="ssv-sug-grid" data-e2e="suggestions" data-matched={home.suggestionsMatched ? "true" : "false"}>
        {home.suggestions.map((t) => <Suggestion key={t.id} t={t} c={c} locale={locale} />)}
      </ul>
    </section>
  );
}

function CardHead({ id, title, link }: { id: string; title: string; link?: { href: string; label: string } }) {
  return (
    <div className="hp-card-head ssv-card-head">
      <h2 id={id} className="hp-card-t">{title}</h2>
      {link ? <Link href={link.href} className="ssv-more-link">{link.label} <span aria-hidden="true">›</span></Link> : null}
    </div>
  );
}

export function StudentHomeView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<StudentHomeResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    getStudentHome()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const home = data && data.ok ? data : null;
  const title = (
    <>
      <UserText>{c.hello(home?.firstName ?? "")}</UserText> <span aria-hidden="true">👋</span>
    </>
  );

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (data === undefined) body = <PageSkeleton rows={4} />;
  else if (!data.ok && data.error === "not-authenticated") {
    body = (
      <EmptyState level={2} title={c.outT} action={<Link href="/auth?next=/student" className="btn btn-primary btn-sm">{c.signIn}</Link>}>
        {c.outB}
      </EmptyState>
    );
  } else if (!data.ok) body = <WrongRoleNotice role="guardian" />;
  else if (home && home.nothing) {
    // Nothing at all: one card, then the suggested profs.
    body = (
      <div className="ssv-stack" data-e2e="home-nothing">
        <EmptyState
          level={2}
          icon={<Search />}
          title={c.firstT}
          action={<Link href="/explore" className="btn btn-primary btn-sm" data-e2e="home-explore">{c.firstCta}</Link>}
        >
          {c.firstB}
        </EmptyState>
        <ForYou home={home} c={c} locale={locale} />
      </div>
    );
  } else if (home) {
    body = (
      <div className="ssv-stack">
        <div className="ssv-home">
          <div className="ssv-col">
            {home.next ? (
              <NextClassHero
                row={home.next}
                onCancelled={(o) => {
                  setFlash(cancelOutcomeText(o, locale));
                  load();
                }}
              />
            ) : (
              <EmptyState
                icon={<Video />}
                title={c.noUpcomingT}
                action={<Link href="/explore" className="btn btn-primary btn-sm">{c.noUpcomingCta}</Link>}
              >
                {c.noUpcomingB}
              </EmptyState>
            )}

            <section className="u-card u-card-pad ssv-card" aria-labelledby="ssv-week-t" data-e2e="home-week">
              <CardHead id="ssv-week-t" title={c.week} link={{ href: "/student/cours", label: c.allClasses }} />
              {home.week.length ? (
                <ul className="ssv-list">
                  {home.week.map((w) => (
                    <WeekRow key={w.kind === "booked" ? w.row.bookingId : w.open.classId} item={w} c={c} locale={locale} />
                  ))}
                </ul>
              ) : (
                <p className="hp-muted">{c.weekEmpty}</p>
              )}
            </section>
          </div>

          <div className="ssv-col">
            <section className="u-card u-card-pad ssv-card" aria-labelledby="ssv-profs-t" data-e2e="home-profs">
              <CardHead id="ssv-profs-t" title={c.profs} link={{ href: "/student/profs", label: c.seeAll }} />
              <ul className="ssv-list">
                {home.profs.map((p) => <ProfRow key={p.tutor.id} p={p} c={c} locale={locale} />)}
              </ul>
            </section>

            <section className="u-card u-card-pad ssv-card" aria-labelledby="ssv-fiches-t" data-e2e="home-fiches">
              <CardHead id="ssv-fiches-t" title={c.fiches} link={{ href: "/student/fiches", label: c.myFiches }} />
              {home.newFiches.length ? (
                <ul className="ssv-list">
                  {home.newFiches.map((f) => <FicheRow key={f.id} f={f} c={c} locale={locale} />)}
                </ul>
              ) : (
                <p className="hp-muted">{c.fichesEmpty}</p>
              )}
            </section>

            <div className="note-info ssv-tip">
              <Info />
              <p>{c.tip}</p>
            </div>
          </div>
        </div>
        <ForYou home={home} c={c} locale={locale} />
      </div>
    );
  }

  return (
    <AppPage title={title} subtitle={c.sub}>
      {flash ? (
        <div role="status" className="ssv-flash" data-e2e="cancel-flash">{flash}</div>
      ) : null}
      {body}
    </AppPage>
  );
}
