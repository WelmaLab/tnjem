"use client";
import { formatNumericDate, priceWithPromotion, type PricedItem, type PublicPromotion } from "@tnajem/shared";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";
import { useAppliedPromo, useNow } from "./promo-store";

/* A PRICE, WITH ITS PROMOTION — Espace prof v2 · Phase 5 (contract C6 on screen).

   The struck-through price, the "−15 %" badge and the end date, wherever a price
   is shown: storefront rows and panel, class page, monthly offers, the mobile bar.
   The number comes from priceWithPromotion() (@tnajem/shared/pricing.ts) — the
   SAME function the API records the booking with — over the tutor's live public
   promotions plus the code this visitor brought (promo-store.ts). No promotion →
   exactly the plain price.

   A client island because the code is the visitor's and the clock moves; it is
   server-rendered with `renderedAt`, so the cached HTML and the first client render
   agree. The badge is blue (information), never ochre (the page's one action) nor
   green (Vérifié and success only). */

const copy = bilingual({
  fr: {
    tnd: "TND",
    perSession: "la séance",
    perMonth: "/ mois",
    until: (d: string) => `jusqu'au ${d}`,
    was: "au lieu de",
    off: (p: number) => `−${p} %`,
  },
  ar: {
    tnd: "د.ت",
    perSession: "للحصة",
    perMonth: "في الشهر",
    until: (d: string) => `حتى لـ ${d}`,
    was: "عوض",
    off: (p: number) => `−${p} %`,
  },
});

export type PromoPriceVariant = "row" | "panel" | "offer" | "bar" | "card";

export function PromoPrice({
  slug,
  item,
  promotions,
  renderedAt,
  variant = "row",
  unit = "session",
}: {
  slug: string;
  item: PricedItem;
  promotions: readonly PublicPromotion[];
  renderedAt?: string | null;
  variant?: PromoPriceVariant;
  unit?: "session" | "month" | "none";
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const code = useAppliedPromo(slug);
  const now = useNow(renderedAt);
  const list = code ? [...promotions, code.promotion] : promotions;
  const q = priceWithPromotion(item, list, { now, code: code?.code ?? null });
  const unitLabel = unit === "session" ? c.perSession : unit === "month" ? c.perMonth : "";

  return (
    <div className={`pp pp-${variant}`} data-e2e="promo-price" data-promo={q.promotion ? String(q.percent) : undefined}>
      {q.promotion && (
        <div className="pp-line">
          <span className="sr-only">{c.was}</span>
          <del className="pp-was" data-e2e="price-was">{q.baseTnd} {c.tnd}</del>
          <span className="pp-badge" dir="ltr" data-e2e="promo-badge">{c.off(q.percent)}</span>
        </div>
      )}
      <div className="pp-amount">
        {q.finalTnd} <span className="pp-cur">{c.tnd}</span>
        {variant === "bar" && unitLabel && <span className="pp-unit"> {unitLabel}</span>}
      </div>
      {variant !== "bar" && (unitLabel || q.endsAt) && (
        <div className="pp-then">
          {unitLabel}
          {q.endsAt && <>{unitLabel ? " · " : ""}{c.until(formatNumericDate(q.endsAt))}</>}
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: PP_CSS }} />
    </div>
  );
}

const PP_CSS = `
  .pp{min-width:0;display:grid;gap:3px;justify-items:start}
  .pp-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .pp-was{font-size:13.5px;color:var(--muted);text-decoration-thickness:1.5px}
  .pp-badge{display:inline-flex;align-items:center;font-size:13px;font-weight:700;line-height:1;
    padding:4px 8px;border-radius:999px;background:var(--blue50);color:var(--blue700);white-space:nowrap}
  .pp-amount{font-family:var(--fd);font-weight:700;font-size:17px;letter-spacing:-.3px;white-space:nowrap;line-height:1.15;color:var(--ink)}
  .pp-cur{font-size:max(13px,.72em);font-weight:600;color:var(--muted)}
  .pp-unit{font-family:var(--fb);font-size:13px;font-weight:600;color:var(--muted)}
  .pp-then{font-size:13px;color:var(--muted);line-height:1.4}
  .pp-panel .pp-amount{font-size:30px;letter-spacing:-.9px}
  .pp-offer .pp-amount{font-size:24px;letter-spacing:-.6px}
  .pp-card .pp-amount{font-size:18px}
`;
