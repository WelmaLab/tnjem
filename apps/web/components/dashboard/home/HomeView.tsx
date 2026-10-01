"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Plus, Shield } from "@/components/icons";
import { getDashboard } from "@/app/actions";
import { AppPage, Blocker, PageSkeleton, ErrorState } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { StorefrontLinkCard } from "@/components/dashboard/StorefrontLinkCard";
import { buildTutorSteps } from "@/lib/onboarding-steps";
import { publicDisplayName, type DashboardData, type DashboardResult } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { SetupProgress } from "./SetupProgress";
import { KpiTiles } from "./KpiTiles";
import { UpcomingSessions } from "./UpcomingSessions";

/* espace prof v2 · shell — the HOME of the prof space (/dashboard), image 1.

   In order: the greeting, the slim setup banner while setup is incomplete, the
   ONE blocker (create the page / get verified), the four numbers, then
   « Prochaines séances » beside « Ma vitrine ». That is all.

   What left this page, and where it went:
     the « 0 TND » balance card        → gone (the Revenus tile says « Bientôt »)
     « Activité récente »              → gone (the same numbers are the tiles)
     « Comment ça marche »             → a link to /aide
     the bookings table                → « Mes élèves »
     the class list + cancel / move    → « Mes classes »
     the packs list                    → « Mes fiches »
     the plan panel                    → « Mon offre »
     the photo                         → the setup steps + /account
     « 1re séance offerte »            → /account (Réglages › Vitrine in phase 6) */

