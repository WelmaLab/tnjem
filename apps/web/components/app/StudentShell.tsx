"use client";
/* ══════════════════════════════════════════════════════════════════════════════
   student-space-v1 · A — THE STUDENT SPACE'S FRAME (contract C3).
   Image: UI_options/espace-eleve-1-shell-accueil.png (desktop + the phone tab bar),
   espace-eleve-4-profil-mobile-ar.png (4c: the Arabic phone).

   The prof shell's structure and components, for a student: the same sidebar
   (<NavList>, its groups, its active state and badges), the same avatar card
   (<AvatarCard>), the same top bar (breadcrumbs, FR·ع, messages, <NotificationsBell>),
   the same ShellContext — so <AppPage>, <SiteShell>'s chrome gate, setCrumbs and
   refreshCounts() all work inside it unchanged. The CSS is the AppShell's (.aps-*);
   what differs is in the student-space-v1 · shell block at the end of globals.css.

   ── WHERE IT IS APPLIED ─────────────────────────────────────────────────────
   At LAYOUT level, for STUDENTS only (StudentShellLayout.tsx):
     app/[locale]/student/layout.tsx    /student (Accueil) and everything under it
     app/[locale]/account/layout.tsx    /account (Profil)
     app/[locale]/messages/layout.tsx   /messages, /messages/** (shared: a tutor gets the AppShell)
   /live/[id] is NOT under any of them: the live room stays full-screen.

   ── WHAT IS DIFFERENT FROM THE PROF SHELL ───────────────────────────────────
   • the nav: packages/shared/src/student-shell.ts + components/app/student-nav.tsx
     (Accueil · APPRENDRE · ÉCHANGER · COMPTE), its badges read the student counts
     (upcoming classes, new fiches, unread messages — contract C4);
   • the phone: five tabs (Accueil · Cours · Profs · Fiches · Messages), no « + »;
     Profil is reached through the AVATAR, which sits in the phone's top bar and opens
     the same menu as the sidebar card: Profil · Aide · Se déconnecter. The top bar's
     messages button is the Messages tab there, so it shows on wide screens only, and
     the tab carries the unread count instead.
   ══════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Link } from "@/components/Link";
import { Logo } from "@/components/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { useLocale } from "@/components/LocaleProvider";
import { Chat, Help, User } from "@/components/icons";
import { getStudentShellCounts } from "@/app/actions-shell";
import { publicTutorName, studentActiveKey, studentCrumbs, STUDENT_TABS, type StudentShellCounts, type StudentShellInfo } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { ShellContext, type Crumb, type ShellContextValue } from "./ShellContext";
import { NotificationsBell } from "./NotificationsBell";
import { AvatarCard, MeMenuItems, NavList, type MeLink } from "./AppShell";
import { closeOnLeave } from "./disclosure";
import { useFocusRescue } from "./focus-rescue";
import { STUDENT_APP_NAV, STUDENT_ICONS, badgeText } from "./student-nav";

const copy = bilingual({
  fr: {
    space: "Espace élève",
    skip: "Aller au contenu",
    crumbs: "Fil d'Ariane",
    quick: "Navigation rapide",
    messages: "Messages",
    unreadMsgs: (n: number) => (n === 1 ? "1 message non lu" : `${n} messages non lus`),
    me: "Mon compte",
    profile: "Profil",
    help: "Aide",
    logout: "Se déconnecter",
    role: "Élève",
    pilot: "Pilote",
  },
  ar: {
    space: "فضاء التلميذ",
    skip: "امشي للمحتوى",
    crumbs: "وين إنتي",
    quick: "تنقّل سريع",
    messages: "الرسائل",
    unreadMsgs: (n: number) => `${n} رسالة موش مقروية`,
    me: "حسابي",
    profile: "حسابي",
    help: "مساعدة",
    logout: "اخرج من حسابك",
    role: "تلميذ",
    pilot: "تجربة",
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

/** "Élève · Pilote" — the role, and the pilot while payments are off (GET /student/shell). */
function roleLine(student: StudentShellInfo | null, c: Copy): string {
  return student?.pilot === false ? c.role : `${c.role} · ${c.pilot}`;
}

/* ── the phone's avatar (top bar): Profil · Aide · Se déconnecter ───────────────
   The sidebar's avatar card is not on a phone; this is the same menu, reached the same
   way — a tap on the avatar. A plain disclosure like the card's: the menu follows its
   button (Tab goes into it), Escape gives focus back, focus or a tap leaving closes it. */
function TopAvatar({ initials, name, links, c }: { initials: string; name: string; links: MeLink[]; c: Copy }) {
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
    <div ref={wrapRef} className="aps-pop-wrap aps-st-narrow" onBlur={(e) => closeOnLeave(e, () => setOpen(false))}>
      <button
        ref={btnRef}
        type="button"
        className="aps-tool aps-st-avatar"
        aria-label={`${c.me} · ${name}`}
        aria-expanded={open}
        aria-controls="aps-me-menu-top"
        onClick={() => setOpen((v) => !v)}
        data-e2e="shell-me-top"
      >
        <span className="avatar aps-me-av" aria-hidden="true">{initials}</span>
      </button>
      {open && (
        <ul id="aps-me-menu-top" className="aps-pop aps-st-me-menu" data-e2e="shell-me-top-menu">
          <MeMenuItems links={links} logout={c.logout} onClose={() => setOpen(false)} />
        </ul>
      )}
    </div>
  );
}

