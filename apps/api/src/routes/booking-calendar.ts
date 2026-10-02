import type { FastifyInstance } from "fastify";
import { icsContentType, isUuid } from "@tnajem/shared";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";
import { calendarFor, ICS_FILENAME } from "../lib/booking-mail";

/* "AJOUTER AU CALENDRIER" — GET /bookings/:id/calendar.ics (espace prof v2 · phase 7).

   The same file the booking emails attach, downloadable from the student space and
   from the link in those emails (through the web app's pass-through,
   apps/web/app/api/calendar/[id]/route.ts, which makes no decision of its own).

   WHO: the student who owns the booking (their entry) or the tutor of the class
   (the class entry) — decided in lib/booking-mail.ts::calendarFor. Everyone else,
   and a malformed id, gets 404, not 403: a booking id is a bare uuid and the answer
   must not confirm that it exists. No session: 401, which the web pass-through
   turns into a trip to /auth.

   The file carries the class title, the tutor's public name, the time and the link
   to the Tnajem live page — never the room URL itself. */

export async function bookingCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>("/bookings/:id/calendar.ics", async (req, reply) => {
    const session = await getSession(req);
    if (!session) return reply.code(401).send({ error: "not-authenticated" });
    if (!isUuid(req.params.id)) return reply.code(404).send({ error: "not-found" });

    const rl = await checkRateLimit(`ics:${session.profile.id}`, 60, 60_000);
    if (!rl.ok) return reply.code(429).send({ error: "too-many-requests" });

    const cal = await calendarFor(req.params.id, session.profile.id);
    if (!cal) return reply.code(404).send({ error: "not-found" });

    reply.header("content-type", icsContentType(cal.method));
    reply.header("content-disposition", `attachment; filename="${ICS_FILENAME}"`);
    reply.header("cache-control", "private, no-store");
    reply.header("x-content-type-options", "nosniff");
    return reply.send(cal.ics);
  });
}
