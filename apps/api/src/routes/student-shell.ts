import type { FastifyInstance } from "fastify";
import { and, eq, sql as raw, bookings, classes } from "@tnajem/db";
import { initials, type StudentShellInfo } from "@tnajem/shared";
import { DEFAULT_CLASS_DURATION_MIN } from "@tnajem/shared/live";
import { paymentsEnabled } from "@tnajem/shared/payments";
import { db } from "../db";
import { getSession } from "../lib/session";
import { checkRateLimit } from "../lib/rate-limit";

/* student-space-v1 · A — the student shell's own data.

     GET /student/shell   the StudentShell: the student's name, initials, and the
                          « Mes cours » badge (upcoming classes)

   The CALLER's own data only: every row is found by the session's profile id, never
   by anything in the request — there is no id here for anyone to swap. A guest, a
   tutor or a guardian gets null (200), the same answer GET /tutor/shell gives a
   non-tutor: "this is not your shell", which the web layout already handles.

   The shell reads this on every student page and again whenever the tab comes back
   to the foreground (apps/web/app/actions-shell.ts), so it is cheap — one indexed
   count — and rate-limited per profile like its neighbours. */

/** Shell reads per profile per window: a page view costs one or two. */
const SHELL_LIMIT = 300;
const SHELL_WINDOW_MS = 10 * 60_000;

export async function studentShellRoutes(app: FastifyInstance): Promise<void> {
  app.get("/student/shell", async (req, reply): Promise<StudentShellInfo | null | void> => {
    const session = await getSession(req);
    if (!session || session.profile.role !== "student") return null;
    const uid = session.profile.id;

    const rl = await checkRateLimit(`student-shell:${uid}`, SHELL_LIMIT, SHELL_WINDOW_MS);
    if (!rl.ok) return reply.code(429).send({ error: "too-many-requests" });

    /* UPCOMING = a seat the student still holds on a class that has not ENDED
       (contract C7: start + duration, whatever classes.status says), and that
       nobody cancelled. A class in progress still counts — the student may be in it. */
    const [row] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(bookings)
      .innerJoin(classes, eq(bookings.classId, classes.id))
      .where(
        and(
          eq(bookings.studentId, uid),
          raw`coalesce(${bookings.status}, 'reserved') <> 'cancelled'`,
          raw`coalesce(${classes.status}, 'scheduled') <> 'cancelled'`,
          raw`${classes.scheduledAt} + make_interval(mins => coalesce(nullif(greatest(${classes.durationMin}, 0), 0), ${DEFAULT_CLASS_DURATION_MIN})) > now()`,
        ),
      );

    const name = session.profile.fullName?.trim() || null;
    return {
      name,
      initials: name ? initials(name) : "?",
      upcoming: row?.n ?? 0,
      pilot: !paymentsEnabled(),
    };
  });
}
