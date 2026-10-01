/* @tnajem/db — the schema, the connection factory, and the document store.

   This package OWNS the drizzle-orm dependency. Everything that builds a query
   imports the operators from here rather than from "drizzle-orm" directly, so
   there is exactly one place the ORM version is pinned and exactly one boundary
   to move when apps/api takes over the queries in Step 4.

   Gate 2 asserts that: `grep -rn "drizzle-orm" apps/web/app apps/web/components`
   must be 0. */

export * as schema from "./schema";
export * from "./schema";

export { createDb } from "./client";
export type { DbHandle, CreateDbOptions, Database, Sql } from "./client";

export {
  storageBase, storageKey, localStore, s3Store, s3ConfigFromEnv, objectStore, storageDriverName, describeS3Error, STORAGE_DRIVERS,
} from "./storage";
export type { ObjectStore, StoredObject, S3Config } from "./storage";
export { sealDoc, openDoc, isSealedDoc, docEncryptionConfigured, DocCryptoError, __resetDocKeyCache } from "./doc-crypto";
export type { OpenedDoc } from "./doc-crypto";

export { notify, REMINDER_CADENCE } from "./notify";
export { eraseAccount, isSlugRetired, slugHash, inactiveAccountsDue, ERASED_NAME } from "./erasure";
export type { ErasureResult, ErasureReason, ErasureDb } from "./erasure";
export type { NotifyInput, NotifyDb, ReminderStep, ReminderPayload } from "./notify";

// espace prof v2 · growth (P4, contract C5): e-mail preferences.
export { getNotificationPrefs, setNotificationPrefs, wantsEmail } from "./notification-prefs";

export {
  purgeExpiredVerificationDocs,
  purgeExpiredAuthRows,
  purgeDeletedAccounts,
  expireSubscriptions,
  runRetention,
  RETENTION_DAYS,
  DELETION_GRACE_DAYS,
} from "./retention";
export type { PurgeResult, AuthPurgeResult, PurgeDb, RetentionRun } from "./retention";

/* The query-builder surface the app uses. Re-exported so no consumer imports
   drizzle-orm directly — see the header. Add to this list rather than reaching
   past the package. */
export {
  eq,
  ne,
  and,
  or,
  not,
  sql,
  desc,
  asc,
  ilike,
  like,
  inArray,
  notInArray,
  isNull,
  isNotNull,
  gt,
  gte,
  lt,
  lte,
  between,
  count,
  countDistinct,
  exists,
  getTableColumns,
} from "drizzle-orm";
