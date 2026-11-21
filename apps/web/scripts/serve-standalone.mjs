/* Run the production server the way `output: "standalone"` requires.

   `next start` DOES NOT WORK with output:"standalone" -- it prints "Ready",
   listens, and then never answers a request. Next says so in a warning that is
   easy to miss because the server looks healthy.

   The standalone bundle is also incomplete by design: `next build` traces server
   code into .next/standalone but does NOT copy .next/static or public/, so a
   server started from it renders HTML with 404s on every chunk and asset.

   MONOREPO: with experimental.outputFileTracingRoot pointed at the repo root, the
   entry point is .next/standalone/<relative path of this app>/server.js -- i.e.
   .next/standalone/apps/web/server.js -- and node_modules lands beside it at
   .next/standalone/node_modules. Every Dockerfile snippet on the internet assumes
   the flat .next/standalone/server.js, which is the usual cause of
   "Cannot find module '/app/server.js'". So locate server.js rather than assume
   it, and copy static/public next to the file we actually found.

   This is the wiring apps/web's Dockerfile needs in Step 5. */
import { cp, access, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preflight } from "./preflight.mjs";
import { webChildEnv, readEnvFiles } from "./web-env.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url))); // apps/web
const standalone = join(appRoot, ".next", "standalone");

/* WHICH ENV FILE.
     --env-file <path>   exactly that file, and it must exist. pm2 passes
                         <APP_DIR>/.env.web (ecosystem.config.cjs), which deploy.sh
                         generates from .env with the web allow-list: no secret in it.
     (none)              the LOCAL runner: repo-root .env.local, then .env, like every
                         other process here — a plain `npm run start:standalone`
                         would otherwise have no API_URL and be refused.
   A real environment variable beats the file, which is how the Playwright config
   pins its own (even blank ones).

   ALLOW-LIST, NOT dotenv.config (VULN-003). The files are PARSED, never loaded into
   this process's env, and the Next child is given only what web-env.mjs allows:
   API_URL, NEXT_PUBLIC_*, SENTRY_*, NODE_ENV, PORT, HOSTNAME, ALLOW_MINORS,
   OTP_CHANNEL, PAYMENTS_ENABLED, TNAJEM_DEMO, plus OS basics (PATH, TZ, ...). The
   root .env also holds DATABASE_URL, DOC_ENCRYPTION_KEY, AUTH_SECRET, CRON_SECRET and
   the mail/S3/SMS credentials; the web tier uses none of them, so it must not hold
   them — a web RCE or env leak must not be a database or ID-scan compromise. */
const argv = process.argv.slice(2);
const envFileAt = argv.indexOf("--env-file");
const envFile = envFileAt >= 0 ? argv[envFileAt + 1] : undefined;
if (envFileAt >= 0 && !envFile) {
  console.error("--env-file needs a path.");
  process.exit(1);
}
let fileVars = {};
try {
  fileVars = envFile
    ? await readEnvFiles([envFile], { required: true })
    : await readEnvFiles([join(appRoot, "../..", ".env.local"), join(appRoot, "../..", ".env")]);
} catch (err) {
  if (envFile) {
    console.error(`Cannot read --env-file ${envFile} (${err.code ?? err.message}).`);
    console.error("deploy.sh writes it from .env: node apps/web/scripts/web-env.mjs .env .env.web");
    process.exit(1);
  }
  /* no dotenv — rely on the real environment */
}
const port = process.env.PORT || fileVars.PORT || "3000";
const childEnv = webChildEnv(fileVars, process.env);
childEnv.PORT = port;
childEnv.HOSTNAME = childEnv.HOSTNAME || "localhost";
fileVars = null; // the secrets in a full .env are not kept around in this process
await preflight("start", childEnv);

/** Depth-first hunt for the traced server.js (flat or nested). */
async function findServer(dir, depth = 0) {
  if (depth > 4) return null;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return null; }
  if (entries.some((e) => e.isFile() && e.name === "server.js")) return dir;
  for (const e of entries) {
    if (e.isDirectory() && e.name !== "node_modules") {
      const hit = await findServer(join(dir, e.name), depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

await access(standalone).catch(() => {
  console.error("No .next/standalone — run `npm run build` first.");
  process.exit(1);
});

const serverDir = await findServer(standalone);
if (!serverDir) {
  console.error("No server.js under .next/standalone — the build did not emit a standalone bundle.");
  process.exit(1);
}

/* force:false — copy what is missing, never overwrite. Two processes started on ONE
   build (e2e: the suite's server plus the ALLOW_MINORS-unset one, Phase A+ P4) used
   to both overwrite the same files, and on Windows the second copy hit a file the
   first was serving: EBUSY, and the first server died. Static chunks are
   content-hashed, so a file that already exists is the same file. public/ is NOT
   hashed (an image can change under the same name), so it still overwrites — and
   its copy was already best-effort. */
await cp(join(appRoot, ".next", "static"), join(serverDir, ".next", "static"), { recursive: true, force: false, errorOnExist: false });
await cp(join(appRoot, "public"), join(serverDir, "public"), { recursive: true }).catch(() => {});

console.log(`standalone server on :${port}  (entry: ${join(serverDir, "server.js")})`);
/* "localhost", NOT "127.0.0.1" — still loopback-only, but the literal breaks every
   middleware rewrite. Next's server builds its own origin from HOSTNAME
   (http://127.0.0.1:3000) while NextURL, inside middleware, rewrites any 127.x
   host to "localhost" — so a rewrite never looks same-origin and Next PROXIES it
   to itself. Behind nginx (X-Forwarded-Proto: https) that proxy speaks TLS to a
   plain-HTTP port: on 15 Sept `GET /` — the site root, rewritten to /fr —
   answered 500 with "EPROTO wrong version number", and every 404 rewrite looped
   until the headers overflowed. preflight.mjs refuses a loopback literal. */
const child = spawn(process.execPath, [join(serverDir, "server.js")], {
  stdio: "inherit",
  env: childEnv, // the allow-list above — NOT ...process.env
});

/* FORWARD SIGNALS. This process is a supervisor, not the server: killing it does
   NOT kill the child, and the child is the one holding the port. pm2 reload sends
   SIGINT to the pm2-managed process (us) and SIGKILLs it after kill_timeout, so
   without this the old Next server keeps :3000 and the replacement dies with
   EADDRINUSE -- a deploy that reports success and serves the previous build. The
   systemd units in DEPLOY.md have the same shape. Exit only when the child does. */
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
