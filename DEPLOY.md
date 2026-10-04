# Deploying Tnajem to a VPS

Since the backend split there are **two processes**, not one:

| process | port | holds |
| --- | --- | --- |
| `@tnajem/web` — Next.js | 3000 | no database credentials at all |
| `@tnajem/api` — Fastify | 4000 | `DATABASE_URL`, `AUTH_SECRET`, `MAIL_*`, the ID scans |

Two ways to run them. **§A** is plain Node behind nginx with the Postgres already
on your VPS — the recommended shape, and what the rest of this document assumes.
**§B** is `docker compose`, which is also how the test suite runs. Steps marked
**(you)** need your server/accounts.

> **Two things will bite you if you skip them.** §7 (the ID-document purge cron —
> `/privacy` already promises it to every tutor) and §3's `STORAGE_DIR` (must be a
> **persistent** volume, or every ID scan vanishes on redeploy).

Once it is running, **OBSERVABILITY.md** is the other half of this document: the
health endpoints, the log shapes, the six alerts worth setting up, and the runbook
for the three failures you are most likely to meet (database unreachable, mail
provider down, storage unavailable).

---

## 0. Local sanity check (you)
```
npm run typecheck    # every workspace + e2e/
npm run build        # builds BOTH apps; dev is lenient, the prod build is strict
npm run test         # API unit tests, then Playwright
```
Commit `package-lock.json` (run `npm install` once) for reproducible installs.

## 1. VPS prerequisites (you)
- Ubuntu/Debian VPS with **Node 22** (`nvm install 22` or NodeSource) and
  **Postgres 18 running**. Node 22 is what both Dockerfiles pin; 20 will probably
  work but is not what anything is tested on.
- Get the code on the box: `git clone …`, then `npm ci` **at the repo root** — this
  is a workspaces monorepo, and installing inside `apps/web` will not link
  `@tnajem/shared`.

## 2. Database (you)
```
sudo -u postgres psql -c "CREATE DATABASE tnajem;"
# (optional dedicated role instead of the superuser:)
# sudo -u postgres psql -c "CREATE ROLE tnajem LOGIN PASSWORD 'strongpass'; ALTER DATABASE tnajem OWNER TO tnajem;"
```
`packages/db/sql/0000_init.sql` is a real baseline — an empty database is fully
created by `npm run db:sql` (§4). You do not need to load a dump first.

## 3. Environment — one `.env` at the repo root

Both processes read the repo-root `.env` (and `.env.local`, which wins). A real
environment variable beats both — that is deliberate, so systemd, a container or
CI can configure the API without editing a file.

```
# ── Required by the API ────────────────────────────────────────────────────
NODE_ENV=production                        # unset is treated as production too — see below
DATABASE_URL=postgresql://tnajem:strongpass@127.0.0.1:5432/tnajem   # NO ?schema=public
AUTH_SECRET=<run: openssl rand -hex 32>
ADMIN_EMAILS=you@example.com               # who may approve tutors at /admin/verifications
STORAGE_DIR=/var/lib/tnajem/storage        # PERSISTENT, ABSOLUTE — see below
CRON_SECRET=<run: openssl rand -hex 32>    # protects /cron/purge — see §7
DOC_ENCRYPTION_KEY=<run: openssl rand -hex 32>  # seals ID scans at rest — see below; LOSE IT = scans unreadable
CORS_ORIGINS=https://tnajem.com,https://www.tnajem.com
TRUSTED_PROXIES=127.0.0.1                  # the web tier's address — REQUIRED, see below
API_PORT=4000
API_HOST=127.0.0.1                         # loopback only; nginx is the front door

# ── Required by the web app ────────────────────────────────────────────────
API_URL=http://127.0.0.1:4000              # server-side only, NEVER NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=https://tnajem.com     # canonical origin
NEXT_PUBLIC_SUPPORT_WHATSAPP=              # optional: support number, digits only (e.g. country code + number, no "+"); empty = the /account support row is hidden
ALLOW_MINORS=                              # leave EMPTY: the pilot is adults only (Phase A, D6). "1" re-opens minor sign-up + booking with guardian consent — only after Phase D

# ── Login e-mail (without this, nobody outside dev can log in) ─────────────
OTP_CHANNEL=email
MAIL_HOST=smtp.example.com
MAIL_PORT=465
MAIL_USER=...
MAIL_PASS=...
MAIL_FROM_ADDRESS=no-reply@tnajem.com
MAIL_FROM_NAME=Tnajem

# ── Database tuning (optional — the defaults are right for a single VPS) ───
# DB_POOL_MAX=10   # postgres.js pool size PER NODE PROCESS. Default 10.
# DB_PREPARE=1     # server-side prepared statements. Set to 0 ONLY with PgBouncer.
# DB_SSL=require   # force TLS (auto: on for a remote host, off over loopback)

# ── Payments: LEAVE UNSET ──────────────────────────────────────────────────
# PAYMENTS_ENABLED=1
```

**Check it before you start anything:** `npm run db:check -- --production` reports
every key as set / empty / missing (never a value), connects to the database,
confirms every numbered migration is applied, and round-trips a file through
`STORAGE_DIR`. It exits 1 on anything production cannot run without.

**`DOC_ENCRYPTION_KEY` seals every identity document at rest** (AES-256-GCM, a
fresh IV per file, the storage path bound in so a file moved onto another tutor's
path fails to open). The API refuses to start in production without it, and refuses
to serve an unencrypted document there. Store it in your secret manager and **never
in the same place as the storage backups** — a backup plus its key is a disclosure.
Lose it and every stored scan is unreadable; tutors would have to upload again.

- **Encrypting files that predate this** (a dev or staging copy):
  `npm run db:encrypt-docs -- --dry-run`, then without `--dry-run`. Counts only.
- **Rotating the key:** set the new key as `DOC_ENCRYPTION_KEY` and the old one as
  `DOC_ENCRYPTION_KEY_PREVIOUS`, restart the API (both open, the new one seals),
  run `npm run db:encrypt-docs`, then remove the previous key and restart.

