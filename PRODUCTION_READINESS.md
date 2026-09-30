# Tnajem — Production readiness
## Eight stages. Gated. Full auto.

> Paste this whole file as your opening prompt in Claude Code, from the repo root.
> Findings marked **[VERIFIED 14 Sept]** were observed in a real browser against the running app.

---

# SCOPE — read this before planning

The product is **feature-complete enough to serve users and not deployable**. The gap is not
screens; it is everything around them. Honest estimate: **3–5 weeks** of focused work. Do not
compress it by skipping stages — the last three are what make the first five safe.

**Definition of done for this document:** a real Tunisian tutor can sign up on a public domain,
be verified by an admin, publish a class, have a real student book and attend it, and neither of
them can lose data, see someone else's data, or be shown a wrong time.

---

# HOW THIS WORKS

**8 stages.** Each has a **GATE** whose commands must exit 0.

1. Do the stage · 2. Run the gate **yourself** · 3. Pass → commit with the tag → next stage ·
4. Fail → fix, re-run · 5. Same gate fails **3 times** → **STOP**, report, wait.

Commit format: `git commit -m "prod-03: email provider + password-less OTP delivery"`

**Never mark a stage done without pasting the actual command output.** Not a summary.
**Do not batch stages.** Every past failure here came from a step reported as done that was
never run.

---

# ⛔ LANDMINES

1. **NEVER run `npm run db:push`.** Deliberately disabled — `drizzle-kit@0.28` emits
   `DROP CONSTRAINT` for ~60 columns against this Postgres. Schema changes go through
   `npm run db:sql` as numbered, idempotent, transactional files.
2. **Postgres is 18.1.** Docs saying 17 are stale.
3. **`AUTH_SECRET` is resolved lazily on purpose.** A module-load throw kills the build on any
   box that injects secrets at runtime. Do not "fix" it by throwing at import time.
4. **Auth is EMAIL OTP** (`OTP_CHANNEL=email`). Any brief saying phone is out of date — **the
   code is the truth.**
5. **RTL: logical CSS properties only.** Never `left`/`right`/`ml-`/`mr-`/`pl-`/`pr-`/`text-left`.
6. **FR/AR parity is compiler-enforced** (`ar: typeof fr`). Every string goes in both locales.
7. **Design tokens only.** No hardcoded hex, radius or spacing.
8. **Never print an env var value.** Report set / empty / missing only.
9. **The monorepo is split** (`apps/web`, `apps/api`). Respect the boundary — web does not touch
   the database.

---

# 🚫 THE TRUTH RULE

No invented statistics, testimonials, ratings, review counts, session counts or user counts — in
the UI **or** structured data. No claim about payments, commission or refunds that isn't true
today. Future pricing only if unmistakably labelled future.

**Currently clean — verified 14 Sept. Do not regress it.**

---

# ✅ VERIFIED WORKING — breaking any of these is a regression

Observed in the browser on 14 Sept, in both locales:

- Unknown slugs **404** in FR and AR with proper localised pages; real slugs resolve
- **Zero** invented figures anywhere; all explore cards show `Nouveau`; **no `AggregateRating` /
  `Review` JSON-LD**
- Storefront header and reviews panel agree (one history per tutor)
- Classes are future-dated and `<time datetime="…">` carries real instants
- French text renders correctly inside RTL pages (`dir="auto"`, 8 elements)
- Every route has a distinct title and `og:title`; `/pour-les-profs` is tutor-facing
- Auth form: `aria-invalid`, linked `aria-describedby`, `role="alert"`, focus moves to the field
- Avatar contrast passes at both gradient ends (worst 4.76:1)
- Gated routes fail closed (`/dashboard`, `/admin/verifications`)
- `/tarifs` states both costs together and cites only published competitor rates

---

# STAGE 0 — Make the dev environment honest  `prod-00`

**This is first because it caused every "I don't see changes" cycle so far.**

**[VERIFIED]** `apps/web` does not load the root `.env`, so `npm run dev` silently runs in **demo
mode** serving fabricated data that looks real.

### Do
- **Fail loudly.** If required config is missing, the dev server either refuses to start or paints
  an unmissable persistent banner: *"MODE DÉMO — données fictives"*. **Never silently serve fake
  data on a product with a truth rule.**
- Demo mode must be **impossible** in production: if `NODE_ENV=production` and demo data would be
  used, **crash at boot** with a clear message.
