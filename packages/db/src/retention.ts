/* ID-document retention purge (INPDP / Loi 2004-63 · Tunisia).
 *
 * /privacy publicly promises: identity documents are deleted AT MOST 90 days
 * after the verification decision. This module is what makes that true.
 *
 * What it does, for every tutor whose verification was DECIDED (status
 * "verified" or "rejected") more than RETENTION_DAYS ago:
 *   1. removes the file from the object store (STORAGE_DRIVER, local by default), then
 *   2. removes the matching `verification_docs` row.
 * File first, row second — if the unlink fails we keep the row so the next run
 * retries it (a row without a file is a lie; a file without a row is a leak).
 *
 * The row is replaced by a verification_traces row (0021) in the same
 * transaction: kind, upload date, decision, decision date — what /privacy says
 * is kept, and nothing else.
 *
 * Tutors in "draft" or "pending" are NEVER touched: the admin queue still needs
 * their documents. Tutors with a NULL reviewed_at are skipped too (no decision
 * date = no retention clock).
 *
 * Idempotent: re-running finds nothing left to do; a missing file is not an
 * error (counted as `filesMissing`) and its row is still purged.
 *
 * NOTE: this module deliberately does NOT import "@/lib/db" — that module is
 * guarded by `server-only` and throws under `tsx`. Callers pass their own
 * drizzle handle, so the same code runs from the CLI script and from the
 * cron route. Same reason lib/db/seed.ts connects directly.
 */
import { and, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { isNull, lte } from "drizzle-orm"; // phase-a lane L4 (A26)
import { SESSION_IDLE_DAYS } from "@tnajem/shared/auth-core";
import { DELETION_GRACE_DAYS, ID_DOCUMENT_RETENTION_DAYS, INACTIVE_ACCOUNT_RETENTION_DAYS } from "@tnajem/shared/legal";
import { adminNotifyEmails } from "@tnajem/shared/admin";
import { eraseAccount, inactiveAccountsDue } from "./erasure";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
/* ONE object store, in ./storage, shared with the uploader and the admin doc
   route. There used to be three copies of the base-directory lookup; they agreed
   only because all three happened to run with the same cwd. */
import { localStore, objectStore, storageBase, storageKey, type ObjectStore } from "./storage";
export { storageBase };
import { otpCodes, profiles, rateLimits, sessions, subscriptions, tutors, verificationDocs, verificationTraces } from "./schema";

/** The ID-document window. The value lives in @tnajem/shared/legal (LEGAL-REVIEW). */
export const RETENTION_DAYS = ID_DOCUMENT_RETENTION_DAYS;

/** Decided states — the retention clock only starts once a human has ruled. */
const DECIDED = ["verified", "rejected"] as const;

/* Any drizzle/postgres-js handle. The schema generic differs between the
   `server-only` client (typed with the full schema) and the standalone one the
   script builds, so we stay generic on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PurgeDb = PostgresJsDatabase<any>;

export type PurgedDoc = {
  docId: string;
  tutorId: string;
  kind: string;
  storagePath: string;
  fileExisted: boolean;
};

export type PurgeResult = {
  cutoff: string;          // ISO date: anything decided before this is expired
  retentionDays: number;
  dryRun: boolean;
  tutorsAffected: number;
  docsDeleted: number;     // verification_docs rows removed
  filesDeleted: number;    // files actually unlinked from disk
  filesMissing: number;    // rows whose file was already gone (still purged)
  errors: string[];
  removed: PurgedDoc[];
};

export type PurgeOptions = {
  /** Report what would go, change nothing. */
  dryRun?: boolean;
  /** Override the window (tests / legal changes). Defaults to RETENTION_DAYS. */
  retentionDays?: number;
  /** Where the files live. Defaults to objectStore() (STORAGE_DRIVER). */
  store?: ObjectStore;
  /** Shorthand for a local store rooted here (tests). Ignored when `store` is set. */
  baseDir?: string;
  /** Line logger. Never receives file names or any other document content. */
  log?: (line: string) => void;
};

