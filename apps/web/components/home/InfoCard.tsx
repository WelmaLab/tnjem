/* home v2 · A — one card of « 3 choses à savoir avant de réserver. »: a tinted icon
   tile, the title (h3), the text, and an optional « Bientôt » row pinned to the
   card's foot (so the rows line up across a row of cards).

   Tones reuse the system's tint pairs: green = --green50 / --green-ink, blue =
   --blue50 / --blue, ochre = --ochre-tint / --ochre-ink. `children` may be text or
   paragraphs. `soon.label` is the « Bientôt » / « قريب » word, drawn as the system's
   « soon » tag (ochre, with the clock); `soon.text` is the sentence beside it.

   Payments: the payment sentence is PaymentStory's (components/PaymentStory.tsx).
   It already draws its own « Bientôt » tag and carries data-payment-story, which the
   e2e crawl looks for — so either pass the sentence alone as `soon.text` and keep
   the data-payment-story contract some other way, or render <PaymentStory/> in
   `children` and leave `soon` out. Never both: two « Bientôt » on one card.
   Server component. */
import type { ReactNode } from "react";
import { Tag } from "@/components/ui";

const TONE_CLASS = { green: "is-green", blue: "is-blue", ochre: "is-ochre" } as const;

export function InfoCard({
  icon,
  tone,
  title,
  children,
  soon,
}: {
  icon: ReactNode;
  tone: "green" | "blue" | "ochre";
  title: string;
  children: ReactNode;
  soon?: { label: string; text: ReactNode };
}) {
  return (
    <div className="u-card u-card-pad hv2-info">
      <span className={`hv2-info-ic ${TONE_CLASS[tone]}`} aria-hidden="true">
        {icon}
      </span>
      <h3 className="hv2-info-t">{title}</h3>
      <div className="hv2-info-body">{children}</div>
      {soon && (
        <div className="hv2-info-soon">
          <Tag kind="soon">{soon.label}</Tag>
          <span className="hv2-info-soon-t">{soon.text}</span>
        </div>
      )}
    </div>
  );
}