- Reconcile `.env` and `.env.local` — they point at different databases and one set of credentials
  fails. One documented source of truth. Report set/empty/missing only.
- `npm run db:seed` to refresh the dev database (the old Yassine row still has stale data).
- Resolve `stash@{0}` — it conflicts in `TarifsInner.tsx`, `pour-les-profs/page.tsx`,
  `contrast.mjs`. Keep or drop deliberately; don't leave it.
- **Check no existing tutor holds a newly reserved slug** (`pour-les-profs`, `tarifs`, `guardian`).
- Push every commit. Confirm `git log origin/HEAD..HEAD` is empty.

### GATE 0
```bash
npm run db:check
npm run db:seed && npm run dev   # banner visible? demo mode obvious?
NODE_ENV=production node -e "require('./apps/web/…config')" # must refuse demo data
git status --porcelain | wc -l          # 0
git log origin/HEAD..HEAD | wc -l       # 0
```
Paste the reserved-slug query result.

---

# STAGE 1 — The confirmed bugs  `prod-01`

## 1.1 🔴 Times are formatted server-side in the server's zone

**[VERIFIED]** The raw server HTML contains:
```html
<time dateTime="2026-09-16T17:00:00.000Z">18:00</time>
```
The readable time is **baked into the server response**. It renders correctly only because the dev
machine is `Africa/Tunis`. **In a UTC container the same instant renders `17:00`** — every class
shown an hour early, to every student, in both locales.

Tunisia is **UTC+1 year-round, no DST since 2009.**

**Fix:** format every user-visible date and time with an explicit
`timeZone: 'Africa/Tunis'` via `Intl.DateTimeFormat`. Store instants in UTC. Audit **every**
surface: storefront, explore, dashboard, `/student`, live page, emails, ICS exports, admin.

**The test is the deliverable:** a spec that runs under `TZ=UTC` and asserts a class stored at
`17:00Z` displays `18:00`. Without it this returns the first time someone deploys.

## 1.2 🟠 Every `[locale]` page is dynamic

`[locale]/not-found.tsx` calls `headers()`, which opts the whole segment out of static rendering.
Combined with 1.3, each storefront view costs a dynamic render **plus** an internal API call — on
the route your SEO depends on.

**Fix:** remove the `headers()` dependency (pass the locale through the route segment instead).
Confirm the storefront is statically renderable again, and measure before/after.

## 1.3 🟠 The 404 middleware needs hardening

The current mechanism calls an internal `/api/tutor-exists` on every slug request. Three problems:

- **It fails open** — a lookup failure passes through, so unknown slugs return 200 again exactly
  when the API is unhealthy. Keep failing open (better than 404-ing real tutors), but **log and
  alert** on it.
- **Negative answers aren't cached** — only positives get 30s. Every miss hits the API; random
  slug traffic is cheap amplification. **Cache negatives too** (shorter TTL) and rate-limit.
- **It's a Next 14.2 workaround.** `notFound()` shipping an empty body is fixed in Next 15.
  **Evaluate the upgrade** — it may delete this machinery entirely. Report the finding; don't
  upgrade mid-stage without saying so.

## 1.4 🟡 `/fr/a/b` renders Next's default English 404
**[VERIFIED]** Title: `404: This page could not be found.` — English, on an Arabic-capable site.
Add a root `not-found.tsx` that respects locale, or a middleware rewrite.

## 1.5 🟡 Arabic wordmark falls back to a system font on `/fr`
The header shows `تنجّم` on **every** French page, so this is your most-viewed brand element
rendering in the wrong typeface. Load the Arabic subset on both locales.

## 1.6 🟡 Intermittent AVIF hang
Image requests once hung and blocked page load, unreproducible after restart. **Do not dismiss
it.** Reproduce under load; if it can't be reproduced, add a timeout and a fallback so a stalled
optimiser can never block a page, and note it as accepted risk.

### GATE 1
```bash
TZ=UTC npx playwright test --grep timezone     # must pass
TZ=Africa/Tunis npx playwright test --grep timezone
npx tsc --noEmit && npm run build
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr/a/b
curl -s http://localhost:3000/fr/a/b | grep -c "could not be found"   # expect 0
```
Plus: paste the static/dynamic render report before and after 1.2, and the negative-cache proof.

