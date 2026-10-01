/* THE PRICE CALCULATION — Espace prof v2 · Phase 5 · contract C6.

   THE ONE place a price with a promotion is computed. The storefront, the class
   page, Explore cards, the checkout, the monthly offers, the teacher's live
   preview (Promotions, and the new-class form's promo hint in Phase 6) and the API
   when it records a booking ALL call priceWithPromotion(), so what a student is
   shown and what is recorded can never disagree. Pure, dependency-free, safe in
   the barrel and on the client.

   THE RULES (spec P5.B):
     • 20 % MAXIMUM. Re-enforced here — a promotion row claiming 25 % is clamped
       to 20 — on top of the database CHECK and the Zod schema. Below 1 % (or not a
       number) it does not apply at all.
     • NO STACKING. Of the promotions that apply, only the BEST single one is used
       (the lowest resulting price; ties → the higher percent, then the one ending
       first, then the id, so the choice is deterministic).
     • Rounded to 0.5 TND (to the nearest), in integer millimes — never a float
       sum, money is counted in the smallest unit.
     • Never below 1 TND, and never ABOVE the base price: a free item (0 TND) or
       one already at or under 1 TND is not discounted. A discount that rounds to
       nothing (1 % of 10 TND) is not a promotion — no badge, no use consumed.

   WHICH PROMOTIONS APPLY: live (active, not ended, started, not past ends_at, uses
   left), the right scope (all · class · pack · monthly, with target_id naming one
   item or, for monthly, none = every offer), and either public (no code) or
   matching the code the visitor brought (?promo=CODE, case-insensitive). */

export const PROMO_PERCENT_MIN = 1;
export const PROMO_PERCENT_MAX = 20;
export const PRICE_STEP_TND = 0.5;
export const PRICE_FLOOR_TND = 1;

export const PROMO_SCOPES = ["all", "class", "pack", "monthly"] as const;
export type PromoScope = (typeof PROMO_SCOPES)[number];

/** Anything with a price: a class (per session), a pack, or a monthly offer. */
export type PricedItem = { kind: "class" | "pack" | "monthly"; id: string; priceTnd: number };

/** The fields the calculation reads. API rows, public DTOs and form previews all fit. */
export type PromotionLike = {
  id: string;
  percent: number;
  scope: PromoScope | string;
  targetId?: string | null;
  code?: string | null;
  startsAt?: string | Date | null;
  endsAt: string | Date;
  maxUses?: number | null;
  uses?: number | null;
  /** false = paused. Absent = active (public DTOs only carry live ones). */
  active?: boolean | null;
  endedAt?: string | Date | null;
};

export type PriceQuote<P extends PromotionLike = PromotionLike> = {
  baseTnd: number;
  finalTnd: number;
  /** The percent actually applied (≤ 20), 0 when no promotion applies. */
  percent: number;
  savedTnd: number;
  promotion: P | null;
  /** ISO end of the applied promotion, for "jusqu'au DD/MM/YYYY". */
  endsAt: string | null;
};

const ms = (d: string | Date | null | undefined): number => (d == null ? NaN : new Date(d).getTime());

/** "rentree-15" → "RENTREE-15"; null when it cannot be a code (3–20 of A–Z 0–9 -). */
export function normalizePromoCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return /^[A-Z0-9-]{3,20}$/.test(v) ? v : null;
}

/** Usable right now: active, not ended, inside its window, uses left, a valid percent. */
export function promotionIsLive(p: PromotionLike, now: Date = new Date()): boolean {
  const t = now.getTime();
  if (p.active === false || p.endedAt) return false;
  if (!Number.isFinite(p.percent) || p.percent < PROMO_PERCENT_MIN) return false;
  const start = ms(p.startsAt);
  if (Number.isFinite(start) && start > t) return false;
  const end = ms(p.endsAt);
  if (!Number.isFinite(end) || end <= t) return false;
  if (p.maxUses != null && (p.uses ?? 0) >= p.maxUses) return false;
  return true;
}

