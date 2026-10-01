"use client";
/* ══════════════════════════════════════════════════════════════════════════════
   espace prof v2 · AppShell — THE ONE FRAME OF THE PROF SPACE (contract C1).
   Image: UI_options/espace-prof-1-shell.png. Rules 1–8 of that image apply to
   every page inside it.

   ── WHERE IT IS APPLIED ─────────────────────────────────────────────────────
   At LAYOUT level, for tutors only, so a page never opts in:
     app/[locale]/dashboard/layout.tsx    every /dashboard/* page, present and future
     app/[locale]/onboarding/layout.tsx   /onboarding (edit my page), /onboarding/verify
     app/[locale]/messages/layout.tsx     /messages, /messages/[id]   (shared with students)
     app/[locale]/account/layout.tsx      /account                    (shared with students)
   Each layout reads the session server-side; a tutor gets the shell, anyone else
   (student, guardian, guest) gets the page exactly as before. /onboarding/upgrade
   is only ever shown to STUDENTS (a tutor is redirected from it), so it keeps the
   public frame.

   Inside the shell, <SiteShell> renders its children only (ShellContext.tsx): no
   site header, no marketing footer, no "Tableau de bord" button. A page that still
   wraps itself in <SiteShell> just works; new pages use <AppPage> below.

   ── THE NAVIGATION ──────────────────────────────────────────────────────────
   components/app/nav.tsx — ONE file: the sidebar groups (APP_NAV), pages under an
   item (APP_SUBPAGES), the mobile tabs and the « + » actions. Append there; the
   sidebar, the active state, the breadcrumbs and the mobile « Profil » sheet all
   follow.

   ── THE PAGE API (import from "@/components/app/AppShell") ───────────────────
     <AppPage
       title={c.title}                       the page's one <h1>
       subtitle={c.sub}                     optional line under it
       actions={<Link className="btn btn-primary btn-sm">…</Link>}
                                             header buttons, inline end — ONE ochre per view
       blockers={<Blocker title={c.verifyT} action={{ href, label }}>{c.verifyB}</Blocker>}
                                             rule 4: right under the title, never at the bottom
       note={c.note}                        rule 7: THE one blue info note — one slot, on purpose
       crumbs={[{ label: c.messages, href: "/messages" }, { label: title }]}
                                             optional: override the breadcrumbs nav.tsx derives
       actionBar={<ActionBar status={c.saved}><button…/></ActionBar>}
                                             rule 5: sticky at the bottom, above the phone tab bar
       width="default" | "narrow" | "wide">
       …content…
     </AppPage>

     <FormSection n={1} title={c.s1}>…</FormSection>        rule 5: numbered form sections
     <PageSkeleton rows={3} /> · <EmptyState …/> · <ErrorState onRetry />
                                             the loading / empty / error states of a page
     Dates and times: components/app/DatePicker.tsx (rule 6 — DD/MM/YYYY, 24 h, never
     a native date input). Destructive confirmations: components/app/ConfirmDialog.tsx.
     Toasts: components/useToast.tsx.

   Outside the shell (a guest who reached a page, the build-time inert state)
   <AppPage> falls back to the public frame, so a page never renders naked.

   ── SLOTS LEFT FOR OTHER TEAMS (grep "ep2:") ───────────────────────────────────
     {/* ep2:share-slot *\/}   home « Ma vitrine » card, Ma vitrine page, Mes classes rows
                              (a plain CopyLinkButton today; growth puts ShareButton there)
     {/* ep2:follow-slot *\/}  the public « Ce prof arrive bientôt » page (growth's Suivre)
     {/* ep2:stats-slot *\/}   Ma vitrine (growth's Vues · Clics · Abonnés)
   ══════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Link } from "@/components/Link";
import { Logo } from "@/components/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { useLocale } from "@/components/LocaleProvider";
import { Chat, Gear, Help, LogOut, Plus, User, ChevronUp, Close } from "@/components/icons";
import { logout } from "@/app/actions";
import { getShellCounts } from "@/app/actions-shell";
import { publicDisplayName, type TutorShell } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { ShellContext, type Crumb, type ShellContextValue } from "./ShellContext";
import { NotificationsBell } from "./NotificationsBell";
import { APP_NAV, CREATE_ACTIONS, MOBILE_TABS, activeItemKey, crumbsFor, navItem, type NavItem } from "./nav";

export { AppPage, Blocker, ActionBar, FormSection, PageSkeleton, EmptyState, ErrorState } from "./AppPage";
export type { AppPageProps } from "./AppPage";
export { useShell, useInAppShell, type Crumb } from "./ShellContext";

const copy = bilingual({
  fr: {
    space: "Espace prof",
    skip: "Aller au contenu",
    crumbs: "Fil d'Ariane",
    quick: "Navigation rapide",
    messages: "Messages",
    unreadMsgs: (n: number) => (n === 1 ? "1 message non lu" : `${n} messages non lus`),
    me: "Mon compte",
    settings: "Réglages",
    help: "Aide",
    logout: "Se déconnecter",
    profile: "Profil",
    close: "Fermer",
    create: "Créer",
    role: "Prof",
    plans: { pilot: "Pilote", gratuit: "Gratuit", essentiel: "Essentiel", pro: "Pro", prestige: "Prestige" } as Record<string, string>,
  },
  ar: {
    space: "فضاء الأستاذ",
    skip: "امشي للمحتوى",
    crumbs: "وين إنتي",
    quick: "تنقّل سريع",
    messages: "الرسائل",
    unreadMsgs: (n: number) => `${n} رسالة موش مقروية`,
    me: "حسابي",
    settings: "الإعدادات",
    help: "مساعدة",
    logout: "اخرج من حسابك",
    profile: "حسابي",
    close: "سكّر",
    create: "اعمل",
    role: "أستاذ",
    plans: { pilot: "تجربة", gratuit: "فابور", essentiel: "الأساسي", pro: "برو", prestige: "بريستيج" } as Record<string, string>,
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

/** "Prof · Pilote" — the role and the tutor's EFFECTIVE plan (packages/shared/src/plans.ts). */
function planLine(shell: TutorShell | null, c: Copy): string {
  if (!shell) return c.role;
  const plan = shell.plan.isPilot ? c.plans.pilot : (c.plans[shell.plan.code] ?? shell.plan.code);
  return `${c.role} · ${plan}`;
}

