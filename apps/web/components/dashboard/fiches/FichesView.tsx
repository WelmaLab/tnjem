"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { useToast } from "@/components/useToast";
import { Book, Plus } from "@/components/icons";
import { deleteMaterial } from "@/app/actions";
import { deletePack, getMyFiches } from "@/app/actions-pages";
import type { MyFiches, TutorFiche } from "@tnajem/shared";
import { fichesCopy } from "./copy";
import { FicheRow } from "./FicheRow";
import { FicheEditDialog } from "./FicheEditDialog";
import { LibraryForm } from "./LibraryForm";

/* ══════════════════════════════════════════════════════════════════════════════
   live-fixes-1 · B — « MES FICHES » (/dashboard/materials), in the shell.

   It was still the Step 10 page: a native file input (« Choose File / No file
   chosen », in the system's language), two native selects and the packs listed
   apart from their files. Now:

     • ONE list of fiches — a pack and its file are one row (packs.material_id,
       0041) — each with its price, its file or video, its class and where it
       shows, and three actions: Partager, Modifier (a dialog), Retirer (asks first);
     • « Nouvelle fiche » → /dashboard/new-pack, the ochre action of the page
       (the empty state carries it while the list is empty — one ochre per view);
     • « Pour tes élèves seulement »: a file or a YouTube video with no price, not
       listed on the page — the library, folded until asked for, with the same
       upload field as « Nouvelle fiche » (components/dashboard/FileDrop.tsx).
   A file is only ever opened by the tutor's enrolled students (or whoever the
   library item's setting says): canRead() in apps/api decides, not this page.
   ══════════════════════════════════════════════════════════════════════════════ */

export function FichesView() {
  const { locale } = useLocale();
  const c = fichesCopy[locale];
  const { toast, showToast } = useToast();
  const [data, setData] = useState<MyFiches | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<TutorFiche | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<TutorFiche | null>(null);
  const [removing, setRemoving] = useState(false);
  const [libOpen, setLibOpen] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setData(await getMyFiches());
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(f: TutorFiche) {
    setRemoving(true);
    const res = f.packId
      ? await deletePack({ id: f.packId }).catch(() => null)
      : await deleteMaterial({ id: f.materialId! }).catch(() => null);
    setRemoving(false);
    setConfirmRemove(null);
    if (!res?.ok) {
      showToast(c.errGeneric);
      return;
    }
    showToast(f.packId ? c.okPackRemoved : c.okRemoved);
    await load();
  }

  const fiches = data?.fiches ?? [];
  const classes = data?.classes ?? [];
  const hasFiches = fiches.length > 0;

  let list: React.ReactNode;
  if (failed) list = <ErrorState onRetry={() => void load()} />;
  else if (data === undefined) list = <PageSkeleton rows={3} />;
  else if (data === null) {
    // No page yet (GET /fiches/mine answers null): a fiche needs one to show on.
    list = (
      <EmptyState
        level={2}
        icon={<Book />}
        title={c.emptyT}
        action={<Link href="/onboarding" className="btn btn-primary btn-sm">{c.emptyNoPageCta}</Link>}
      >
        {c.emptyNoPage}
      </EmptyState>
    );
  }
  else if (!hasFiches) {
    list = (
      <EmptyState
        level={2}
        icon={<Book />}
        title={c.emptyT}
        action={<Link href="/dashboard/new-pack" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}
      >
        {c.emptyB}
      </EmptyState>
    );
  } else {
    list = (
      <section className="u-card u-card-pad" aria-labelledby="fx-list-t">
        <h2 id="fx-list-t" className="hp-card-t">
          {c.listTitle} <span className="mc-count">{fiches.length}</span>
        </h2>
        <ul className="fx-list" role="list" data-e2e="fiche-list">
          {fiches.map((f) => (
            <FicheRow
              key={f.key}
              f={f}
              classes={classes}
              verified={data.verified}
              onEdit={setEditing}
              onRemove={setConfirmRemove}
              busy={removing}
            />
          ))}
        </ul>
      </section>
    );
  }

  const removeBody = !confirmRemove
    ? null
    : confirmRemove.packId
      ? confirmRemove.materialId ? c.removePackBody : c.removePackBodyNoFile
      : c.removeBody;

  return (
    <AppPage
      title={c.title}
      subtitle={c.sub}
      actions={
        hasFiches ? (
          <Link href="/dashboard/new-pack" className="btn btn-primary btn-sm aps-hide-mobile" data-e2e="fiche-new">
            <Plus />
            {c.newPack}
          </Link>
        ) : undefined
      }
    >
      <div className="fx-stack">
        {list}

        {data ? (
          <section className="u-card u-card-pad" aria-labelledby="fx-lib-t" data-e2e="library">
            <div className="fx-lib-head">
              <div className="min-w-0 flex-1">
                <h2 id="fx-lib-t" className="hp-card-t">{c.libT}</h2>
                <p className="hp-muted">{c.libB}</p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-expanded={libOpen}
                aria-controls="fx-lib-body"
                onClick={() => setLibOpen((v) => !v)}
                data-e2e="library-toggle"
              >
                {libOpen ? c.libClose : (
                  <>
                    <Plus />
                    {c.libOpen}
                  </>
                )}
              </button>
            </div>
            <div id="fx-lib-body" hidden={!libOpen} className="fx-lib-body">
              {libOpen && (
                <LibraryForm
                  classes={classes}
                  onAdded={(m) => {
                    showToast(m);
                    setLibOpen(false);
                    void load();
                  }}
                />
              )}
            </div>
          </section>
        ) : null}
      </div>

      <FicheEditDialog
        fiche={editing}
        classes={classes}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          showToast(c.saved);
          void load();
        }}
      />

      {/* A removal is final for the tutor — ask first. */}
      <ConfirmDialog
        open={confirmRemove !== null}
        title={confirmRemove ? c.removeTitle(confirmRemove.title) : ""}
        confirmLabel={c.removeYes}
        cancelLabel={c.keep}
        busy={removing}
        onConfirm={() => confirmRemove && void remove(confirmRemove)}
        onClose={() => setConfirmRemove(null)}
      >
        {removeBody}
      </ConfirmDialog>
      {toast}
    </AppPage>
  );
}