/* NO PREFETCH on the shell's links, for the AppShell's reason: every page here is
   request-time (the layout reads the session), so a prefetch is a full server render. */

/* ══ THE SHELL ═══════════════════════════════════════════════════════════════ */
export function StudentShell({ student, children }: { student: StudentShellInfo | null; children: ReactNode }) {
  const { locale } = useLocale();
  const c = copy[locale];
  // usePathname() is locale-prefixed (/fr/student); the nav table speaks locale-bare paths.
  const path = (usePathname() ?? "/").replace(/^\/(fr|ar)(?=\/|$)/, "") || "/";
  const activeKey = studentActiveKey(path);

  const [override, setOverride] = useState<Crumb[] | null>(null);
  const crumbs = override ?? studentCrumbs(path, locale);

  // The server already knows the upcoming count; the rest arrives after the first paint.
  const [counts, setCounts] = useState<StudentShellCounts>({ notifications: 0, messages: 0, fiches: 0, upcoming: student?.upcoming ?? 0 });
  const refreshCounts = useCallback(() => {
    getStudentShellCounts().then(setCounts).catch(() => {});
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

  const ctx = useMemo<ShellContextValue>(
    () => ({ shell: null, kind: "student", student, setCrumbs: setOverride, refreshCounts }),
    [student, setOverride, refreshCounts],
  );

  useFocusRescue();

  // "Ahmed M." — the avatar card of image 1. Their own screen, but the same short form everywhere.
  const name = publicTutorName(student?.name) ?? "—";
  const initials = student?.initials ?? "?";
  const meLinks: MeLink[] = [
    { href: "/account", label: c.profile, icon: User },
    { href: "/aide", label: c.help, icon: Help },
  ];
  const msgBadge = badgeText(counts.messages);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="aps aps-student" data-e2e="student-shell">
        <a href="#main" className="skip-link">{c.skip}</a>

        <aside className="aps-side" data-e2e="shell-sidebar">
          <Link prefetch={false} href="/student" className="aps-brand" aria-label="Tnajem">
            <Logo variant="full" height={30} />
          </Link>
          <nav aria-label={c.space} className="aps-nav">
            <NavList nav={STUDENT_APP_NAV} data={counts} activeKey={activeKey} idPrefix="aps-side" />
          </nav>
          <AvatarCard name={name} initials={initials} line={roleLine(student, c)} links={meLinks} meLabel={c.me} logout={c.logout} />
        </aside>

        <div className="aps-body">
          <header className="aps-top" data-e2e="shell-topbar">
            <Link prefetch={false} href="/student" className="aps-top-brand" aria-label="Tnajem">
              <Logo variant="mark" alt="" height={32} />
            </Link>
            <nav aria-label={c.crumbs} className="aps-crumbs" data-e2e="shell-crumbs">
              <ol>
                {crumbs.map((cr, i) => (
                  <li key={`${cr.label}-${i}`}>
                    {cr.href && i < crumbs.length - 1 ? (
                      <Link prefetch={false} href={cr.href}><bdi>{cr.label}</bdi></Link>
                    ) : (
                      <span aria-current={i === crumbs.length - 1 ? "page" : undefined}><bdi>{cr.label}</bdi></span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>
            <div className="aps-tools">
              <LocaleToggle compact />
              <Link prefetch={false}
                href="/messages"
                className="aps-tool aps-st-wide"
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
              <TopAvatar initials={initials} name={name} links={meLinks} c={c} />
            </div>
          </header>

          <main id="main" tabIndex={-1} className="aps-main">
            {children}
          </main>
        </div>

        <nav className="aps-tabs aps-st-tabs" aria-label={c.quick} data-e2e="shell-tabs">
          {STUDENT_TABS.map((tab) => {
            const Icon = STUDENT_ICONS[tab.key];
            const href = STUDENT_APP_NAV.flatMap((g) => g.items).find((i) => i.key === tab.key)?.href ?? "/student";
            const badge = tab.key === "messages" ? msgBadge : null;
            return (
              <Link prefetch={false}
                key={tab.key}
                href={href}
                className="aps-tab"
                aria-current={activeKey === tab.key ? "page" : undefined}
                data-e2e={`tab-${tab.key}`}
              >
                <span className="aps-st-tab-ic">
                  <Icon />
                  {badge && (
                    <span className="aps-count" aria-hidden="true" data-e2e={`tab-badge-${tab.key}`}>
                      {counts.messages > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>
                <span>{tab.label[locale]}</span>
                {badge && <span className="sr-only">, {c.unreadMsgs(counts.messages)}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
    </ShellContext.Provider>
  );
}