async function signOut() {
  await logout().catch(() => null);
  // Hard navigation on purpose: a full reload drops every client cache of the signed-in user.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
}

/* ── the nav list: the sidebar AND the mobile « Profil » sheet ──────────────── */
function NavList({ shell, activeKey, onNavigate, idPrefix }: { shell: TutorShell | null; activeKey: string | null; onNavigate?: () => void; idPrefix: string }) {
  const { locale } = useLocale();
  const link = (item: NavItem) => {
    const badge = item.badge?.(shell) ?? null;
    const Icon = item.icon;
    return (
      <li key={item.key}>
        <Link prefetch={false}
          href={item.href}
          className="aps-link"
          aria-current={activeKey === item.key ? "page" : undefined}
          onClick={onNavigate}
          data-e2e={`nav-${item.key}`}
        >
          <Icon />
          <span className="aps-link-t">{item.label[locale]}</span>
          {badge && (
            <>
              <span className="aps-badge" aria-hidden="true" data-e2e={`nav-badge-${item.key}`}>{badge.text}</span>
              <span className="sr-only">, {badge.label[locale]}</span>
            </>
          )}
        </Link>
      </li>
    );
  };
  return (
    <>
      {APP_NAV.map((g) =>
        g.label ? (
          <div key={g.key} className="aps-group" role="group" aria-labelledby={`${idPrefix}-${g.key}`}>
            <p className="aps-group-t" id={`${idPrefix}-${g.key}`}>{g.label[locale]}</p>
            <ul>{g.items.map(link)}</ul>
          </div>
        ) : (
          <ul key={g.key}>{g.items.map(link)}</ul>
        ),
      )}
    </>
  );
}

