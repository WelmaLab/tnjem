"use client";
import "./SiteHeader.css";
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

/* Page-scoped CSS (`qh-`) lives in ./SiteHeader.css (home v2 · G: it was an inline
   <style> shipped in every page's HTML and in the JS bundle). It is
   UNLAYERED, so it beats globals.css's @layer components without !important.

   Fixes it carries:
   • `.hide-mobile` was applied to the header CTA; globals sets it to
     `display:revert` ≥768px, which reverts an <a> to `display:inline` and kills
     the .btn flex box (no gap, no 44px min-height). We use `qh-only-wide` instead.
   • 320px overflow: brand + full FR/AR toggle + burger overflowed the flex row.
     The toggle is `compact` and the Arabic wordmark hides under 420px.
   • The dropdown gets a max-height + scroll so a long menu can't exceed the
     viewport, and logical properties keep it RTL-correct. */

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
              {/* Phase A+ (U2): the header is never orange, so each page's own main action is
                  the only ochre button in view. home v2 · D: filled cobalt, as in the mockup. */}
              <Link href="/signup/prof" className="btn btn-sm qh-cta qh-cta-fill" data-e2e="header-create">{c.createPage}</Link>
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