export async function purgeExpiredVerificationDocs(
  db: PurgeDb,
  opts: PurgeOptions = {},
): Promise<PurgeResult> {
  const retentionDays = opts.retentionDays ?? RETENTION_DAYS;
  const dryRun = opts.dryRun ?? false;
  /* Resolved BEFORE any row is read. In production with no STORAGE_DIR this throws,
     and that is the point: see storageBase() — a purge pointed at the wrong place
     would find no files, delete every row, and report success. */
  const store = opts.store ?? (opts.baseDir ? localStore(opts.baseDir) : objectStore());
  const log = opts.log ?? (() => {});

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const result: PurgeResult = {
    cutoff: cutoff.toISOString(),
    retentionDays,
    dryRun,
    tutorsAffected: 0,
    docsDeleted: 0,
    filesDeleted: 0,
    filesMissing: 0,
    errors: [],
    removed: [],
  };

  // Expired = doc belongs to a tutor whose decision is older than the cutoff.
  // The status filter is what keeps pending/draft tutors safe.
  const expired = await db
    .select({
      docId: verificationDocs.id,
      tutorId: verificationDocs.tutorId,
      kind: verificationDocs.kind,
      storagePath: verificationDocs.storagePath,
      uploadedAt: verificationDocs.createdAt,
      status: tutors.status,
      reviewedAt: tutors.reviewedAt,
    })
    .from(verificationDocs)
    .innerJoin(tutors, eq(verificationDocs.tutorId, tutors.id))
    .where(
      and(
        inArray(tutors.status, [...DECIDED]),
        isNotNull(tutors.reviewedAt),
        lt(tutors.reviewedAt, cutoff),
        // LEGAL-REVIEW: per-document retention clock — older rounds wait for the newest decision (A26; phase-a/verify-fix D6).
        /* phase-a lane L4 (A26): a VERIFIED tutor who resubmits now stays verified,
           so "decided" no longer implies "nothing waiting". A round submitted after
           the last decision is undecided and the admin still needs it — skipped
           exactly as a pending tutor always was, until that round is decided. */
        or(isNull(tutors.submittedAt), lte(tutors.submittedAt, tutors.reviewedAt)),
      ),
    );

  const tutorIds = new Set(expired.map((r) => r.tutorId));
  result.tutorsAffected = tutorIds.size;

  log(
    `retention: window=${retentionDays}d cutoff=${cutoff.toISOString()} ` +
      `expired_docs=${expired.length} tutors=${tutorIds.size}${dryRun ? " (dry-run)" : ""}`,
  );

  for (const row of expired) {
    try {
      storageKey(row.storagePath, { legacy: true });
    } catch {
      // Unsafe/garbage path — never unlink it, never silently drop the row.
      result.errors.push(`doc ${row.docId}: refusing unsafe storage_path`);
      continue;
    }

    let fileExisted = false;
    try {
      /* The deleted/already-gone split exists only to keep an honest count in the
         audit log; a missing file is not an error. */
      if (dryRun) fileExisted = (await store.stat(row.storagePath)) !== null;
      else fileExisted = (await store.delete(row.storagePath)) === "deleted";
    } catch (e) {
      // Disk problem: keep the row so the next run retries. Never orphan a file.
      result.errors.push(`doc ${row.docId}: unlink failed — ${(e as Error).message}`);
      continue;
    }

    if (!dryRun) {
      try {
        // The trace and the deletion are one fact: both or neither.
        await db.transaction(async (tx) => {
          await tx.insert(verificationTraces).values({
            tutorId: row.tutorId,
            kind: row.kind,
            uploadedAt: row.uploadedAt,
            decision: row.status,
            decidedAt: row.reviewedAt,
            reason: "retention",
          });
          await tx.delete(verificationDocs).where(eq(verificationDocs.id, row.docId));
        });
      } catch (e) {
        result.errors.push(`doc ${row.docId}: row delete failed — ${(e as Error).message}`);
        continue;
      }
    }

    if (fileExisted) result.filesDeleted++;
    else result.filesMissing++;
    result.docsDeleted++;
    result.removed.push({
      docId: row.docId,
      tutorId: row.tutorId,
      kind: row.kind,
      storagePath: row.storagePath,
      fileExisted,
    });
    // Audit line: ids + kind only — no file names, no document content.
    log(
      `  purged doc=${row.docId} tutor=${row.tutorId} kind=${row.kind} ` +
        `decided=${row.reviewedAt instanceof Date ? row.reviewedAt.toISOString() : String(row.reviewedAt)} ` +
        `file=${fileExisted ? "deleted" : "already-gone"}`,
    );
  }

  // Best-effort: drop the per-tutor folder once it is empty. Never fatal.
  if (!dryRun) {
    for (const tutorId of tutorIds) {
      await store.pruneEmpty(`verification/${tutorId}`);
    }
  }

  log(
    `retention: done — rows=${result.docsDeleted} files=${result.filesDeleted} ` +
      `already-gone=${result.filesMissing} errors=${result.errors.length}`,
  );
  return result;
}