---

# STAGE 2 — Prove every journey end to end  `prod-02`

**Against the real database and the real API — not demo data.** Run each by hand, then automate.

| Journey | Must work |
|---|---|
| **Tutor** | sign up → email OTP arrives → storefront → upload ID → admin approves → publish class → see booking → cancel/reschedule → notified |
| **Student** | sign up → guardian consent if minor → explore → storefront → book → appears in `/student` → join live → cancel (48h rule) → review → rating updates |
| **Admin** | queue → **open an ID document** → approve → reject with reason → block an account |
| **Concurrency** | two simultaneous claims on the last seat → exactly one wins; the class never oversells |
| **OTP** | two rapid requests → exactly one live code; cooldown enforced |

**Fix whatever breaks.** Expect the admin document route and the free-session toggle to need
attention — both have a history.

Also verify the guardrails still hold: a live-room URL reaches only the owning tutor or a booked
student · an unverified tutor is unbookable **via the API**, not just hidden · guardian consent is
enforced server-side · uploads are sniffed by magic bytes, not the client's MIME claim.

### GATE 2
```bash
npx playwright test          # full suite, both locales
npm run test -w apps/api
```
Paste: the seat-race result, the OTP-race result, and a screenshot of an admin opening a real
uploaded document.

---

# STAGE 3 — Production infrastructure  `prod-03`

Nothing is deployed today. Put both external dependencies behind adapters **if not already** so
these are config changes, not rewrites.

| Concern | Now | Production |
|---|---|---|
| **Email** | Gmail SMTP (~500/day, poor deliverability) | Resend / Postmark / SES **with SPF, DKIM, DMARC** |
| **Storage** | local disk | S3 / R2 — disk doesn't survive redeploy or scale past one instance |
| **Database** | local | Managed Postgres, automated backups, **PITR** |
| **Rate limiting** | in-process | **Postgres-backed** — it resets on deploy and multiplies per instance |
| **Cron** | nothing runs | Scheduled purge, guarded by `CRON_SECRET` |
| **Secrets** | `.env` | Host secret manager. Never in the repo |

**Set `ADMIN_EMAILS`** — empty means no tutor can ever be approved and the marketplace stays
permanently empty. Confirm the admin document route authorises on the **same allowlist** as the
queue.

**Normalise stored storage paths to `/`** — Windows dev plus Linux prod will otherwise break every
document link.

### GATE 3
```bash
npm run db:check                 # db, storage, mail all reachable
npm run db:purge -- --dry-run    # reports without deleting
```
Send a real test email and paste the SPF/DKIM/DMARC pass result from the receiving headers.
Prove the rate limiter survives a restart. Prove an uploaded document round-trips through object
storage.

---

# STAGE 4 — Security  `prod-04`

- **Headers:** CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
  Documents: `Content-Disposition: attachment`, `nosniff`, `no-store`.
- **Documents are never publicly addressable.** Short-TTL signed URLs only. **Encrypt national ID
  scans at rest** — a stolen disk must not be a disclosure.
- **Every document read writes an audit row** — including admin reads.
- **Session review:** rotation on privilege change, absolute + idle TTL, revocation effective on
  the next request.
- **Personal data never in a URL, query string or log line.** Add a test asserting no log line
  matches an email or phone pattern.
- `npm audit --production` — triage everything high or critical.
- Run the repo's own security review if one exists; otherwise dispatch a subagent to audit auth,
  uploads, admin routes and the live-room gate, and **fix what it finds**.

### GATE 4
```bash
npm audit --production
npx playwright test --grep security
curl -sI https://<staging-host>/ | grep -iE "content-security|strict-transport|x-content-type"
```
Paste the header output and the audit triage.

---

# STAGE 5 — Compliance and duty of care  `prod-05`

**You serve minors and store national ID documents. These are launch blockers, not roadmap items.**

- **The 90-day ID purge must actually run.** `/privacy` promises it. Schedule it, guard it with
  `CRON_SECRET`, and prove a document is gone from storage after expiry.
- **A report / abuse route**, reachable **without an account**, plus an admin queue. A platform
  serving children with no way to report a problem will not survive its first incident or its
  first journalist.
- **Account deletion.** Self-service, 30-day grace, blocked while classes are booked. **Anonymise,
  don't delete** — strip identity, hard-delete ID documents from storage, keep the booking shell.
  **Then say exactly that in `/privacy`.** A user told "deleted" who later sees their data will
  report you, and they'd be right.
