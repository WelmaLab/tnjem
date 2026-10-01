import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { runRetention } from "@tnajem/db";
import { bearerAuthorised } from "../lib/bearer";
import { runGrowthJobs } from "../lib/growth-cron";
import { db } from "../db";

/* The retention purge, moved from apps/web/app/api/cron/purge.

   It belongs here now: apps/web owns no database, and this job deletes rows and
   unlinks identity documents. /privacy promises those documents are deleted at
   most 90 days after the verification decision, so this endpoint is the thing
   that keeps a published legal commitment — it is not a maintenance nicety. */

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  const handle = async (
    req: FastifyRequest<{ Querystring: { dryRun?: string } }>,
    reply: FastifyReply,
  ) => {
    const secret = process.env.CRON_SECRET?.trim();
    /* 503, not 401, when it is UNCONFIGURED: an unset secret is a broken deploy,
       not a rejected caller, and the two need to look different in a log. It also
       refuses to run rather than running unauthenticated. */
    if (!secret) {
      req.log.error("CRON_SECRET is not set — refusing to run the retention purge");
      return reply.code(503).send({ ok: false, error: "not-configured" });
    }

    const auth = req.headers.authorization;
    if (!bearerAuthorised(auth, secret)) return reply.code(401).send({ ok: false, error: "unauthorised" });

    const dryRun = req.query?.dryRun === "1";

    /* THE SAME RUN AS `npm run db:purge` (packages/db/src/retention.ts::runRetention):
       four independent jobs — ID documents past the window, expired auth rows,
       accounts past their deletion grace, expired subscriptions. One failing never
       stops the others. Per-document lines (ids only, never file names) go to the
       server log; they used to be promised there and never written. */
    const run = await runRetention(db, { dryRun, log: (line) => req.log.info({ job: "retention" }, line) });
    const docs = run.documents;
    /* Espace prof v2 · growth: the followers digest, subscription expiry/reminders
       and stats housekeeping — extra INDEPENDENT jobs in the same nightly run
       (lib/growth-cron.ts). A failure there never stops retention, nor the reverse. */
    const growth = await runGrowthJobs(db, { dryRun, log: (line) => req.log.info({ job: "growth" }, line) });
    const failedJobs = [...run.failedJobs, ...growth.failedJobs];

    /* COUNTS ONLY in the response body. The removed-document list carries tutor and
       document ids; that stays in the server log and never crosses the wire. */
    const failed = failedJobs.length > 0 || (docs?.errors.length ?? 0) > 0;
    const body = {
      ok: !failed,
      dryRun,
      documents: docs
        ? {
            tutorsAffected: docs.tutorsAffected,
            docsDeleted: docs.docsDeleted,
            filesDeleted: docs.filesDeleted,
            filesMissing: docs.filesMissing,
            errors: docs.errors.length,
          }
        : null,
      auth: run.auth,
      accounts: run.accounts,
      subscriptions: run.subscriptions,
      growth: growth.results,
      failedJobs: failedJobs.map((f) => f.job),
    };
    if (failed) req.log.error({ failedJobs: failedJobs.map((f) => f.job), documentErrors: docs?.errors.length ?? 0 }, "retention purge had failures");
    return reply.code(failed ? 500 : 200).send(body);
  };

  // GET and POST both: cron runners differ, and the job is idempotent either way.
  app.get<{ Querystring: { dryRun?: string } }>("/cron/purge", handle);
  app.post<{ Querystring: { dryRun?: string } }>("/cron/purge", handle);
}
