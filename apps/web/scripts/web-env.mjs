/* The web tier's environment allow-list (VULN-003).

   The Next server holds NO backend secret. It never talks to Postgres, never
   decrypts an ID scan, never hashes an OTP, never sends mail and never signs a
   cron call: all of that lives in apps/api. So the process that renders pages
   gets the handful of variables it reads, and nothing else — an RCE or an
   env-disclosure bug in the web tier then leaks a site URL, not DOC_ENCRYPTION_KEY.

   Two users of this file:
     - scripts/serve-standalone.mjs builds the Next child's env with webChildEnv().
     - deploy.sh writes <APP_DIR>/.env.web from <APP_DIR>/.env with the CLI below,
       so the web process has its own env file that holds no secret at all:
           node apps/web/scripts/web-env.mjs <source .env> <dest .env.web>

   Inventory (every process.env read in apps/web, plus the @tnajem/shared modules
   the web imports at runtime): security-audit/env-split.md. Adding a variable the
   web reads at runtime means adding it HERE, or the server will not see it. */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Application variables the web server reads at runtime. Exact names. */
export const WEB_ENV_KEYS = Object.freeze([
  "NODE_ENV",
  "PORT",
  "HOSTNAME",
  "API_URL", //              lib/api.ts and every route handler — the only backend it knows
  "ALLOW_MINORS", //         packages/shared/src/age.ts (signup copy, consent layout)
  "OTP_CHANNEL", //          packages/shared/src/auth-core.ts::otpChannel (sign-in copy)
  "PAYMENTS_ENABLED", //     packages/shared/src/payments.ts::paymentsEnabled (tarifs, storefront)
  "TNAJEM_DEMO", //          preflight.mjs REFUSES it in production — so it must reach the check
  "SENTRY_DSN", //           lib/sentry-server.ts via shared/observability.ts
  "SENTRY_ENVIRONMENT",
  "SENTRY_RELEASE", //       exported by deploy.sh, handed over by pm2 --update-env
  "NEXT_TELEMETRY_DISABLED",
]);

/** NEXT_PUBLIC_* is public by definition: it is inlined into the browser bundle. */
export const WEB_ENV_PREFIXES = Object.freeze(["NEXT_PUBLIC_"]);

/** What any Node process needs from the OS, taken from the real environment only —
    never from an env file. NODE_OPTIONS carries --enable-source-maps (pm2). */
export const SYSTEM_ENV_KEYS = Object.freeze([
  "PATH", "Path", "PATHEXT", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "LC_ALL",
  "TZ", "TMPDIR", "TEMP", "TMP", "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS",
  // Windows: Node's DNS, crypto and os.tmpdir() look these up.
  "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "ProgramData", "ProgramFiles", "ALLUSERSPROFILE", "COMPUTERNAME", "NUMBER_OF_PROCESSORS",
]);

/** May the web server see this application variable? */
export function isWebEnvKey(key) {
  return WEB_ENV_KEYS.includes(key) || WEB_ENV_PREFIXES.some((p) => key.startsWith(p));
}

/** The Next child's whole environment. `fileVars` (parsed env files) and
    `processEnv` (the runner's real environment) are both filtered; a real
    variable beats the file even when it is empty, which is how the Playwright
    config pins a key blank ("blank beats .env"). */
export function webChildEnv(fileVars, processEnv) {
  const out = {};
  for (const [k, v] of Object.entries(fileVars ?? {})) {
    if (isWebEnvKey(k) && typeof v === "string") out[k] = v;
  }
  for (const [k, v] of Object.entries(processEnv ?? {})) {
    if (typeof v !== "string") continue;
    if (isWebEnvKey(k) || SYSTEM_ENV_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

/** dotenv.parse over several files; the FIRST file that sets a key wins, the same
    precedence as dotenv.config({path: .env.local}) then ({path: .env}). A missing
    file is skipped unless `required`. Nothing is written to process.env. */
export async function readEnvFiles(paths, { required = false } = {}) {
  const { parse } = await import("dotenv");
  const merged = {};
  for (const p of paths) {
    let text;
    try {
      text = readFileSync(p, "utf8");
    } catch (err) {
      if (required) throw err;
      continue;
    }
    for (const [k, v] of Object.entries(parse(text))) if (!(k in merged)) merged[k] = v;
  }
  return merged;
}

/** One `KEY=value` line dotenv parses back to exactly `value`. dotenv has no
    escape inside quotes, so pick a quote character the value does not contain. */
function envLine(key, value) {
  if (/^[^\s#'"`\\]*$/.test(value)) return `${key}=${value}`;
  const q = ["'", '"', "`"].find((c) => !value.includes(c));
  if (!q) throw new Error(`${key}: value holds every quote character; cannot write it safely`);
  return `${key}=${q}${value}${q}`;
}

/** The text of a web env file: allow-listed keys from `fileVars` only. */
export function webEnvFileText(fileVars) {
  const lines = Object.keys(fileVars)
    .filter(isWebEnvKey)
    .sort()
    .map((k) => envLine(k, fileVars[k]));
  return [
    "# GENERATED by deploy.sh from .env (apps/web/scripts/web-env.mjs). Do not edit:",
    "# edit .env and re-run deploy.sh. Holds NO secret — the web tier needs none.",
    ...lines,
    "",
  ].join("\n");
}

/* CLI: node web-env.mjs <source .env> <dest .env.web>. Prints key names only. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [src, dest] = process.argv.slice(2);
  if (!src || !dest) {
    console.error(`usage: node ${fileURLToPath(import.meta.url)} <source .env> <dest .env.web>`);
    process.exit(2);
  }
  const vars = await readEnvFiles([src], { required: true });
  writeFileSync(dest, webEnvFileText(vars), { mode: 0o600 });
  chmodSync(dest, 0o600); // mode above applies only when the file is created
  const keys = Object.keys(vars).filter(isWebEnvKey).sort();
  console.log(`   wrote ${dest}: ${keys.join(" ") || "(no keys)"}`);
}
