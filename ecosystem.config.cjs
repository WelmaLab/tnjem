/* pm2 process file — the two Tnajem processes, supervised separately.
 *
 * Since the backend split there is no single process to run: the Next.js front end
 * and the Fastify API are separate, hold different secrets (the web tier has no
 * DATABASE_URL at all) and fail independently. One pm2 app each, started by
 * deploy.sh:
 *
 *     pm2 start  ./ecosystem.config.cjs --only tnajem-api --env production
 *     pm2 reload ./ecosystem.config.cjs --only tnajem-web --env production
 *     pm2 logs tnajem-web        pm2 status        pm2 save
 *
 * .cjs, not .js: this file must be CommonJS (`module.exports`) whatever the root
 * package.json says, and the root has no "type" field today — a later
 * `"type": "module"` there would otherwise turn every pm2 command into a
 * "module is not defined" crash at deploy time. Paths come from __dirname for the
 * same class of reason: `pm2 start ./ecosystem.config.cjs` must behave identically
 * from the repo root, from a systemd unit, and from a non-login SSH shell.
 *
 * NO SECRETS HERE. Both processes read the repo-root .env themselves (apps/api via
 * src/env.ts, the web runner via scripts/serve-standalone.mjs), and that file is
 * written by .github/workflows/deploy.yml from the "deploy" GitHub Environment.
 * A real environment variable always wins over the file, which is what env_production
 * below relies on.
 */
const { join } = require("node:path");

const root = __dirname;
const log = (name) => ({
  out_file: join(root, "logs", `pm2-${name}-out.log`),
  error_file: join(root, "logs", `pm2-${name}-error.log`),
  log_date_format: "YYYY-MM-DD HH:mm:ss",
  merge_logs: true,
});

/* Shared supervision policy. restart_delay + max_restarts matter because both
   processes REFUSE TO START on bad configuration (assertBootConfig, preflight.mjs)
   — without a delay pm2 would spin on a missing AUTH_SECRET as fast as the CPU
   allows and bury the one log line that says why. */
const common = {
  instances: 1,
  exec_mode: "fork",
  autorestart: true,
  restart_delay: 3000,
  max_restarts: 10,
  max_memory_restart: "500M",
  watch: false,
};

module.exports = {
  apps: [
    {
      /* API — Fastify, loopback :4000 (API_PORT/API_HOST come from .env; nginx must
         never expose this port). The entry point is the tsup bundle, so `npm run
         build -w @tnajem/api` has to have run: deploy.sh builds before it reloads. */
      name: "tnajem-api",
      cwd: join(root, "apps", "api"),
      script: "dist/server.js",
      /* The bundle is minified-ish and chunked by tsup, which emits .map files next
         to it — with this flag Node applies them itself, so every stack trace (in
         the log AND in the error report) names a real file and line instead of
         chunk-KVXWOIF4.js:1:98214. No upload step, no auth token, no CI artifact. */
      node_args: ["--enable-source-maps"],
      ...common,
      ...log("api"),
      /* API_FORCE_START: server.ts only listens when process.argv[1] is server.js.
         Under pm2, argv[1] is pm2's ProcessContainerFork.js, so without this the API
         loads, never binds :4000 and logs nothing (first deploy, 30 Sept 2026). */
      env: { NODE_ENV: "development", API_FORCE_START: "1" },
      /* The API treats an UNSET NODE_ENV as production, so this line is belt and
         braces rather than the guard itself — but npm, Next and everything else on
         the box read NODE_ENV too, and the pm2-managed environment is the one place
         a human looks first. */
      env_production: { NODE_ENV: "production", API_FORCE_START: "1" },
    },
    {
      /* Web — the standalone runner, NOT `next start` (which logs "Ready", binds the
         port and then answers nothing under output: "standalone"). The runner loads
         the root .env, runs the preflight, copies .next/static + public/ next to the
         traced server, and spawns it. */
      name: "tnajem-web",
      cwd: join(root, "apps", "web"),
      script: "scripts/serve-standalone.mjs",
      ...common,
      ...log("web"),
      /* The runner spawns a child and forwards SIGINT/SIGTERM to it; give that child
         time to finish in-flight requests before pm2 escalates to SIGKILL. Shorter
         than pm2's own default listen timeout on purpose. */
      kill_timeout: 8000,
      env: { NODE_ENV: "development", PORT: "3000" },
      env_production: {
        NODE_ENV: "production",
        PORT: "3000",
        /* "localhost", NEVER the 127.0.0.1 literal. Next builds its own origin from
           HOSTNAME while middleware rewrites any 127.x host to "localhost", so with
           the literal no rewrite looks same-origin and Next proxies to itself —
           behind nginx that proxy speaks TLS to a plain-HTTP port and GET / answers
           500. preflight.mjs refuses a loopback literal for this reason. */
        HOSTNAME: "localhost",
        /* Same reason as the API's node_args, but it has to be NODE_OPTIONS here:
           pm2 supervises the runner, and the Next server is the CHILD it spawns —
           node_args would flag the parent only. NODE_OPTIONS is inherited.
           (next.config.mjs turns on experimental.serverSourceMaps so the .map
           files exist to be applied; they never reach a browser.)
           If a cold `next build` is OOM-killed on a small VPS, that is a BUILD
           flag, not this one: NODE_OPTIONS=--max-old-space-size=1024 bash deploy.sh. */
        NODE_OPTIONS: "--enable-source-maps",
      },
    },
  ],
};

/* NOT cluster mode, for both apps, deliberately:
   - tnajem-web is a supervisor + child. pm2 cluster mode forks the SCRIPT, so each
     worker would spawn its own Next server on the same PORT and all but one would
     die with EADDRINUSE.
   - tnajem-api would multiply DB_POOL_MAX (default 10) by the worker count against
     a stock Postgres that allows ~87 usable connections (see .env.example). Scaling
     the API means lowering DB_POOL_MAX in the same change, and past ~4 workers it
     means PgBouncer, not more workers. SCALABILITY.md §2 has the numbers. */
