import { and, asc, eq, inArray, isNull, classes, tutorOffers } from "@tnajem/db";
import { priceWithPromotion, type PublicOffer, type PublicPromotion } from "@tnajem/shared";
import { db } from "../db";
import { onSaleClassSql } from "./class-sale";
import { livePublicPromotions, toPublicPromotion } from "./promotions";

/* What Phase 5 adds to the PUBLIC, ANONYMOUS reads (Espace prof v2 · growth).

   Both feed ISR-cached pages, so both are the same for every visitor on Earth:
   the active monthly offers, and the live PUBLIC promotions (no code — a code is
   the visitor's own and is resolved in their browser, GET /tutors/:slug/pricing).
   A promotion that ends while a page sits in the cache is re-checked at render
   AND in the browser (pricing.ts compares against the clock), and every promotion
   write busts the storefront and the /explore list. */

export async function storefrontGrowthExtras(tutorId: string): Promise<{ offers: PublicOffer[]; promotions: PublicPromotion[] }> {
  const [offers, promos] = await Promise.all([
    db.select().from(tutorOffers)
      .where(and(eq(tutorOffers.tutorId, tutorId), eq(tutorOffers.active, true), isNull(tutorOffers.archivedAt)))
      .orderBy(asc(tutorOffers.priceTndPerMonth)),
    livePublicPromotions(db, [tutorId]),
  ]);
  return {
    offers: offers.map((o) => ({
      id: o.id,
      title: o.title,
      sessions_per_month: o.sessionsPerMonth,
      price_tnd: Number(o.priceTndPerMonth),
    })),
    promotions: promos.map((p) => toPublicPromotion(p)),
  };
}

/** /explore: per tutor, the cheapest bookable class AFTER the best public promotion —
    when a promotion actually lowers the "from" price. */
export async function explorePromoPrices(tutorIds: string[]): Promise<Map<string, { final_tnd: number; percent: number; ends_at: string }>> {
  const out = new Map<string, { final_tnd: number; percent: number; ends_at: string }>();
  if (tutorIds.length === 0) return out;
  const promos = await livePublicPromotions(db, tutorIds);
  if (promos.length === 0) return out;
  const withPromo = [...new Set(promos.map((p) => p.tutorId))];
  const rows = await db
    .select({ id: classes.id, tutorId: classes.tutorId, price: classes.priceTnd })
    .from(classes)
    .where(and(inArray(classes.tutorId, withPromo), onSaleClassSql)) // the same "on sale" the price_from uses
    .limit(2000);
  const now = new Date();
  const best = new Map<string, { base: number; final: number; percent: number; endsAt: string | null }>();
  for (const c of rows) {
    const q = priceWithPromotion({ kind: "class", id: c.id, priceTnd: Number(c.price) }, promos.filter((p) => p.tutorId === c.tutorId), { now });
    const cur = best.get(c.tutorId);
    if (!cur || q.finalTnd < cur.final) best.set(c.tutorId, { base: q.baseTnd, final: q.finalTnd, percent: q.percent, endsAt: q.endsAt });
  }
  for (const [tutorId, b] of best) {
    if (b.percent > 0 && b.endsAt) out.set(tutorId, { final_tnd: b.final, percent: b.percent, ends_at: b.endsAt });
  }
  return out;
}
