import { config } from "dotenv";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { objectStore } from "@tnajem/db/storage";
import { docEncryptionConfigured } from "@tnajem/db/doc-crypto";

/* Config, loaded from the REPO ROOT rather than cwd.

   Same rule as packages/db/bin/_paths.ts and for the same reason: cwd is
   whichever workspace launched the process, so a cwd-relative .env silently
   loads nothing and every secret comes back undefined. */

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function repoRoot(): string {
  let dir = PKG_ROOT;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        if (j.workspaces) return dir;
      } catch {
        /* keep walking */
      }
    }
    const up = resolve(dir, "..");
    if (up === dir) break;
    dir = up;
  }
  return PKG_ROOT;
}

/* PRECEDENCE: a real environment variable BEATS both files.

   Neither call passes override:true, which is deliberate and was learned the hard
   way. The CLI scripts use override on .env.local so a stray shell DATABASE_URL
   cannot silently point a migration at the wrong database — that is right for a
   one-shot script a human runs by hand.

   It is WRONG for a long-running service. A server must be configurable by its
   environment: a container, a systemd unit, CI, and the E2E harness all set
   variables deliberately. With override:true, .env.local silently won — the test
   suite passed STORAGE_DIR pointing at .e2e-storage, .env.local replaced it with
   apps/web/.storage, and every ID-scan read 404'd because the API was looking in a
   directory the fixtures had never written to. The API was, in effect, not
   configurable at all.

   dotenv skips a key that is already present in process.env, so this gives the
   standard order: process env > .env.local > .env. */
const root = repoRoot();
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

export const PORT = Number(process.env.API_PORT ?? 4000);
export const HOST = process.env.API_HOST ?? "127.0.0.1";
/* UNSET MEANS PRODUCTION. It used to mean development, and every safety rule in
   this service is gated on IS_PROD: the OTP code shown on screen when no mail
   provider is configured, the AUTH_SECRET / CORS_ORIGINS boot checks, the
   STORAGE_DIR guard. The built dist reads NODE_ENV at runtime and only the API
   Dockerfile set it — so the documented pm2/systemd deploy ran in development
   mode, and one mistyped MAIL_* key turned the login screen into "type an admin's
   address, read their code" (security review, 15 Sept 2026).

   Development is now something you ASK for: `npm run dev` preloads src/dev-env.ts,
   the test runner preloads test/test-env.ts, and the e2e config sets it for the API
   it starts. Written back to process.env so packages/shared and packages/db, which
   read it directly, agree with this module. */
if (!process.env.NODE_ENV?.trim()) process.env.NODE_ENV = "production";
export const NODE_ENV = process.env.NODE_ENV;
export const IS_PROD = NODE_ENV === "production";

/** Read at boot from package.json so /health reports something real. */
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/* CORS. An EXACT origin allow-list, never "*".

   Credentials are cookies here, and `Access-Control-Allow-Origin: *` is not even
   legal alongside `Allow-Credentials: true` — but the failure mode that matters is
   the one where someone "fixes" a CORS error by reflecting the request's Origin
   header, which is functionally the same as "*" and hands any site on the internet
   the ability to make authenticated requests as the logged-in user. */
export const CORS_ORIGINS: string[] = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

/* Cookie domain. Scoped to .tnajem.com in production so tnajem.com and
   api.tnajem.com share the session cookie. Unset in dev, where both are
   localhost and a domain attribute would break it. */
export const COOKIE_DOMAIN = process.env.COOKIE_DOMAIN?.trim() || undefined;

