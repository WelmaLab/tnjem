import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PROMO_PERCENT_MAX, discountedPrice, normalizePromoCode, priceWithPromotion, promoCodeState,
  promotionCovers, promotionIsLive, type PromotionLike,
} from "@tnajem/shared";
import { checkInput, offerInputSchema, promotionInputSchema } from "@tnajem/shared/growth-input";

/* Espace prof v2 · Phase 5 · contract C6 — THE price calculation
   (packages/shared/src/pricing.ts) and the input schemas (growth-input.ts). Pure:
   no database. The rules: best single promotion (no stacking), 20 % cap
   re-enforced, rounded to 0.5 TND, never below 1 TND, never above the base. */

const NOW = new Date("2026-10-01T10:00:00Z");
const DAY = 86_400_000;
const promo = (over: Partial<PromotionLike> = {}): PromotionLike => ({
  id: over.id ?? "p",
  percent: 15,
  scope: "all",
  targetId: null,
  code: null,
  startsAt: new Date(NOW.getTime() - DAY),
  endsAt: new Date(NOW.getTime() + 7 * DAY),
  maxUses: null,
  uses: 0,
  active: true,
  endedAt: null,
  ...over,
});
const cls = (priceTnd: number, id = "c1") => ({ kind: "class" as const, id, priceTnd });

describe("C6 · discountedPrice — cap, rounding, floor", () => {
  const cases: [number, number, number][] = [
    [40, 15, 34],     // exact
    [10, 15, 8.5],    // exact half
    [7, 15, 6],       // 5.95 → 6.0 (nearest 0.5)
    [13, 20, 10.5],   // 10.4 → 10.5
    [12, 10, 11],     // 10.8 → 11
    [21, 5, 20],      // 19.95 → 20
    [33, 7, 30.5],    // 30.69 → 30.5
    [40, 25, 32],     // 25 % is clamped to 20 %
    [40, 100, 32],    // so is anything above
    [40, 19.9, 32.5], // a fraction is truncated: 19 % → 32.4 → 32.5
    [1.2, 20, 1],     // 0.96 → 1.0, the floor
    [1.25, 20, 1],    // 1.0 → floor 1
    [1, 20, 1],       // never below 1 TND
    [0.5, 20, 0.5],   // never ABOVE the base: under the floor already, untouched
    [0, 20, 0],       // a free item stays free
    [40, 0, 40],      // below 1 % does not apply
    [40, -5, 40],
    [40, Number.NaN, 40],
  ];
  for (const [base, pct, want] of cases) {
    test(`${base} TND −${pct} % → ${want} TND`, () => assert.equal(discountedPrice(base, pct), want));
  }
  test("money is counted in millimes: no float drift on a long run", () => {
    for (let base = 1; base <= 300; base += 0.5) {
      for (let pct = 1; pct <= PROMO_PERCENT_MAX; pct++) {
        const p = discountedPrice(base, pct);
        assert.equal(Math.round(p * 2), p * 2, `${base} −${pct} % = ${p} is a multiple of 0.5 — or the base itself`);
        assert.ok(p <= base && p >= Math.min(1, base), `${base} −${pct} % = ${p}`);
      }
    }
  });
});

