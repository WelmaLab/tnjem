# Observability — what the app tells you, and what to do about it

Three questions this document answers: **is it up**, **what broke**, and **what do I
do now**. Written against what the code actually emits; every log shape below was
copied from a real line.

| | where | reports |
| --- | --- | --- |
| Uptime | `GET /api/health` (web, public) | 200 when the web tier, the API, the database and the document store are all healthy; **503** otherwise |
| Diagnosis | `GET /health` (API, loopback) | always 200; `{ok, db, storage, version, tz}` — the body is the signal |
| Errors | Sentry, server-side only | the exception with a stack, the route pattern, the request id |
| Events | JSON log lines with an `event` field | mail/SMS failure, notify failure, audit-write failure, the 404 middleware failing open |
| Config | `npm run db:check -- --production` | every key as set/empty/missing, a real SMTP login, a real storage round-trip |

---

## 1. Error tracking (Sentry)

**Off by default.** With no `SENTRY_DSN` the SDK is never initialised: nothing is
sent, nothing is buffered, and both servers behave exactly as they did before.
`npm run db:check` prints whether it is on, and so does the API's boot line
(`"sentry":true`).

**Server-side only, deliberately.** Browser errors are not reported. The site's CSP
is `connect-src 'self'` ([apps/web/next.config.mjs](apps/web/next.config.mjs)), so a
browser SDK would mean widening that policy to an external ingest origin and
shipping more JavaScript to every page over 3G. What is lost: errors that happen
purely in the browser after hydration. What is kept: every server render, route
handler, server action and API request — and the CSP.

### Setup (you, once)
1. Create a project at sentry.io (free tier: 5k errors/month). Platform: **Node.js**.
2. Put the DSN in the `deploy` GitHub Environment as `SENTRY_DSN` (DEPLOY.md §5.2).
   Optionally `SENTRY_ENVIRONMENT` — it defaults to `NODE_ENV`, and unset `NODE_ENV`
   means production.
3. Deploy. `deploy.sh` exports `SENTRY_RELEASE` from the commit sha, so every event
   is tagged with the deploy it came from and a regression shows up as "new in
   `abc1234`".
4. Prove it — **on the box**, because `/debug/error` is on the API and nginx does not
   expose port 4000:
   ```
   ssh you@server
   cd /var/www/tnajem && export $(grep -m1 '^CRON_SECRET=' .env)     # do not echo it
   curl -sS -i -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:4000/debug/error
   ```
   It answers **500** with the generic body and an `x-request-id` header, logs
   `msg:"request failed"`, and produces one Sentry event tagged with that same
   request id — which is GATE 7's "trigger a deliberate error", end to end through
   the real handler. POST only, bearer-guarded, no side effects.

### What an event may contain
[packages/shared/src/observability.ts](packages/shared/src/observability.ts) holds
the policy; [apps/api/test/sentry.test.ts](apps/api/test/sentry.test.ts) enforces it,
including a test that asserts **every field the log redaction strips is also
scrubbed from an event**, so the two policies cannot drift apart.

- `sendDefaultPii: false` — no cookies, no headers, no request bodies.
- Field names emptied wherever they appear: `cookie`, `authorization`, `set-cookie`,
  `code`, `codeHash`, `token`, `sessionToken`, `storagePath`, `email`, `phone`,
  `guardianPhone`, `identifier`.
- Patterns stripped from any string, including error messages — an address or a
  Tunisian number. This is the half that earns its keep: Postgres writes the
  offending value into the message of a unique violation
  (`Key (email)=(rania@example.tn) already exists`).
- Query strings become `?[redacted]`: `/api/admin/doc/x?sig=…` is a capability.
- UUIDs, ISO dates and Twilio error codes **survive** — over-scrubbing does not
  protect anyone, it just sends whoever is debugging back to the raw logs.

Stacks are readable without any upload step: both processes run with
`--enable-source-maps` (ecosystem.config.cjs) and both builds emit maps
(tsup's `sourcemap`, and `experimental.serverSourceMaps` for Next — server maps
only, never shipped to a browser).

---

## 2. Log shapes (what to write alert queries against)

**Two shapes, and they disagree on purpose.** The API's are pino's; the ones from
`@tnajem/shared`, `@tnajem/db` and the edge middleware are hand-rolled, because those
modules are imported by client components and cannot pull in a logger. Both are one
JSON object per line.

**A. Fastify/pino (API)** — numeric `level`, epoch-ms `time`:
```json
{"level":30,"time":1789533980375,"pid":3716,"reqId":"5ef73bc6-…","req":{"id":"5ef73bc6-…","method":"GET","path":"/health"},"msg":"incoming request"}
{"level":50,"time":1789533980377,"reqId":"…","code":"23505","cause":"23505","route":"/bookings","msg":"request failed"}
```
`level` 50 = error, 40 = warn, 30 = info. The `req` serializer emits **only**
`{id, method, path}` — no query string, no headers, no IP. A 5xx logs
`msg:"request failed"`; a 4xx logs `msg:"request rejected"` at info.