**How an admin opens a document.** Never by its id: the review queue gives each
admin, for each document, a link that works for **10 minutes** and only with **that
admin's session** (an expired link answers 410 and says to reload the page). The
document **downloads** (`Content-Disposition: attachment`), and every read writes
an `admin_actions` row (`verification.doc.read`, with the request id) **before** a
byte is sent — if the row cannot be written, nothing is sent.

**The web server refuses to start on a bad config.** `apps/web/scripts/preflight.mjs`
runs before `server.js` (the Dockerfile `CMD`, and `npm run start:standalone`) and
exits 1 without `API_URL` or with `TNAJEM_DEMO=1`. There is no demo data in
production, by construction. It does not ask for `AUTH_SECRET`: the web app never
reads it — only the API does, and the API refuses to boot without it.

**`API_URL` must not be `NEXT_PUBLIC_`.** The browser never calls the API; the web
server does, from inside the box. Prefixing it would bake a private address into
the client bundle and invite someone to "fix" it by exposing port 4000 publicly.

**The web app has no `DATABASE_URL` and must not be given one.** If you find
yourself adding it, something has been ported backwards.

**`ADMIN_EMAILS`, not `ADMIN_PHONES`.** Login is e-mail OTP; most admin profiles
have no phone number at all, so a phone allow-list rejects every admin — which
previously showed up as a 403 on every identity-document view. `ADMIN_PHONES` is
still read when `OTP_CHANNEL=sms`, which is not the shipped configuration.

**`AUTH_SECRET` is a hard requirement in production.** It is the key every OTP hash
is derived from (`sha256(identifier:code:AUTH_SECRET)`), so a deploy that forgets
it would ship auth whose hashes an attacker can precompute from a default string
that is public in this repo. It resolves **lazily** (on the first OTP hash, not at
module load) *by design*: every page's server bundle imports auth, so a
module-load throw would kill `next build` on any box that injects secrets at
runtime. The API is stricter — `assertBootConfig()` **refuses to start** without it
in production, because Fastify has no build step to protect. If you see
*"FATAL CONFIG: AUTH_SECRET is not set"*, that check is doing its job.

**`CORS_ORIGINS` is an exact allow-list and the API refuses to start without it in
production.** Never `*`, and never reflect the request's `Origin` header — the
credentials here are cookies, and reflecting the origin hands any site on the
internet the ability to make authenticated requests as the logged-in user.

**`TRUSTED_PROXIES` decides whether the OTP rate limiter works.** `clientIp()` keys
`otp:req:ip` (10 per 10 min) and `otp:vfy:ip` (30 per 15 min). Now that the browser
talks to nginx and Next rather than to the throttling process, that key survives
two hops, and there are exactly two ways to get it wrong:

- **unset** → the API sees the web server's address for every user. All traffic
  collapses into **one bucket**: ten requests from anyone lock every user out of
  login, repeatably. **The API refuses to start in production without it.**
- **`true`** → `X-Forwarded-For` becomes attacker-controlled and the per-IP limiter
  is bypassed by rotating a header. **Strictly worse than not splitting at all.**

So list **specific addresses** — the web tier's, and nothing else.

**`DB_POOL_MAX` (default 10)** is the pool size of **one Node process**. What
Postgres sees is `workers × DB_POOL_MAX`. Stock Postgres allows 100 connections,
3 reserved for superusers, and you want ~10 spare for psql/backups/the purge cron
— so keep the product **under ~87**. One API process at the default = 10; a
2-worker pm2 cluster = 20. Both are comfortable. If you raise the worker count,
**lower `DB_POOL_MAX`**. Raising the pool is *not* how you scale: a Postgres
backend is a forked process (~5-10MB), and throughput peaks around 2-4× CPU cores
of concurrently active queries. When 87 stops being enough the answer is
**PgBouncer**, not a bigger number (SCALABILITY.md §2).

**`DB_PREPARE`** — leave it on (the default). Prepared statements are a real win
on the hot point-lookups (`sessions.token`, `tutors.slug`). Set **`DB_PREPARE=0`
in the same change that introduces PgBouncer in transaction-pooling mode**, and
not before: a prepared statement lives on a server connection the next transaction
may not be handed back, so PgBouncer + prepare is a source of intermittent
"prepared statement does not exist" errors.

**`DB_SSL`** is auto-detected from the host and normally needs no value: TLS is
required when the database host is remote, and skipped over loopback (a default
local Postgres does not offer TLS, and forcing `require` there is a guaranteed
connection error). **The heuristic cannot tell a private container network from
the open internet**, which is why `docker-compose.yml` sets `DB_SSL=0` explicitly —
without it the API came up, answered `/health` with `db:false`, and gave no reason
at all. Set `DB_SSL=require` if you move Postgres off the box.

**`DATABASE_URL` is not optional in production.** The API exits at boot without it.
The web app, which has none, throws from `getStorefront()` when no backend is
configured rather than returning `null`: a site-wide 404 storm would tell Google to
deindex every real tutor page, while a 5xx honestly says "we are broken".

**`NEXT_PUBLIC_SITE_URL`** feeds `metadataBase`, `robots.txt` and the sitemap. Set
it **per environment** — a staging box that leaves it at the default emits canonical
links and a sitemap pointing at production, and Google will happily index the wrong
origin.

**`PAYMENTS_ENABLED`** is the master switch in `packages/shared/src/payments.ts`.
**Only the exact string `1` turns payments on**; unset/empty = OFF, so an env typo
can never start moving money. Leave it unset until counsel signs off *and* the
provider contract + webhook signature verification exist. While OFF, every payment
adapter throws and the tutor balance is a real `0`.