describe("C6 · priceWithPromotion — which promotion applies", () => {
  test("NO STACKING: of 10 % and 15 %, only 15 % applies", () => {
    const q = priceWithPromotion(cls(40), [promo({ id: "a", percent: 10 }), promo({ id: "b", percent: 15 })], { now: NOW });
    assert.equal(q.finalTnd, 34);
    assert.equal(q.percent, 15);
    assert.equal(q.promotion?.id, "b");
    assert.equal(q.savedTnd, 6);
  });

  test("a row claiming 25 % is held to 20 % (the cap, re-enforced)", () => {
    const q = priceWithPromotion(cls(40), [promo({ percent: 25 })], { now: NOW });
    assert.equal(q.percent, 20);
    assert.equal(q.finalTnd, 32);
  });

  test("a discount that rounds to nothing is not a promotion (no badge, no use)", () => {
    const q = priceWithPromotion(cls(10), [promo({ percent: 1 })], { now: NOW });
    assert.equal(q.percent, 0);
    assert.equal(q.promotion, null);
    assert.equal(q.finalTnd, 10);
  });

  test("a free class and a 1 TND class take no promotion", () => {
    assert.equal(priceWithPromotion(cls(0), [promo()], { now: NOW }).promotion, null);
    assert.equal(priceWithPromotion(cls(1), [promo({ percent: 20 })], { now: NOW }).promotion, null);
  });

  test("expired, not started, paused, ended and exhausted promotions do not apply", () => {
    const dead = [
      promo({ id: "exp", endsAt: new Date(NOW.getTime() - 1) }),
      promo({ id: "soon", startsAt: new Date(NOW.getTime() + DAY) }),
      promo({ id: "paused", active: false }),
      promo({ id: "ended", endedAt: new Date(NOW.getTime() - DAY) }),
      promo({ id: "full", maxUses: 3, uses: 3 }),
    ];
    for (const p of dead) {
      assert.equal(priceWithPromotion(cls(40), [p], { now: NOW }).promotion, null, p.id);
      assert.equal(promotionIsLive(p, NOW), false, p.id);
    }
    assert.equal(promotionIsLive(promo({ maxUses: 3, uses: 2 }), NOW), true);
  });

  test("scope: one class, one pack, monthly (one offer or every offer), all = everything", () => {
    assert.equal(promotionCovers(promo({ scope: "class", targetId: "c1" }), { kind: "class", id: "c1" }), true);
    assert.equal(promotionCovers(promo({ scope: "class", targetId: "c1" }), { kind: "class", id: "c2" }), false);
    assert.equal(promotionCovers(promo({ scope: "pack", targetId: "k" }), { kind: "class", id: "k" }), false);
    assert.equal(promotionCovers(promo({ scope: "monthly", targetId: null }), { kind: "monthly", id: "o1" }), true);
    assert.equal(promotionCovers(promo({ scope: "monthly", targetId: "o2" }), { kind: "monthly", id: "o1" }), false);
    assert.equal(promotionCovers(promo({ scope: "monthly" }), { kind: "class", id: "c1" }), false);
    for (const kind of ["class", "pack", "monthly"] as const) assert.equal(promotionCovers(promo({ scope: "all" }), { kind, id: "x" }), true);
  });

  test("a CODE promotion applies only with its code (case-insensitive), and still never stacks", () => {
    const pub = promo({ id: "pub", percent: 10 });
    const coded = promo({ id: "code", percent: 20, code: "RENTREE" });
    assert.equal(priceWithPromotion(cls(40), [pub, coded], { now: NOW }).promotion?.id, "pub", "no code: the public one");
    assert.equal(priceWithPromotion(cls(40), [pub, coded], { now: NOW, code: "rentree" }).promotion?.id, "code", "the code: the best one");
    assert.equal(priceWithPromotion(cls(40), [pub, coded], { now: NOW, code: "AUTRE" }).promotion?.id, "pub", "a wrong code: the public one");
    assert.equal(priceWithPromotion(cls(40), [pub, coded], { now: NOW, code: "rentree" }).finalTnd, 32);
  });

  test("ties are deterministic: same price → higher percent → ends first → id", () => {
    const a = promo({ id: "b", percent: 15, endsAt: new Date(NOW.getTime() + 2 * DAY) });
    const b = promo({ id: "a", percent: 15, endsAt: new Date(NOW.getTime() + 5 * DAY) });
    assert.equal(priceWithPromotion(cls(40), [b, a], { now: NOW }).promotion?.id, "b", "the one ending first");
    const c = promo({ id: "z", percent: 15 });
    const d = promo({ id: "y", percent: 15 });
    assert.equal(priceWithPromotion(cls(40), [c, d], { now: NOW }).promotion?.id, "y");
    // 1.5 TND: 15 % rounds back up to 1.5 (not a promotion); 20 % lands on the 1 TND floor.
    const q = priceWithPromotion(cls(1.5), [promo({ id: "p15", percent: 15 }), promo({ id: "p20", percent: 20 })], { now: NOW });
    assert.equal(q.finalTnd, 1);
    assert.equal(q.promotion?.id, "p20");
  });

  test("the end date travels with the quote (the badge says 'jusqu'au …')", () => {
    const end = new Date(NOW.getTime() + 3 * DAY);
    assert.equal(priceWithPromotion(cls(40), [promo({ endsAt: end })], { now: NOW }).endsAt, end.toISOString());
  });
});

