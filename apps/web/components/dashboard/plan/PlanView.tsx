"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { getDashboard } from "@/app/actions";
import { AppPage, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { PLANS, formatLongDate, planByCode, tnd, type DashboardResult, type Plan } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { FREE_MONTHS, PRICING } from "@/lib/pricing-copy";

/* espace prof v2 · « Mon offre » (/dashboard/plan), image 4: the tutor's CURRENT
   offer (the pilot, today, for everyone) and a compact summary of the plans that
   come after it. /tarifs stays the public page with the detail.

   EVERY NUMBER IS THE CATALOGUE'S (PLANS, packages/shared/src/plans.ts): the price,
   the class limit the API enforces, the Explore boost. The student bands are the
   same hints /tarifs gives ("convient à …"), not a rule anything counts.

   december sprint · C (D23): the pricing rule. A tutor on the default (pilot) plan
   is in their free months, so the card says « Offert tes 3 premiers mois » — never a
   « 0 TND / mois » price that would read as permanent — and the plans below are
   what comes after those months.

   READ-ONLY, and that is the honest shape: there is no checkout, so a button here
   would lead nowhere or imply a purchase that cannot happen. */

const copy = bilingual({
  fr: {
    title: "Mon offre",
    pilot: "Pilote",
    pilotTitle: "Offre complète",
    pilotLine: "Séances illimitées.",
    pilotNotice: PRICING.fr.notice,
    pilotPrice: "Offert",
    pilotPer: `tes ${FREE_MONTHS} premiers mois`,
    grantedTitle: (name: string) => `Offre ${name}`,
    grantedLine: "Activée par l'équipe Tnajem. Rien ne t'est facturé.",
    until: (d: string) => `Jusqu'au ${d}.`,
    perMonth: "/mois",
    usage: (used: number, max: number) => `Séances publiées : ${used} sur ${max} (les séances à venir comptent).`,
    after: `Après tes ${FREE_MONTHS} premiers mois`,
    names: { gratuit: "Gratuit", essentiel: "Essentiel", pro: "Pro", prestige: "Prestige", pilot: "Pilote" } as Record<string, string>,
    bands: { gratuit: "1–14 élèves", essentiel: "15–20 élèves", pro: "21–35 élèves", prestige: "36 élèves et plus" } as Record<string, string>,
    oneAtATime: "1 séance à la fois",
    nAtATime: (n: number) => `${n} séances à la fois`,
    unlimited: "Séances illimitées",
    boost1: "mise en avant",
    boost2: "placement prioritaire",
    commission: PRICING.fr.plusCommissionWhen,
    details: "Détails des offres",
    current: "Ton offre",
  },
  ar: {
    title: "العرض متاعي",
    pilot: "تجربة",
    pilotTitle: "عرض كامل",
    pilotLine: "حصص بلا حدّ.",
    pilotNotice: PRICING.ar.notice,
    pilotPrice: "فابور",
    pilotPer: `في أول ${FREE_MONTHS} شهور متاعك`,
    grantedTitle: (name: string) => `عرض ${name}`,
    grantedLine: "فعّلو فريق Tnajem. ما تتفوترش حتى مليم.",
    until: (d: string) => `حتى لـ ${d}.`,
    perMonth: "/في الشهر",
    usage: (used: number, max: number) => `الحصص المنشورة : ${used} من ${max} (نحسبو الحصص الجاية).`,
    after: `بعد أول ${FREE_MONTHS} شهور متاعك`,
    names: { gratuit: "فابور", essentiel: "الأساسي", pro: "برو", prestige: "بريستيج", pilot: "تجربة" } as Record<string, string>,
    bands: { gratuit: "1–14 تلميذ", essentiel: "15–20 تلميذ", pro: "21–35 تلميذ", prestige: "36 تلميذ وأكثر" } as Record<string, string>,
    oneAtATime: "حصة وحدة في نفس الوقت",
    nAtATime: (n: number) => `${n} حصص في نفس الوقت`,
    unlimited: "حصص بلا حدّ",
    boost1: "تبان في المقدّمة",
    boost2: "مركز أول",
    commission: PRICING.ar.plusCommissionWhen,
    details: "تفاصيل العروض",
    current: "العرض متاعك",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

/** "5 séances à la fois · mise en avant" — from the plan's own numbers. */
function planLine(p: Plan, c: Copy): string {
  const classes = p.maxClasses === null ? c.unlimited : p.maxClasses === 1 ? c.oneAtATime : c.nAtATime(p.maxClasses);
  const boost = p.exploreBoost >= 2 ? c.boost2 : p.exploreBoost === 1 ? c.boost1 : null;
  return boost ? `${classes} + ${boost}` : classes;
}

export function PlanView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const [result, setResult] = useState<DashboardResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    getDashboard()
      .then((d) => setResult(d))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (result === undefined) body = <PageSkeleton rows={2} />;
  else if (result && "wrongRole" in result) body = <WrongRoleNotice role={result.wrongRole} />;
  else if (!result) body = <PageSkeleton rows={1} />;
  else {
    const p = result.plan;
    const until = p.expiresAt ? formatLongDate(p.expiresAt, locale) : null;
    const listed = PLANS.filter((x) => x.listed);
    const currentCode = p.isPilot ? null : p.code;
    const granted = planByCode(p.code);
    body = (
      <>
        <section className="u-card ofr-now" aria-labelledby="ofr-now-t" data-e2e="plan-card">
          <div className="min-w-0 flex-1">
            <span className="tag tag-neutral">{p.isPilot ? c.pilot : c.names[p.code] ?? p.code}</span>
            <h2 id="ofr-now-t" className="ofr-now-t">{p.isPilot ? c.pilotTitle : c.grantedTitle(c.names[p.code] ?? p.code)}</h2>
            <p className="ofr-now-b">{p.isPilot ? c.pilotLine : c.grantedLine}</p>
            {p.isPilot && <p className="ofr-now-b">{c.pilotNotice}</p>}
            {until && <p className="ofr-now-b">{c.until(until)}</p>}
            {p.maxClasses !== null && <p className="ofr-now-b">{c.usage(p.openClasses, p.maxClasses)}</p>}
          </div>
          {/* december sprint · C (D23): on the default plan the tutor is in the free
              months — « Offert », not a « 0 TND » that reads as the price for good. A
              plan granted by the team is billed nothing: 0 is its true amount. */}
          <div className="ofr-now-price" data-e2e="plan-now-price">
            {p.isPilot ? (
              <>
                <span className="ofr-price">{c.pilotPrice}</span>
                <span className="ofr-per">{c.pilotPer}</span>
              </>
            ) : (
              <>
                <span className="ofr-price hp-num">0 TND</span>
                <span className="ofr-per">{c.perMonth}</span>
              </>
            )}
          </div>
        </section>

        <h2 className="hp-card-t mt-5 mb-3">{c.after}</h2>
        <ul className="ofr-grid" data-e2e="plan-summary">
          {listed.map((x) => (
            <li
              key={x.code}
              className={`u-card ofr-mini${x.code === "pro" ? " is-hi" : ""}${x.code === currentCode ? " is-current" : ""}`}
              data-e2e={`plan-${x.code}`}
            >
              <div className="ofr-mini-name">
                {c.names[x.code]}
                {x.code === currentCode && granted ? <span className="tag tag-neutral">{c.current}</span> : null}
              </div>
              <div className="ofr-mini-band">{c.bands[x.code]}</div>
              <div className="ofr-mini-price">
                <span className="ofr-price-sm hp-num">{tnd(x.monthlyMillimes)}</span>
                <span className="ofr-per">TND{c.perMonth}</span>
              </div>
              <div className="ofr-mini-line">{planLine(x, c)}</div>
            </li>
          ))}
        </ul>
        <p className="ofr-foot">
          {c.commission}
          <span aria-hidden="true"> · </span>
          <Link href="/tarifs" className="linklike linklike-inline">{c.details}</Link>
        </p>
      </>
    );
  }

  return (
    <AppPage title={c.title} width="default">
      {body}
    </AppPage>
  );
}
