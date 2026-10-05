"use client";
import { Link } from "@/components/Link";
import { Logo } from "@/components/Logo";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "./LocaleProvider";
import { LocaleToggle } from "./LocaleToggle";
import { useRoleHint } from "./role-hint";

/* The coarse role for nav, read from the readable ROLE_HINT_COOKIE (lib/auth.ts).
   This REPLACES a getMe() server-action POST that used to fire on every page load —
   which meant every perfectly-cached page still dragged an uncacheable POST behind
   it for every visitor (SCALABILITY.md / launch brief Phase 2). Reading a cookie is
   zero network. It is a display hint only: a stale/forged value at worst shows a nav
   link that bounces to /auth (middleware) — every action re-checks the real session.
   student-space-v1 · A: the reader lives in ./role-hint.ts, shared with the footer. */

/* Header copy is page-local (lib/i18n.ts is shared and read-only for agents).
   Nav labels say WHAT you get, not where you go: "Trouver un prof" beats
   "Explorer", "Pour les profs" beats a second copy of the signup CTA. The two
   audiences (students/parents · tutors) are the two nav items — that is the
   whole information architecture of the product in one row. */
const NAV = {
  fr: {
    findTutor: "Trouver un prof",
    forTutors: "Pour les profs",
    signIn: "Se connecter",
    createPage: "Créer ma page",
    mySpace: "Mon espace",
    dashboard: "Tableau de bord",
    messages: "Messages",
    guardianArea: "Espace parent",
    account: "Mon profil",
    becomeTutor: "Devenir prof",
    menu: "Menu",
    closeMenu: "Fermer le menu",
    nav: "Navigation principale",
    gStudents: "Élèves & parents",
    gTutors: "Profs",
  },
  ar: {
    findTutor: "لقّي أستاذ",
    forTutors: "للأساتذة",
    signIn: "دخول",
    createPage: "اعمل صفحتك",
    mySpace: "فضائي",
    dashboard: "لوحتي",
    messages: "الرسائل",
    guardianArea: "فضاء الولي",
    account: "حسابي",
    becomeTutor: "ولّي أستاذ",
    menu: "القائمة",
    closeMenu: "سكّر القائمة",
    nav: "التنقّل الرئيسي",
    gStudents: "تلامذة وأولياء",
    gTutors: "أساتذة",
  },
} as const;

/* Page-scoped CSS (`qh-`), injected with dangerouslySetInnerHTML — an inline
   <style>{`…`}</style> in a client component triggers hydration errors. It is
   UNLAYERED, so it beats globals.css's @layer components without !important.

   Fixes it carries:
   • `.hide-mobile` was applied to the header CTA; globals sets it to
     `display:revert` ≥768px, which reverts an <a> to `display:inline` and kills
     the .btn flex box (no gap, no 44px min-height). We use `qh-only-wide` instead.
   • 320px overflow: brand + full FR/AR toggle + burger overflowed the flex row.
     The toggle is `compact` and the Arabic wordmark hides under 420px.
   • The dropdown gets a max-height + scroll so a long menu can't exceed the
     viewport, and logical properties keep it RTL-correct. */
const CSS = `
/* min-height:44px — as a link this is a tap target, and it measured 86x34. */
.qh-brand{min-width:0;flex:none;min-height:44px}
@media (max-width:419px){
  .site-header .qh-brand{font-size:17px;gap:8px}
  /* Scale by height and let width follow the intrinsic ratio from the img's
     width/height attributes — that keeps the box reserved, so shrinking the
     mark on small screens costs no layout shift. */
  .site-header .qh-brand img{height:32px;width:auto}
  .site-header .qh-brand .ar{display:none}
}
.qh-nav{display:none;align-items:center;gap:22px;font-weight:600;font-size:14.5px;min-width:0}
.qh-nav a{color:var(--ink2);transition:.15s;white-space:nowrap;padding:6px 2px;border-radius:8px}
.qh-nav a:hover{color:var(--blue)}
.qh-nav a[aria-current="page"]{color:var(--ink);box-shadow:inset 0 -2px 0 var(--ochre)}
.qh-right{display:flex;align-items:center;gap:8px;margin-inline-start:auto;min-width:0}
.qh-signin{display:none;font-weight:700;font-size:14px;color:var(--ink2);white-space:nowrap;
  padding:10px 10px;border-radius:10px;min-height:44px;align-items:center}
.qh-signin:hover{color:var(--blue)}
.qh-cta{display:none!important}
.qh-burger{display:grid;place-items:center;width:44px;height:44px;border-radius:11px;
  border:1px solid var(--line);background:var(--paper);cursor:pointer;color:var(--ink);flex:none}
@media (min-width:600px){ .qh-cta{display:inline-flex!important} }
/* 1024, not 900: at 900–1023px the brand + 2 nav links + toggle + sign-in + CTA
   overflow the 64px row. Below that the burger carries every destination. */
@media (min-width:1024px){
  .qh-nav{display:flex}
  .qh-signin{display:inline-flex}
  .qh-burger{display:none}
}
/* mobile dropdown */
.qh-menu{position:absolute;inset-block-start:100%;inset-inline:0;background:var(--paper);
  border-block-end:1px solid var(--line);box-shadow:var(--sh);display:flex;flex-direction:column;
  padding:10px;z-index:51;max-height:calc(100vh - 64px);overflow-y:auto;gap:2px}
.qh-menu .qh-group{font-size:13px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;
  color:var(--muted);padding:12px 12px 6px}
.qh-menu a{display:flex;align-items:center;gap:10px;padding:13px 12px;border-radius:11px;
  font-weight:600;font-size:15px;color:var(--ink);min-height:48px}
.qh-menu a:hover,.qh-menu a:focus-visible{background:var(--blue50);color:var(--blue)}
.qh-menu a[aria-current="page"]{background:var(--sand);color:var(--ink)}
/* Phase A+ (U2): the menu's CTA is the same cobalt outline as the header's. */
.qh-menu .qh-menu-cta{justify-content:center;background:transparent;color:var(--blue);border:1.5px solid var(--blue);margin-top:8px}
.qh-menu .qh-menu-cta:hover{background:var(--blue50);color:var(--blue)}
.qh-menu .qh-sep{height:1px;background:var(--line);margin:8px 4px}
html[dir="rtl"] .qh-menu .qh-group{letter-spacing:normal}
`;