describe("C6 · codes", () => {
  test("normalizePromoCode", () => {
    assert.equal(normalizePromoCode(" rentree-15 "), "RENTREE-15");
    for (const bad of ["ab", "A".repeat(21), "RENTRÉE", "a b", "<x>", 12, null]) assert.equal(normalizePromoCode(bad), null);
  });
  test("promoCodeState explains a code that does not apply — calmly", () => {
    assert.equal(promoCodeState(null, NOW), "invalid");
    assert.equal(promoCodeState(promo(), NOW), "ok");
    assert.equal(promoCodeState(promo({ endsAt: new Date(NOW.getTime() - 1) }), NOW), "expired");
    assert.equal(promoCodeState(promo({ endedAt: NOW }), NOW), "expired");
    assert.equal(promoCodeState(promo({ active: false }), NOW), "paused");
    assert.equal(promoCodeState(promo({ startsAt: new Date(NOW.getTime() + DAY) }), NOW), "not-started");
    assert.equal(promoCodeState(promo({ maxUses: 1, uses: 1 }), NOW), "exhausted");
  });
});

describe("Zod · promotion and offer inputs", () => {
  const end = new Date(Date.now() + 10 * DAY).toISOString();
  test("percent: 20 accepted; 25, 0, 20.5 rejected with percent-out-of-range", () => {
    assert.equal(checkInput(promotionInputSchema, { percent: 20, scope: "all", endsAt: end }).ok, true);
    for (const percent of [25, 0, 20.5, 21, -1, "15"]) {
      assert.deepEqual(checkInput(promotionInputSchema, { percent, scope: "all", endsAt: end }), { ok: false, error: "percent-out-of-range" }, String(percent));
    }
  });
  test("scope/target, window, code", () => {
    assert.deepEqual(checkInput(promotionInputSchema, { percent: 10, scope: "class", endsAt: end }), { ok: false, error: "target-required" });
    assert.deepEqual(checkInput(promotionInputSchema, { percent: 10, scope: "all", targetId: "0b6f9a52-1d5e-4a3e-9d1e-3c2b1a0f9e8d", endsAt: end }), { ok: false, error: "target-not-allowed" });
    assert.deepEqual(checkInput(promotionInputSchema, { percent: 10, scope: "all", endsAt: new Date(Date.now() - DAY).toISOString() }), { ok: false, error: "invalid-dates" });
    assert.deepEqual(checkInput(promotionInputSchema, { percent: 10, scope: "all", endsAt: new Date(Date.now() + 200 * DAY).toISOString() }), { ok: false, error: "too-long" });
    const ok = checkInput(promotionInputSchema, { percent: 10, scope: "all", endsAt: end, code: "rentree" });
    assert.equal(ok.ok && ok.value.code, "RENTREE");
    assert.deepEqual(checkInput(promotionInputSchema, { percent: 10, scope: "all", endsAt: end, code: "a b" }), { ok: false, error: "invalid-code" });
  });
  test("offers: price > 0, 1–31 sessions", () => {
    assert.equal(checkInput(offerInputSchema, { title: "4 séances", sessionsPerMonth: 4, priceTnd: 120 }).ok, true);
    assert.equal(checkInput(offerInputSchema, { title: "Max", sessionsPerMonth: 31, priceTnd: 0.5 }).ok, true);
    assert.deepEqual(checkInput(offerInputSchema, { title: "Gratuit", sessionsPerMonth: 4, priceTnd: 0 }), { ok: false, error: "price-must-be-positive" });
    assert.deepEqual(checkInput(offerInputSchema, { title: "Négatif", sessionsPerMonth: 4, priceTnd: -10 }), { ok: false, error: "price-must-be-positive" });
    for (const s of [0, 32, 2.5]) assert.deepEqual(checkInput(offerInputSchema, { title: "Trop", sessionsPerMonth: s, priceTnd: 50 }), { ok: false, error: "invalid-sessions" });
  });
});
