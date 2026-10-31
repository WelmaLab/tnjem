/* home v2 · A — the trust row under the hero CTA: an icon and a short label that
   wraps onto (about) two lines, four items. A list, inside a size container: the
   row is 2 × 2 in a narrow column and one line of four from 520px of its OWN width
   (globals.css « home v2 · A »), whatever grid it is placed in. `className` goes on
   the outer box (margins, max-width).

   The icon colour is the caller's: --blue by default, or a text utility on the icon
   (e.g. text-green-ink). The icon is decorative; the label carries the meaning.
   Server component. */
import type { ReactNode } from "react";

export function TrustRow({ items, className }: { items: { icon: ReactNode; label: string }[]; className?: string }) {
  return (
    <div className={`hv2-trust-box${className ? ` ${className}` : ""}`}>
      <ul className="hv2-trust">
        {items.map((it) => (
          <li key={it.label}>
            <span className="hv2-trust-ic" aria-hidden="true">
              {it.icon}
            </span>
            <span className="hv2-trust-l">{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
