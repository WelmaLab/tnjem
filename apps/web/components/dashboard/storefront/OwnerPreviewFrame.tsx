"use client";
import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Eye, Store } from "@/components/icons";
import { useRouter } from "next/navigation";
import { AppPage, Blocker, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import type { TutorVerifStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the frame of the OWNER PREVIEW (rule 8: « Ma vitrine =
   aperçu privé »). The banner says what this is and whether the page is public;
   below it, the tutor's page exactly as a visitor would get it once online (the
   storefront's own <h1> — the tutor's name — is this page's heading). */

const copy = bilingual({
  fr: {
    offT: "Aperçu privé · pas encore en ligne",
    offB: "Vérifie ton compte",
    offCta: "Envoyer mes documents",
    rejectedB: "Ton dossier est à compléter : corrige et renvoie tes documents",
    rejectedCta: "Renvoyer mes documents",
    pendingB: "Vérification en cours, réponse en général sous 24–48 h",
    suspendedB: "Ta page est suspendue : contacte l'équipe Tnajem",
    onT: "Aperçu privé · ta page est en ligne",
    onB: "Voici ce que voient les élèves.",
    onCta: "Ouvrir la page publique",
    emptyTitle: "Tu n'as pas encore de page",
    emptyBody: "Crée ta page de prof : ton nom, ta matière, ton lien.",
    emptyCta: "Créer ma page",
    title: "Aperçu privé",
  },
  ar: {
    offT: "معاينة خاصة · موش على الخط لتوّا",
    offB: "ثبّت حسابك",
    offCta: "ابعث وثائقي",
    rejectedB: "الملف متاعك يلزمو تكملة: صلّح وعاود ابعث وثائقك",
    rejectedCta: "عاود ابعث وثائقي",
    pendingB: "التثبّت في الطريق، الجواب عادةً في 24–48 ساعة",
    suspendedB: "صفحتك موقوفة: اتصل بفريق Tnajem",
    onT: "معاينة خاصة · صفحتك على الخط",
    onB: "هذا اللي يشوفوه التلامذة.",
    onCta: "حلّ الصفحة العامة",
    emptyTitle: "ما عندكش صفحة لتوّا",
    emptyBody: "اعمل صفحتك متاع أستاذ: إسمك، مادتك، اللينك متاعك.",
    emptyCta: "اعمل صفحتي",
    title: "معاينة خاصة",
  },
});

export function OwnerPreviewFrame({
  status,
  slug,
  suspended,
  children,
}: {
  status: TutorVerifStatus;
  slug: string;
  suspended: boolean;
  children: ReactNode;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const online = status === "verified" && !suspended;

  const banner = online ? (
    <Blocker title={c.onT} icon={<Eye />} action={<Link href={`/${slug}`} className="btn btn-ghost btn-sm aps-blocker-cta">{c.onCta}</Link>}>
      {c.onB}
    </Blocker>
  ) : suspended ? (
    <Blocker title={c.offT} icon={<Eye />}>{c.suspendedB}</Blocker>
  ) : status === "pending" ? (
    <Blocker title={c.offT} icon={<Eye />}>{c.pendingB}</Blocker>
  ) : status === "rejected" ? (
    <Blocker title={c.offT} icon={<Eye />} action={{ href: "/onboarding/verify", label: c.rejectedCta }}>{c.rejectedB}</Blocker>
  ) : (
    <Blocker title={c.offT} icon={<Eye />} action={{ href: "/onboarding/verify", label: c.offCta }}>{c.offB}</Blocker>
  );

  return (
    <div className="aps-page aps-page-wide" data-e2e="owner-preview">
      <div className="aps-blockers" data-e2e="owner-preview-banner" data-online={online ? "true" : "false"}>{banner}</div>
      <div className="aps-preview">{children}</div>
    </div>
  );
}

export function OwnerPreviewEmpty() {
  const { locale } = useLocale();
  const c = copy[locale];
  return (
    <AppPage title={c.title} width="narrow">
      <EmptyState icon={<Store />} title={c.emptyTitle} action={<Link href="/onboarding" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}>
        {c.emptyBody}
      </EmptyState>
    </AppPage>
  );
}

/* espace prof v2 · pro (P7) — the two other states of this server page. A failed
   read is an ERROR with a retry (it used to fall through to « Tu n'as pas encore de
   page », telling a tutor with a page that they had none); the wait is a skeleton
   (loading.tsx next to the page). */
export function OwnerPreviewError() {
  const { locale } = useLocale();
  const router = useRouter();
  return (
    <AppPage title={copy[locale].title} width="narrow">
      <ErrorState onRetry={() => router.refresh()} />
    </AppPage>
  );
}

export function OwnerPreviewLoading() {
  const { locale } = useLocale();
  return (
    <AppPage title={copy[locale].title}>
      <PageSkeleton rows={3} />
    </AppPage>
  );
}