/* Responsive top navigation. Auth-aware (student-space-v1 · A, three states): a
   signed-in student gets « Mon espace » (→ /student), a prof « Tableau de bord », a
   parent « Espace parent »; nobody signed in is offered « Se connecter » — logged out,
   the header is exactly as before. On phones every destination collapses into a grouped
   hamburger menu — grouped by audience, so a first-time visitor sees which half
   of the product is theirs. */
export function SiteHeader() {
  const { locale } = useLocale();
  const c = NAV[locale];
  const pathname = usePathname();
  const role = useRoleHint();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);

  // The role is read after hydration (useRoleHint): the server render is auth-agnostic, so the HTML stays cacheable.

  // Close on navigation.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Escape closes and returns focus; a click outside closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); }
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // /fr/explore → /explore, so aria-current works in both locales.
  const path = (pathname ?? "/").replace(/^\/(fr|ar)(?=\/|$)/, "") || "/";
  const cur = (href: string) => (path === href ? "page" : undefined);

  const isTutor = role === "tutor";
  const isStudent = role === "student";

  return (
    <header className="site-header">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="container">
        <Link href="/" className="brand-mark qh-brand" aria-label="Tnajem">
          <Logo variant="full" height={38} priority />
        </Link>

        <nav className="qh-nav" aria-label={c.nav}>
          <Link href="/explore" aria-current={cur("/explore")}>{c.findTutor}</Link>
          <Link href="/pour-les-profs" aria-current={cur("/pour-les-profs")}>{c.forTutors}</Link>
        </nav>

        <div className="qh-right">
          <LocaleToggle compact />

          {isTutor ? (
            <Link href="/dashboard" className="btn btn-outline btn-sm qh-cta" data-e2e="header-space">{c.dashboard}</Link>
          ) : isStudent ? (
            <Link href="/student" className="btn btn-outline btn-sm qh-cta" data-e2e="header-space">{c.mySpace}</Link>
          ) : role === "guardian" ? (
            <Link href="/guardian" className="btn btn-outline btn-sm qh-cta" data-e2e="header-space">{c.guardianArea}</Link>
          ) : (
            <>
              <Link href="/auth" className="qh-signin" data-e2e="header-signin">{c.signIn}</Link>
              {/* SIGNUP, not /onboarding. This CTA used to point straight at the
                  tutor's step-1 screen, which was reachable by any signed-in
                  profile and silently converted a student's account to a tutor
                  one on submit. The role is now chosen by choosing a page. */}
              {/* Phase A+ (U2): the header is never orange — its CTA is the cobalt outline for
                  everyone, so each page's own main action is the only ochre button in view. */}
              <Link href="/signup/prof" className="btn btn-outline btn-sm qh-cta">{c.createPage}</Link>
            </>
          )}

          <button
            ref={btnRef}
            type="button"
            className="qh-burger"
            aria-label={open ? c.closeMenu : c.menu}
            aria-expanded={open}
            aria-controls="qh-menu"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
              {open
                ? <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>
                : <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></>}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="qh-menu" ref={menuRef} className="qh-menu" aria-label={c.menu} onClick={() => setOpen(false)}>
          <div className="qh-group">{c.gStudents}</div>
          <Link href="/explore" aria-current={cur("/explore")}>{c.findTutor}</Link>
          {isStudent && <Link href="/student" aria-current={cur("/student")}>{c.mySpace}</Link>}

          <div className="qh-group">{c.gTutors}</div>
          <Link href="/pour-les-profs" aria-current={cur("/pour-les-profs")}>{c.forTutors}</Link>
          {isTutor && <Link href="/dashboard" aria-current={cur("/dashboard")}>{c.dashboard}</Link>}

          {/* A signed-in student is offered the DELIBERATE upgrade screen, never
              /onboarding directly — that link was the silent conversion. A visitor
              with no session is offered signup. A tutor is offered neither: they
              already have the page. */}
          {isStudent && (
            <Link href="/onboarding/upgrade" aria-current={cur("/onboarding/upgrade")}>
              {c.becomeTutor}
            </Link>
          )}

          <div className="qh-sep" />
          {/* Step 8b. One entry point for BOTH roles — a thread belongs to a
              booking, and both sides of a booking need to reach it. Not shown to
              signed-out visitors: there is nothing behind it for them. */}
          {role && <Link href="/messages" aria-current={cur("/messages")}>{c.messages}</Link>}
          {/* Step 14. Shown to a GUARDIAN role only. The page itself is harmless
              to anyone else — it lists your children, and a non-parent has none —
              but offering it in the nav to every student would be an invitation
              to a screen that is permanently empty for them. */}
          {role === "guardian" && (
            <Link href="/guardian" aria-current={cur("/guardian")}>{c.guardianArea}</Link>
          )}
          {role
            ? <Link href="/account" aria-current={cur("/account")}>{c.account}</Link>
            : <Link href="/auth" aria-current={cur("/auth")}>{c.signIn}</Link>}
          {!role && (
            <Link href="/signup/prof" className="qh-menu-cta">{c.createPage}</Link>
          )}
        </nav>
      )}
    </header>
  );
}