/** Does this promotion's scope cover this item? "all" is everything the tutor
    sells — classes, packs and monthly offers. */
export function promotionCovers(p: PromotionLike, item: Pick<PricedItem, "kind" | "id">): boolean {
  if (p.scope === "all") return true;
  if (p.scope === "monthly") return item.kind === "monthly" && (!p.targetId || p.targetId === item.id);
  return p.scope === item.kind && p.targetId === item.id;
}

/** The discounted price: percent clamped to ≤ 20, rounded to 0.5 TND, ≥ 1 TND, ≤ base. */
export function discountedPrice(baseTnd: number, percent: number): number {
  if (!Number.isFinite(baseTnd) || baseTnd <= 0) return Number.isFinite(baseTnd) ? Math.max(0, baseTnd) : 0;
  if (!Number.isFinite(percent) || percent < PROMO_PERCENT_MIN) return baseTnd;
  const pct = Math.min(Math.trunc(percent), PROMO_PERCENT_MAX);
  const baseM = Math.round(baseTnd * 1000);
  const rawM = (baseM * (100 - pct)) / 100;
  const stepM = PRICE_STEP_TND * 1000;
  const roundedM = Math.round(rawM / stepM) * stepM;
  const flooredM = Math.max(roundedM, PRICE_FLOOR_TND * 1000);
  return Math.min(flooredM, baseM) / 1000;
}

/** The ONE price with a promotion. `code` = what the visitor brought (?promo=CODE). */
export function priceWithPromotion<P extends PromotionLike>(
  item: PricedItem,
  promotions: readonly P[],
  opts: { now?: Date; code?: string | null } = {},
): PriceQuote<P> {
  const base = Number.isFinite(item.priceTnd) ? Math.max(0, item.priceTnd) : 0;
  const none: PriceQuote<P> = { baseTnd: base, finalTnd: base, percent: 0, savedTnd: 0, promotion: null, endsAt: null };
  const now = opts.now ?? new Date();
  const code = normalizePromoCode(opts.code);
  let best: { p: P; final: number; pct: number } | null = null;
  for (const p of promotions) {
    if (!promotionIsLive(p, now) || !promotionCovers(p, item)) continue;
    if (p.code && normalizePromoCode(p.code) !== code) continue; // a private code, not the one brought
    const final = discountedPrice(base, p.percent);
    if (final >= base) continue; // rounds to nothing: not a promotion
    const pct = Math.min(Math.trunc(p.percent), PROMO_PERCENT_MAX);
    if (
      !best ||
      final < best.final ||
      (final === best.final && pct > best.pct) ||
      (final === best.final && pct === best.pct && ms(p.endsAt) < ms(best.p.endsAt)) ||
      (final === best.final && pct === best.pct && ms(p.endsAt) === ms(best.p.endsAt) && p.id < best.p.id)
    ) {
      best = { p, final, pct };
    }
  }
  if (!best) return none;
  const endsAt = new Date(best.p.endsAt).toISOString();
  return {
    baseTnd: base,
    finalTnd: best.final,
    percent: best.pct,
    savedTnd: Math.round((base - best.final) * 1000) / 1000,
    promotion: best.p,
    endsAt,
  };
}

/** Why a code a visitor brought does not apply — for the calm message (never an error). */
export type PromoCodeState = "ok" | "invalid" | "expired" | "not-started" | "exhausted" | "paused";

export function promoCodeState(p: PromotionLike | null | undefined, now: Date = new Date()): PromoCodeState {
  if (!p) return "invalid";
  if (p.endedAt || ms(p.endsAt) <= now.getTime()) return "expired";
  if (p.active === false) return "paused";
  if (Number.isFinite(ms(p.startsAt)) && ms(p.startsAt) > now.getTime()) return "not-started";
  if (p.maxUses != null && (p.uses ?? 0) >= p.maxUses) return "exhausted";
  return "ok";
}