**`STORAGE_DIR` MUST be persistent, and MUST be absolute.** Tutors upload national
ID scans here (sensitive personal data under Tunisia's INPDP regime, Loi 2004-63).
On an ephemeral filesystem — a container layer, an instance without a mounted disk,
anything wiped on redeploy — the ID docs disappear on every deploy, which breaks
the admin review queue *and* leaves orphaned `verification_docs` rows pointing at
files that no longer exist. **Absolute** because Next's standalone `server.js`
`chdir`s to its own directory and CLI scripts run from whichever workspace invoked
them; a relative path resolved somewhere different three times in this project's
history, and each time the purge deleted rows while orphaning the files.
`storageBase()` now throws in production rather than guessing.

Every read, write and delete of an upload (ID scans, materials, photos) goes
through one object store, `objectStore()` in `packages/db/src/storage.ts`, chosen by
`STORAGE_DRIVER`. Keys are the database paths (`verification/<tutorId>/…`,
`materials/<tutorId>/…`, `avatars/<tutorId>/…`). Whichever driver you pick,
`npm run db:check` round-trips a sentinel through it.

**`local` (default).** Files under `STORAGE_DIR`, written atomically (temp file,
then rename). This means **one API instance per volume**: two instances on two
machines would each see half the files.

**`s3`** (AWS S3, Cloudflare R2, MinIO). Needed as soon as there's more than one
API instance, or a host without a persistent disk. Set `S3_BUCKET`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, plus `S3_ENDPOINT` for R2/MinIO (see
`.env.example`).
- **The bucket must be private**: no public access and no public URL. Every read
  is streamed through an authorised API route.
- The key the API uses needs `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject`
  on `arn:aws:s3:::<bucket>/*`, **and `s3:ListBucket` on the bucket itself**.
  Without `ListBucket`, S3 answers 403 instead of 404 for an absent object, and the
  API checks the bucket with `HeadBucket` before its first operation. That check
  is deliberate: with a mistyped bucket name, every document would look "already
  gone", and the retention purge would delete the rows and orphan the real scans.
  A wrong bucket or key now fails loudly instead.
- Moving from `local` to `s3`: copy the tree with its paths unchanged (for example
  `rclone copy /var/lib/tnajem/storage r2:<bucket>/<S3_PREFIX>`), run `db:check` on
  the new settings, then switch `STORAGE_DRIVER` and restart.

**Proven on 15 Sept 2026** against MinIO RELEASE.2025-09-07 (local container):
- Driver contract, all checks passed:
  - 1 MiB byte-exact round-trip, streaming and size;
  - absent objects return null;
  - an anonymous GET gets 403;
  - prefix isolation;
  - a wrong bucket and wrong credentials throw instead of answering "missing";
  - 8 concurrent writes to one key leave one whole object.
- The API on `STORAGE_DRIVER=s3` passed the admin, avatar, materials,
  journey-admin and journey-tutor specs: 40/40, 97 objects in the bucket, nothing
  written to local disk.

To rerun the specs against a bucket: start the API with the `S3_*` settings,
then `E2E_STORAGE_DRIVER=s3 npx playwright test …`.

```
sudo mkdir -p /var/lib/tnajem/storage && sudo chown $USER /var/lib/tnajem/storage
sudo chmod 700 /var/lib/tnajem/storage
```

## 4. Migrate + build
```
npm run db:sql         # applies packages/db/sql/ (raw, idempotent, transactional)
npm run build          # both apps
```
**Do NOT run `npm run db:push`.** It is deliberately disabled (the script exits 1).
drizzle-kit 0.28 is not PostgreSQL 18-aware: PG17+ stores `NOT NULL` as *named*
catalog constraints, drizzle-kit doesn't recognise them, and it emits
`DROP CONSTRAINT "<table>_<col>_not_null"` for ~60 columns — i.e. it tries to strip
`NOT NULL` off most of the database. Schema changes go through the raw, idempotent,
transactional SQL files in `packages/db/sql/` via `npm run db:sql`; add a new
numbered `.sql` file for each change. (Re-enable push only as a deliberate,
verified task after upgrading drizzle-kit to a PG18-aware release.)

Every file is idempotent and replays cleanly, so re-running `db:sql` on a
half-migrated database is safe. There is **no migrations ledger** — idempotency is
the only guard, so keep it that way in every new file.

**Do NOT run `npm run db:seed` in production.** It publishes a demo tutor on
`/explore` and on a public storefront. The script refuses to run when
`NODE_ENV=production`; do not force it.

---

# §A — Plain Node behind nginx (recommended)

## 5. Run both processes

Three files do this, and they are the same three whether a push deploys or you do it
by hand over ssh:

| file | where it runs | what it is |
| --- | --- | --- |
| `.github/workflows/deploy.yml` | GitHub runner | writes `.env` from the `deploy` environment, ships it, calls `deploy.sh` |
| `deploy.sh` | the VPS | install → build both → migrate → `db:check` → reload pm2 → smoke |
| `ecosystem.config.cjs` | the VPS | the two pm2 apps: `tnajem-api`, `tnajem-web` |

### 5.1 First-run server prep (you, once)

```
sudo mkdir -p /var/www/tnajem && sudo chown $USER /var/www/tnajem   # APP_DIR
sudo mkdir -p /var/lib/tnajem/storage && sudo chown $USER /var/lib/tnajem/storage
sudo chmod 700 /var/lib/tnajem/storage                              # STORAGE_DIR (§3)
sudo npm i -g pm2                  # the workflow installs it if missing, but not sudo-free
```
Plus Postgres 18 with the database created (§2), nginx (§6), certbot, and an ssh key
whose **public** half is in `~/.ssh/authorized_keys` and whose **private** half is the
`SERVER_SSH_KEY` secret. Node: `nvm install 22`. The workflow installs the current LTS
only if `node` is missing entirely — it never changes a Node version that is already
there, so the major on the box is whatever you put there. Both Dockerfiles pin 22.

### 5.2 The `deploy` GitHub Environment (you, once)

*Settings → Environments → New environment → name it `deploy`*, then add these as
**Environment secrets**. There is no `vars.*` in the workflow: one place to look.

| secret | example / note |
| --- | --- |
| `SERVER_HOST` `SERVER_USER` `SERVER_PORT` | the VPS, the deploying user, `22` |
| `SERVER_SSH_KEY` | the **private** key, whole file including the BEGIN/END lines |
| `APP_DIR` | `/var/www/tnajem` — **re-point it if you copied this environment from another project**; the deploy refuses to run in a checkout of a different repo, but get it right anyway |
| `DATABASE_URL` `AUTH_SECRET` `DOC_ENCRYPTION_KEY` `CRON_SECRET` | §3. Losing `DOC_ENCRYPTION_KEY` makes every stored ID scan unreadable |
| `NEXT_PUBLIC_SITE_URL` `CORS_ORIGINS` `TRUSTED_PROXIES` `COOKIE_DOMAIN` | §3. `NEXT_PUBLIC_SITE_URL` is **baked into the bundle at build time** |
| `NEXT_PUBLIC_DEFAULT_MEET_BASE` | optional: the live-room base, e.g. `https://meet.jit.si/tnajem-`. Unset/empty → that default (the workflow writes the default when neither a variable nor a secret exists); set, it must be an absolute `https://` prefix or `db:check --production` stops the deploy. Baked in at build time |
| `NEXT_PUBLIC_SUPPORT_WHATSAPP` | optional, empty by default: InnoviaBurst's support number, digits only, no `+`. Baked in at build time; empty or invalid hides the "Aide & support" row on `/account` |
| `ALLOW_MINORS` | leave **unset/empty**: adults-only pilot (decision D6). Read by both the API and the web server; only `"1"` lets minors sign up and book (guardian consent still enforced). Don't set it before Phase D (parent accounts) |
| `ADMIN_EMAILS` `OTP_CHANNEL` `LOG_LEVEL` `PAYMENTS_ENABLED` | leave `PAYMENTS_ENABLED` **unset** until counsel signs off |
| `STORAGE_DRIVER` `STORAGE_DIR` | `local` + `/var/lib/tnajem/storage`, or `s3` + the `S3_*` secrets |
| `MAIL_HOST` `MAIL_PORT` `MAIL_SECURE` `MAIL_USER` `MAIL_PASS` `MAIL_FROM_NAME` `MAIL_FROM_ADDRESS` `MAIL_REPLY_TO` | **required**: `db:check` opens a real SMTP connection and the deploy stops if it fails |
| `SENTRY_DSN` `SENTRY_ENVIRONMENT` | optional — unset means server errors are logged but reported nowhere. `SENTRY_RELEASE` is set by `deploy.sh` from the commit sha; do not add it here. See OBSERVABILITY.md |
| optional | `S3_*`, `TWILIO_*`, `BACKUP_DIR`, `PG_BIN` |

`NODE_ENV`, `API_PORT`, `API_HOST` and `API_URL` are **not** secrets — the workflow
writes them as literals, because they describe the shape of the deployment (the API is
loopback-only on 4000 and the web tier reaches it there) and must not drift.

A missing secret expands to an **empty string**, silently. The workflow therefore
refuses to contact the server unless every required key is non-empty, and it prints key
names only, never values or lengths.

### 5.3 Deploying

```
git push origin production          # → Actions: CI, then build + restart on the box
```
CI (`.github/workflows/ci.yml`) runs first and the deploy job needs it green: typecheck,
lint, the API tests, the full Playwright suite against a real Postgres 18, `npm audit`.
*Actions → Deploy to production → Run workflow* with **skip_tests** is the emergency
path; it is only reachable by hand.

`deploy.sh` then, in this order: `npm ci --include=dev` → build the API → build the web
app → assert the standalone entry point exists → `npm run db:sql` → `npm run db:check --
--production` → `pm2 reload` api then web → `pm2 save` → smoke-test `:4000/health` and
`:3000/fr`. **Install and build come first on purpose**: a failure there aborts before
anything is migrated or restarted, and the previous release keeps serving. Anything
after that point is a real, visible failure.

To do the same thing by hand (also the way to run it before the first `git push`):
```
cd /var/www/tnajem && bash deploy.sh          # .env must already be in place, mode 600
```

`npm ci --include=dev` is not a typo. Root `devDependencies` hold `tsx`, `typescript`,
`postgres` and `dotenv`; every `db:*` script runs through tsx and both builds need their
dev deps. npm also reads `NODE_ENV=production` as `--omit=dev`, so the flag is the
difference between a deploy and `tsx: not found` at the migration step.

### 5.4 Day to day

```
pm2 status                     # both apps, uptime, restarts, memory
pm2 logs tnajem-api            # or tnajem-web; files are in <APP_DIR>/logs/
pm2 reload ./ecosystem.config.cjs --only tnajem-web --env production
```
If `next build` is OOM-killed on a small VPS (the log just says `Killed`), add swap or
`NODE_OPTIONS=--max-old-space-size=1024 bash deploy.sh`. The web app is one pm2 app, not
a cluster: its process is a supervisor that spawns the Next server, so cluster mode would
fork the supervisor and every worker but one would die on `EADDRINUSE`. Scaling the API
past one worker means lowering `DB_POOL_MAX` in the same change (SCALABILITY.md §2).

> **`next start` does not work with `output: "standalone"`** — it logs *Ready*,
> binds the port, and never answers a request. Use `start:standalone`, which also
> copies in `.next/static` and `public/`; the standalone bundle ships without both.
> The standalone entry point is `.next/standalone/**apps/web**/server.js`, not the
> flat path every example assumes — `scripts/serve-standalone.mjs` locates it.

> **Never set `HOSTNAME=127.0.0.1` for the web process.** It binds `localhost` by
> default (loopback only, which is what nginx's `proxy_pass` needs). With the
> `127.0.0.1` literal, Next proxies its own middleware rewrites back to itself —
> behind nginx's `X-Forwarded-Proto: https` that proxy speaks TLS to a plain-HTTP
> port, and `GET /` (the site root) answers **500**. The preflight refuses to start
> with a loopback literal. Containers use `HOSTNAME=0.0.0.0` (the Dockerfile sets it).

### 5.5 systemd instead of pm2 (alternative)

Same two processes, no pm2 and no `ecosystem.config.cjs`; `deploy.sh`'s pm2 section is
then the part you replace with `systemctl restart tnajem-api tnajem-web`. Keep
`KillMode=control-group` (the default): the web unit's `ExecStart` is a supervisor that
spawns the Next server, and systemd has to stop the whole cgroup, not just the parent.

`/etc/systemd/system/tnajem-api.service`:
```
[Unit]
Description=Tnajem API
After=network.target postgresql.service
[Service]
WorkingDirectory=/home/USER/tnajem-app
ExecStart=/usr/bin/npm run start -w @tnajem/api
Environment=NODE_ENV=production
Restart=always
User=USER
[Install]
WantedBy=multi-user.target
```
`/etc/systemd/system/tnajem-web.service`:
```
[Unit]
Description=Tnajem web
After=network.target tnajem-api.service
[Service]
WorkingDirectory=/home/USER/tnajem-app
ExecStart=/usr/bin/npm run start:standalone -w @tnajem/web
Environment=PORT=3000
Restart=always
User=USER
[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now tnajem-api tnajem-web`

Check both: `curl -sf 127.0.0.1:4000/health` must return `{"ok":true,"db":true,…}`.
**`db:false` with a 200 is a real failure** — the API is up and cannot reach
Postgres. The reason is in the API's log; it is not in the response body, because
`/health` is unauthenticated and a connection error carries the host, port and user.

### 5.6 Rollback

**Code** — deploy an older commit, with the same script that deployed the new one:
```
cd /var/www/tnajem
git log --oneline -10                  # pick the last known-good commit
git reset --hard <sha>
bash deploy.sh                         # rebuilds, re-runs db:sql, reloads, smoke-tests
```
The next `git push origin production` overwrites this (`reset --hard origin/production`),
so also revert on the branch — `git revert <bad sha>` — or the following deploy brings
the bad commit back.

**Migrations are forward-only.** There is no down migration and no ledger (§4). Rolling
code back *past* a migration is safe only because every SQL file is additive: the old
code ignores the new column. It stops being safe the moment a file drops or renames
something, which is why §4 says keep every new file additive and idempotent. If a
migration is the thing that broke, the recovery is a restore, not a revert.

**Data** — restore into a NEW database and point the app at it (`db:restore` refuses the
live `DATABASE_URL` and any database that already has tables):
```
RESTORE_DATABASE_URL=postgresql://…/tnajem_restored npm run db:restore -- backups/tnajem-….dump
# then edit DATABASE_URL in .env (or the deploy secret) and: pm2 reload … --only tnajem-api
```
Restore the ID scans too: they live in `STORAGE_DIR`, not in the dump (§8).

## 6. nginx reverse proxy + HTTPS (you) — **do not `proxy_pass` everything** ⚠️

This is the **#1 bottleneck** (SCALABILITY.md §6). The naive config sends *every*
request to the single Node process — including `/_next/static/*`, which is
immutable, content-hashed, and something nginx can serve from disk at ~zero cost.
One storefront view is 1 HTML + **~10 asset requests**. A tutor pastes their link
into a WhatsApp group, three thousand phones open it, and that is **~30,000
requests** funnelled through one single-threaded Node process over slow 3G
connections that hold sockets open for a long time. Node falls over long before
Postgres does.

Three changes, all cheap, all before the pilot: **nginx serves the static assets**,
**nginx compresses**, **Cloudflare fronts the origin**.

`/etc/nginx/sites-available/tnajem`:
```nginx
server {
  server_name tnajem.com www.tnajem.com;
  # 15M, and the number is set by NEXT, not by nginx or the API.
  # There are three ceilings on a verification upload and they do not agree:
  #   Next   serverActions.bodySizeLimit = 12mb   (next.config.mjs) ← BINDING
  #   API    6 files x 8 MB = ~48 MB              (apps/api/src/server.ts)
  #   nginx  this line
  # The upload is a server action, so Next rejects first. Keep nginx comfortably
  # above 12mb so the rejection comes from the app with a message the UI can
  # show, rather than as a bare nginx 413. Raising this alone buys nothing.
  client_max_body_size 15M;

  # ── gzip (Node is NOT compressing for you) ─────────────────────────────────
  # Compression costs nginx microseconds and saves a mid-range Android on 3G
  # ~70% of the JS/CSS bytes. (text/html is not listed below because nginx always
  # compresses it once gzip is on — it cannot be added or removed from the list.)
  gzip              on;
  gzip_vary         on;                    # so caches key on Accept-Encoding
  gzip_proxied      any;                   # compress proxied responses too — the default is "off"
  gzip_comp_level   5;                     # 5 ≈ 95% of the savings of 9 at a third of the CPU
  gzip_min_length   1024;
  gzip_types text/plain text/css text/xml application/json application/javascript
             application/xml+rss image/svg+xml application/manifest+json;
  # (Optional, better: brotli — needs ngx_brotli, not in the stock Debian package.)

  # ── Static assets: served BY NGINX, never proxied ──────────────────────────
  # Everything under /_next/static/ is content-hashed by the build: the filename
  # changes whenever the bytes change, so it can be cached forever. `immutable`
  # tells the browser not to even send a revalidation request on reload.
  # NOTE: `alias` (not `root`), and note the apps/web/ segment — this is a
  # monorepo, and the build output is NOT at the repo root.
  location /_next/static/ {
    alias /home/USER/tnajem-app/apps/web/.next/static/;
    access_log off;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  # apps/web/public/ holds eight brand files (favicons, logo.png/.webp, og.png). They
  # are NOT content-hashed, so a SHORT TTL: `immutable` here would pin a stale logo
  # in every browser that ever loaded it, with no way to push a correction.
  location ~ ^/(favicon\.ico|favicon-32\.png|apple-touch-icon\.png|logo\.png|logo-white\.png|logo\.webp|logo-white\.webp|og\.png)$ {
    root /home/USER/tnajem-app/apps/web/public;
    access_log off;
    expires 1h;
    add_header Cache-Control "public, max-age=3600";
  }

  # ── Everything else → Next ─────────────────────────────────────────────────
  # If the deploy's smoke test says the web app answers on localhost:3000 but not on
  # 127.0.0.1:3000, this line is the fix: `proxy_pass http://localhost:3000;`. The web
  # process binds whatever "localhost" resolves to (HOSTNAME=localhost is mandatory —
  # the 127.0.0.1 literal breaks every middleware rewrite, §5), and on a box that
  # answers ::1 first it listens on IPv6 loopback only. nginx would then refuse every
  # request while pm2 shows a perfectly healthy process.
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    # X-Real-IP OVERWRITES whatever the client sent; apps/web/lib/client-ip.ts reads
    # it first (then the rightmost X-Forwarded-For entry — never the leftmost, which
    # the client writes itself).
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    # (No `Upgrade`/`Connection: upgrade` headers: nothing here uses WebSockets in
    # production — the live class opens Jitsi in a NEW TAB, so that traffic never
    # touches this origin. Hardcoding them would only break upstream keep-alive.)
  }
}
```
`sudo ln -s … /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx`
Then HTTPS: `sudo certbot --nginx -d tnajem.com -d www.tnajem.com`.

> **Do NOT expose port 4000.** There is no `api.tnajem.com` vhost above and that is
> deliberate: the browser never calls the API. Every request reaches it through the
> web app, which forwards the session cookie server-side. Publishing the API would
> add a second, publicly reachable authentication surface with a different CORS
> posture for exactly zero benefit — bind it to `127.0.0.1` (`API_HOST`) and leave
> it there. If a future feature genuinely needs direct browser access (a large
> upload bypassing the Next server, say), that is the change that also has to sort
> out `COOKIE_DOMAIN` on both writers and add the vhost — not a config tweak.

**Check it actually works** — the header must come from nginx, not Node:
```
curl -sI https://tnajem.com/_next/static/… | grep -i cache-control
# → cache-control: public, max-age=31536000, immutable
curl -sH 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' https://tnajem.com/
```
If `nginx -t` passes but assets 404, the `alias` path is wrong — it must end in a
`/` and point at the real `apps/web/.next/static` of the build you are running.

> **X-Forwarded-For is a rate-limit key**, never an authz input. Keep the
> `proxy_set_header` line above *and* set `TRUSTED_PROXIES` (§3): the header now
> has to survive nginx → Next → Fastify, and either half missing collapses the
> per-IP OTP throttle into one shared bucket for the whole internet.

### Cloudflare in front (free tier) — do this too

nginx serving static from disk fixes the *CPU* cost; Cloudflare fixes the
*bandwidth and latency* cost, and it is the difference between a viral WhatsApp
link being a good day and an outage. Free tier is enough:

1. Move the domain's nameservers to Cloudflare, add an **A record → your VPS IP**,
   proxy status **Proxied** (orange cloud).
2. SSL/TLS mode: **Full (strict)** — you already have a real certbot certificate on
   the origin, so there is no reason to run anything weaker.
3. Caching → the `immutable` header above is what Cloudflare keys on: `/_next/static/*`
   is then served **from the edge**, and those ~10 asset requests per view never
   reach the VPS at all.
4. Turn on **Brotli** and **HTTP/3** (both one toggle) — this is also how you get
   Brotli without building `ngx_brotli`.
5. Leave **"Always Online"** off and do **not** add a cache rule for HTML: the
   storefront must be able to go dark within 60s of a rejection (see
   `apps/web/lib/cache.ts` / `revalidateTutor`). Caching HTML at the edge would put
   an uncontrollable second cache in front of that control.

**Ordering note:** with Cloudflare proxying, the client address arrives as
`CF-Connecting-IP`. Install Cloudflare's real-IP ranges
(`set_real_ip_from … ; real_ip_header CF-Connecting-IP;`) or every request will
appear to come from a Cloudflare address — same collapsed-throttle problem as
above, one bucket per Cloudflare edge node.

---

# §B — docker compose

```
export AUTH_SECRET=$(openssl rand -hex 32)
docker compose up -d --build
```

`db` (postgres:18.1-alpine, pinned) → `migrate` (its own service, runs **once**;
two API replicas racing `db:sql` is wrong even though every file is transactional)
→ `api` → `web`. Both app images are `node:22-slim`, **not alpine**: the lockfile
is generated on Windows and carries 97 `@esbuild` platform packages but zero
linux-musl ones, so `npm ci` on alpine installs no esbuild binary and the build
dies with a confusing exit 127. `sharp` has the same problem.

What to change before this is a production compose file rather than a local one:

- **Stop publishing `5432`.** The `db` service publishes `${DB_PUBLISHED_PORT:-15432}`
  so the E2E suite can seed from the host. Nothing outside the compose network
  should reach Postgres in production.
- **`DB_SSL=0` is a statement about the compose bridge**, where nothing leaves the
  machine. Point `DATABASE_URL` at another host and you must remove it.
- **`storage` is a named volume on purpose.** ID scans must survive a redeploy;
  `/privacy` promises 90 days, not "until we next ship". Back it up.
- Put nginx or Cloudflare in front for TLS and static caching — §6 applies
  unchanged, with `alias` pointing into the web container's mount or a copied-out
  `.next/static`.

The E2E overlay (`docker-compose.e2e.yml`) is **test-only** and must never be part
of a deploy: it bind-mounts a working directory over the storage volume, pins the
admin allow-list to a test identity, and points mail at a local sink.

---

## 7. Retention purge (documents, auth rows, closed accounts, expired plans) — **SCHEDULE THIS** ⚠️

One daily job, **four independent things swept**. Independent is the operative
word: each runs whether or not the others succeeded, because an expired grace
period must be honoured even if the document purge fails, and vice versa.

1. **ID documents past the 90-day window.** `/privacy` tells every tutor their
   identity documents are **deleted at most 90 days after the verification
   decision**. Until you add a cron, that promise is false, the ID scans sit on
   disk indefinitely, and that is an INPDP exposure with a paper trail pointing at
   our own privacy page.
2. **Expired `sessions` and `otp_codes`.** These grow by one row **per login** and
   **per OTP request**, forever — nothing else ever deletes them, and every login
   reads through the accumulated garbage. Deleting an expired row cannot log anyone
   out or invalidate a usable code: the auth layer already treats them as dead.
   (Indexed via `sessions_expires_at_idx` / `otp_codes_expires_at_idx`.)

3. **Accounts whose 30-day deletion grace has expired** (Step 15). Closing an
   account is a *request*, reversible for 30 days; this is the job that finally
   honours it. Without it, "supprimer mon compte" never deletes anything.
4. **Subscriptions past their expiry date** (Step 16). Bookkeeping only — the
   entitlement resolver already treats a past expiry as dead, so a night this does
   not run costs nobody an entitlement and gives nobody one. It flips the row's
   status so the one-active-grant index frees up and an admin is not shown an
   "active" plan that ran out in March.

**Docker compose schedules it for you**: the `retention` service calls
`POST /cron/purge` once at start and every 24 hours, and prints each run with its
HTTP status. On §A (plain Node) you schedule it yourself, below. The API refuses to
start in production without `CRON_SECRET`.

After job 1, a purged document leaves only a `verification_traces` row (kind, upload
date, decision, decision date): the trace `/privacy` §5 describes. No file, name or
path. `e2e/privacy-retention.spec.ts` proves the file is gone from storage.

All four live in `packages/db/src/retention.ts`, and **both entry points call the
same `runRetention()`**: `npm run db:purge` and `POST /cron/purge` are one run. (Until
15 Sept the CLI ran only the first two while this page said "pick either" — a host
scheduling the CLI never erased a closed account.) Each job is wrapped, so one
failing never stops the others; any failure makes the CLI exit **1** and the route
answer **500** with the failed job names — alert on that. All four are idempotent,
so overlapping runs are harmless. Pick **one**.

> **The endpoint moved.** It used to be `POST /api/cron/purge` on the *web* app.
> That route no longer exists — the web app owns no database. It is now
> **`GET|POST /cron/purge` on the API, port 4000**. An old crontab pointing at
> `https://tnajem.com/api/cron/purge` will 404 every night, silently, while the
> privacy page keeps promising deletion. Check yours.

### Option A — HTTP route

`/cron/purge` accepts `GET` and `POST`, authenticates a `CRON_SECRET` bearer token
in constant time, and **refuses to run (503) if `CRON_SECRET` is unset** — it will
never expose an unauthenticated destructive endpoint. `?dryRun=1` previews without
deleting. The response body carries **counts only** (and `failedJobs`); the per-job
lines — document and tutor ids, never file names — go to the API log as
`{"job":"retention", …}`, because anyone holding the token can call this and the ids
are a map of who uploaded what.

The API listens on loopback (§3, `API_HOST=127.0.0.1`), so the cron runs **on the
box**:
```
15 3 * * * curl -fsS -X POST http://127.0.0.1:4000/cron/purge \
  -H "Authorization: Bearer $CRON_SECRET" >> /var/log/tnajem-purge.log 2>&1
```
(`CRON_SECRET` is not in cron's environment by default — either inline the value or
add `CRON_SECRET=…` as a line at the top of the crontab.)

Under docker compose: `docker compose exec api node -e "fetch('http://127.0.0.1:4000/cron/purge',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>r.text()).then(console.log)"`

### Option B — systemd timer (running the CLI on the box)

`/etc/systemd/system/tnajem-purge.service`:
```
[Unit]
Description=Tnajem — retention purge (ID documents, auth rows, closed accounts, expired plans)
After=network.target postgresql.service
[Service]
Type=oneshot
WorkingDirectory=/home/USER/tnajem-app
ExecStart=/usr/bin/npm run db:purge
User=USER
```
`/etc/systemd/system/tnajem-purge.timer`:
```
[Unit]
Description=Daily ID-document retention purge
[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true          # catch up if the box was off at 03:15
[Install]
WantedBy=timers.target
```
```
sudo systemctl daemon-reload
sudo systemctl enable --now tnajem-purge.timer
systemctl list-timers tnajem-purge.timer     # confirm the next run
npm run db:purge -- --dry-run                # confirm it finds what you expect
```
**The trailing `--` is required.** `npm run db:purge --dry-run` swallows the flag
and runs a **real purge** — that has already happened once here.

### Option C — a PaaS scheduler (Render cron job, Railway cron, Fly machines)

Run the CLI as the scheduled command, from the repo root, with the same environment
as the API (`DATABASE_URL`, `STORAGE_DIR` on the same persistent volume):
```
npm run db:purge
```
It exits non-zero on any failure, which is what these schedulers alert on. If the
scheduler cannot mount the storage volume, use Option A against the running API
instead — a purge that cannot see the files would count every document "already gone".

**Verify it actually ran** — check the log/journal after the first night. A purge cron
that silently fails is indistinguishable from one you never wrote.

### 7.1 Class reminders and review prompts — `/cron/reminders`, every 10 minutes

A **second, separate** job (espace prof v2 · phase 7): the 24 h and 1 h reminders
before each class (to the student, and one per class to the tutor) and the
"comment s'est passée la séance ?" email 2 h after a class the student attended.
It only sends email — nothing is deleted — so it runs often, not nightly.

Same contract as `/cron/purge`: `GET|POST`, `CRON_SECRET` bearer compared in constant
time, **503 if `CRON_SECRET` is unset**, counts only in the body
(`student24h`, `student1h`, `tutor24h`, `tutor1h`, `reviewPrompts`, `skipped`,
`failed`, `failedJobs`), **500** when a sweep failed. Each email is claimed through
its "sent" marker (`0039_booking_reminders.sql`) before it goes out, so overlapping
or repeated runs never send twice; a failed send is retried by the next run while it
is still due. With no mail provider configured (`MAIL_*` unset) the run sends and
claims nothing (`"mail": false`).

Links in these emails point at `NEXT_PUBLIC_SITE_URL` (the API reads the same
variable as the web app — set it in the API's environment too).

On the box (§A), next to the purge line:
```
*/10 * * * * curl -fsS -X POST http://127.0.0.1:4000/cron/reminders \
  -H "Authorization: Bearer $CRON_SECRET" >> /var/log/tnajem-reminders.log 2>&1
