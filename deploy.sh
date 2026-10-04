#!/usr/bin/env bash
# =============================================================================
#  deploy.sh — Tnajem, on the server
#
#  Runs ON THE VPS, called by .github/workflows/deploy.yml over SSH once it has
#  reset the checkout to origin/production and written $APP_DIR/.env from the
#  "deploy" GitHub Environment. Safe to run by hand for the same effect:
#
#      cd /var/www/tnajem && bash deploy.sh
#
#  Order matters. Install and BUILD first, while nothing is touched: a failed
#  build aborts here (set -e) and the running processes keep serving the previous
#  release. Only then migrate, check the configuration, and restart.
#
#  Two processes, separately supervised — see ecosystem.config.cjs:
#      tnajem-api   Fastify, loopback :4000
#      tnajem-web   Next.js standalone, :3000
# =============================================================================
set -euo pipefail

# ── Node on PATH ─────────────────────────────────────────────────────────────
# appleboy/ssh-action gives a NON-LOGIN, NON-INTERACTIVE shell: ~/.bashrc and
# ~/.profile are never read, so nvm's shim is absent and `node` does not exist.
# This must be here as well as in the workflow, because a hand-run over plain ssh
# hits exactly the same wall.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$PATH:/usr/local/bin:/usr/bin"

APP_DIR="${APP_DIR:-/var/www/tnajem}"
ECOSYSTEM="$APP_DIR/ecosystem.config.cjs"
# Pinned by deploy.yml (.env) and ecosystem.config.cjs respectively; overridable
# for a one-off run on a box that uses other ports.
API_PORT="${API_PORT:-4000}"
WEB_PORT="${WEB_PORT:-3000}"

# Which deploy an error report belongs to. Exported (not written into .env, which
# the workflow owns) so `pm2 start/reload --update-env` hands it to both processes;
# pm2 save then persists it, so a reboot resurrects the same tag. A hand-run without
# git still works — the apps fall back to tnajem@<package version>.
SENTRY_RELEASE="${SENTRY_RELEASE:-$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || true)}"
export SENTRY_RELEASE

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\n[deploy] FAILED: %s\n' "$1" >&2; exit 1; }