/* ══════════════════════════════════════════════════════════════════════════════
   TRUST PROXY — the single highest-severity setting in the split.

   clientIp() keys the OTP rate limiter: otp:req:ip (10 per 10 min) and
   otp:vfy:ip (30 per 15 min). Once the browser no longer talks to the process
   that throttles it, that key has to survive one extra hop, and there are exactly
   two ways to get it wrong:

     trustProxy: false  → the API sees the WEB SERVER's address for every user.
       All traffic collapses into ONE bucket: one attacker exhausts the limit for
       the entire internet, and every real user's throttle is spent by strangers.

     trustProxy: true   → X-Forwarded-For becomes attacker-controlled. Anyone can
       rotate the header and bypass the per-IP limiter entirely — strictly worse
       than the monolith, where the header could not be forged past the platform.

   So: trust a SPECIFIC address (the web app, or the reverse proxy in front of
   it), never a boolean true. Fastify accepts a string/array of trusted hops.

   This is wired NOW, in Step 3, before any action moves — a half-ported process
   would otherwise put the same user in two different buckets.

   Values that mean "trust every hop" are dropped here and refused at boot. */
const TRUST_EVERYONE = new Set(["true", "*", "0.0.0.0/0", "::/0", "all"]);

export const TRUST_PROXY: string[] | boolean = (() => {
  const raw = process.env.TRUSTED_PROXIES?.trim();
  if (raw) return raw.split(",").map((s) => s.trim()).filter((s) => s && !TRUST_EVERYONE.has(s.toLowerCase()));
  // Dev: the web app runs on loopback, so trust only loopback.
  if (!IS_PROD) return ["127.0.0.1", "::1"];
  /* Production with nothing configured: trust NOTHING (assertBootConfig refuses to
     start this way; this is what a process that skipped the boot check gets). */
  return false;
})();

export function assertBootConfig(): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL?.trim()) missing.push("DATABASE_URL");
  if (IS_PROD && !process.env.AUTH_SECRET?.trim()) missing.push("AUTH_SECRET");
  if (IS_PROD && CORS_ORIGINS.length === 0) missing.push("CORS_ORIGINS");
  /* TRUSTED_PROXIES is required in production. Unset used to be tolerated as "the
     safe failure", but under docker compose every visitor then arrives from the web
     container's address: ONE rate-limit bucket for the whole site, so ten requests
     from anyone lock every user out of login, repeatably. A value that trusts every
     hop is refused too — it would make X-Forwarded-For attacker-controlled. */
  const proxies = process.env.TRUSTED_PROXIES?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  if (proxies.some((p) => TRUST_EVERYONE.has(p.toLowerCase()))) {
    console.error("[tnajem-api] FATAL CONFIG: TRUSTED_PROXIES trusts every hop. List the web tier's addresses. Refusing to start.");
    process.exit(1);
  }
  if (IS_PROD && proxies.length === 0) missing.push("TRUSTED_PROXIES");
  /* The retention purge keeps promises /privacy makes (ID scans gone after 90 days,
     accounts erased after the grace). Without CRON_SECRET the endpoint refuses to
     run, so a production API without it has a legal promise nobody can keep. */
  if (IS_PROD && !process.env.CRON_SECRET?.trim()) missing.push("CRON_SECRET");
  /* Identity documents are sealed at rest; production does not start without the
     key, and a malformed key stops every environment. The message names the key. */
  try {
    if (IS_PROD && !docEncryptionConfigured()) missing.push("DOC_ENCRYPTION_KEY");
  } catch (e) {
    console.error(`[tnajem-api] FATAL CONFIG: ${(e as Error).message}. Refusing to start.`);
    process.exit(1);
  }
  /* The object store, resolved now rather than at the first upload: an unknown
     STORAGE_DRIVER, S3 settings with keys missing, or (production) no STORAGE_DIR
     would otherwise surface as a tutor whose ID scan failed to save. Resolving it
     makes no network call, so boot does not depend on the bucket being up;
     db:check proves the round-trip. The messages name keys, never values. */
  let storageProblem: string | null = null;
  try {
    objectStore();
  } catch (e) {
    storageProblem = (e as Error).message.replace(/\.$/, "");
  }
  if (missing.length) console.error(`[tnajem-api] FATAL CONFIG: missing ${missing.join(", ")}. Refusing to start.`);
  if (storageProblem) console.error(`[tnajem-api] FATAL CONFIG: storage — ${storageProblem}. Refusing to start.`);
  if (missing.length || storageProblem) process.exit(1);
}
