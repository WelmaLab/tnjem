/* The admin's read-only view of a tutor's monthly offers and subscriptions
   (espace prof v2 · pro P7) — GET /admin/tutors/:tutorId/offers. Pure types. */
import type { SubscriptionStatus } from "./offers";

export type AdminOfferRow = {
  id: string;
  title: string;
  sessionsPerMonth: number;
  priceTnd: number;
  active: boolean;
  archived: boolean;
  createdAt: string;
};

export type AdminSubscriptionRow = {
  id: string;
  offerTitle: string;
  /** First name only — the rule wherever a counterparty is named. */
  studentFirstName: string | null;
  status: SubscriptionStatus;
  sessionsPerMonth: number;
  priceTnd: number;
  promotionPercent: number | null;
  requestedAt: string;
  confirmedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  cancelledAt: string | null;
};

export type AdminTutorOffers =
  | { ok: true; offers: AdminOfferRow[]; subscriptions: AdminSubscriptionRow[] }
  | { ok: false; error: string };
