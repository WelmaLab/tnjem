"use client";
import { useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Back } from "@/components/icons";
import { AppPage } from "@/components/app/AppShell";
import { bilingual } from "@/lib/i18n";
import { ClassDetailPanel } from "./ClassDetailPanel";

/* /student/cours/<bookingId> — the detail of one booking as its own page (a phone's
   way in from « Mes cours »; on a computer it is the list's right column). The
   breadcrumbs say where it sits: Apprendre › Mes cours › Ma séance. */

const copy = bilingual({
  fr: { title: "Ma séance", learn: "Apprendre", list: "Mes cours", back: "Mes cours" },
  ar: { title: "حصّتي", learn: "نتعلّم", list: "حصصي", back: "حصصي" },
});

export function ClassDetailView({ bookingId }: { bookingId: string }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [flash, setFlash] = useState<string | null>(null);
  return (
    <AppPage
      title={c.title}
      crumbs={[{ label: c.learn }, { label: c.list, href: "/student/cours" }, { label: c.title }]}
      actions={<Link href="/student/cours" className="btn btn-ghost btn-sm" data-e2e="detail-back"><Back /> {c.back}</Link>}
    >
      {flash ? <div role="status" className="ssv-flash" data-e2e="cancel-flash">{flash}</div> : null}
      <div className="u-card u-card-pad ssv-cdetail ssv-cdetail-page">
        <ClassDetailPanel bookingId={bookingId} onFlash={setFlash} />
      </div>
    </AppPage>
  );
}
