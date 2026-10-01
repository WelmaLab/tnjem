import { lt, sql as raw, vitrineStatsDaily } from "@tnajem/db";
import { db as appDb } from "../db";

/* THE GROWTH NIGHTLY JOBS (Espace prof v2 · Phases 3–5), run inside the existing
   /cron/purge call (routes/cron.ts) right after the retention run.

   Same contract as packages/db/src/retention.ts::runRetention: every job is
   INDEPENDENT — wrapped, so one failing (a mail provider down, a locked table)
   never stops the others — and the caller turns `failedJobs` into the HTTP
   status. Results are COUNTS only: no id, no address, nothing personal crosses
   the wire; per-row detail goes to the log callback, ids only. */

type Db = typeof appDb;
export type GrowthJobOptions = { dryRun?: boolean; log?: (line: string) => void; now?: Date };
export type GrowthRun = {
  results: Record<string, unknown>;
  failedJobs: { job: string; error: string }[];
};

/* Phase 3. The vitrine counters are aggregates with nothing personal in them, but
   nothing reads past 90 days either; a year and a bit is kept so a tutor can
   still be shown "this time last year" later, and the table cannot grow forever. */
export const VITRINE_STATS_KEEP_DAYS = 400;

export async function pruneVitrineStats(db: Db, opts: GrowthJobOptions = {}): Promise<{ deleted: number }> {
  const cutoff = raw`(now() at time zone 'Africa/Tunis')::date - ${VITRINE_STATS_KEEP_DAYS}::int`;
  if (opts.dryRun) {
    const [{ n }] = await db
      .select({ n: raw<number>`count(*)::int` })
      .from(vitrineStatsDaily)
      .where(lt(vitrineStatsDaily.day, cutoff));
    opts.log?.(`vitrine-stats (dry-run): due=${n}`);
    return { deleted: 0 };
  }
  const rows = await db.delete(vitrineStatsDaily).where(lt(vitrineStatsDaily.day, cutoff)).returning({ day: vitrineStatsDaily.day });
  opts.log?.(`vitrine-stats: pruned=${rows.length}`);
  return { deleted: rows.length };
}

/** Every growth job, each wrapped. */
export async function runGrowthJobs(db: Db, opts: GrowthJobOptions = {}): Promise<GrowthRun> {
  const results: Record<string, unknown> = {};
  const failedJobs: GrowthRun["failedJobs"] = [];
  async function job(name: string, run: () => Promise<unknown>): Promise<void> {
    try {
      results[name] = await run();
    } catch (err) {
      // The code/name only — a driver message can carry statement parameters.
      const error = String((err as { code?: string }).code ?? (err as Error).name).slice(0, 120);
      failedJobs.push({ job: name, error });
      results[name] = null;
      opts.log?.(`${name}: FAILED — ${error}`);
    }
  }
  await job("vitrineStats", () => pruneVitrineStats(db, opts));
  return { results, failedJobs };
}
