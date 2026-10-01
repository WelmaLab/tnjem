"use client";
import { useEffect, useState } from "react";
import { formatNumericDate } from "@tnajem/shared";
import { Info } from "@/components/icons";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";
import { getTutorPricing } from "@/app/actions-growth";
import { setAppliedPromo, storedPromoCode } from "./promo-store";

/* ?promo=CODE — Espace prof v2 · Phase 5.

   The link a tutor shares from Promotions (/{slug}?promo=CODE). The page is ISR,
   so the code is read HERE, in the browser, checked against the API (rate-limited
   per address) and, if it applies, handed to every <PromoPrice> of this tutor and
   kept for the checkout. A code that does not apply — expired, unknown, used up,
   not started, paused — gets ONE CALM LINE and the normal price stays bookable: a
   stale link is not an error the visitor caused. Information, so blue (.note-info).

   Without ?promo= it quietly re-applies a code this tab already validated for this
   tutor (the class page and back), and renders nothing when there is none. */

const copy = bilingual({
  fr: {
    ok: (code: string, pct: number, end: string) => `Code ${code} appliqué : −${pct} % jusqu'au ${end}.`,
    expired: "Ce code promo a expiré — le prix normal reste réservable.",
    invalid: "Ce code promo n'est pas valable — le prix normal reste réservable.",
    exhausted: "Ce code promo a déjà servi autant de fois que prévu — le prix normal reste réservable.",
    notStarted: "Ce code promo n'est pas encore actif — le prix normal reste réservable.",
    paused: "Ce code promo est en pause pour l'instant — le prix normal reste réservable.",
  },
  ar: {
    ok: (code: string, pct: number, end: string) => `الكود ${code} تطبّق : \u2066−${pct} %\u2069 حتى لـ ${end}.`,
    expired: "الكود هذا وفى وقتو — تنجّم تحجز بالسوم العادي.",
    invalid: "الكود هذا موش صالح — تنجّم تحجز بالسوم العادي.",
    exhausted: "الكود هذا تستعمل قدّ ما كان مبرمج — تنجّم تحجز بالسوم العادي.",
    notStarted: "الكود هذا مازال ما بداش — تنجّم تحجز بالسوم العادي.",
    paused: "الكود هذا موقّف توّا — تنجّم تحجز بالسوم العادي.",
  },
});

export function PromoCodeBanner({ slug, className }: { slug: string; className?: string }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [line, setLine] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("promo");
    const code = fromUrl ?? storedPromoCode(slug);
    if (!code) return;
    let alive = true;
    getTutorPricing(slug, code)
      .then((res) => {
        if (!alive) return;
        const r = res?.code;
        if (r?.state === "ok" && r.promotion) {
          setAppliedPromo(slug, { code: r.promotion.code ?? code.toUpperCase(), promotion: r.promotion });
          setState("ok");
          setLine(c.ok(r.promotion.code ?? code.toUpperCase(), r.promotion.percent, formatNumericDate(r.promotion.endsAt)));
          return;
        }
        setAppliedPromo(slug, null);
        if (!fromUrl) return; // a remembered code that lapsed: nothing to say, it simply stops applying
        const s = r?.state ?? "invalid";
        setState(s);
        setLine(s === "expired" ? c.expired : s === "exhausted" ? c.exhausted : s === "not-started" ? c.notStarted : s === "paused" ? c.paused : c.invalid);
      })
      .catch(() => {
        /* the pricing check failed: the normal price shows, as it would anyway */
      });
    return () => {
      alive = false;
    };
  }, [slug, c]);

  if (!line) return null;
  return (
    <div className={`note-info pcb${className ? ` ${className}` : ""}`} role="status" data-e2e="promo-banner" data-state={state ?? undefined}>
      <Info />
      <p>{line}</p>
    </div>
  );
}
