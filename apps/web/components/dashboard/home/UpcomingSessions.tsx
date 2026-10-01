"use client";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { monthLabel, type DashboardClass } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — « Prochaines séances » on the home: the next three
   classes still ahead, each a link to its page, and the way to all of them. The
   full list (past ones, duplicate, edit, cancel, share) is « Mes classes ». */

const copy = bilingual({
  fr: {
    title: "Prochaines séances",
    all: "Voir toutes mes classes",
    empty: "Aucune séance.",
    emptyCta: "Créer ma 1ʳᵉ classe",
    emptyCtaAgain: "Créer une classe",
    seats: (taken: number, total: number) => `${taken}/${total} inscrits`,
    live: "En direct",
  },
  ar: {
    title: "الحصص الجاية",
    all: "شوف الحصص متاعي الكل",
    empty: "ما فمّا حتى حصة.",
    emptyCta: "اعمل أول حصة متاعك",
    emptyCtaAgain: "اعمل حصة",
    seats: (taken: number, total: number) => `${taken}/${total} محجوز`,
    live: "دايركت",
  },
});

export function nextClasses(classes: DashboardClass[], n = 3): DashboardClass[] {
  return classes
    .filter((k) => k.status !== "cancelled" && (k.phase === "upcoming" || k.phase === "live"))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, n);
}

export function UpcomingSessions({ classes, everHadClass }: { classes: DashboardClass[]; everHadClass: boolean }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const next = nextClasses(classes);
  return (
    <section className="u-card u-card-pad hp-card" aria-labelledby="hp-next-t" data-e2e="home-upcoming">
      <div className="hp-card-head">
        <h2 id="hp-next-t" className="hp-card-t">{c.title}</h2>
        {next.length > 0 && (
          <Link href="/dashboard/classes" className="linklike text-[13px]">{c.all}</Link>
        )}
      </div>
      {next.length === 0 ? (
        <p className="hp-dashed">
          {c.empty}{" "}
          <Link href="/dashboard/new-class" className="linklike linklike-inline">
            {everHadClass ? c.emptyCtaAgain : c.emptyCta}
          </Link>
        </p>
      ) : (
        <ul className="hp-list">
          {next.map((k) => (
            <li key={k.id}>
              <Link href={`/class/${k.id}`} className="hp-row">
                <span className="thumb hp-thumb" aria-hidden="true">
                  <b>{k.day}</b>
                  <span>{monthLabel(k.month, locale)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <UserText as="span" className="hp-row-t">{k.title}</UserText>
                  <span className="hp-row-m">
                    <time dateTime={k.starts_at}>{k.day} {monthLabel(k.month, locale)} · {k.time}</time>
                    {k.duration_min ? ` · ${k.duration_min} min` : ""}
                    {" · "}
                    <span className="hp-num">{c.seats(Math.max(0, k.seats - k.seats_left), k.seats)}</span>
                  </span>
                </span>
                {k.phase === "live" && <span className="tag tag-live" data-e2e="class-phase" data-phase="live">{c.live}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