**B. `event` lines (shared/db/edge)** — string `level`, ISO `at`:
```json
{"level":"error","event":"mail_send_failed","detail":"EAUTH 535 during AUTH","at":"2026-09-16T02:14:09.001Z"}
{"level":"warn","event":"tutor_lookup_fail_open","reason":"timeout","suppressed":3,"at":"2026-09-16T02:14:09.001Z"}
```
One query — *has an `event` field* — finds all of them. The full list:
`mail_send_failed`, `sms_send_failed`, `notify_failed`, `audit_write_failed`,
`tutor_lookup_fail_open`.

> **pm2 prefixes its own timestamp** to every line in `logs/pm2-*.log` when
> `log_date_format` is set — which it is for the web app (its output is prose) and
> **not** for the API (its output is JSON that already carries `time`). If you ship
> these files to a log service, parse the API's as JSON and the web's as text.

---

## 3. Alerts that matter

Six rules, each with the signal to match and why it is worth waking someone. Set
them up in Sentry (1-2) and in your log/uptime tooling (3-6).

| # | Alert | Match | Why |
| --- | --- | --- | --- |
| 1 | **Error rate** | Sentry: > 10 events in 5 min, any level | A deploy that broke a common path |
| 2 | **New issue in a release** | Sentry: first-seen in release `<sha>` | The regression alert. Tagged automatically by `deploy.sh` |
| 3 | **API 5xx** | pino `level:50` **and** `msg:"request failed"` — > 5 in 5 min | The same failures as 1, from the side Sentry cannot see if the DSN is wrong |
| 4 | **Nobody can log in** | `event:"mail_send_failed"` — **any** occurrence | Every login code goes through that line. `requestOtp` still returns ok, so the UI shows no error and the product is simply shut |
| 5 | **Purge failed** | `POST /cron/purge` → HTTP **500**, or the CLI exits non-zero, or `msg:"retention purge had failures"` | `/privacy` promises ID scans are deleted within 90 days. A silent failure is a broken legal commitment |
| 6 | **404 middleware failing open** | `event:"tutor_lookup_fail_open"` — > 5 lines in 15 min | Unknown slugs are answering 200 with a soft 404. Cause is in `reason`: `timeout`/`network` = the API is slow, `over_budget` = a scraper |

Also worth a rule, lower urgency:
- `event:"audit_write_failed"` — the admin audit trail has stopped being written,
  which matters because it is the only record of who opened an ID scan.
- `/api/health` returning 503 with `storage:false` — ID-document review is down
  (usually a volume that did not come back after a reboot). Everything else works,
  which is why the API's own `/health` stays 200: see §4.
- Disk: `df -h` on `STORAGE_DIR` over 80%. ID scans and backups share the box.

### Uptime monitoring (you)
Point any monitor (Better Stack, Uptime Robot, Cloudflare) at:
- `https://tnajem.com/fr` — expect 200 and the text `<h1`
- `https://tnajem.com/api/health` — expect **200**; it answers 503 the moment the
  API, the database or the document store is unreachable

Interval 1-5 min from at least two regions. Do **not** monitor port 4000: it is
loopback-only by design, and the aggregate route above is what reports it.

---

## 4. Why the two health endpoints disagree

They are read by different things, and the difference is deliberate.

- **The API's `/health` always answers 200**, with `{db:false}` or `{storage:false}`
  in the body. A 503 with an empty body tells an operator strictly less than a 200
  that says which dependency is down. Docker's HEALTHCHECK reads `.ok && .db`, so
  `ok` stays hard-coded `true` and a **storage** failure does not pull the whole API
  out of rotation — it stops ID-document review, not logins or bookings.
- **The web's `/api/health` answers 503 when anything is degraded.** Monitors alert
  on status codes; one that only reads 200 would stay green through a total
  database outage.

Neither ever says *why* in the response body: both are unauthenticated, and a
connection error carries the database host, port and user. The reason is in the log.

---

## 5. Runbook

Common first step for all three: **is it the app or a dependency?**
```
curl -s http://127.0.0.1:4000/health            # {"ok":true,"db":?,"storage":?}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/fr
pm2 status ; pm2 logs tnajem-api --lines 50
```

### 5.1 Database unreachable — `db:false`
Symptom: every page that reads data throws; `/api/health` is 503; the API log has
`msg:"health: database unreachable"`.
1. Is Postgres running? `sudo systemctl status postgresql` → `sudo systemctl start postgresql`.
2. Can it be reached with the app's own credentials? `npm run db:check -- --production`
   (it prints the server version on success and never prints a value).
3. Out of connections (`sorry, too many clients already`)? Count them:
   `sudo -u postgres psql -c "select count(*), state from pg_stat_activity group by state;"`.
   The product's ceiling is `DB_POOL_MAX` × worker count, against ~87 usable —
   SCALABILITY.md §2. Lower `DB_POOL_MAX` in `.env` and `pm2 reload tnajem-api --update-env`.