- **Consent records** with a policy version and timestamp; withdrawal as easy as granting.
- **INPDP:** registration for processing personal data, including tutors' IDs.
- **Décret 2015-1619:** never feature an identifiable serving public-school teacher.
- **No minor's photo** without written parental consent.
- `/terms` and `/privacy` must **describe what is implemented** — nothing aspirational.

> ⚖️ Put every legal value in one file with `// LEGAL-REVIEW:` markers. **Do not invent retention
> periods or lawful bases.** Build the machinery; the founder's lawyer decides the numbers.

### GATE 5
```bash
npm run db:purge -- --dry-run
npx playwright test --grep "privacy|report|deletion"
```
Must pass: a logged-out report is accepted · deletion honoured after grace · **ID documents
actually gone from storage** · an erased user's name appears in no response.

---

# STAGE 6 — Deploy  `prod-06`

- Register **tnajem.com**. Configure DNS, TLS, redirects (`www`, apex, `http→https`).
- **Staging first**, identical to production. Never test a migration in production.
- CI: build, typecheck, lint, the full test suite, and the static gates on every push.
- A documented, **reversible** migration path. `db:sql` only.
- **Restore a backup into a scratch database and boot the app against it.** A backup you have
  never restored is a hypothesis, not a backup.
- Health check endpoint reporting app, database and storage.
- Rollback plan, written down, with the exact commands.

### GATE 6
```bash
curl -sf https://tnajem.com/fr | grep -q "<h1"
curl -sf https://tnajem.com/api/health | jq -e '.ok'
curl -s -o /dev/null -w "%{http_code}\n" https://tnajem.com/fr/unknown-slug   # 404
npx playwright test --config=e2e/production.config.ts
```
Paste the restore-test output and the SSL grade.

---

# STAGE 7 — Observability  `prod-07`

- **Error tracking** (Sentry) on web and API, with source maps and release tagging
- **Uptime monitoring** on `/` and `/api/health`
- **Structured logs** with request IDs — never a token, OTP, document path or personal identifier
- **Alerts that matter:** error rate, API 5xx, OTP send failures, the 404 middleware failing open,
  purge job failure, disk/storage capacity
- **A runbook** for the three most likely failures: database unreachable, mail provider down,
  storage unavailable
- Load-test the catalogue and the storefront; record the numbers

### GATE 7
Trigger a deliberate error and show it in Sentry. Show an alert firing. Paste the load-test
results and the runbook.

---

# STAGE 8 — Final production gate  `prod-08`

```bash
npx tsc --noEmit
npm run build
npm run verify              # every static gate
npx playwright test         # full suite, both locales
TZ=UTC npx playwright test  # the whole suite under UTC
npm audit --production
```

**Then verify by hand and report with evidence:**

1. **Times are correct under `TZ=UTC`** — the single most likely silent production failure
2. **Unknown slugs 404** in both locales; real slugs resolve
3. **Zero fabricated data** anywhere, including JSON-LD
4. **Zero physical CSS properties**, **zero `<img>` tags** added
5. **FR/AR parity** — programmatic count
6. **Every route has a distinct title**
7. Screenshots at **320, 380, 768, 1280**, both locales, for every key page — **and look at them**
8. A backup **restored and booted**
9. A **complete journey on the production domain**: tutor signs up → verified → publishes →
   student books → attends → reviews
10. `git log --oneline` showing 8 tagged stage commits

---

# WHAT TO TELL ME, NOT DECIDE YOURSELF

- **The free-tier limit.** It counts every upcoming non-cancelled class, so a tutor with one
  weekly group who publishes next week early is already at 2 and pays. That is probably not
  intended. **Report it; do not change pricing.**
- Any retention period, lawful basis, or legal statement
- Anything that would weaken a security guardrail to make a test pass
- Any decision that changes what a user is charged or promised

---

# IF YOU GET STUCK

**Stop and ask** — do not improvise around:
- A gate failing 3 times
- A schema change you're unsure is reversible
- A need to weaken security or disable a static gate
- A credential or paid service you don't have
- A conflict between this document and the code — **the code is the truth**

**An honest "stage 4 is blocked because X" is worth far more than a green report that isn't true.
I re-run these checks myself.**
