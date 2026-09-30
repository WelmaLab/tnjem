/* The frame of the sign-up and sign-in pages — "Option B · brand panel + form"
   (UI_AUTH_OPTION_B.md §1.2). It renders <SiteShell> itself, so a caller must not
   wrap it in another one.

   ≥ 900px  one card: the blue brand panel (~40%) on the inline START side — left
            on /fr, right on /ar, by the grid itself — and the form (~60%).
   < 900px  the card goes full-bleed and the panel collapses to a compact band
            above the form: title + summary only.

   Two structural choices, both about assistive technology:
   - The panel is a plain <div>, not an <aside>. A complementary landmark nested
     inside <main> is an axe violation (landmark-complementary-is-top-level).
   - The FORM comes first in the DOM and the grid places the panel visually. The
     page's H1 (in `children`) is then the first heading a screen reader meets, and
     the panel's H2 sits under it in the outline. The panel holds nothing
     focusable, so the visual order changes no focus order.

   The bottom block is a TRUST NOTE, never a testimonial: no name, no city, no
   quote — nobody has said anything yet, and the product does not invent it. */
import type { ReactNode } from "react";
import { SiteShell } from "@/components/SiteShell";
import { Check, Shield } from "@/components/icons";

export type AuthShellProps = {
  /** Small line above the panel title (rendered uppercase by CSS in FR). */
  eyebrow: string;
  /** The panel's H2. Also the mobile band's title. */
  title: string;
  /** One line under the title, shown in the compact mobile band only. */
  summary: string;
  /** The three check items of the desktop panel. */
  points: readonly string[];
  /** The trust note pinned to the bottom of the desktop panel. */
  trust: string;
  /** The form side: the page's H1 and everything under it. */
  children: ReactNode;
};

export function AuthShell({ eyebrow, title, summary, points, trust, children }: AuthShellProps) {
  return (
    <SiteShell>
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-main">
            <div className="auth-main-inner">{children}</div>
          </div>
          <div className="auth-panel">
            <div className="auth-panel-head">
              <p className="auth-eyebrow">{eyebrow}</p>
              <h2 className="auth-panel-title">{title}</h2>
              <p className="auth-panel-summary">{summary}</p>
              <ul className="auth-points">
                {points.map((p) => (
                  <li key={p}>
                    <span className="auth-tick" aria-hidden="true"><Check /></span>
                    <span className="min-w-0">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="auth-trust">
              <Shield />
              <p>{trust}</p>
            </div>
          </div>
        </div>
      </div>
    </SiteShell>
  );
}