/* ══════════════════════════════════════════════════════════════════════════════
   Expired auth rows (SCALABILITY.md §5 / §7).

   `sessions` grows by one row per LOGIN (30-day expiry) and `otp_codes` by one row
   per OTP REQUEST (5-minute expiry). Nothing ever deleted an expired row from
   either: createOtp only clears the rows for the ONE phone it is minting a code
   for, and createSession only GCs the expired rows of the ONE profile logging in.
   So both tables grow exactly as fast as the product does, forever — and every
   login then reads through that garbage.

   Deleting an expired row can never log anyone out or invalidate a code that would
   still have worked: getSession() already treats `expires_at < now()` as no session
   (and deletes it), and verifyOtpCode() already treats it as no code. This purge is
   pure housekeeping — it removes rows the auth layer considers dead already.

   Indexed: `sessions_expires_at_idx` / `otp_codes_expires_at_idx` (schema.ts) make
   both statements index scans rather than a seq scan of a forever-growing table.

   Idempotent, overlap-safe, and unconditional on tutor status — nothing here is
   subject to the 90-day ID-document window; the expiry timestamp on the row IS the
   retention policy. Same contract as purgeExpiredVerificationDocs: the caller
   passes the db handle (so this runs under `tsx` as well as inside Next), dry-run
   only counts, and the return value is the audit record.
   ═════════════════════════════════════════════════════════════════════════════ */
export type AuthPurgeResult = {
  dryRun: boolean;
  cutoff: string;          // ISO — "expired" means expires_at < this
  sessionsDeleted: number;
  otpCodesDeleted: number;
  rateLimitsDeleted: number; // stale fixed-window rows (reset_at < now)
};

export type AuthPurgeOptions = {
  /** Count what would go, delete nothing. */
  dryRun?: boolean;
  /** Line logger. Never receives a token, a phone or a code hash. */
  log?: (line: string) => void;
};

/* postgres.js returns a RowList carrying `.count` (rows affected). The db handle is
   deliberately generic (PurgeDb = PostgresJsDatabase<any>), so read it defensively
   instead of leaning on a driver-specific type: a wrong count must never throw and
   abort a purge that already did its work. */
function affected(res: unknown): number {
  const n = (res as { count?: unknown } | null | undefined)?.count;
  return typeof n === "number" ? n : 0;
}

