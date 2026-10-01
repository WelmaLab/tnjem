"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { getDashboard } from "@/app/actions";
import { AppPage, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { PaymentStory } from "@/components/PaymentStory";
import { formatLongDate, type DashboardResult } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — « Mon offre » (/dashboard/plan), the THIN phase-1 page:
   the tutor's current plan and what it lets them do, and the way to the public
   offers. Phase 6 finishes it per image 4 (the compact summary of the plans).

   READ-ONLY, and that is the honest shape: there is no checkout, so a button here
   would lead nowhere or imply a purchase that cannot happen. The usage line is the
   number POST /classes enforces, so a tutor meets a limit here, calmly, rather
   than at the end of a form. */

const copy = bilingual({
  fr: {
    title: "Mon offre",
    sub: "Ce que ton offre te permet, et ce qui est facturé (rien, pendant le pilote).",
    pilot: "Pilote",
    pilotTitle: "Offre complète, gratuite",
    pilotBody: "Pendant le pilote, tous les profs ont l'offre complète : séances illimitées, et rien n'est facturé. On te préviendra avant que ça change.",
    grantedBody: "Offre activée par l'équipe Tnajem. Rien ne t'est facturé.",
    unlimited: "Séances publiées : illimitées",
    usage: (used: number, max: number) => `Séances publiées : ${used} sur ${max}`,
    usageNote: "On compte les séances à venir. Une séance annulée ou déjà passée libère la place.",
    until: (d: string) => `Jusqu'au ${d}.`,
    seeTarifs: "Voir les offres",
  },
  ar: {
    title: "العرض متاعي",
    sub: "شنوّة يسمحلك العرض متاعك، وشنوّة يتخلّص (حتى شي، في فترة التجربة).",
    pilot: "تجربة",
    pilotTitle: "عرض كامل، بلاش",
    pilotBody: "في فترة التجربة، الأساتذة الكل عندهم العرض الكامل : حصص بلا حدّ، وما فمّا حتى فاتورة. باش نعلموك قبل ما يتبدّل الحال.",
    grantedBody: "العرض فعّلو فريق Tnajem. ما تتفوترش حتى مليم.",
    unlimited: "الحصص المنشورة : بلا حدّ",
    usage: (used: number, max: number) => `الحصص المنشورة : ${used} من ${max}`,
    usageNote: "نحسبو الحصص الجايّة برك. حصة تلغات ولا فاتت ترجّعلك البلاصة.",
    until: (d: string) => `حتى لـ ${d}.`,
    seeTarifs: "شوف العروض",
  },
});

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
    body = (
      <section className="u-card u-card-pad plan-card" aria-labelledby="pl-t" data-e2e="plan-card">
        <span className="tag tag-neutral">{p.isPilot ? c.pilot : p.code}</span>
        <h2 id="pl-t" className="plan-title">{p.isPilot ? c.pilotTitle : p.code}</h2>
        <p className="hp-muted">{p.isPilot ? c.pilotBody : c.grantedBody}</p>
        {until && <p className="hp-muted mt-1">{c.until(until)}</p>}
        <p className="plan-usage">{p.maxClasses === null ? c.unlimited : c.usage(p.openClasses, p.maxClasses)}</p>
        {p.maxClasses !== null && <p className="hp-muted">{c.usageNote}</p>}
        <div className="mt-4">
          <Link href="/tarifs" className="btn btn-ghost btn-sm">{c.seeTarifs}</Link>
        </div>
      </section>
    );
  }

  return (
    <AppPage
      title={c.title}
      subtitle={c.sub}
      /* The one payment sentence (D4), behind its « Bientôt » while payments are off. */
      note={<PaymentStory locale={locale} audience="tutor" enabled={Boolean(result && !("wrongRole" in result) && result.paymentsEnabled)} />}
      width="narrow"
    >
      {body}
    </AppPage>
  );
}