const copy = bilingual({
  fr: {
    hello: (name: string) => `Salut ${name} 👋`,
    helloAnon: "Salut 👋",
    online: "Ta page est en ligne.",
    newClass: "Nouvelle classe",
    help: "Comment ça marche ?",
    helpCta: "Lire l'aide",
    // The ONE blocker of the home (rule 4).
    bStoreT: "Crée ta page de prof",
    bStoreB: "ton nom, ta matière, ton lien. Deux minutes.",
    bStoreCta: "Créer ma page",
    bVerifyT: "Fais-toi vérifier",
    bVerifyB: "ta page et tes classes passent en ligne dès que c'est fait.",
    bVerifyCta: "Envoyer mes documents",
    bRejectedT: "Dossier à compléter",
    bRejectedB: "il manque quelque chose. Corrige et renvoie tes documents.",
    bRejectedCta: "Renvoyer mes documents",
    pendingNote: "Vérification en cours : on regarde tes documents, réponse en général sous 24–48 h. Rien à faire de ton côté.",
    signedOutTitle: "Connecte-toi pour voir ton espace prof",
    signedOutBody: "Tes classes, tes élèves et ton lien s'affichent ici une fois connecté.",
    signIn: "Se connecter",
    dashboard: "Accueil",
  },
  ar: {
    hello: (name: string) => `أهلا ${name} 👋`,
    helloAnon: "أهلا 👋",
    online: "صفحتك على الخط.",
    newClass: "حصة جديدة",
    help: "كيفاش يخدم ؟",
    helpCta: "اقرا المساعدة",
    bStoreT: "اعمل صفحتك متاع أستاذ",
    bStoreB: "إسمك، مادتك، اللينك متاعك. دقيقتين.",
    bStoreCta: "اعمل صفحتي",
    bVerifyT: "تثبّت من هويتك",
    bVerifyB: "صفحتك وحصصك يوليو على الخط أوّل ما يكمل.",
    bVerifyCta: "ابعث وثائقي",
    bRejectedT: "الملف يلزمو تكملة",
    bRejectedB: "فمّا حاجة ناقصة. صلّح وعاود ابعث وثائقك.",
    bRejectedCta: "عاود ابعث وثائقي",
    pendingNote: "التثبّت في الطريق: قاعدين نشوفو في وثائقك، الجواب عادةً في 24–48 ساعة. ما عندك ما تعمل.",
    signedOutTitle: "ادخل لحسابك باش تشوف فضاءك",
    signedOutBody: "حصصك، تلامذتك واللينك متاعك يبانو هوني كي تدخل.",
    signIn: "دخول",
    dashboard: "الرئيسية",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

/** The home's one blocker, or null. Pending is not a blocker: nothing to do, it is a note. */
function blockerOf(d: DashboardData, c: Copy) {
  if (!d.has_storefront) return <Blocker title={c.bStoreT} action={{ href: "/onboarding", label: c.bStoreCta }}>{c.bStoreB}</Blocker>;
  if (d.status === "draft") return <Blocker title={c.bVerifyT} action={{ href: "/onboarding/verify", label: c.bVerifyCta }}>{c.bVerifyB}</Blocker>;
  if (d.status === "rejected") return <Blocker title={c.bRejectedT} action={{ href: "/onboarding/verify", label: c.bRejectedCta }}>{c.bRejectedB}</Blocker>;
  return null;
}

export function HomeView() {
  const { locale } = useLocale();
  const c = copy[locale];
  /* undefined = loading · null = signed out · {wrongRole} = the other role · data = the tutor */
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

  if (failed) {
    return (
      <AppPage title={c.dashboard}>
        <ErrorState onRetry={load} />
      </AppPage>
    );
  }
  if (result === undefined) {
    return (
      <AppPage title={c.helloAnon}>
        <PageSkeleton rows={3} />
      </AppPage>
    );
  }
  if (result && "wrongRole" in result) {
    return (
      <AppPage title={c.dashboard} width="narrow">
        <WrongRoleNotice role={result.wrongRole} />
      </AppPage>
    );
  }
  if (result === null) {
    return (
      <AppPage title={c.dashboard} width="narrow">
        <div className="u-card u-card-pad text-center">
          <span className="hp-hero-ic" aria-hidden="true"><Shield /></span>
          <h2 className="font-display text-[18px] mb-[7px]">{c.signedOutTitle}</h2>
          <p className="text-[13px] text-muted leading-[1.6] mb-[18px]">{c.signedOutBody}</p>
          <Link href="/auth" className="btn btn-primary max-w-[260px] mx-auto">{c.signIn}</Link>
        </div>
      </AppPage>
    );
  }

  const d = result;
  const first = publicDisplayName(d.name);
  const steps = buildTutorSteps(
    {
      hasStorefront: d.has_storefront,
      status: d.status,
      hasClass: d.classes.length > 0,
      hasSlug: Boolean(d.slug),
      photo: d.avatarStatus,
      linkShared: Boolean(d.linkShared),
    },
    locale,
    { everyCta: true },
  );
  const setupDone = steps.every((s) => s.state === "done");
  const blocker = blockerOf(d, c);

  return (
    <AppPage
      title={first ? c.hello(first) : c.helloAnon}
      /* Image 1: the progress line sits under the greeting, slim, until setup is done. */
      subtitle={setupDone ? c.online : <SetupProgress steps={steps} />}
      /* One ochre per view: while a blocker carries the main action, « Nouvelle
         classe » is the cobalt outline. Hidden on phones, where the « + » does it. */
      actions={
        <Link
          href="/dashboard/new-class"
          className={`btn ${blocker ? "btn-outline" : "btn-primary"} btn-sm aps-hide-mobile`}
          data-e2e="home-new-class"
        >
          <Plus />
          {c.newClass}
        </Link>
      }
      blockers={blocker}
      note={d.status === "pending" ? c.pendingNote : undefined}
    >
      <KpiTiles d={d} />
      <div className="hp-grid">
        <UpcomingSessions classes={d.classes} everHadClass={d.classes.length > 0} />
        <StorefrontLinkCard slug={d.slug} status={d.status} hasStorefront={d.has_storefront} />
      </div>
      <p className="hp-help">
        {c.help}{" "}
        <Link href="/aide" prefetch={false} className="linklike linklike-inline">{c.helpCta}</Link>
      </p>
    </AppPage>
  );
}