export async function purgeExpiredAuthRows(
  db: PurgeDb,
  opts: AuthPurgeOptions = {},
): Promise<AuthPurgeResult> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log ?? (() => {});
  const now = new Date();
  /* A session is dead at its absolute expiry OR after SESSION_IDLE_DAYS unused —
     getSession() refuses both, so both rows are swept. */
  const deadSession = or(
    lt(sessions.expiresAt, now),
    lt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_DAYS * 86_400_000)),
  );

  if (dryRun) {
    const [s] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .where(deadSession);
    const [o] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpCodes)
      .where(lt(otpCodes.expiresAt, now));
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rateLimits)
      .where(lt(rateLimits.resetAt, now));

    const res: AuthPurgeResult = {
      dryRun: true,
      cutoff: now.toISOString(),
      sessionsDeleted: s?.n ?? 0,
      otpCodesDeleted: o?.n ?? 0,
      rateLimitsDeleted: r?.n ?? 0,
    };
    log(
      `auth-retention (dry-run): expired sessions=${res.sessionsDeleted} ` +
        `otp_codes=${res.otpCodesDeleted} rate_limits=${res.rateLimitsDeleted}`,
    );
    return res;
  }

  const s = await db.delete(sessions).where(deadSession);
  const o = await db.delete(otpCodes).where(lt(otpCodes.expiresAt, now));
  // Stale fixed-window rows: self-healing (reset on next hit) but a key never hit
  // again lingers, so sweep it here on the same daily schedule. Indexed on reset_at.
  const r = await db.delete(rateLimits).where(lt(rateLimits.resetAt, now));

  const res: AuthPurgeResult = {
    dryRun: false,
    cutoff: now.toISOString(),
    sessionsDeleted: affected(s),
    otpCodesDeleted: affected(o),
    rateLimitsDeleted: affected(r),
  };
  log(
    `auth-retention: sessions=${res.sessionsDeleted} otp_codes=${res.otpCodesDeleted} ` +
      `rate_limits=${res.rateLimitsDeleted}`,
  );
  return res;
}

/* ══════════════════════════════════════════════════════════════════════════════
   JOBS 3 AND 4 — moved here from apps/api so the CLI can run them too.

   `npm run db:purge` used to run jobs 1 and 2 only, while POST /cron/purge ran all
   four — and DEPLOY.md and .env.example said "run EITHER". A host that chose the
   CLI never erased an account whose deletion grace had expired, and /privacy
   promises that erasure. Both entry points now call runRetention() below.
   ══════════════════════════════════════════════════════════════════════════════ */

/** Days between "supprimer mon compte" and the erasure (Step 15). @tnajem/shared/legal. */
export { DELETION_GRACE_DAYS };

/* THE ACCOUNT ERASURE (Step 15, anonymised since Stage 5 — see ./erasure.ts).

   Two ways an account becomes due, one erasure:
     requested  the 30-day grace after "supprimer mon compte" has passed;
     inactive   nobody has used the account for INACTIVE_ACCOUNT_RETENTION_DAYS
                (LEGAL-REVIEW, @tnajem/shared/legal). Allow-listed admins are never due.
   One at a time: a failure (or a deferral — an upcoming class, a file storage would
   not delete) leaves the account due again tomorrow, and is LOGGED by id. */
export type AccountRetentionResult = {
  due: number;
  purged: number;
  deferred: number;
  inactiveDue: number;
  inactiveErased: number;
};

export async function purgeDeletedAccounts(
  db: PurgeDb,
  opts: { dryRun?: boolean; log?: (line: string) => void; store?: ObjectStore } = {},
): Promise<AccountRetentionResult> {
  const log = opts.log ?? (() => {});
  const due: { id: string }[] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.deletionStatus, "requested"),
        sql`${profiles.deletionRequestedAt} < now() - (${DELETION_GRACE_DAYS} * interval '1 day')`,
      ),
    )
    .limit(500);
  /* Admins (profiles.admin_granted_at) are never due — inactiveAccountsDue checks the
     column. The ADMIN_EMAILS notification list is still spared as well (VULN-006). */
  const admins = adminNotifyEmails(process.env);
  const inactive = await inactiveAccountsDue(db, {
    retentionDays: INACTIVE_ACCOUNT_RETENTION_DAYS,
    excludeEmails: admins,
  });
  const result: AccountRetentionResult = { due: due.length, purged: 0, deferred: 0, inactiveDue: inactive.length, inactiveErased: 0 };

  if (opts.dryRun || (due.length === 0 && inactive.length === 0)) {
    log(`account-retention${opts.dryRun ? " (dry-run)" : ""}: due=${due.length} inactive=${inactive.length}`);
    return result;
  }

  for (const [list, reason] of [[due, "requested"], [inactive, "inactive"]] as const) {
    for (const p of list) {
      try {
        const r = await eraseAccount(db, p.id, { reason, store: opts.store, log });
        if (r.outcome === "erased") {
          if (reason === "requested") result.purged += 1;
          else result.inactiveErased += 1;
        } else if (r.outcome === "deferred") {
          result.deferred += 1;
          log(`account-retention: profile ${p.id} deferred (${r.why})`);
        }
      } catch (err) {
        log(`account-retention: could not erase profile ${p.id} (${(err as { code?: string }).code ?? (err as Error).name})`);
      }
    }
  }
  log(`account-retention: due=${due.length} erased=${result.purged} inactive=${inactive.length} inactive-erased=${result.inactiveErased} deferred=${result.deferred}`);
  return result;
}

