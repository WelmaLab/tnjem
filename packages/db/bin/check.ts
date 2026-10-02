/* npm run db:check — can THIS box run Tnajem, right now?

   One command that answers the questions every "it works on my machine" cycle
   on this project started with: is the database reachable, has every numbered
   migration been applied, can the document store be written, and which config
   keys are present.

     npm run db:check                 development rules (production keys warn)
     npm run db:check -- --production production rules (production keys fail)
                                      — also implied by NODE_ENV=production

   NEVER PRINTS A VALUE. Every key is reported as set / empty / missing, and the
   object store is exercised without echoing its location. The server version
   is printed: it is not configuration.

   "Every migration applied" without a ledger: there is no schema_migrations
   table yet (Stage 6 adds one), so this reads packages/db/sql/*.sql and checks
   that every table they CREATE and every column they ADD exists. That catches
   the real failure — a new file nobody ran — and needs no bookkeeping. */
import { loadEnv, SQL_DIR } from "./_paths";
loadEnv();

import postgres from "postgres";
import { verifyMail, closeMail } from "@tnajem/shared/mail";
import { describeS3Error, objectStore, storageDriverName, type ObjectStore } from "../src/storage";
import { docEncryptionConfigured, openDoc, sealDoc } from "../src/doc-crypto";
import * as schema from "../src/schema";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/* The public fallback in packages/shared/src/auth-core.ts (DEV_SECRET). */
const PUBLIC_DEV_SECRET = "dev-insecure-secret-change-me";

const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
let failures = 0;
let warnings = 0;

const ok = (label: string, detail = "") => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
const warn = (label: string, detail: string) => {
  warnings++;
  console.log(`  ! ${label} — ${detail}`);
};
const fail = (label: string, detail: string) => {
  failures++;
  console.log(`  ✗ ${label} — ${detail}`);
};

type KeyState = "set" | "empty" | "missing";
function keyState(name: string): KeyState {
  const v = process.env[name];
  if (v === undefined) return "missing";
  return v.trim() ? "set" : "empty";
}

/** A key that must be set everywhere, or only in production. */
function requireKey(name: string, when: "always" | "production", why: string) {
  const state = keyState(name);
  if (state === "set") return ok(name, "set");
  if (when === "always" || production) return fail(name, `${state}. ${why}`);
  warn(name, `${state} (required in production). ${why}`);
}

function checkEnv() {
  console.log("\nConfiguration");
  requireKey("DATABASE_URL", "always", "Nothing can start without it.");
  requireKey("API_URL", "always", "The web app has nothing to call without it (demo mode needs TNAJEM_DEMO=1).");
  const driver = storageDriverName();
  if (!driver) fail("STORAGE_DRIVER", "set to an unknown driver (expected local or s3)");
  else if (driver === "local") {
    ok("STORAGE_DRIVER", keyState("STORAGE_DRIVER") === "set" ? "local" : "local (default)");
    requireKey("STORAGE_DIR", "always", "Unset, every workspace resolves a different cwd-relative store.");
  } else {
    ok("STORAGE_DRIVER", "s3");
    for (const k of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) requireKey(k, "always", "Required by the s3 driver.");
    for (const k of ["S3_ENDPOINT", "S3_REGION", "S3_FORCE_PATH_STYLE", "S3_PREFIX"]) {
      console.log(`  · ${k} — ${keyState(k)} (optional)`);
    }
  }

  const secret = process.env.AUTH_SECRET?.trim() ?? "";
  if (!secret) fail("AUTH_SECRET", `${keyState("AUTH_SECRET")}. Every OTP hash depends on it: openssl rand -hex 32`);
  else if (secret === PUBLIC_DEV_SECRET) fail("AUTH_SECRET", "set, but to the PUBLIC development default. Generate one: openssl rand -hex 32");
  else if (secret.length < 32) (production ? fail : warn)("AUTH_SECRET", "set, but shorter than 32 characters");
  else ok("AUTH_SECRET", "set, not the public default, 32+ characters");

  /* The key identity documents are sealed with. Reported as set / missing / malformed —
     and a round-trip proves it works, without ever printing it. */
  try {
    if (docEncryptionConfigured()) {
      const probe = Buffer.from("db:check");
      const back = openDoc("_check/probe", sealDoc("_check/probe", probe)).plaintext;
      if (back.equals(probe)) ok("DOC_ENCRYPTION_KEY", "set, 32 bytes, seal/open round-trip OK");
      else fail("DOC_ENCRYPTION_KEY", "set, but a seal/open round-trip returned different bytes");
    } else {
      (production ? fail : warn)("DOC_ENCRYPTION_KEY", `${keyState("DOC_ENCRYPTION_KEY")}. ID scans are stored unencrypted without it (the API refuses to start in production): openssl rand -hex 32`);
    }
  } catch {
    fail("DOC_ENCRYPTION_KEY", "set, but not 32 bytes (64 hex characters, or base64)");
  }
  if (keyState("DOC_ENCRYPTION_KEY_PREVIOUS") === "set") {
    warn("DOC_ENCRYPTION_KEY_PREVIOUS", "set: a key rotation is in progress. Run npm run db:encrypt-docs, then remove it.");
  }

  if (process.env.TNAJEM_DEMO === "1") {
    (production ? fail : warn)("TNAJEM_DEMO", "set to 1 — demo data is development-only");
  }

  requireKey("ADMIN_EMAILS", "production", "Empty means nobody can review verifications.");
  requireKey("CRON_SECRET", "production", "Unset, /cron/purge refuses to run and nothing is ever purged.");
  requireKey("CORS_ORIGINS", "production", "Empty in production, the API refuses to boot.");
  requireKey("TRUSTED_PROXIES", "production", "Unset in production, the API refuses to boot (one rate-limit bucket for every visitor).");
  if (production) {
    /* Reported as production / not production: a boolean, not the value. */
    if (process.env.NODE_ENV === "production") ok("NODE_ENV", "production");
    else fail("NODE_ENV", "not production. The API treats unset as production, but Next, npm and every other tool on the box read it too: set NODE_ENV=production.");
  }
  requireKey("NEXT_PUBLIC_SITE_URL", "production", "Canonical links and the sitemap fall back to https://tnajem.com.");

  /* Error tracking is optional everywhere, so this only ever reports — it must not
     fail a deploy. It is worth a line because "we thought errors were being
     reported" is a failure you only discover during the incident you needed it
     for: db:check is where an operator looks to find out whether it is actually on.
     Never the value — a DSN identifies the project. */
  if (keyState("SENTRY_DSN") === "set") {
    ok("SENTRY_DSN", `set — server-side error reporting is ON (env: ${process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV?.trim() || "production"})`);
  } else {
    (production ? warn : ok)("SENTRY_DSN", "not set — server errors are logged but not reported anywhere (OBSERVABILITY.md)");
  }

  const mailKeys = ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"];
  const mailMissing = mailKeys.filter((k) => keyState(k) !== "set");
  if (mailMissing.length === 0) ok("MAIL_*", "HOST, USER, PASS, FROM_ADDRESS set (login tested below)");
  else if (production) fail("MAIL_*", `${mailMissing.join(", ")} not set — no login code can be delivered`);
  else warn("MAIL_*", `${mailMissing.join(", ")} not set — login codes are shown on screen (dev only)`);
}

