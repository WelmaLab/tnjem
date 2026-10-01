/* MONTHLY OFFERS, SUBSCRIPTIONS AND PROMOTIONS — the DTOs and limits both apps
   share (Espace prof v2 · Phase 5). Pure, client-safe, in the barrel. The input
   SCHEMAS (zod) are in ./growth-input.ts, a subpath, so zod stays out of the
   client bundle; the price calculation is ./pricing.ts. */
import type { PromoScope } from "./pricing";

export const OFFER_MAX_PER_TUTOR = 3;
export const OFFER_SESSIONS_MIN = 1;
export const OFFER_SESSIONS_MAX = 31;
export const OFFER_TITLE_MAX = 80;
export const OFFER_PRICE_MAX = 5000;

/* THE MONTHLY OFFER'S PAYMENT NOTE — the spec's own sentence (ESPACE_PROF_V2,
   P5.A.3), shown beside every "S'abonner — X TND / mois", always next to the
   "Bientôt" tag. It names what is true during the pilot: the student pays the
   tutor outside Tnajem, and online payment comes later. It lives here, beside the
   one payment story (./payment-story.ts), so every surface renders the same words;
   apps/api/test/ep2-subscriptions.test.ts pins the French text to the spec. */
export const MONTHLY_PAYMENT_NOTE = {
  fr: "Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof.",
  ar: "الخلاص أونلاين قريب — للوقت هذا تخلّص أستاذك مباشرة.",
} as const;

/** An offer as the public profile shows it (active, not archived, public tutor). */
export type PublicOffer = {
  id: string;
  title: string;
  sessions_per_month: number;
  price_tnd: number;
};

/** A promotion as a public page may know it: live, and public (no code) — or the
    one whose code this visitor brought. Never the use count or the cap. */
export type PublicPromotion = {
  id: string;
  percent: number;
  scope: PromoScope;
  targetId: string | null;
  startsAt: string;
  endsAt: string;
  code: string | null;
};

/** GET /tutors/:slug/pricing — the live public promotions, and the visitor's code. */
export type TutorPricing = {
  promotions: PublicPromotion[];
  code?: {
    state: "ok" | "invalid" | "expired" | "not-started" | "exhausted" | "paused";
    promotion?: PublicPromotion;
  };
};

export const SUBSCRIPTION_STATUSES = ["requested", "active", "paused", "cancelled", "expired"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The signed-in student's subscription with one tutor (the offer card's status). */
export type MySubscription = {
  id: string;
  status: SubscriptionStatus;
  offerId: string;
  offerTitle: string;
  sessionsPerMonth: number;
  priceTnd: number;
  requestedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Covered sessions already booked in the current month window. */
  usedThisPeriod: number;
};

/** One row of the tutor's Abonnements page. The student by FIRST NAME only. */
export type TutorSubscriptionRow = {
  id: string;
  status: SubscriptionStatus;
  studentFirstName: string | null;
  offerId: string;
  offerTitle: string;
  sessionsPerMonth: number;
  priceTnd: number;
  promotionPercent: number | null;
  requestedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  usedThisPeriod: number;
  /** Active and ending within 7 days. */
  expiringSoon: boolean;
};

/** The tutor's own offer, on the Abonnements page. */
export type TutorOfferRow = PublicOffer & {
  active: boolean;
  createdAt: string;
  /** Running subscriptions (active | paused) on this offer — « N abonnements en cours ». Requests are listed apart. */
  liveSubscriptions: number;
};

/** A promotion as its owner sees it. */
export type TutorPromotionRow = PublicPromotion & {
  maxUses: number | null;
  uses: number;
  active: boolean;
  endedAt: string | null;
  createdAt: string;
  /** Derived: scheduled · live · paused · ended · expired · exhausted. */
  state: "scheduled" | "live" | "paused" | "ended" | "expired" | "exhausted";
};
