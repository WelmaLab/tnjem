import type { ReactNode } from "react";
import { SkipLink } from "./SkipLink";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { ChromeGate } from "./app/ShellContext";

/* Full-width responsive web shell (replaces the mobile <Frame> on web-redesigned
   screens). Header + footer are responsive; the page composes its own
   <section className="web-section"><div className="container">…</div></section>.

   espace prof v2 · shell: INSIDE the AppShell (a tutor on a prof page) this renders
   the page alone — no site header, no marketing footer, no second <main>. See
   components/app/ShellContext.tsx. */
export function SiteShell({ children, footer = true }: { children: ReactNode; footer?: boolean }) {
  return (
    <ChromeGate skip={<SkipLink />} header={<SiteHeader />} footer={footer ? <SiteFooter /> : null}>
      {children}
    </ChromeGate>
  );
}