/** Tables created and columns added by the numbered migrations. */
async function expectedSchema() {
  const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const tables = new Set<string>();
  const columns = new Set<string>(); // "table.column"
  for (const file of files) {
    const text = (await readFile(join(SQL_DIR, file), "utf8")).replace(/--[^\n]*/g, "");
    for (const m of text.matchAll(/create\s+table\s+if\s+not\s+exists\s+"?(?:public\.)?"?([a-z_]+)"?/gi)) {
      tables.add(m[1]);
    }
    for (const stmt of text.matchAll(/alter\s+table\s+(?:only\s+)?"?(?:public\.)?"?([a-z_]+)"?([^;]*);/gi)) {
      // Digits allowed after the first letter: "reminder_24h_sent_at" (0039) is a legal name.
      for (const c of stmt[2].matchAll(/add\s+column\s+if\s+not\s+exists\s+"?([a-z_][a-z0-9_]*)"?/gi)) {
        columns.add(`${stmt[1]}.${c[1]}`);
      }
    }
  }
  return { files, tables, columns };
}

async function checkDatabase() {
  console.log("\nDatabase");
  const url = process.env.DATABASE_URL;
  if (!url) return fail("connection", "skipped — DATABASE_URL is not set");

  let sql: ReturnType<typeof postgres>;
  try {
    sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
  } catch {
    return fail("connection", "DATABASE_URL is set but is not a valid connection URL");
  }
  try {
    const [{ version }] = await sql<{ version: string }[]>`select version()`;
    ok("connection", version.split(",")[0]);

    const { files, tables, columns } = await expectedSchema();
    const presentTables = new Set(
      (await sql<{ t: string }[]>`
        select table_name as t from information_schema.tables where table_schema = 'public'`).map((r) => r.t),
    );
    const presentColumns = new Set(
      (await sql<{ c: string }[]>`
        select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public'`).map((r) => r.c),
    );
    const missingTables = [...tables].filter((t) => !presentTables.has(t));
    const missingColumns = [...columns].filter((c) => !presentColumns.has(c));
    const latest = files[files.length - 1];
    if (missingTables.length === 0 && missingColumns.length === 0) {
      ok("migrations", `${files.length} files through ${latest}: ${tables.size} tables and ${columns.size} added columns present`);
    } else {
      fail(
        "migrations",
        `not fully applied (latest file ${latest}). Missing ` +
          [missingTables.length ? `tables: ${missingTables.join(", ")}` : "", missingColumns.length ? `columns: ${missingColumns.join(", ")}` : ""]
            .filter(Boolean)
            .join("; ") +
          ". Run: npm run db:sql",
      );
    }

    await checkSchemaMatches(sql);
  } catch (e) {
    fail("connection", `cannot reach the database (${(e as { code?: string }).code ?? (e as Error).name})`);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

/* schema.ts ↔ the database, column for column (phase-a/verify-fix D9).

   The migrations check above reads the SQL files only; it never looked at
   packages/db/src/schema.ts, although "schema and migrations match column for
   column" was cited as its proof. This compares what the app's Drizzle schema
   declares (every exported pgTable: table, column, NOT NULL) with what the
   database actually has, both ways, so a schema.ts that drifted from the SQL —
   a column the code writes that no migration adds, or a NOT NULL one side does
   not know about — fails the gate instead of the first request. */
async function checkSchemaMatches(sql: ReturnType<typeof postgres>) {
  const declared = new Map<string, boolean>(); // "table.column" → notNull
  const declaredTables = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    declaredTables.add(cfg.name);
    for (const col of cfg.columns) declared.set(`${cfg.name}.${col.name}`, col.notNull);
  }
  const rows = await sql<{ t: string; c: string; nullable: string }[]>`
    select table_name as t, column_name as c, is_nullable as nullable
      from information_schema.columns
     where table_schema = 'public' and table_name in ${sql([...declaredTables])}`;
  const actual = new Map(rows.map((r) => [`${r.t}.${r.c}`, r.nullable === "NO"]));
  const missing = [...declared.keys()].filter((k) => !actual.has(k));
  const undeclared = [...actual.keys()].filter((k) => !declared.has(k));
  const nullability = [...declared].filter(([k, notNull]) => actual.has(k) && actual.get(k) !== notNull).map(([k]) => k);
  if (missing.length === 0 && undeclared.length === 0 && nullability.length === 0) {
    ok("schema.ts", `${declaredTables.size} tables and ${declared.size} columns match the database, NOT NULL included`);
  } else {
    fail(
      "schema.ts",
      [
        missing.length ? `declared but not in the database: ${missing.join(", ")}` : "",
        undeclared.length ? `in the database but not in schema.ts: ${undeclared.join(", ")}` : "",
        nullability.length ? `NOT NULL differs: ${nullability.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }
}

/* Through the SAME driver the API uses (objectStore()), so this proves the thing
   uploads will actually hit — not merely a directory that happens to be writable. */
async function checkStorage() {
  console.log("\nDocument store");
  const driver = storageDriverName();
  if (driver === "local" && !process.env.STORAGE_DIR?.trim()) {
    return fail("put/get/stream/delete", "skipped — STORAGE_DIR is not set");
  }
  const key = `_check/${process.pid}-${randomBytes(4).toString("hex")}`;
  const body = Buffer.from(`db:check ${new Date().toISOString()}`);
  let store: ObjectStore;
  try {
    store = objectStore();
  } catch (e) {
    // objectStore() messages name keys, never values.
    return fail("put/get/stream/delete", `skipped — ${(e as Error).message}`);
  }
  try {
    await store.put(key, body);
    const back = await store.get(key);
    const opened = await store.open(key);
    const chunks: Buffer[] = [];
    if (opened) for await (const c of opened.stream) chunks.push(c as Buffer);
    const removed = await store.delete(key);
    const after = await store.stat(key);
    await store.pruneEmpty("_check");
    if (!back || !back.equals(body)) return fail("put/get/stream/delete", "get returned different bytes");
    if (!opened || opened.size !== body.length || !Buffer.concat(chunks).equals(body)) {
      return fail("put/get/stream/delete", "the stream returned different bytes");
    }
    if (removed !== "deleted" || after !== null) return fail("put/get/stream/delete", "the object survived delete");
    ok("put/get/stream/delete", `sentinel round-tripped through the ${store.driver} driver`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    fail("put/get/stream/delete", `failed (${code === "BUCKET_UNREACHABLE" ? (e as Error).message : code ?? describeS3Error(e)})`);
    await store.delete(key).catch(() => {});
  }
}

/* Presence was never the question that mattered: a set MAIL_PASS that Gmail rejects
   means nobody can log in, and the first to find out is a user. verify() connects and
   authenticates without sending anything. */
async function checkMail() {
  console.log("\nMail");
  const keys = ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"];
  if (keys.some((k) => keyState(k) !== "set")) {
    return (production ? fail : warn)("SMTP login", "skipped — MAIL_* incomplete (see Configuration)");
  }
  const res = await verifyMail();
  closeMail();
  if (res.ok) ok("SMTP login", "connected and authenticated (nothing sent)");
  else (production ? fail : warn)("SMTP login", `failed: ${res.error}`);
}

async function main() {
  console.log(`Tnajem db:check — ${production ? "PRODUCTION" : "development"} rules`);
  checkEnv();
  await checkDatabase();
  await checkStorage();
  await checkMail();
  console.log(`\n${failures === 0 ? "✓ OK" : `✗ ${failures} failure(s)`}${warnings ? `, ${warnings} warning(s)` : ""}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  /* Name and the first stack frame (a code location) — not the message, which for
     a driver error can carry connection details. */
  const frame = String((e as Error)?.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  console.error(`✗ db:check crashed: ${(e as Error)?.name ?? typeof e} ${frame.trim()}`);
  process.exit(1);
});
