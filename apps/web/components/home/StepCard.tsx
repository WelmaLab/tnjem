/* home v2 · A — one step of « En 4 étapes, c'est simple. »: the number in a cobalt
   disc, the icon in a soft-blue disc, the title (h3) and one line of text.

   Place them in `<ol className="hv2-steps">`, one `<li>` per card: one column on a
   phone, two from 640px, four in a row from 1024px. `arrow` draws the dashed arrow
   to the NEXT card, centred in the gap (--hv2-step-gap); it only shows from 1024px
   (below, the next card is not beside this one) and is mirrored in Arabic. Pass it
   on every card but the last.

   The number is hidden from assistive tech: the <ol> already says « 1 of 4 », and
   « 1 1 Cherche ton prof » is noise. Not interactive, so no hover lift (a lift on
   static content reads as a broken link). Server component. */
import type { ReactNode } from "react";

export function StepCard({ n, icon, title, text, arrow }: { n: number; icon: ReactNode; title: string; text: string; arrow?: boolean }) {
  return (
    <div className="u-card u-card-pad hv2-step">
      <div className="hv2-step-head">
        <span className="hv2-step-n" aria-hidden="true">
          {n}
        </span>
        <span className="hv2-step-ic" aria-hidden="true">
          {icon}
        </span>
      </div>
      <h3 className="hv2-step-t">{title}</h3>
      <p className="hv2-step-p">{text}</p>
      {arrow && (
        <svg viewBox="0 0 20 12" className="hv2-step-arrow" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6h11" strokeDasharray="2 3" />
            <path d="M14 1.8 18.4 6 14 10.2" />
          </g>
        </svg>
      )}
    </div>
  );
}
