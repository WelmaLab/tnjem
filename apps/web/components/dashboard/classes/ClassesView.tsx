"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Plus, Video } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { getDashboard } from "@/app/actions";
import { AppPage, Blocker, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import type { DashboardClass, DashboardData, DashboardResult } from "@tnajem/shared";
import { startState } from "@tnajem/shared/live"; // live-fixes-3 · A1
import { bilingual } from "@/lib/i18n";
import { ClassRow } from "./ClassRow";

/* espace prof v2 · shell — « Mes classes » (/dashboard/classes): every class the
   tutor has published, the ones still ahead first, then the past ones. The list is
   GET /dashboard's (the same rows the home counts), so the two can never disagree. */

const copy = bilingual({
  fr: {
    title: "Mes classes",
    sub: "Tes séances en direct : celles qui arrivent, et celles déjà passées.",
    newClass: "Nouvelle classe",
    upcoming: "À venir",
    past: "Passées",
    none: "Rien ici pour l'instant.",
    emptyTitle: "Aucune classe pour l'instant",
    emptyBody: "Un titre, une date, ton prix : ta séance apparaît sur ta page et les élèves réservent en un clic.",
    emptyCta: "Créer ma 1ʳᵉ classe",
    // live-fixes-1 · H: before verification the form keeps a draft — « prepare », not « create ».
    emptyCtaPrepare: "Préparer ma 1ʳᵉ classe",
    emptyBodyNoPage: "Commence par ta page : tes classes s'y afficheront.",
    note: "Annuler une séance libère toutes les places : tes élèves sont prévenus et ne doivent rien.",
    pendingNote: "Vérification en cours : tu pourras publier tes classes dès qu'elle est validée, en général sous 24–48 h.",
    bVerifyT: "Fais-toi vérifier",
    bVerifyB: "tes classes sont publiées dès que ton compte est vérifié.",
    bVerifyCta: "Envoyer mes documents",
    bRejectedT: "Dossier à compléter",
    bRejectedB: "corrige et renvoie tes documents pour publier tes classes.",
    bRejectedCta: "Renvoyer mes documents",
    bStoreT: "Crée ta page de prof",
    bStoreB: "tes classes s'affichent sur ta page.",
    bStoreCta: "Créer ma page",
  },
  ar: {
    title: "حصصي",
    sub: "حصصك الدايركت: اللي جاية، واللي فاتت.",
    newClass: "حصة جديدة",
    upcoming: "الجاية",
    past: "اللي فاتت",
    none: "ما فمّا شي لتوّا.",
    emptyTitle: "ما فمّا حتى حصة لتوّا",
    emptyBody: "عنوان، وقت، وثمنك: الحصة تبان في صفحتك والتلامذة يحجزو بكليكة.",
    emptyCta: "اعمل أول حصة متاعك",
    emptyCtaPrepare: "حضّر أول حصة متاعك",
    emptyBodyNoPage: "ابدا بصفحتك: الحصص متاعك تبان فيها.",
    note: "كي تلغي حصة، البلايص الكل تتسرّح: التلامذة يتعلمو وما عليهم والو.",
    pendingNote: "التثبّت في الطريق: تنجّم تنشر حصصك أوّل ما يتقبل، عادةً في 24–48 ساعة.",
    bVerifyT: "تثبّت من هويتك",
    bVerifyB: "حصصك تتنشر أوّل ما حسابك يتثبّت.",
    bVerifyCta: "ابعث وثائقي",
    bRejectedT: "الملف يلزمو تكملة",
    bRejectedB: "صلّح وعاود ابعث وثائقك باش تنشر حصصك.",
    bRejectedCta: "عاود ابعث وثائقي",
    bStoreT: "اعمل صفحتك متاع أستاذ",
    bStoreB: "حصصك تبان في صفحتك.",
    bStoreCta: "اعمل صفحتي",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

/** Ahead = still bookable or happening now; everything else (done, cancelled) is past. */
export function splitClasses(classes: DashboardClass[]): { upcoming: DashboardClass[]; past: DashboardClass[] } {
  const ahead = (k: DashboardClass) => k.status !== "cancelled" && k.status !== "done" && (k.phase === "upcoming" || k.phase === "live");
  return {
    upcoming: classes.filter(ahead).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    past: classes.filter((k) => !ahead(k)).sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
  };
}

function blockerOf(d: DashboardData, c: Copy) {
  if (!d.has_storefront) return <Blocker title={c.bStoreT} action={{ href: "/onboarding", label: c.bStoreCta }}>{c.bStoreB}</Blocker>;
  if (d.status === "draft") return <Blocker title={c.bVerifyT} action={{ href: "/onboarding/verify", label: c.bVerifyCta }}>{c.bVerifyB}</Blocker>;
  if (d.status === "rejected") return <Blocker title={c.bRejectedT} action={{ href: "/onboarding/verify", label: c.bRejectedCta }}>{c.bRejectedB}</Blocker>;
  return null;
}

export function ClassesView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
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

  /* live-fixes-3 · A3: « Modifier » on the owner's class page is /dashboard/classes?edit=<id>
     — there is no other edit screen: a published class changes by its date. Read once,
     then dropped from the address bar so a reload does not reopen the dialog. */
  const [editId, setEditId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("edit");
    if (!id) return;
    setEditId(id);
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);

  const data = result && !("wrongRole" in result) ? result : null;
  const blocker = data ? blockerOf(data, c) : null;
  const { upcoming, past } = splitClasses(data?.classes ?? []);
  // live-fixes-3 · A1: one ochre per view — while a class can be started, that is the main action.
  const startable = upcoming.some((k) => startState(k) === "open");

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (result === undefined) body = <PageSkeleton rows={4} />;
  else if (result && "wrongRole" in result) body = <WrongRoleNotice role={result.wrongRole} />;
  else if (!data || data.classes.length === 0) {
    /* live-fixes-1 · H — ONE clear primary action per view. Nothing to list: the empty
       state carries the action and the header button steps aside. With a blocker on top
       (no page yet, not verified), the blocker's button is the ochre one: the empty state
       offers to prepare a draft (outline), or nothing when there is no page to put it on. */
    const action = !data?.has_storefront ? undefined : blocker ? (
      <Link href="/dashboard/new-class" className="btn btn-outline btn-sm" data-e2e="classes-empty-cta">{c.emptyCtaPrepare}</Link>
    ) : (
      <Link href="/dashboard/new-class" className="btn btn-primary btn-sm" data-e2e="classes-empty-cta">
        {data.status === "verified" ? c.emptyCta : c.emptyCtaPrepare}
      </Link>
    );
    body = (
      <EmptyState level={2} icon={<Video />} title={c.emptyTitle} action={action}>
        {data && !data.has_storefront ? c.emptyBodyNoPage : c.emptyBody}
      </EmptyState>
    );
  } else {
    body = (
      <>
        <section className="u-card u-card-pad mc-block" aria-labelledby="mc-up">
          <h2 id="mc-up" className="hp-card-t">
            {c.upcoming} <span className="mc-count">{upcoming.length}</span>
          </h2>
          {upcoming.length === 0 ? (
            <p className="hp-muted">{c.none}</p>
          ) : (
            <ul className="mc-list" data-e2e="classes-upcoming">
              {upcoming.map((k) => <ClassRow key={k.id} k={k} onChanged={load} notify={showToast} autoEdit={k.id === editId} />)}
            </ul>
          )}
        </section>
        <section className="u-card u-card-pad mc-block" aria-labelledby="mc-past">
          <h2 id="mc-past" className="hp-card-t">
            {c.past} <span className="mc-count">{past.length}</span>
          </h2>
          {past.length === 0 ? (
            <p className="hp-muted">{c.none}</p>
          ) : (
            <ul className="mc-list" data-e2e="classes-past">
              {past.map((k) => <ClassRow key={k.id} k={k} onChanged={load} notify={showToast} />)}
            </ul>
          )}
        </section>
      </>
    );
  }

  return (
    <AppPage
      title={c.title}
      subtitle={c.sub}
      actions={
        data && data.classes.length > 0 ? (
          <Link href="/dashboard/new-class" className={`btn ${blocker || startable ? "btn-outline" : "btn-primary"} btn-sm aps-hide-mobile`}>
            <Plus />
            {c.newClass}
          </Link>
        ) : undefined
      }
      blockers={blocker}
      note={data?.status === "pending" ? c.pendingNote : upcoming.length > 0 ? c.note : undefined}
    >
      {body}
      {toast}
    </AppPage>
  );
}
