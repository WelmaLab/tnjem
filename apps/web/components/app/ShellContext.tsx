"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { TutorShell } from "@tnajem/shared";

/* espace prof v2 · shell — the one piece of the AppShell that the PUBLIC chrome
   needs to know about, kept in its own small file so SiteShell can import it
   without pulling the whole shell (sidebar, bell, menus) into every public page.

   Inside an AppShell, <SiteShell> renders its children and nothing else: no site
   header, no marketing footer (rule 2 of image 1). That is what lets the shell sit
   at LAYOUT level — every existing prof page that still wraps itself in <SiteShell>
   loses the public chrome automatically, and so does any page a later team adds. */

export type Crumb = { label: string; href?: string };

export type ShellContextValue = {
  /** The tutor the shell was rendered for (GET /tutor/shell), or null if it could not be read. */
  shell: TutorShell | null;
  /** Replace the top bar's breadcrumbs for the current page (AppPage `crumbs`). null = derived from nav.tsx. */
  setCrumbs: (crumbs: Crumb[] | null) => void;
  /** Re-read the unread counts (bell + messages) — e.g. after marking things read. */
  refreshCounts: () => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The shell context, or null outside a prof page. */
export function useShell(): ShellContextValue | null {
  return useContext(ShellContext);
}

/** True when this render sits inside the AppShell (a tutor on a prof page). */
export function useInAppShell(): boolean {
  return useContext(ShellContext) !== null;
}

/* The public frame, or nothing. skip/header/footer arrive as ELEMENTS from SiteShell
   (which may be a server component), so SkipLink/SiteHeader/SiteFooter stay where
   they were rendered and this file adds no weight to a public page beyond itself.
   Inside the shell the page's content lands straight in the shell's own <main> —
   a second <main> landmark (and a second skip link) would be wrong. */
export function ChromeGate({
  skip,
  header,
  footer,
  children,
}: {
  skip: ReactNode;
  header: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  if (useInAppShell()) return <>{children}</>;
  return (
    <div className="site-shell">
      {skip}
      {header}
      {/* id + tabIndex: the skip link's target must be focusable for the jump to
          actually move focus (not just scroll) in Safari and older Chromium. */}
      <main id="main" tabIndex={-1} className="web-main">{children}</main>
      {footer}
    </div>
  );
}
