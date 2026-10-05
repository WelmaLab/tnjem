import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { bearerAuthorised } from "../lib/bearer";
import { runReminders } from "../lib/reminders";
import { markEndedClassesDone } from "../lib/class-done"; // student-space-v1 · fixes (H2)
import { logEvent } from "@tnajem/shared/observability";

/* POST|GET /cron/reminders — the FREQUENT job (espace prof v2 · phase 7).

   Separate from /cron/purge on purpose: the purge runs once a night and deletes
   things; this runs every few minutes (DEPLOY.md §7, docker-compose `reminders`)
   and only sends email — the 24 h and 1 h class reminders and the after-class
   review prompt (lib/reminders.ts) — plus, since student-space-v1 · H2, one write:
   classes that have ended move from `scheduled` to `done` (lib/class-done.ts).
   Idempotent: each email is claimed by its "sent" marker (0039) before it goes
   out, and an ended class is moved once, so overlapping runs are harmless.

   Authenticated exactly like /cron/purge: a CRON_SECRET bearer compared in
   constant time, and 503 — not 401 — when the secret is unset, so a broken deploy
   and a rejected caller look different in a log. The body is counts only. */

export async function cronReminderRoutes(app: FastifyInstance): Promise<void> {
  const handle = async (req: FastifyRequest, reply: FastifyReply) => {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) {
      req.log.error("CRON_SECRET is not set — refusing to run the reminder job");
      return reply.code(503).send({ ok: false, error: "not-configured" });
    }
    if (!bearerAuthorised(req.headers.authorization, secret)) {
      return reply.code(401).send({ ok: false, error: "unauthorised" });
    }

    /* student-space-v1 · H2: ended classes → `done` (lib/class-done.ts). First, and
       whether or not mail is configured — the reminder run below sends nothing
       without a provider, but a finished class is finished either way. Failing it
       never stops the reminders; it is reported like one of their jobs. */
    let classesDone = 0;
    let sweepFailed = false;
    try {
      classesDone = await markEndedClassesDone();
    } catch (e) {
      sweepFailed = true;
      logEvent("error", "reminder_job_failed", { job: "class-done", detail: (e as { code?: string }).code ?? (e as Error).name });
    }

    const run = await runReminders();
    if (sweepFailed) run.failedJobs.push("class-done");
    const failed = run.failedJobs.length > 0;
    if (failed) req.log.error({ failedJobs: run.failedJobs }, "reminder run had failures");
    else if (!run.mail) req.log.warn("reminder run skipped — no mail provider configured");
    return reply.code(failed ? 500 : 200).send({ ok: !failed, ...run, classesDone });
  };

  app.get("/cron/reminders", handle);
  app.post("/cron/reminders", handle);
}