# Poll a URL until it answers and the body contains a needle. No fixed sleep:
# pm2 start returns as soon as it has forked, long before Fastify has a database
# connection or Next has compiled its first route.
wait_for() {
  local url="$1" secs="$2" needle="$3" body i=0
  while [ "$i" -lt "$secs" ]; do
    if body="$(curl -fsS --max-time 5 "$url" 2>/dev/null)"; then
      if printf '%s' "$body" | grep -q -- "$needle"; then printf '%s' "$body"; return 0; fi
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

# pm2 reload if the app is already known, pm2 start otherwise. `pm2 describe` is an
# EXACT name lookup: `pm2 list | grep -q tnajem` would match the other app's row
# and take the wrong branch the first time only one of the two exists.
pm2_up() {
  local app="$1"
  if pm2 describe "$app" >/dev/null 2>&1; then
    pm2 reload "$ECOSYSTEM" --only "$app" --env production --update-env
  else
    pm2 start "$ECOSYSTEM" --only "$app" --env production
  fi
}

echo "================================================="
echo " Tnajem — deploying in $APP_DIR"
echo " node $(node -v 2>/dev/null || echo 'MISSING') / npm $(npm -v 2>/dev/null || echo 'MISSING')"
echo "================================================="

cd "$APP_DIR"
[ -f .env ] || fail ".env is missing. The workflow writes it from the 'deploy' environment; for a hand-run, copy it in first."
[ -f "$ECOSYSTEM" ] || fail "ecosystem.config.cjs is missing — is $APP_DIR really the Tnajem checkout?"
mkdir -p logs

# ── 1. Dependencies ──────────────────────────────────────────────────────────
# --include=dev is NOT optional. This is a workspaces monorepo whose root
# devDependencies hold tsx, typescript, postgres and dotenv: every db:* script runs
# through tsx, and next build / tsup need their own dev deps. npm also reads
# NODE_ENV=production as --omit=dev, and NODE_ENV=production is exactly what this
# box exports — so being explicit is the difference between a deploy and a
# "tsx: not found" at the migration step.
step "Installing dependencies (root, workspaces)"
npm ci --include=dev

# ── 2. Build both apps, before anything is changed ───────────────────────────
step "Building the API (tsup -> apps/api/dist/server.js)"
npm run build -w @tnajem/api

step "Building the web app (next build --webpack -> standalone)"
# NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_DEFAULT_MEET_BASE are BAKED IN HERE, from
# the .env written above — setting them only at runtime ships production canonical
# links and sitemap on a staging box. The workflow never writes the meet base empty
# (it falls back to https://meet.jit.si/tnajem-), the code reads empty as that same
# default, and step 4's db:check refuses a value that is not an https:// URL prefix
# — after this build, but before anything is restarted (live-fixes-3 · B1).
npm run build -w @tnajem/web

# The standalone entry point is nested in a monorepo: .next/standalone/apps/web/,
# not the flat .next/standalone/server.js every example assumes. If Next ever stops
# emitting it, the runner would exit 1 at restart time with the site already down.
WEB_ENTRY="apps/web/.next/standalone/apps/web/server.js"
[ -f "$WEB_ENTRY" ] || fail "no $WEB_ENTRY — the build did not emit a standalone bundle. Nothing was restarted."

# ── 3. Schema ────────────────────────────────────────────────────────────────
# Raw, numbered, idempotent, transactional per file (packages/db/sql/). Forward
# only: there is no migrations ledger and no down migration — rolling back past a
# migration is safe only because every file is additive. db:push is disabled.
step "Applying migrations (npm run db:sql)"
# Two database roles (ops/vps-bootstrap.sh): migrations run as the OWNER, the apps
# run as the limited tnajem_app role, which can never ALTER a table or disable the
# admin_actions append-only trigger (0031). A real env var beats .env (dotenv never
# overrides), so DATABASE_URL is swapped for this one command only. If
# MIGRATION_DATABASE_URL is absent, fall back to DATABASE_URL (single-role boxes).
MIGRATION_URL="$(grep -m1 '^MIGRATION_DATABASE_URL=' .env | cut -d= -f2- || true)"
if [ -n "$MIGRATION_URL" ]; then
  DATABASE_URL="$MIGRATION_URL" npm run db:sql
else
  echo "   (no MIGRATION_DATABASE_URL — migrating with DATABASE_URL)"
  npm run db:sql
fi

# ── 4. Configuration gate ────────────────────────────────────────────────────
# Reports every key as set/empty/missing (never a value), verifies every migration
# landed, round-trips a real object through the document store, and CONNECTS TO
# SMTP. It exits 1 on anything production cannot run without, which aborts the
# deploy here — before pm2 is touched, with the previous release still serving.
#
# Consequence, deliberate: no deploy succeeds until MAIL_HOST/PORT/USER/PASS/
# FROM_ADDRESS are real, because without them nobody outside dev can log in.
step "Checking production configuration (npm run db:check -- --production)"
npm run db:check -- --production

# ── 5. Restart, API first ────────────────────────────────────────────────────
# API first so the web tier's first request has something to call.
step "Restarting tnajem-api"
pm2_up tnajem-api

step "Restarting tnajem-web"
pm2_up tnajem-web

pm2 save

# ── 6. Smoke test — the deploy is not finished until the box answers ─────────
step "Smoke test"
if health="$(wait_for "http://127.0.0.1:$API_PORT/health" 45 '"ok":true')"; then
  echo "   api  /health -> $health"
else
  pm2 logs tnajem-api --lines 40 --nostream || true
  fail "the API did not answer /health with ok:true on :$API_PORT"
fi
# A 200 with db:false is a REAL failure: the API is up and cannot reach Postgres.
# The reason is in the API log, never in the response body (/health is public and a
# connection error carries the host, port and user).
printf '%s' "$health" | grep -q '"db":true' || {
  pm2 logs tnajem-api --lines 40 --nostream || true
  fail "/health says db:false — the API is up but cannot reach Postgres"
}

# 127.0.0.1 deliberately, not localhost: this is the address nginx's proxy_pass uses,
# so the smoke test has to prove the same path a visitor takes. HOSTNAME=localhost lets
# the resolver choose, and on a box that answers ::1 first the web app binds IPv6
# loopback ONLY -- nginx then gets "connection refused" while pm2 reports a healthy
# process. Verified on the dev machine (Next 16 bound ::1 with HOSTNAME=localhost).
if wait_for "http://127.0.0.1:$WEB_PORT/fr" 90 '<h1' >/dev/null; then
  echo "   web  /fr     -> 200 with an <h1> on 127.0.0.1"
elif wait_for "http://localhost:$WEB_PORT/fr" 10 '<h1' >/dev/null; then
  fail "the web app answers on localhost:$WEB_PORT but NOT on 127.0.0.1:$WEB_PORT -- it bound IPv6 loopback only.
      nginx's 'proxy_pass http://127.0.0.1:$WEB_PORT' would get 'connection refused' for every request.
      Fix it in nginx: proxy_pass http://localhost:$WEB_PORT;
      Do NOT set HOSTNAME=127.0.0.1 -- that breaks every middleware rewrite (DEPLOY.md §5)."
else
  pm2 logs tnajem-web --lines 40 --nostream || true
  fail "the web app did not render /fr on :$WEB_PORT"
fi

echo ""
echo "================================================="
echo " Deployment complete — $(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
echo " pm2 status ; pm2 logs tnajem-api ; pm2 logs tnajem-web"
echo "================================================="
