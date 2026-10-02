"use server";
/* Server actions — Espace prof v2 · pro (Phase 7).

   Thin proxies to apps/api through lib/api.ts, under its five rules: the API
   decides everything (here: the admin allow-list and the audit row), nothing is
   retried, and demo mode (no API, dev only) degrades to a refusal. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { AdminTutorOffers } from "@tnajem/shared";

/** The admin tutor page: a tutor's monthly offers and the subscriptions to them,
    read-only. The API writes "offers.read" to the audit log before it answers. */
export async function getTutorOffersAsAdmin(tutorId: string): Promise<AdminTutorOffers> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call(`/admin/tutors/${encodeURIComponent(tutorId)}/offers`, undefined, "GET");
}
