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
     (/account is the student's page; its layout sends a tutor to /dashboard/settings — phase 6)
   Each layout reads the session server-side; a tutor gets the shell, anyone else
   (student, guardian, guest) gets the page exactly as before — except that a STUDENT
   gets the student space's own frame there, StudentShell.tsx (student-space-v1 · A),
   which reuses this file's NavList, AvatarCard and MeMenuItems. /onboarding/upgrade
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
                                             rule 5: pinned to the bottom edge (or render <ActionBar>
                                             anywhere in the page, e.g. inside its <form>)
       width="default" | "narrow"           one frame for the whole space (1080px): "default" for a
                                             page, "narrow" for a single-column form (a 760px column
                                             at the inline start, so the title never moves);
                                             "wide" is an old alias of "default"
       form>                                form mode without an action bar (below)
       …content…
     </AppPage>

     FORM MODE (live-fixes-1 · A2): a page that is a form shows ONE bar on a phone — its
     action bar — and no tab bar (the « + » lives in it). An <ActionBar> turns it on by
     itself; a form with no action bar mounts <FormMode /> while it is on screen (or the
     page passes `form`). Pure CSS (:has([data-aps-form]) in app/globals.css), so it is
     right on the first paint. Whatever is pinned to the bottom (the tab bar, or the
     measured action bar) is kept clear: the page ends 16px above it, and a field scrolled
     or tabbed to lands above it (scroll-padding on the document).

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
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
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
import { closeOnLeave } from "./disclosure";
import { useFocusRescue } from "./focus-rescue";
import { APP_NAV, CREATE_ACTIONS, CREATE_TAB_AT, MOBILE_TABS, activeItemKey, crumbsFor, navItem, type NavGroup, type NavItem } from "./nav";

export { AppPage, Blocker, ActionBar, FormMode, FormSection, PageSkeleton, EmptyState, ErrorState } from "./AppPage";
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

export async function signOut() {
  await logout().catch(() => null);
  // Hard navigation on purpose: a full reload drops every client cache of the signed-in user.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = "/";
}

/* ── the nav list: the sidebar AND the mobile « Profil » sheet ────────────────
   student-space-v1 · A: generic — `nav` is the space's table (APP_NAV for the prof,
   STUDENT_APP_NAV for the student) and `data` is what its badges read. */
export function NavList<T>({ nav, data, activeKey, onNavigate, idPrefix }: { nav: NavGroup<T>[]; data: T; activeKey: string | null; onNavigate?: () => void; idPrefix: string }) {
  const { locale } = useLocale();
  const link = (item: NavItem<T>) => {
    const badge = item.badge?.(data) ?? null;
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
      {nav.map((g) =>
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

/* ── the avatar menu's entries: links, then « Se déconnecter » ────────────────
   student-space-v1 · A: shared by the prof's avatar card and the student's (sidebar
   card, and the avatar of the phone's top bar). */
export type MeLink = { href: string; label: string; icon: (p: { className?: string }) => ReactElement };

export function MeMenuItems({ links, logout, onClose }: { links: MeLink[]; logout: string; onClose: () => void }) {
  return (
    <>
      {links.map((l) => (
        <li key={l.href}>
          <Link prefetch={false} href={l.href} className="aps-menu-item" onClick={onClose}>
            <l.icon />
            {l.label}
          </Link>
        </li>
      ))}
      <li>
        <button type="button" className="aps-menu-item" onClick={signOut}>
          <LogOut />
          {logout}
        </button>
      </li>
    </>
  );
}

/* ── the avatar card at the bottom of the sidebar (rule 3) ────────────────────
   student-space-v1 · A: what it shows comes from the caller — the prof's card reads
   "Prof · Pilote" and opens Réglages · Aide; the student's reads "Élève · Pilote" and
   opens Profil · Aide. Same markup, same hooks, same keyboard behaviour. */
export function AvatarCard({ name, initials, line, links, meLabel, logout }: { name: string; initials: string; line: string; links: MeLink[]; meLabel: string; logout: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const first = name;

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

  /* live-fixes-2 · F: the menu comes AFTER its button in the DOM (it is drawn above it
     all the same — absolutely placed), so the Tab after opening it goes INTO it rather
     than on to the top bar with the menu left open; and focus leaving it closes it. */
  return (
    <div ref={wrapRef} className="aps-me" onBlur={(e) => closeOnLeave(e, () => setOpen(false))}>
      <button
        ref={btnRef}
        type="button"
        className="aps-me-btn"
        aria-expanded={open}
        aria-controls="aps-me-menu"
        aria-label={`${meLabel} · ${first}`}
        onClick={() => setOpen((v) => !v)}
        data-e2e="shell-me"
      >
        <span className="avatar aps-me-av" aria-hidden="true">{initials}</span>
        <span className="aps-me-txt">
          <span className="aps-me-name">{first}</span>
          <span className="aps-me-plan" data-e2e="shell-plan">{line}</span>
        </span>
        <ChevronUp className="aps-me-chev" />
      </button>
      {open && (
        <ul id="aps-me-menu" className="aps-pop aps-me-menu" data-e2e="shell-me-menu">
          <MeMenuItems links={links} logout={logout} onClose={() => setOpen(false)} />
        </ul>
      )}
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
          <NavList nav={APP_NAV} data={shell} activeKey={activeKey} onNavigate={onClose} idPrefix="aps-sheet" />
        </nav>
        {/* « Aide » is in the nav list above (nav.tsx, COMPTE group — pro P7). */}
        <ul className="aps-sheet-extra">
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

/* ── the « + » (phones): the raised middle slot of the tab bar ───────────────────
   live-fixes-1 · A3: it used to float above the tab bar, over the page — and a button
   floating over scrolling content covers whatever scrolls under it (« Copier le lien »
   on the Arabic home, as the page opened). Docked in the bar, it never covers anything. */
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
  // live-fixes-2 · F: the menu after its button (Tab goes into it), closed when focus leaves.
  return (
    <div ref={wrapRef} className="aps-fab-wrap" onBlur={(e) => closeOnLeave(e, () => setOpen(false))}>
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

  // live-fixes-2 · F: a removed control (a confirmed « Retirer »…) hands focus to its neighbour, not to <body>.
  useFocusRescue();

  return (
    <ShellContext.Provider value={ctx}>
      <div className="aps" data-e2e="app-shell">
        <a href="#main" className="skip-link">{c.skip}</a>

        <aside className="aps-side" data-e2e="shell-sidebar">
          <Link prefetch={false} href="/dashboard" className="aps-brand" aria-label="Tnajem">
            <Logo variant="full" height={30} />
          </Link>
          <nav aria-label={c.space} className="aps-nav">
            <NavList nav={APP_NAV} data={shell} activeKey={activeKey} idPrefix="aps-side" />
          </nav>
          <AvatarCard
            name={publicDisplayName(shell?.name) ?? "—"}
            initials={shell?.initials ?? "?"}
            line={planLine(shell, c)}
            links={[
              { href: "/dashboard/settings", label: c.settings, icon: Gear },
              { href: "/aide", label: c.help, icon: Help },
            ]}
            meLabel={c.me}
            logout={c.logout}
          />
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
          {MOBILE_TABS.map((tab, i) => {
            const item = navItem(tab.key);
            if (!item) return null;
            const Icon = item.icon;
            return (
              <Fragment key={tab.key}>
                {i === CREATE_TAB_AT && <CreateFab c={c} />}
                <Link prefetch={false}
                  href={item.href}
                  className="aps-tab"
                  aria-current={activeKey === tab.key ? "page" : undefined}
                  data-e2e={`tab-${tab.key}`}
                >
                  <Icon />
                  <span>{tab.label[locale]}</span>
                </Link>
              </Fragment>
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
        <ProfileSheet shell={shell} activeKey={activeKey} open={sheet} onClose={() => setSheet(false)} c={c} />
      </div>
    </ShellContext.Provider>
  );
}