/* THE SUBSCRIPTION EXPIRY SWEEP (Step 16). Bookkeeping, not enforcement: the
   entitlement resolver already treats a past expiry as dead. This flips the status
   so the partial unique index frees up and an admin is not shown an "active" row
   that ran out in March. */
export async function expireSubscriptions(
  db: PurgeDb,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<{ due: number; expired: number }> {
  const log = opts.log ?? (() => {});
  const where = and(
    eq(subscriptions.status, "active"),
    sql`${subscriptions.expiresAt} is not null and ${subscriptions.expiresAt} <= now()`,
  );
  const due: { id: string }[] = await db.select({ id: subscriptions.id }).from(subscriptions).where(where).limit(1000);
  if (opts.dryRun || due.length === 0) {
    log(`subscription-expiry${opts.dryRun ? " (dry-run)" : ""}: due=${due.length}`);
    return { due: due.length, expired: 0 };
  }
  const res: { id: string }[] = await db.update(subscriptions).set({ status: "expired" }).where(where).returning({ id: subscriptions.id });
  log(`subscription-expiry: expired=${res.length}`);
  return { due: due.length, expired: res.length };
}

export type RetentionRun = {
  dryRun: boolean;
  documents: PurgeResult | null;
  auth: AuthPurgeResult | null;
  accounts: AccountRetentionResult | null;
  subscriptions: { due: number; expired: number } | null;
  /** A job that THREW (as opposed to per-document errors inside job 1). */
  failedJobs: { job: string; error: string }[];
};

/* THE ONE RETENTION RUN, for `npm run db:purge` and POST /cron/purge alike.

   Four INDEPENDENT jobs: each is wrapped, so a failure in one (a missing
   STORAGE_DIR, a locked table) never stops the others — an expired account is
   erased even on the night the document store is unreachable. The caller decides
   what a failure means (exit code, HTTP status); `failedJobs` says which. */
export async function runRetention(
  db: PurgeDb,
  opts: { dryRun?: boolean; retentionDays?: number; log?: (line: string) => void } = {},
): Promise<RetentionRun> {
  const dryRun = opts.dryRun ?? false;
  const log = opts.log;
  const failedJobs: RetentionRun["failedJobs"] = [];
  async function job<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (err) {
      const error = `${(err as Error).name}: ${(err as Error).message}`.slice(0, 300);
      failedJobs.push({ job: name, error });
      log?.(`${name}: FAILED — ${error}`);
      return null;
    }
  }
  const documents = await job("documents", () => purgeExpiredVerificationDocs(db, { dryRun, retentionDays: opts.retentionDays, log }));
  const auth = await job("auth", () => purgeExpiredAuthRows(db, { dryRun, log }));
  const accounts = await job("accounts", () => purgeDeletedAccounts(db, { dryRun, log }));
  const subs = await job("subscriptions", () => expireSubscriptions(db, { dryRun, log }));
  return { dryRun, documents, auth, accounts, subscriptions: subs, failedJobs };
}