/* ── the avatar card at the bottom of the sidebar (rule 3) ──────────────────── */
function AvatarCard({ shell, c }: { shell: TutorShell | null; c: Copy }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const first = publicDisplayName(shell?.name) ?? "—";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="aps-me">
      {open && (
        <ul id="aps-me-menu" className="aps-pop aps-me-menu" data-e2e="shell-me-menu">
          <li>
            <Link prefetch={false} href="/account" className="aps-menu-item" onClick={() => setOpen(false)}>
              <Gear />
              {c.settings}
            </Link>
          </li>
          <li>
            <Link prefetch={false} href="/aide" className="aps-menu-item" onClick={() => setOpen(false)}>
              <Help />
              {c.help}
            </Link>
          </li>
          <li>
            <button type="button" className="aps-menu-item" onClick={signOut}>
              <LogOut />
              {c.logout}
            </button>
          </li>
        </ul>
      )}
      <button
        ref={btnRef}
        type="button"
        className="aps-me-btn"
        aria-expanded={open}
        aria-controls="aps-me-menu"
        aria-label={`${c.me} · ${first}`}
        onClick={() => setOpen((v) => !v)}
        data-e2e="shell-me"
      >
        <span className="avatar aps-me-av" aria-hidden="true">{shell?.initials ?? "?"}</span>
        <span className="aps-me-txt">
          <span className="aps-me-name">{first}</span>
          <span className="aps-me-plan" data-e2e="shell-plan">{planLine(shell, c)}</span>
        </span>
        <ChevronUp className="aps-me-chev" />
      </button>
    </div>
  );
}

/* ── the mobile « Profil » sheet: everything the four tabs do not reach ─────── */
function ProfileSheet({ shell, activeKey, open, onClose, c }: { shell: TutorShell | null; activeKey: string | null; open: boolean; onClose: () => void; c: Copy }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const first = publicDisplayName(shell?.name) ?? "—";
  return (
    <dialog
      ref={ref}
      className="aps-sheet"
      aria-labelledby="aps-sheet-t"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // a tap on the backdrop
      }}
      data-e2e="shell-sheet"
    >
      <div className="aps-sheet-in">
        <div className="aps-sheet-head">
          <span className="avatar aps-me-av" aria-hidden="true">{shell?.initials ?? "?"}</span>
          <span className="aps-me-txt">
            <span className="aps-me-name" id="aps-sheet-t">{first}</span>
            <span className="aps-me-plan">{planLine(shell, c)}</span>
          </span>
          <button type="button" className="aps-tool" aria-label={c.close} onClick={onClose}>
            <Close />
          </button>
        </div>
        <nav aria-label={c.space} className="aps-nav aps-sheet-nav">
          <NavList shell={shell} activeKey={activeKey} onNavigate={onClose} idPrefix="aps-sheet" />
        </nav>
        <ul className="aps-sheet-extra">
          <li>
            <Link prefetch={false} href="/aide" className="aps-menu-item" onClick={onClose}>
              <Help />
              {c.help}
            </Link>
          </li>
          <li>
            <button type="button" className="aps-menu-item" onClick={signOut}>
              <LogOut />
              {c.logout}
            </button>
          </li>
        </ul>
      </div>
    </dialog>
  );
}

