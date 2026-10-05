import type { FastifyInstance } from "fastify";
import { eq, isNull, and, tutors } from "@tnajem/db";
import { vSlug, type ViewerBooking } from "@tnajem/shared";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { viewerBookings } from "../lib/viewer-booking";

/* GET /student/booked?tutor=<slug> — student-space-v1 · H1.

   « Am I booked with this prof? », for the storefront /<slug>: an ISR-cached,
   anonymous page that learns it in the browser after hydration, so the seat the
   student already holds reads « ✓ Tu es inscrit à cette séance » instead of
   « Réserver la séance ». (The class page gets the same answer inside GET
   /classes/:id → viewer_booking, which already reads the session.)

   The caller's OWN seats only — the profile id comes from the session, never the
   request — on that tutor's classes that have not ended (lib/viewer-booking.ts).
   Students only (contract C9); everyone else gets a typed refusal and the page shows
   what it shows today. Domain outcomes are 200s with { ok:false } like every read the
   web proxies (apps/web/lib/api.ts, rule 2). Rate-limited like the .ics read. */

export type StudentBookedResult =
  | { ok: true; bookings: ViewerBooking[] }
  | { ok: false; error: "not-authenticated" | "students-only" | "too-many-requests" | "not-found" };

export async function studentBookedRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { tutor?: string } }>("/student/booked", async (req): Promise<StudentBookedResult> => {
    const session = await getSession(req);
    if (!session) return { ok: false, error: "not-authenticated" };
    if (session.profile.role !== "student") return { ok: false, error: "students-only" };

    const rl = await checkRateLimit(`booked:${session.profile.id}`, 60, 60_000);
    if (!rl.ok) return { ok: false, error: "too-many-requests" };

    const slug = vSlug(req.query?.tutor ?? "");
    if (!slug.ok) return { ok: false, error: "not-found" };
    const [t] = await db
      .select({ id: tutors.id })
      .from(tutors)
      .where(and(eq(tutors.slug, slug.value), isNull(tutors.erasedAt)))
      .limit(1);
    if (!t) return { ok: false, error: "not-found" };

    return { ok: true, bookings: await viewerBookings(session.profile.id, { tutorId: t.id }) };
  });
}
