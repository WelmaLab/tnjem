"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PublicPromotion } from "@tnajem/shared";

/* THE VISITOR'S PROMO CODE, per tutor — Espace prof v2 · Phase 5.

   /{slug}?promo=CODE is an ISR page: the code is the visitor's, so it is checked
   in their browser (PromoCodeBanner → GET /tutors/:slug/pricing?code=) and kept
   here. Every <PromoPrice> of that tutor re-prices from it, and the checkout reads
   it back (sessionStorage, this tab only) so the code a student arrived with is the
   one their booking carries. It is only a HINT: the API re-checks the code when it
   records the booking, and a code that stopped working is refused there, calmly. */

type Applied = { code: string; promotion: PublicPromotion } | null;
const applied = new Map<string, Applied>();
const listeners = new Set<() => void>();
const key = (slug: string) => `tnajem:promo:${slug}`;

export function setAppliedPromo(slug: string, entry: Applied): void {
  applied.set(slug, entry);
  try {
    if (entry) sessionStorage.setItem(key(slug), entry.code);
    else sessionStorage.removeItem(key(slug));
  } catch {
    /* storage blocked — the code still applies on this page */
  }
  for (const l of listeners) l();
}

export function storedPromoCode(slug: string): string | null {
  try {
    return sessionStorage.getItem(key(slug));
  } catch {
    return null;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useAppliedPromo(slug: string | null | undefined): Applied {
  return useSyncExternalStore(
    subscribe,
    () => (slug ? applied.get(slug) ?? null : null),
    () => null,
  );
}

/** "Now", hydration-safe: the instant the cached HTML was rendered, then the real
    clock once mounted (a promotion can end while a page sits in the ISR cache). */
export function useNow(renderedAt?: string | null): Date {
  const [now, setNow] = useState(() => (renderedAt ? new Date(renderedAt) : new Date()));
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