/* ── the floating « + » (phones) ─────────────────────────────────────────────── */
function CreateFab({ c }: { c: Copy }) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={wrapRef} className="aps-fab-wrap">
      {open && (
        <ul id="aps-fab-menu" className="aps-pop aps-fab-menu" data-e2e="shell-fab-menu">
          {CREATE_ACTIONS.map((a) => (
            <li key={a.href}>
              <Link prefetch={false} href={a.href} className="aps-menu-item" onClick={() => setOpen(false)}>
                <a.icon />
                {a.label[locale]}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <button
        ref={btnRef}
        type="button"
        className="aps-fab"
        aria-label={c.create}
        aria-expanded={open}
        aria-controls="aps-fab-menu"
        onClick={() => setOpen((v) => !v)}
        data-e2e="shell-fab"
      >
        <Plus />
      </button>
    </div>
  );
}

/* NO PREFETCH on the shell's links (prefetch={false} throughout). Every prof page is
   request-time (the layout reads the session), so a prefetch is a full server render —
   layout, session lookup and shell data — and the sidebar alone carries a dozen links:
   that is a dozen renders per page view, on a 3G phone, for pages the tutor may never
   open. (It also kept a prefetch of a page a later phase builds hanging open.) */

/* ══ THE SHELL ═══════════════════════════════════════════════════════════════ */
export function AppShell({ shell, children }: { shell: TutorShell | null; children: ReactNode }) {
  const { locale } = useLocale();
  const c = copy[locale];
  // usePathname() is locale-prefixed (/fr/dashboard); nav.tsx speaks locale-bare paths.
  const path = (usePathname() ?? "/").replace(/^\/(fr|ar)(?=\/|$)/, "") || "/";
  const activeKey = activeItemKey(path);

  const [override, setOverride] = useState<Crumb[] | null>(null);
  const crumbs = override ?? crumbsFor(path, locale);

  const [counts, setCounts] = useState({ notifications: 0, messages: 0 });
  const refreshCounts = useCallback(() => {
    getShellCounts().then(setCounts).catch(() => {});
  }, []);
  // On every page, and whenever the tab comes back to the foreground.
  useEffect(() => {
    refreshCounts();
  }, [path, refreshCounts]);
  useEffect(() => {
    const onFocus = () => refreshCounts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshCounts]);

  const [sheet, setSheet] = useState(false);
  useEffect(() => setSheet(false), [path]);

  const ctx = useMemo<ShellContextValue>(() => ({ shell, setCrumbs: setOverride, refreshCounts }), [shell, setOverride, refreshCounts]);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="aps" data-e2e="app-shell">
        <a href="#main" className="skip-link">{c.skip}</a>

        <aside className="aps-side" data-e2e="shell-sidebar">
          <Link prefetch={false} href="/dashboard" className="aps-brand" aria-label="Tnajem">
            <Logo variant="full" height={30} />
          </Link>
          <nav aria-label={c.space} className="aps-nav">
            <NavList shell={shell} activeKey={activeKey} idPrefix="aps-side" />
          </nav>
          <AvatarCard shell={shell} c={c} />
        </aside>

        <div className="aps-body">
          <header className="aps-top" data-e2e="shell-topbar">
            <Link prefetch={false} href="/dashboard" className="aps-top-brand" aria-label="Tnajem">
              <Logo variant="mark" alt="" height={32} />
            </Link>
            <nav aria-label={c.crumbs} className="aps-crumbs" data-e2e="shell-crumbs">
              <ol>
                {crumbs.map((cr, i) => (
                  <li key={`${cr.label}-${i}`}>
                    {cr.href && i < crumbs.length - 1 ? (
                      <Link prefetch={false} href={cr.href}>{cr.label}</Link>
                    ) : (
                      <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{cr.label}</span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="aps-tools">
              <LocaleToggle compact />
              <Link prefetch={false}
                href="/messages"
                className="aps-tool"
                aria-label={counts.messages > 0 ? `${c.messages} · ${c.unreadMsgs(counts.messages)}` : c.messages}
                aria-current={path === "/messages" ? "page" : undefined}
                data-e2e="shell-messages"
              >
                <Chat />
                {counts.messages > 0 && (
                  <span className="aps-count" aria-hidden="true" data-e2e="shell-messages-count">
                    {counts.messages > 9 ? "9+" : counts.messages}
                  </span>
                )}
              </Link>
              <NotificationsBell unread={counts.notifications} onRead={refreshCounts} />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="aps-main">
            {children}
          </main>
        </div>

        <nav className="aps-tabs" aria-label={c.quick} data-e2e="shell-tabs">
          {MOBILE_TABS.map((tab) => {
            const item = navItem(tab.key);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <Link prefetch={false}
                key={tab.key}
                href={item.href}
                className="aps-tab"
                aria-current={activeKey === tab.key ? "page" : undefined}
                data-e2e={`tab-${tab.key}`}
              >
                <Icon />
                <span>{tab.label[locale]}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className="aps-tab"
            aria-expanded={sheet}
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
            data-e2e="tab-profile"
          >
            <User />
            <span>{c.profile}</span>
          </button>
        </nav>
        <CreateFab c={c} />
        <ProfileSheet shell={shell} activeKey={activeKey} open={sheet} onClose={() => setSheet(false)} c={c} />
      </div>
    </ShellContext.Provider>
  );
}