4. Disk full? `df -h`. Postgres stops accepting writes before it stops accepting
   connections, so this looks like a hang, not a refusal.
5. Recent migration? `npm run db:sql` is idempotent — re-run it; it is safe.
6. Still down: restore is §5.6 of DEPLOY.md. **Do not** `db:restore` over the live
   database; it refuses the live `DATABASE_URL` for that reason.

### 5.2 Mail provider down — nobody can log in
Symptom: `event:"mail_send_failed"` lines; users say the code never arrives. The UI
shows no error, because `requestOtp` does not reveal delivery state (deliberately —
it would be an account-existence oracle).
1. `npm run db:check -- --production` — the Mail section performs a real SMTP login
   and prints the failure class (`EAUTH`, `ETIMEDOUT`, a 5xx SMTP code).
2. `EAUTH` after a provider change → the password/app-password is stale. Fix the
   `MAIL_PASS` secret in the `deploy` environment and redeploy (the deploy will not
   even finish if mail is broken — `db:check` is a blocking gate).
3. Rate-limited (Gmail free caps around 500 recipients/day)? Move to a transactional
   provider; the adapter is SMTP-only and provider-agnostic, so it is env, not code.
4. **Emergency channel switch**: `OTP_CHANNEL=sms` with the `TWILIO_*` keys set moves
   login to SMS with no rebuild — the implementation is live and compiling
   ([packages/shared/src/sms.ts](packages/shared/src/sms.ts)). Set it, redeploy, tell
   people. Note the admin allow-list is `ADMIN_EMAILS` and is keyed to the e-mail
   identity, so admins keep their existing accounts.
5. Never "fix" this by showing the code on screen in production. That path fails
   closed on purpose: it would hand any visitor the code for any address.

### 5.3 Storage unavailable — `storage:false`
Symptom: `/api/health` 503 with `storage:false`; `msg:"health: document store unwritable"`;
tutors cannot upload ID scans; admins get 503 opening a document.
1. Which driver? `npm run db:check -- --production` prints `local` or `s3` and does a
   real put/get/delete round-trip.
2. **Local**: is the volume mounted? `mount | grep tnajem`, `ls -la $STORAGE_DIR`,
   `df -h`. After a reboot the usual cause is an unmounted disk, and the directory
   then exists but empty and owned by root → `sudo chown $USER $STORAGE_DIR`.
   **A missing directory is the dangerous case**: the purge treats a missing file as
   "already gone" and deletes the row anyway, so do not run `db:purge` until storage
   is confirmed healthy. That is the failure the write-probe in `/health` exists to
   catch.
3. **S3/R2**: a wrong bucket or expired credentials throw rather than answering
   "missing" — by design, for exactly the reason above. Check `S3_*` in the deploy
   environment; 403 is a credentials problem, 404 a bucket-name problem.
4. Rows whose files are gone: the admin document route logs
   `"identity document could not be opened"` with the doc id. Those tutors must
   re-upload; there is no recovery from the dump (files are not in the database —
   back them up separately, DEPLOY.md §8).

---

## 6. Load test — measured, not modelled

`npm run ui:load` ([tools/ui-audit/load.mjs](tools/ui-audit/load.mjs)) against a
production build. The two URLs Stage 7 names: the catalogue, and the storefront a
tutor pastes into a WhatsApp group.

Run on **16 Sept 2026**, `UI_AUDIT_BASE=http://localhost:3210` — the standalone
production build and the API on one developer laptop (Windows, Node 22.19), with
Postgres and the load generator on the same machine. Treat these as a **baseline to
compare against**, not as VPS capacity: the load generator is competing with the app
for the same cores.

| path | connections | req/s | p50 | p95 | p99 | non-2xx |
| --- | --- | --- | --- | --- | --- | --- |
| `/fr/explore` (catalogue) | 50 | **269** | 181ms | 242ms | 304ms | 0 |
| `/fr/yassine-math` (storefront) | 50 | **1113** | 43ms | 57ms | 64ms | 0 |
| `/fr/yassine-math` | 200 | **1059** | 184ms | 250ms | 309ms | 0 |

What this says:

1. **The ISR work pays for itself.** The storefront serves **4× the catalogue's
   throughput** at a quarter of the latency, because it is cached and the catalogue
   is rendered per request (`force-dynamic`). The viral path is the fast one, which
   is the right way round.
2. **It queues, it does not shed.** Going from 50 to 200 concurrent connections left
   throughput flat (1113 → 1059 req/s) and raised latency proportionally
   (p95 57ms → 250ms) with **zero** errors, zero timeouts. No connection-pool
   exhaustion, no 500s under 4× the load.
3. **The catalogue is the one to watch.** 269 req/s is comfortable for launch, and it
   is the page that will degrade first because every hit is a database round trip.
   SCALABILITY.md §6's ladder (cache `/explore`, then read replicas) starts here.

Re-run after any change to caching, the database pool, or the storefront's data
loading, and add a row rather than replacing one.
