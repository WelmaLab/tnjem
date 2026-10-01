import { and, eq, gt, inArray, isNull, lte, or, sql as raw, promotions } from "@tnajem/db";
import {
  normalizePromoCode, priceWithPromotion, promoCodeState,
  type PricedItem, type PriceQuote, type PromoScope, type PublicPromotion,
} from "@tnajem/shared";
import type { db as appDb } from "../db";

/* Promotions, as the API reads and spends them (Espace prof v2 · Phase 5 B).

   The ARITHMETIC is not here: it is packages/shared/src/pricing.ts (contract C6),
   the same function every page shows a price with. This module only fetches rows,
   maps them to the public shape, and moves `uses` ATOMICALLY:

     claim    UPDATE … SET uses = uses + 1 WHERE live AND (max_uses IS NULL OR
              uses < max_uses) RETURNING — under the row lock, two students racing
              for the last use cannot both get it (the loser is told calmly and
              keeps the normal price);
     release  UPDATE … SET uses = uses - 1 WHERE uses > 0 — when the booking or the
              request that took the discount is cancelled. */

type Q = Pick<typeof appDb, "select" | "update">;
type PromoRow = typeof promotions.$inferSelect;

/** SQL: usable right now (the same rule as pricing.ts::promotionIsLive). */
export const promotionLiveSql = and(
  eq(promotions.active, true),
  isNull(promotions.endedAt),
  lte(promotions.startsAt, raw`now()`),
  gt(promotions.endsAt, raw`now()`),
  or(isNull(promotions.maxUses), raw`${promotions.uses} < ${promotions.maxUses}`),
);

export function toPublicPromotion(p: PromoRow, showCode = false): PublicPromotion {
  return {
    id: p.id,
    percent: p.percent,
    scope: p.scope as PromoScope,
    targetId: p.targetId,
    startsAt: new Date(p.startsAt).toISOString(),
    endsAt: new Date(p.endsAt).toISOString(),
    code: showCode ? p.code : null,
  };
}

/** Live PUBLIC promotions (no code) of these tutors — what every visitor sees. */
export async function livePublicPromotions(q: Q, tutorIds: string[]): Promise<PromoRow[]> {
  if (tutorIds.length === 0) return [];
  return q.select().from(promotions)
    .where(and(inArray(promotions.tutorId, tutorIds), isNull(promotions.code), promotionLiveSql))
    .limit(200);
}

/** The promotion a code names for this tutor, in any state (so the message can say why). */
export async function promotionByCode(q: Q, tutorId: string, rawCode: unknown): Promise<PromoRow | null> {
  const code = normalizePromoCode(rawCode);
  if (!code) return null;
  const [row] = await q.select().from(promotions)
    .where(and(eq(promotions.tutorId, tutorId), eq(promotions.code, code)))
    .limit(1);
  return row ?? null;
}

export type CodeNotice = Exclude<ReturnType<typeof promoCodeState>, "ok">;

/** The price of one item right now: the best of the public promotions and the
    visitor's code (no stacking). `notice` says why a code they brought did not apply. */
export async function quoteItem(
  q: Q,
  tutorId: string,
  item: PricedItem,
  rawCode?: unknown,
): Promise<{ quote: PriceQuote<PromoRow>; notice: CodeNotice | null }> {
  const candidates = await livePublicPromotions(q, [tutorId]);
  let notice: CodeNotice | null = null;
  if (rawCode != null && rawCode !== "") {
    const coded = await promotionByCode(q, tutorId, rawCode);
    const state = promoCodeState(coded);
    if (coded && state === "ok") candidates.push(coded);
    else notice = state === "ok" ? "invalid" : state;
  }
  return { quote: priceWithPromotion(item, candidates, { code: typeof rawCode === "string" ? rawCode : null }), notice };
}

/** Take one use of a promotion, atomically. False = it stopped being usable meanwhile. */
export async function claimPromotionUse(q: Q, promotionId: string): Promise<boolean> {
  const rows = await q.update(promotions)
    .set({ uses: raw`${promotions.uses} + 1`, updatedAt: raw`now()` })
    .where(and(eq(promotions.id, promotionId), promotionLiveSql))
    .returning({ id: promotions.id });
  return rows.length > 0;
}

/** Give a use back (the booking or request that took it was cancelled). */
export async function releasePromotionUse(q: Q, promotionId: string): Promise<void> {
  await q.update(promotions)
    .set({ uses: raw`greatest(${promotions.uses} - 1, 0)`, updatedAt: raw`now()` })
    .where(and(eq(promotions.id, promotionId), gt(promotions.uses, 0)));
}