```
Under docker compose the `reminders` service runs it every 10 minutes for you.
Every 10 minutes is the coarsest interval that keeps the "1 h before" email within
about an hour of the start; running it more often is harmless.

---

## 8. Backups and restore — **a backup nobody has restored is not a backup** ⚠️

### What `npm run db:backup` writes
Two files per run in `BACKUP_DIR` (default `./backups`, git-ignored), owner-only:
- `tnajem-<UTC time>.dump`: `pg_dump` custom format.
- `tnajem-<UTC time>.json`: the manifest (sha256 of the dump, server and `pg_dump`
  versions, latest migration, and the **exact** row count of every table, counted
  inside the same snapshot the dump reads).

It needs:
- the PostgreSQL **client tools at the server's major version or newer** (18 here).
  They're found on `PATH`, in `PG_BIN`, or in the standard Windows install folder.
- a **direct** connection. Snapshot export does not survive PgBouncer in transaction
  mode.

The password goes to `pg_dump` through its environment, never its command line,
and nothing prints a host, user or database name.

The dump contains every user's personal data. **Encrypt it and move it off this
machine** (for example `age`/`gpg`, then `rclone`/`restic` to a different
provider). How long backups are kept has **not been decided**: it's a retention
period for counsel (LEGAL-REVIEW). The script never deletes old backups.

### Uploaded files are not in the dump
ID scans, materials and photos live in the object store (`STORAGE_DIR` with the
local driver). Back them up **in the same job, files first, then the dump**:
- An upload that lands between the two becomes a row whose file is missing. That
  is visible (the admin sees a 404) and the purge cleans it up.
- The other order leaves the reverse: a file with no row. An **ID scan nothing
  points at is never purged**, which breaks the retention promise.

For the same reason, don't schedule the backup at the same time as the retention
purge.

On the `s3` driver, copy the bucket to a second bucket at a **different provider or
account** with the same ordering (`rclone sync r2:<bucket> backup:<bucket>`, then
the dump). Bucket versioning alone does not count: it doesn't survive losing the
account.
```
# nightly, as the app user, away from the purge window (example: 02:30)
rsync -a /var/lib/tnajem/storage/ /var/backups/tnajem/storage/   # then encrypt + ship
cd /srv/tnajem && npm run db:backup                                 # then encrypt + ship
```

### Restore: into a NEW database, never over the live one
`db:restore` refuses the database in `DATABASE_URL` and any database that already
has tables. There's no `--force`: a restore over live data destroys everything
written since the backup.
```
createdb tnajem_restored                                   # empty
RESTORE_DATABASE_URL=postgresql://…/tnajem_restored \
  npm run db:restore -- backups/tnajem-20260915T141342Z.dump
