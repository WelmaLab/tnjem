"use client";
import { useEffect, useState } from "react";
import { Info } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import {
  CANCEL_FREE_WINDOW_HOURS, CANCEL_FREE_WINDOW_MS, CANCEL_GRACE_MINUTES, CANCEL_GRACE_MIN_LEAD_MINUTES,
  CANCEL_GRACE_MS, CANCEL_GRACE_MIN_LEAD_MS, LATE_CANCEL_RETAINED_PCT,
} from "@tnajem/shared";

/* live-fixes-3 · C — « Cette séance est dans moins de 48 h : après 15 min, une
   annulation compte 40 % pour le prof. »

   Said BEFORE the student confirms, on the checkout and on the storefront, when the
   class is already inside the 48 h window — so the grace after booking is the only
   free cancellation left (@tnajem/shared/cancellation). Every number comes from the
   rule itself.

   A CLIENT ISLAND because it depends on "now": the storefront is ISR (cached HTML for
   everybody), so the server cannot decide it. Nothing renders until the browser has
   checked the clock — the server HTML never carries it, so there is no mismatch.

   PAYMENTS ARE OFF: « compte 40 % pour le prof » is the share the cancellation ledger
   RECORDS, never a charge. `pilotLine` adds the « rien n'est prélevé » sentence where
   nothing next to the note says it already (the storefront; the checkout's rule box
   right above it does). A seat that costs nothing (a 0 TND class, a seat the monthly
   subscription covers) retains nothing: no note. */

const H = CANCEL_FREE_WINDOW_HOURS;
const G = CANCEL_GRACE_MINUTES;
const GL = CANCEL_GRACE_MIN_LEAD_MINUTES;
const PCT = Math.round(LATE_CANCEL_RETAINED_PCT * 100);

const copy = bilingual({
  fr: {
    note: `Cette séance est dans moins de ${H} h : après ${G} min, une annulation compte ${PCT} % pour le prof.`,
    /* Within 30 min of the start the grace is cut short (it never reaches into the last
       15 min), so « après 15 min » would overstate it. */
    soon: `Cette séance commence bientôt : à partir de ${GL} min avant le début, une annulation compte ${PCT} % pour le prof.`,
    pilot: "Rien n'est prélevé pendant le pilote.",
  },
  ar: {
    note: `الحصة هاذي في أقل من ${H} ساعة : بعد ${G} دقيقة، الإلغاء يتحسب ⁦${PCT} %⁩ للأستاذ.`,
    soon: `الحصة هاذي قريب تبدا : من ${GL} دقيقة قبل البداية، الإلغاء يتحسب ⁦${PCT} %⁩ للأستاذ.`,
    pilot: "ما يتخصم حتى مليم في فترة التجربة.",
  },
});

export function LateCancelNote({
  startsAt,
  priceTnd,
  locale,
  pilotLine = false,
  className,
}: {
  /** The class start, ISO. */
  startsAt: string;
  /** What this seat would cost: 0 (free class, covered seat) → nothing is ever retained → no note. */
  priceTnd: number;
  locale: "fr" | "ar";
  pilotLine?: boolean;
  className?: string;
}) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const at = Date.parse(startsAt);
    const tick = () => setLeft(at - Date.now());
    tick();
    // The page can stay open while the class crosses the 48 h mark.
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [startsAt]);

  if (left === null || !Number.isFinite(left) || left <= 0 || left >= CANCEL_FREE_WINDOW_MS || !(priceTnd > 0)) return null;
  const c = copy[locale];
  const text = left > CANCEL_GRACE_MS + CANCEL_GRACE_MIN_LEAD_MS ? c.note : c.soon;
  return (
    <div className={`note-info lcn${className ? ` ${className}` : ""}`} data-e2e="late-cancel-note">
      <Info />
      <p>
        {text}
        {pilotLine && <> {c.pilot}</>}
      </p>
    </div>
  );
}
