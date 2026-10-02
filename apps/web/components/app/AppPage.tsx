"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import { Info, Shield } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { useShell, type Crumb } from "./ShellContext";

/* espace prof v2 · shell — the PAGE half of the AppShell API. Documented in full in
   the header of components/app/AppShell.tsx (contract C1); import from there. */

const copy = bilingual({
  fr: {
    actions: "Actions de la page",
    loading: "Chargement…",
    errTitle: "Impossible de charger cette page",
    errBody: "Vérifie ta connexion, puis réessaie.",
    retry: "Réessayer",
  },
  ar: {
    actions: "أعمال الصفحة",
    loading: "قاعد يحمّل…",
    errTitle: "ما نجّمناش نحمّلو الصفحة هاذي",
    errBody: "ثبّت في الكونكسيون متاعك، ومن بعد عاود جرّب.",
    retry: "عاود جرّب",
  },
});

export type AppPageProps = {
  /** The page's one <h1>. */
  title: ReactNode;
  subtitle?: ReactNode;
  /** Header actions, at the inline end. At most ONE ochre (btn-primary) per view. */
  actions?: ReactNode;
  /** Rule 4 — what stops the tutor, at the TOP of the page, right under the title. Use <Blocker>. */
  blockers?: ReactNode;
  /** Rule 7 — THE one info note of the page (blue .note-info). One node, on purpose: there is no second slot. */
  note?: ReactNode;
  /** Replace the breadcrumbs nav.tsx derives for this path (e.g. a conversation's title). */
  crumbs?: Crumb[];
  /** Rule 5 — the action bar pinned to the bottom of a form page. Use <ActionBar> (here or anywhere in the page). */
  actionBar?: ReactNode;
  /** live-fixes-1 · A5 — the prof space has ONE width (--aps-page-w, 1080px) and every page's title
      starts at the same place:
        "default"  a page — lists, overviews, two-column forms (form + live preview): 1080px;
        "narrow"   a single-column form (Vérification, Réglages…): the same frame, its column
                   760px (--aps-form-w) at the inline start;
        "wide"     kept so older callers compile — since A5 it is the same as "default". */
  width?: "default" | "narrow" | "wide";
  /** live-fixes-1 · A2 — form mode: on a phone the tab bar and the « + » step aside (see <FormMode>).
      An <ActionBar> already implies it. */
  form?: boolean;
  children: ReactNode;
};

const WIDTH = { default: "aps-page", narrow: "aps-page aps-page-narrow", wide: "aps-page aps-page-wide" } as const;

export function AppPage({ title, subtitle, actions, blockers, note, crumbs, actionBar, width = "default", form = false, children }: AppPageProps) {
  const ctx = useShell();
  const setCrumbs = ctx?.setCrumbs;
  const crumbKey = crumbs ? JSON.stringify(crumbs) : null;

  useEffect(() => {
    if (!setCrumbs || !crumbKey) return;
    setCrumbs(JSON.parse(crumbKey) as Crumb[]);
    return () => setCrumbs(null);
  }, [setCrumbs, crumbKey]);

  const body = (
    <div className={WIDTH[width]}>
      <header className="aps-head">
        <div className="aps-head-txt">
          <h1 className="aps-h1">{title}</h1>
          {subtitle ? <div className="aps-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="aps-head-actions">{actions}</div> : null}
      </header>
      {blockers ? <div className="aps-blockers">{blockers}</div> : null}
      {note ? (
        <div className="note-info aps-note-info">
          <Info />
          <p>{note}</p>
        </div>
      ) : null}
      {children}
      {actionBar}
      {form ? <FormMode /> : null}
    </div>
  );

  /* Outside the shell (a guest, the build-time inert state) the page still renders,
     inside the public frame. */
  if (!ctx) {
    return (
      <SiteShell>
        <section className="web-section tight">
          <div className="container">{body}</div>
        </section>
      </SiteShell>
    );
  }
  return body;
}

/** Rule 4 — a blocker banner: what stops the tutor, and the one thing that unblocks it. */
export function Blocker({
  title,
  children,
  action,
  icon,
}: {
  title: ReactNode;
  children?: ReactNode;
  /** The unblocking action: { href, label } renders the page's ochre button; or pass your own node. */
  action?: { href: string; label: string } | ReactNode;
  icon?: ReactNode;
}) {
  const act =
    action && typeof action === "object" && "href" in (action as object) && "label" in (action as object)
      ? (action as { href: string; label: string })
      : null;
  return (
    <div className="aps-blocker" data-e2e="shell-blocker">
      <span className="aps-blocker-ic" aria-hidden="true">{icon ?? <Shield />}</span>
      <p className="aps-blocker-txt">
        <b>{title}</b>
        {children ? <> — {children}</> : null}
      </p>
      {act ? (
        <Link href={act.href} className="btn btn-primary btn-sm aps-blocker-cta">
          {act.label}
        </Link>
      ) : (
        (action as ReactNode) ?? null
      )}
    </div>
  );
}

/** Rule 5 — the action bar of a form page. `status` sits at the inline start ("Brouillon enregistré").

    live-fixes-1 · A1/A2: inside the shell it is PINNED to the bottom edge — the whole width on a
    phone, the content column beside the sidebar on a computer — and mounting one puts the page in
    form mode (no tab bar, no « + » on a phone). Its height is measured, not guessed: it varies
    (the status line wraps above the buttons on a phone) and the page must keep exactly that much
    room, plus 16px, below its last field, and scroll a focused field above it (--aps-bar-h,
    read by the shell's CSS in app/globals.css). Render it anywhere in the page — inside the
    <form> when its button submits it. */
export function ActionBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  const { locale } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const root = document.documentElement;
    // The border box: it already holds the safe-area inset the bar pads itself with on a phone.
    const measure = () => root.style.setProperty("--aps-bar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--aps-bar-h");
    };
  }, []);
  return (
    <div ref={ref} className="aps-actionbar" role="region" aria-label={copy[locale].actions} data-aps-form="">
      <div className="aps-actionbar-in">
        <div className="aps-actionbar-status">{status}</div>
        <div className="aps-actionbar-btns">{children}</div>
      </div>
    </div>
  );
}