rsync -a /var/backups/tnajem/storage/ /var/lib/tnajem/storage-restored/
DATABASE_URL=postgresql://…/tnajem_restored STORAGE_DIR=/var/lib/tnajem/storage-restored \
  npm run db:check                                         # migrations, store, mail
# then: stop the API, point DATABASE_URL + STORAGE_DIR at the restored copies,
# start, smoke-test, and keep the old database until you have decided.
```
`db:restore` checks four things and exits 1 on any failure:
1. the dump's sha256 matches its manifest;
2. `pg_restore` ran in one transaction with `--exit-on-error`;
3. the same tables exist;
4. every row count equals the backup's.

**Proven on 15 Sept 2026** (dev, PostgreSQL 18.1):
- 28 tables and 1 676 rows restored, all four checks passed, and `db:check` passed
  against the restored database.
- Restoring into a non-empty database, into the live `DATABASE_URL`, and from a
  dump with one flipped byte were all refused.

### Managed Postgres
A provider's point-in-time recovery (PITR) covers "undo the last hour". It isn't
a substitute for `db:backup`: that copy is independent of the provider and account,
and you can restore it anywhere. Use both. PITR needs the hosting account, which
doesn't exist yet.

---

## Notes
- Back up **Postgres** and the **`STORAGE_DIR`** folder together (§8); the DB rows and
  the files on disk are two halves of one record. ID docs are served only via the
  admin-gated `/api/admin/doc/[id]` route on the web app — which is a **streaming
  pass-through that makes no access decision of its own**. The API decides, using
  `ADMIN_EMAILS`. Never serve them from the public web root.
- Schema changes: add a numbered file to `packages/db/sql/` and run `npm run db:sql`
  (idempotent, transactional). `db:push` is deliberately disabled — it is not
  PG18-safe (see §4).
- **Only verified tutors are public** (`/explore`, `/<slug>`, sitemap). Approve them
  at `/admin/verifications` — access is limited to the addresses in `ADMIN_EMAILS`.
- **What each plan actually grants.** A `Plan` carries exactly two levers —
  `maxClasses` (open classes at once) and `exploreBoost` (ranking on `/explore`).
  Nothing else in the product asks what plan a tutor is on.

  | Plan | / month | Open classes | Explore boost |
  |---|---|---|---|
  | `pilot` (default while payments are off) | — | unlimited | — |
  | `gratuit` | 0 TND | 1 | — |
  | `essentiel` | 29 TND | 5 | — |
  | `pro` | 59 TND | unlimited | ×1 |
  | `prestige` | 99 TND | unlimited | ×2 |

  Plus **10 % commission**, on payments Tnajem processes and nothing else — 0 TND
  today, because it processes none. The other features `/tarifs` lists on the paid
  tiers (SMS/WhatsApp reminders, stats, selling materials, replays, priority
  verification, priority support) are **not built** and are marked "Bientôt" on
  the page. Granting Prestige today hands out a stronger Explore boost and nothing
  more. Source of truth: `packages/shared/src/plans.ts`.
- **Plans are granted by hand at `/admin/plans`**, same allowlist. There is no
  checkout: payments are off, so a grant hands out entitlements and bills nobody.
  While `PAYMENTS_ENABLED` is unset every tutor is on the `pilot` plan (no limits);
  **the day you set it, ungranted tutors drop to `gratuit` — one open class.**
  Move the tutors you mean to keep unlimited onto plans *before* flipping it.
  Every grant and revoke is written to `admin_actions`.
- An unverified tutor's storefront returns **404 with a localized not-found body and
  `robots: noindex`**, decided in `apps/web/proxy.ts` before rendering. Do not move
  it to a runtime `notFound()`: on Next 14 that shipped a 6-byte body.
- Payments stay off (`PAYMENTS_ENABLED` unset) until legal/INPDP sign-off.
