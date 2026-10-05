"use server";
/* Server actions — student-space-v1 · fixes (H1).

   « Am I booked with this prof? » for the storefront /<slug>, which is ISR-cached
   and anonymous: the page asks from the browser, after hydration (the BookedSwap
   islands in components/class/). A thin proxy to GET /student/booked — the API
   decides everything (session, student role, rate limit) — through lib/api.ts and
   its five rules. Never called during a server render. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { ViewerBooking } from "@tnajem/shared";

/** The signed-in student's live seats on this tutor's classes, soonest first.
    null = not a signed-in student (guest, tutor, guardian), or any refusal: the
    page then shows exactly what it shows anyone. */
export async function getMyBookingsWithTutor(slug: string): Promise<ViewerBooking[] | null> {
  if (demoFallback) return null;
  const res = await call<{ ok: true; bookings: ViewerBooking[] } | { ok: false; error: string }>(
    `/student/booked?tutor=${encodeURIComponent(slug)}`,
    undefined,
    "GET",
  );
  return res.ok ? res.bookings : null;
}