/** live-fixes-1 · A2 — FORM MODE. A page that is a form (or a form that opens inside a page,
    like « Nouvelle offre ») mounts this while the form is on screen: on a phone the bottom tab
    bar and the floating « + » step aside, so the screen keeps one bar at most — the page's own
    <ActionBar>, which implies form mode by itself. It is a hidden marker the shell's CSS reads
    with :has(), so it is right from the first paint, server-rendered, with no state to sync.
    `<AppPage form>` is the same thing for a whole page. */
export function FormMode() {
  return <span hidden data-aps-form="" />;
}

/** Rule 5 — a numbered form section (image 2: « 1 L'essentiel »). */
export function FormSection({ n, title, children, id }: { n: number; title: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="aps-section" aria-labelledby={id ? `${id}-t` : undefined} id={id}>
      <h2 className="aps-section-t" id={id ? `${id}-t` : undefined}>
        <span className="aps-section-n" aria-hidden="true">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Loading state: grey bars in the shape of the list that is coming. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  const { locale } = useLocale();
  return (
    <div className="aps-skel" role="status" aria-live="polite" data-e2e="shell-skeleton">
      <span className="sr-only">{copy[locale].loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="aps-skel-row" aria-hidden="true">
          <span className="aps-skel-box" />
          <span className="aps-skel-lines">
            <span className="aps-skel-line" />
            <span className="aps-skel-line aps-skel-short" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Empty state: what is missing and the one way forward. */
export function EmptyState({ icon, title, children, action, level = 3 }: {
  icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode;
  /** 2 when the empty state IS the page body, right under the page's h1; 3 inside a titled card. */
  level?: 2 | 3;
}) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className="aps-empty" data-e2e="shell-empty">
      {icon ? <span className="aps-empty-ic" aria-hidden="true">{icon}</span> : null}
      <div className="min-w-0">
        <H className="aps-empty-t">{title}</H>
        {children ? <p className="aps-empty-b">{children}</p> : null}
        {action ? <div className="aps-empty-a">{action}</div> : null}
      </div>
    </div>
  );
}

/** Error state: says it failed, offers a retry. An h2: it almost always replaces a
    page's body under the h1, and an h2 inside a titled card never skips a level. */
export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  return (
    <div className="aps-empty aps-error" role="alert" data-e2e="shell-error">
      <div className="min-w-0">
        <h2 className="aps-empty-t">{c.errTitle}</h2>
        <p className="aps-empty-b">{c.errBody}</p>
        <div className="aps-empty-a">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
            {c.retry}
          </button>
        </div>
      </div>
    </div>
  );
}
