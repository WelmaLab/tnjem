"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Eye, Store } from "@/components/icons";
import { getDashboard } from "@/app/actions";
import { AppPage, Blocker, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { StorefrontLinkCard } from "@/components/dashboard/StorefrontLinkCard";
import { VitrineStats } from "@/components/dashboard/storefront/VitrineStats"; // espace prof v2 · growth (P3)
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import type { DashboardData, DashboardResult } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — « Ma vitrine » (/dashboard/storefront): the tutor's
   public page from the inside — the link, whether it is online, the owner preview,
   and where to edit it. Growth (phase 3) adds the share sheet and the
   « Vues · Clics · Abonnés » numbers (the ep2 slots below). */

const copy = bilingual({
  fr: {
    title: "Ma vitrine",
    sub: "Ta page publique : ce que les élèves et leurs parents voient.",
    edit: "Modifier ma page",
    preview: "Voir l'aperçu privé",
    public: "Ouvrir ma page publique",
    online: "Ta page est en ligne : n'importe qui peut l'ouvrir avec ton lien, et elle est listée dans Explorer.",
    offline: "Avant la vérification, ton lien ouvre une page « Ce prof arrive bientôt » : rien de ta page n'est encore public.",
    pendingNote: "Vérification en cours : ta page passe en ligne dès qu'elle est validée, en général sous 24–48 h.",
    bVerifyT: "Pas encore en ligne",
    bVerifyB: "vérifie ton compte pour que ta page soit publique.",
    bVerifyCta: "Envoyer mes documents",
    bRejectedT: "Dossier à compléter",
    bRejectedB: "corrige et renvoie tes documents pour mettre ta page en ligne.",
    bRejectedCta: "Renvoyer mes documents",
    emptyTitle: "Tu n'as pas encore de page",
    emptyBody: "Ton nom, ta matière, ton lien : deux minutes, et tu as une adresse à partager.",
    emptyCta: "Créer ma page",
    manage: "Gérer ma page",
  },
  ar: {
    title: "واجهتي",
    sub: "صفحتك العامة: اللي يشوفوه التلامذة والأولياء.",
    edit: "بدّل صفحتي",
    preview: "شوف المعاينة الخاصة",
    public: "حلّ صفحتي العامة",
    online: "صفحتك على الخط: أي واحد ينجّم يحلّها باللينك متاعك، وموجودة في «اكتشف».",
    offline: "قبل التثبّت، اللينك متاعك يحلّ صفحة « الأستاذ هذا جاي قريب »: حتى حاجة من صفحتك ما هي ظاهرة لتوّا.",
    pendingNote: "التثبّت في الطريق: صفحتك تولّي على الخط أوّل ما يتقبل، عادةً في 24–48 ساعة.",
    bVerifyT: "موش على الخط لتوّا",
    bVerifyB: "ثبّت حسابك باش صفحتك تولّي عامة.",
    bVerifyCta: "ابعث وثائقي",
    bRejectedT: "الملف يلزمو تكملة",
    bRejectedB: "صلّح وعاود ابعث وثائقك باش صفحتك تولّي على الخط.",
    bRejectedCta: "عاود ابعث وثائقي",
    emptyTitle: "ما عندكش صفحة لتوّا",
    emptyBody: "إسمك، مادتك، اللينك متاعك: دقيقتين، ويولّي عندك عنوان تشاركو.",
    emptyCta: "اعمل صفحتي",
    manage: "صرّف صفحتي",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

function blockerOf(d: DashboardData, c: Copy) {
  if (d.status === "draft") return <Blocker title={c.bVerifyT} action={{ href: "/onboarding/verify", label: c.bVerifyCta }}>{c.bVerifyB}</Blocker>;
  if (d.status === "rejected") return <Blocker title={c.bRejectedT} action={{ href: "/onboarding/verify", label: c.bRejectedCta }}>{c.bRejectedB}</Blocker>;
  return null;
}

export function MyStorefrontView() {
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

  const d = result && !("wrongRole" in result) ? result : null;

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (result === undefined) body = <PageSkeleton rows={2} />;
  else if (result && "wrongRole" in result) body = <WrongRoleNotice role={result.wrongRole} />;
  else if (!d || !d.has_storefront || !d.slug) {
    body = (
      <EmptyState level={2} icon={<Store />} title={c.emptyTitle} action={<Link href="/onboarding" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}>
        {c.emptyBody}
      </EmptyState>
    );
  } else {
    const online = d.status === "verified";
    body = (
      <>
        <StorefrontLinkCard slug={d.slug} status={d.status} hasStorefront headingId="sv-link-t" />
        {/* ep2:stats-slot — growth (phase 3): « Vues · Clics · Abonnés » for the last 30 days. */}
        <VitrineStats />
        <section className="u-card u-card-pad hp-card" aria-labelledby="sv-manage-t">
          <h2 id="sv-manage-t" className="hp-card-t">{c.manage}</h2>
          <p className="hp-muted mb-3">{online ? c.online : c.offline}</p>
          <div className="cluster">
            <Link href="/dashboard/storefront/preview" className="btn btn-ghost btn-sm" data-e2e="sv-preview">
              <Eye />
              {c.preview}
            </Link>
            <Link href="/onboarding" className="btn btn-ghost btn-sm">{c.edit}</Link>
            {online && (
              <Link href={`/${d.slug}`} className="btn btn-ghost btn-sm">{c.public}</Link>
            )}
          </div>
        </section>
      </>
    );
  }

  return (
    <AppPage
      title={c.title}
      subtitle={c.sub}
      blockers={d && d.has_storefront ? blockerOf(d, c) : null}
      note={d?.status === "pending" ? c.pendingNote : undefined}
      width="narrow"
    >
      <div className="sv-stack">{body}</div>
    </AppPage>
  );
}
