"use server";
/* Server actions — Espace prof v2 · growth (Phases 3–5): sharing and vitrine
   statistics, follows and e-mail preferences, monthly offers, subscriptions and
   promotions.

   Every one is a thin proxy to apps/api through lib/api.ts and obeys its five
   rules — in particular: ISR-safe reads use callAnonymous() (no cookies(), no
   headers()), every rule is enforced by the API (this file decides nothing), and
   nothing here is retried. Demo mode (no API, dev only) degrades to empty answers. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";

/* ── Phase 3 · vitrine statistics ─────────────────────────────────────────── */

/** The page beacon (components/share/VitrineBeacon.tsx). Fire-and-forget: a stats
    failure must never surface on a public page, so this never throws. */
export async function trackVitrineHit(input: { slug: string; classId?: string | null; source?: string | null }): Promise<void> {
  if (demoFallback) return;
  try {
    await call("/vitrine/hit", input);
  } catch {
    /* the counter missed one visit — nothing a visitor should ever see */
  }
}

export type VitrineStats = {
  ok: true;
  days: number;
  since: string;
  totals: { views: number; clicks: number };
  bySource: { source: string; views: number; clicks: number }[];
  daily: { day: string; views: number; clicks: number }[];
  /** null until the follower count exists (Phase 4). */
  followers: number | null;
} | { ok: false; error: string };

/** The owner's own last-N-days numbers, for Ma vitrine. */
export async function getVitrineStats(days = 30): Promise<VitrineStats> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call<VitrineStats>(`/vitrine/stats?days=${encodeURIComponent(String(days))}`, undefined, "GET");
}
