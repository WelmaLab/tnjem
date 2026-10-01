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

/* ── Phase 4 · follows ────────────────────────────────────────────────────── */

export type FollowStatus = {
  signedIn: boolean;
  following: boolean;
  canFollow: boolean;
  /** Why the button cannot follow: "own-page" | "students-only" | "not-found". */
  reason?: string;
};

/** What the Suivre button shows. Viewer-specific, so CLIENT-side only (ISR pages). */
export async function getFollowStatus(slug: string): Promise<FollowStatus> {
  if (demoFallback) return { signedIn: false, following: false, canFollow: true };
  return call<FollowStatus>(`/follows/status?slug=${encodeURIComponent(slug)}`, undefined, "GET");
}

export type FollowResult = { ok: boolean; following?: boolean; already?: boolean; error?: string };

export async function followTutor(slug: string): Promise<FollowResult> {
  if (demoFallback) return { ok: true, following: true };
  return call<FollowResult>("/follows", { slug });
}

export async function unfollowTutor(slug: string): Promise<FollowResult> {
  if (demoFallback) return { ok: true, following: false };
  return call<FollowResult>("/follows/unfollow", { slug });
}

/** A student's followed tutors ("Mohamed B." — never the last name). */
export async function getFollowedTutors(): Promise<{ slug: string; name: string; subject: string; live: boolean; since: string }[] | null> {
  if (demoFallback) return null;
  return call("/follows/mine", undefined, "GET");
}

/** The tutor's followers for Mes élèves: a count and FIRST NAMES only. */
export async function getMyFollowers(): Promise<
  { ok: true; count: number; items: { firstName: string | null; since: string }[] } | { ok: false; error: string }
> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call("/tutor/followers", undefined, "GET");
}

/* ── Phase 4 · e-mail preferences (contract C5) — for Réglages › Notifications ── */

export type NotificationPrefsResult =
  | { ok: true; prefs: { followers: boolean; bookings: boolean; messages: boolean; reminders: boolean } }
  | { ok: false; error: string };

export async function getNotificationPrefs(): Promise<NotificationPrefsResult> {
  if (demoFallback) return { ok: true, prefs: { followers: true, bookings: true, messages: true, reminders: true } };
  return call<NotificationPrefsResult>("/me/notification-prefs", undefined, "GET");
}

export type UnsubscribeLookup = { ok: true; kind: string; locale: "fr" | "ar"; already: boolean } | { ok: false; error: string };

/** What an unsubscribe token would switch off. Changes nothing (scanner-safe GET). */
export async function lookupUnsubscribe(token: string): Promise<UnsubscribeLookup> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call<UnsubscribeLookup>(`/email/unsubscribe?token=${encodeURIComponent(token)}`, undefined, "GET");
}

/** The click on "Me désabonner": switch that one kind off. */
export async function confirmUnsubscribe(token: string): Promise<{ ok: boolean; kind?: string; error?: string }> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call("/email/unsubscribe", { token });
}

/** Save some switches (the API validates: booleans for the four known kinds only). */
export async function saveNotificationPrefs(
  patch: Partial<{ followers: boolean; bookings: boolean; messages: boolean; reminders: boolean }>,
): Promise<NotificationPrefsResult> {
  if (demoFallback) return { ok: false, error: "demo" };
  return call<NotificationPrefsResult>("/me/notification-prefs", patch);
}
