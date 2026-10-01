"use client";
import { useLocale } from "@/components/LocaleProvider";
import type { DashboardData } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the four numbers of the home (image 1). Every one is a
   REAL count, and a zero is shown as a zero, greyed — never padded (truth rule):

     Élèves          tutors.students_count: distinct students with a live booking
     Séances à venir the tutor's classes still ahead (upcoming or live, not cancelled)
     Note            the real average — only when real reviews exist, else « — »
     Revenus         « Bientôt »: payments are off, nothing is earned through Tnajem */

const copy = bilingual({
  fr: { students: "Élèves", upcoming: "Séances à venir", rating: "Note", revenue: "Revenus", soon: "Bientôt", ratingOf: (n: number) => (n === 1 ? "sur 1 avis" : `sur ${n} avis`), none: "pas encore d'avis" },
  ar: { students: "التلامذة", upcoming: "الحصص الجاية", rating: "التقييم", revenue: "المداخيل", soon: "قريب", ratingOf: (n: number) => `على ${n} رأي`, none: "ما فمّاش آراء لتوّا" },
});

export function upcomingCount(d: DashboardData): number {
  return d.classes.filter((k) => k.status !== "cancelled" && (k.phase === "upcoming" || k.phase === "live")).length;
}

export function KpiTiles({ d }: { d: DashboardData }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const upcoming = upcomingCount(d);
  const hasRating = d.reviewCount > 0;
  const tiles = [
    { key: "students", label: c.students, value: String(d.students), zero: d.students === 0 },
    { key: "upcoming", label: c.upcoming, value: String(upcoming), zero: upcoming === 0 },
    {
      key: "rating",
      label: c.rating,
      value: hasRating ? d.rating.toFixed(1).replace(".", locale === "ar" ? "." : ",") : "—",
      zero: !hasRating,
      hint: hasRating ? c.ratingOf(d.reviewCount) : c.none,
    },
    /* The real balance only if payments ever open; until then the word, greyed. */
    d.paymentsEnabled
      ? { key: "revenue", label: c.revenue, value: `${d.balance_tnd} TND`, zero: d.balance_tnd === 0 }
      : { key: "revenue", label: c.revenue, value: c.soon, zero: true },
  ];
  return (
    <dl className="hp-kpis" data-e2e="home-kpis">
      {tiles.map((t) => (
        <div key={t.key} className="hp-kpi">
          <dt className="hp-kpi-l">{t.label}</dt>
          <dd className={`hp-kpi-v${t.zero ? " is-zero" : ""}`} data-e2e={`kpi-${t.key}`}>
            <span className="hp-num">{t.value}</span>
            {"hint" in t && t.hint ? <span className="sr-only"> ({t.hint})</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
