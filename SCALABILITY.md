# SCALABILITY.md — surviving the WhatsApp moment

The scenario this document is written against: **one tutor pastes their storefront
link into a WhatsApp group or a TikTok bio, and within ten minutes several
thousand mid-range Androids on 3G open `tnajem.com/<slug>` at the same time.**

Everything below is either already done (indexes, pool, caching) or is the next
thing to do, in the order it will start hurting.

---

## 1. Database indexes

Before this pass the database had **no indexes beyond primary keys and unique
constraints**. Every `/explore` load, every dashboard render and every login was a
sequential scan. At pilot size that is invisible; at 10k rows and 500 req/s it is
the outage.

Each index below exists because a specific query in `lib/auth.ts`, `lib/data.ts`
or `app/actions.ts` runs it. Nothing here is speculative.

### Added — plain indexes

| Table | Index | Columns | The query it serves |
|---|---|---|---|
| `tutors` | `tutors_status_rating_idx` | `(status, rating)` | `getExploreTutors` — `where status='verified' order by rating desc`. Leading column also serves the sitemap (`status='verified'`) and the admin queue (`status='pending'`). |
| `tutors` | `tutors_profile_id_idx` | `(profile_id)` | The hottest authenticated tutor query: `getDashboard`, `createTutor`, `createClass`, `createPack`, `submitVerification`, `getMyVerification` all do `where profile_id = <me>`. |
| `classes` | `classes_tutor_id_scheduled_at_idx` | `(tutor_id, scheduled_at)` | `getStorefront` (the viral page), `getDashboard`, and the `min(price) group by tutor_id` in `getExploreTutors`. `scheduled_at` second gives date-ordered reads from the same index. |
| `classes` | `classes_scheduled_at_idx` | `(scheduled_at)` | The `class_reminder` sweep — classes across *all* tutors in a time window. |
| `packs` | `packs_tutor_id_idx` | `(tutor_id)` | `getStorefront` + `getDashboard`. |
| `bookings` | `bookings_student_id_status_idx` | `(student_id, status)` | `getStudentDashboard` — `where student_id = ? and status <> 'cancelled'`. |
| `reviews` | `reviews_tutor_id_created_at_idx` | `(tutor_id, created_at)` | `getTutorReviews` (`where tutor_id order by created_at desc limit 50` → backward index scan, no sort), `recomputeTutorStats`, and Explore's per-tutor rating aggregate. |
| `notifications` | `notifications_profile_id_created_at_idx` | `(profile_id, created_at)` | `getNotifications` — `where profile_id order by created_at desc limit 50`. |
| `notifications` | `notifications_profile_id_read_at_idx` | `(profile_id, read_at)` | `markNotificationsRead` — `where profile_id and read_at is null`. btree indexes NULLs, so `IS NULL` is a real index condition. |
| `sessions` | `sessions_expires_at_idx` | `(expires_at)` | The purge that does not exist yet — `delete from sessions where expires_at < now()` (§5). |
| `sessions` | `sessions_profile_id_idx` | `(profile_id)` | The `ON DELETE CASCADE` from `profiles`, and "log out everywhere" later. An unindexed FK makes every profile delete a seq scan. |
| `otp_codes` | `otp_codes_phone_idx` | `(phone)` | **Four** phone lookups per successful login (`otpCooldownRemaining`, `createOtp`'s delete, `verifyOtpCode`'s select, then its delete). All seq scans today. |
| `otp_codes` | `otp_codes_expires_at_idx` | `(expires_at)` | The OTP purge (§5). |
| `verification_docs` | `verification_docs_tutor_id_idx` | `(tutor_id)` | `getMyVerification`, the admin queue's per-tutor N+1 loop, and the retention purge's join. |
| `consents` | `consents_minor_id_idx` | `(minor_id)` | `verifyOtp` runs `where minor_id = ?` on **every student login** to decide `needsConsent`. |

### Already unique — not re-declared, and these are correctness constraints too

These already have a btree index by virtue of being a `PRIMARY KEY` or a `UNIQUE`
constraint. Adding a second index on the same leading columns would cost writes
and buy nothing, so we did not:

| Table | Constraint | Why it is also a correctness guarantee |
|---|---|---|
| `sessions.token` | **PRIMARY KEY** | Hit on **every authenticated request** (`getSession`). Two rows with one token = two identities behind one cookie. |
| `profiles.phone` | **UNIQUE** | Hit on every login. Two profiles with one phone = an account-takeover primitive. |
| `tutors.slug` | **UNIQUE** | Hit on every storefront view. Two tutors on one slug = a stolen storefront. |
| `bookings (class_id, student_id)` | **UNIQUE** | This constraint *is* what makes `reserveSeat` idempotent — it catches the conflict instead of double-booking. Its btree also serves `where class_id = ?` (leading column), so **no separate `class_id` index is needed**. |
| `reviews (student_id, class_id)` | **UNIQUE** | One review per student per class; `createReview` relies on the conflict. Also serves lookups by `student_id`. |
| `referrals.code` | **UNIQUE** | — |

### Two indexes deliberately NOT added

- **`bookings.class_id`** — redundant. It is the leading column of the
  `(class_id, student_id)` unique index, which already serves both
  `where class_id = ?` and the composite "already booked?" probe.
- **`payments` / `payouts`** — zero rows, zero queries (`lib/payments.ts` is
  hard-disabled scaffolding). Index them in the same PR that turns payments on.

### One upgrade to make later

`otp_codes.phone` is a **plain** index, not unique. `createOtp` does
delete-then-insert, so there should only ever be one live row per phone — unique
would be the semantically correct constraint and would close a race where two
concurrent `requestOtp` calls leave two valid codes. It is not unique today
because `db:push` would **fail** if duplicates already exist, and this task was
required to be non-destructive. To upgrade, dedupe first:

```sql
DELETE FROM otp_codes a USING otp_codes b
WHERE a.phone = b.phone AND a.created_at < b.created_at;
-- then swap index(...) for uniqueIndex(...) in schema.ts and push
```

Same reasoning applies to `tutors.profile_id` (one storefront per profile).

---

## 2. Connection pooling (`lib/db/index.ts`)

### What was wrong

```ts
const sql = url ? (g.__tnajemSql ?? postgres(url, { max: 5 })) : null;
if (url && process.env.NODE_ENV !== "production" && sql) g.__tnajemSql = sql;
```

The singleton was cached **only in dev**. In production the `globalThis` write
never happened — so any second evaluation of the module (a separate route chunk,
a standalone build re-importing it) silently opened **another pool**, multiplying
the connection budget by a number nobody was tracking. `max: 5` was also
unjustified, and there was no `connect_timeout`: when Postgres got slow, every
Node request queued forever instead of failing fast.

### The sizing math

Deployment (per `DEPLOY.md`) is a VPS running `next start` under pm2, with
Postgres on the same box. **pm2 cluster mode forks one Node process per worker,
and each worker imports this module and opens its own pool.** So:

```
total connections = (pm2 workers) × DB_POOL_MAX + short-lived scripts
```

Budget against Postgres' default `max_connections = 100`:

```
100   max_connections (default)
 − 3   superuser_reserved_connections
 −10   psql, drizzle-kit push, pg_dump, the purge cron, you at 2am
 ────
  87   usable by the app
```

**Chosen: `DB_POOL_MAX = 10` per process (env-overridable), 2 pm2 workers → 20
connections.** Comfortably inside 87, with room for an old process to hold its
pool for a few seconds during a reload.

**Why 10 and not 50.** A Postgres connection is a forked backend process
(~5-10 MB RSS). Throughput does not scale with connection count — it peaks at
roughly `2-4 × CPU cores` of *concurrently active* queries and then degrades as
backends contend for CPU and locks. On a 2-4 core VPS, ~20 total connections is
already at the knee of that curve. With the indexes above, queries are 1-5 ms
point lookups, so 10 slots sustains well over 1000 queries/sec/worker. Under a
spike, the correct behaviour is to **queue inside postgres.js** (which is what a
bounded pool does) rather than open a 400th backend and thrash the DB into a
death spiral.

> **If you add pm2 workers, lower `DB_POOL_MAX`** to keep the product under ~87.
> When that stops being enough, the answer is PgBouncer (§6), not a bigger pool.

### Every setting, and why

| Setting | Value | Reason |
|---|---|---|
| `max` | `10` (`DB_POOL_MAX`) | See above. Bounded queueing beats unbounded backends. |
| `idle_timeout` | `20`s | Return the steady state to near-zero between spikes instead of pinning max backends forever. |
| `max_lifetime` | `30`min | Bounds per-backend memory growth; lets a restarted Postgres hand out clean connections without a redeploy. |
| `connect_timeout` | `10`s | **Fail fast.** The default waits forever: a DB hiccup becomes every Node request hanging, nginx 504s, and no capacity left to serve the *cached* storefronts that would otherwise still be fine. |
| `prepare` | `true` (`DB_PREPARE=0` to disable) | Server-side plan caching is a real win on the hot point lookups (`sessions.token`, `tutors.slug`). **It is also the one setting that breaks the day PgBouncer goes in front in transaction-pooling mode** — a prepared statement lives on a server connection the next transaction may not get. Flip `DB_PREPARE=0` in the same change that introduces PgBouncer. |
| `ssl` | auto | Loopback Postgres on the same VPS needs no TLS (and a default install does not offer it — forcing `require` there is a guaranteed connection error). A **remote** database always gets `require`, or the password and every row cross the network in the clear. Override with `DB_SSL`. |
| singleton | `globalThis`, **in prod too** | Dev HMR re-evaluates the module on every save and leaked a whole pool each time (an afternoon of editing → `sorry, too many clients already`). The same class of leak in prod silently multiplies the budget above. There is no downside to caching it in production. |
| `SIGTERM`/`SIGINT` | `sql.end({ timeout: 5 })` | Let in-flight queries finish on a pm2 reload instead of severing them mid-transaction. Registered once, inside the singleton branch, so dev HMR cannot pile up listeners. |

---

## 3. Caching and rendering

### The viral page: `app/[slug]/page.tsx`

Before: a server component doing **four sequential Postgres queries** (tutor →
classes → packs → reviews) and a full React render, **on every single request**.
Three thousand phones = twelve thousand queries.

Now, two layers:

1. **ISR — `export const revalidate = 60`.** Next renders the page once and
   serves the same HTML to everyone for 60s, re-rendering in the background
   afterwards (stale-while-revalidate — nobody ever waits for it). **A cache hit
   costs zero queries and zero renders.** This is the layer that actually absorbs
   the spike.
2. **`unstable_cache` around the reads** (`lib/cache.ts`) — belt and braces for
   the paths ISR does not cover: `generateMetadata` (the WhatsApp link-preview
   crawler), background re-renders, on-demand revalidation. Even a miss storm
   across workers collapses to one query per slug per window.

**This page is safe to cache as HTML** because it is 100% anonymous: it reads no
cookies, and the only session-aware thing on screen — the header's login state —
is fetched client-side by `SiteHeader` via `getMe()`. Nothing user-specific is
ever baked into the cached bytes.

### The TTL trade-off (`STOREFRONT_TTL = 60s`)

`getStorefront()` returns `null` for any tutor that is not `verified`, and the
page 404s. So **the TTL is the worst-case window in which a just-rejected tutor's
page is still public.** That is a trust and compliance question, not a
performance one, and it is why the number is 60 seconds and not an hour:

- **Long enough** to absorb the spike. A viral moment is measured in requests per
  *second*; at 500 req/s, one slug costs Postgres **1 query per minute instead of
  30,000**. Going from 60s to 3600s would remove a further 0.03% of load — nothing.
- **Short enough** that a rejection is live within a minute — well inside any
  moderation SLA, and far faster than a shared link's next hop.
- **It is a ceiling, not a floor.** `approveTutor` / `rejectTutor` should call
  `revalidateTutor(slug)` (§7) to make the change effective **immediately**. The
  TTL is what protects us on the day someone edits `tutors.status` by hand in
  `psql` and forgets the app exists.

> ⚠️ **pm2 cluster caveat.** Next's default ISR cache is **per process**. With
> more than one pm2 worker, `revalidateTag()` in worker 1 does **not** purge
> worker 2's copy — the other workers stay stale until their own TTL expires.
> The 60s ceiling is what bounds that. If you ever raise the TTL, you must first
> configure a **shared `cacheHandler`** (Redis) in `next.config.mjs`, or run a
> single worker.

### The sitemap: `app/sitemap.ts`

`getPublicTutorRefs()` is an **unbounded `select … from tutors where status =
'verified'` with no LIMIT** — the one full-table scan in the codebase — and it
was exposed at a public URL. `curl https://tnajem.com/sitemap.xml` in a loop was a
free denial-of-service against the same pool that serves logins. Now
`revalidate = 3600` + `getCachedPublicTutorRefs()`: the scan runs **once an hour**
no matter who asks.

### What is deliberately NOT cached

**Anything derived from the session cookie.** `getDashboard`,
`getStudentDashboard`, `getNotifications`, `getMe`, `canJoinClass` — all stay
per-request. `unstable_cache` has no notion of *who asked*: a value cached during
one student's request is served verbatim to the next. That is how a marketplace
shows one student another student's phone number. `lib/cache.ts` takes slugs and
returns only data that is identical for every visitor on Earth, and says so at
the top of the file.

---

## 4. Frontend on a mid-range Android over 3G

`next.config.mjs` now sets `compress: true` (nginx does **not** gzip today — see
the config in `DEPLOY.md` §6 — so without this the storefront HTML shipped
uncompressed), `poweredByHeader: false`, AVIF/WebP, device widths trimmed to what
Tunisian phones actually report (the default list goes to 3840px), a 30-day image
cache, and `dangerouslyAllowSVG: false`.

**The real problem is the client bundles, and it is architectural.** Reported, not
refactored (those files are owned elsewhere):

| File | Lines | Why it hurts |
|---|---|---|
| `app/pour-les-profs/page.tsx` | **2053** | `"use client"` — the *entire* page is a client component. ~30 `@keyframes`, infinite `lpp-float` / `lpp-glow` / `lpp-wash` background animations, a `requestAnimationFrame` count-up hook, multiple `IntersectionObserver`s. Continuous compositing on a phone = battery + jank. |
| `app/page.tsx` | **1250** | `"use client"`. The homepage. Same pattern. |
| `components/storefront/StorefrontView.tsx` | **767** | `"use client"` — **this one is on the viral path.** We now cache the HTML perfectly, then make every 3G phone download and hydrate 767 lines of JS to display what is essentially a static poster. |
| `app/dashboard/page.tsx` | 869 | Behind login, so not on the viral path, but the same monolithic-client-component pattern. |
| `app/onboarding/verify/page.tsx` | 740 | Behind login. |

The single highest-value frontend change: **make `StorefrontView` a server
component and push only the genuinely interactive bits (the booking button, the
locale toggle) into small client islands.** The storefront's HTML is already free
(ISR); the JS is what is left to pay for.

Second: the landing animations should be behind `prefers-reduced-motion` and
should not run infinitely (the count-up hook already honours it; the background
washes do not).

---

## 5. Housekeeping — the tables that grow forever

`sessions` grows by one row **per login** (30-day expiry, never deleted).
`otp_codes` grows by one row **per OTP request** (5-minute expiry, never
deleted — `createOtp` only deletes the rows for *that one phone*). Nothing ever
removes an expired row from either. A successful login writes to both, so this
grows exactly as fast as the product does, and every login then scans that
growing garbage.

The indexes in §1 (`sessions_expires_at_idx`, `otp_codes_expires_at_idx`) exist
specifically so the purge below is an index scan and not a full scan. **The purge
itself still has to be written** — see §7 for the handoff.

---

## 6. What breaks first, and the ladder

### #1 bottleneck, today: the single Node process serving every static asset

With the indexes and ISR in place, **Postgres is no longer first to fall over —
the Node process is.** Specifically:

- nginx (`DEPLOY.md` §6) `proxy_pass`es **everything** to Node, including
  `/_next/static/*`. There is **no CDN**. One storefront view is 1 HTML +
  ~10 asset requests (JS chunks, CSS, three Google font families). Three thousand
  phones ≈ **30,000 requests**, all through one single-threaded Node process, all
  over slow 3G connections that hold sockets open for a long time.
- On top of that, `SiteHeader` fires a `getMe()` **server-action POST on every
  page load**, including for anonymous visitors — so the perfectly-cached HTML is
  still followed by an uncacheable dynamic POST per visitor. (No DB hit when
  there is no cookie, but it is still a full Node request.)

**The fix is cheap and should be done before launch:** let nginx serve
`/_next/static/` straight from disk with `Cache-Control: public, max-age=31536000,
immutable`, enable `gzip`/`brotli` there, and put **Cloudflare (free tier) in
front of the whole origin**. This is the highest leverage change on this page,
and it takes an afternoon.

### The ladder

| When | Symptom you will see | Do this |
|---|---|---|
| **Now, before the pilot** | — | nginx serves `/_next/static/` from disk; Cloudflare in front. Purge expired sessions/OTPs (§5). Wire `revalidateTutor()` into approve/reject (§7). |
| **~1k daily users** | p95 climbs on the dashboard; one core pinned | pm2 cluster with 2 workers (`DB_POOL_MAX=10` → 20 connections, still fine). Add a shared **Redis `cacheHandler`** at the same time, or `revalidateTag` stops being reliable across workers. |
| **~10k daily users / first real spike** | `sorry, too many clients already`; connection storms on deploy | **PgBouncer** in transaction mode in front of Postgres, and set `DB_PREPARE=0`. Now the app can have many more workers against a small server-side pool. |
| **Storage: first day a tutor's ID scan goes missing** | Orphaned `verification_docs` rows; uploads lost on redeploy | Move `STORAGE_DIR` to **object storage** (S3-compatible; Scaleway/OVH are close to Tunisia). Local disk does not survive a second app server — it is the thing that blocks horizontal scaling entirely. |
| **~50k daily users** | Read queries (Explore, storefronts) crowd out writes | **Read replica.** Point `getExploreTutors` / `getStorefront` / the sitemap at it — they are already cached and already tolerate 60s of staleness, so replica lag is free. Keep every write and `getSession` on the primary. |
| **Explore gets slow with a `q=` filter** | `ilike '%…%'` on four columns = seq scan every time | The `%…%` leading wildcard **cannot** use a btree index. Add a **GIN trigram index** (`CREATE EXTENSION pg_trgm`) or move to `tsvector` full-text search. Not done now: at pilot catalogue size the seq scan is faster than the index, and it is behind a filter most users never touch. |
| **Notifications table gets fat** | Slow `getNotifications` despite the index | Purge read notifications older than 90 days. |

---

## 7. Handoff — what I do not own

### To the owner of `app/actions.ts` (the security agent)

**a) Cache invalidation.** Import from `@/lib/cache` and call at the end of every
write that changes a public storefront, so a tutor's edit is instant instead of
up to 60s late:

```ts
import { revalidateTutor, revalidatePublicTutors } from "@/lib/cache";

approveTutor / rejectTutor  → revalidateTutor(t.slug); revalidatePublicTutors();  // ← the compliance one
createTutor (slug changed)  → revalidateTutor(oldSlug); revalidateTutor(newSlug);
createClass / createPack    → revalidateTutor(mine.slug);
createReview                → revalidateTutor(<the class's tutor slug>);
reserveSeat / cancelBooking → revalidateTutor(tut.slug);   // seats_left moved
```

Both helpers are non-throwing by design: a revalidation failure must never fail a
write that already committed.

**b) The `reserveSeat` oversell race — ALREADY FIXED, nothing to do.** Checked
after the fact: the seat claim is now an atomic conditional `UPDATE … WHERE
seats_taken < seats RETURNING id` inside a transaction, so the loser's update
matches zero rows and gets `"full"` instead of a phantom seat. The blind
`students_count + 1` was replaced with a distinct recount in the same tx. Both
were exactly the bugs a viral spike would have found on day one. Two notes from
the pooling side, so they do not get undone later:

- **Keep `notify()` (SMS) outside the transaction**, as it is today. A
  transaction holds one of the 10 pool connections for its whole duration; doing
  Twilio HTTP I/O inside one would pin a connection — and the class's row lock —
  for the length of a network call to a third party. Thirty concurrent bookings
  would then exhaust the pool waiting on an SMS gateway. The current code commits
  first and notifies after; that is the correct order and the comment there says
  so.
- Transactions are the reason `connect_timeout` (§2) matters: they make pool
  pressure real rather than theoretical.

### To the owner of `lib/retention.ts` / `scripts/purge-docs.ts` / `app/api/cron/purge/route.ts`

Add an auth-row purge next to the existing ID-document purge. The indexes it
needs (`sessions_expires_at_idx`, `otp_codes_expires_at_idx`) are already in
`schema.ts`. Suggested shape, matching the existing module's style (caller passes
the db handle, returns counts, idempotent, safe to overlap):

```ts
// lib/retention.ts
import { lt, sql } from "drizzle-orm";
import { sessions, otpCodes } from "./db/schema";

export type AuthPurgeResult = { sessionsDeleted: number; otpCodesDeleted: number };

/** Expired auth rows. Both tables grow by one row per login / per OTP, forever. */
export async function purgeExpiredAuthRows(
  db: PurgeDb,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<AuthPurgeResult> {
  const now = new Date();
  const log = opts.log ?? (() => {});

  if (opts.dryRun) {
    const [s] = await db.select({ n: sql<number>`count(*)::int` })
      .from(sessions).where(lt(sessions.expiresAt, now));
    const [o] = await db.select({ n: sql<number>`count(*)::int` })
      .from(otpCodes).where(lt(otpCodes.expiresAt, now));
    log(`auth-retention (dry-run): sessions=${s?.n ?? 0} otp_codes=${o?.n ?? 0}`);
    return { sessionsDeleted: s?.n ?? 0, otpCodesDeleted: o?.n ?? 0 };
  }

  // An expired session is already dead to getSession(); an expired OTP is already
  // dead to verifyOtpCode(). Deleting them can never log anyone out or invalidate
  // a code that would still have worked.
  const s = await db.delete(sessions).where(lt(sessions.expiresAt, now));
  const o = await db.delete(otpCodes).where(lt(otpCodes.expiresAt, now));

  const res = { sessionsDeleted: s.count ?? 0, otpCodesDeleted: o.count ?? 0 };
  log(`auth-retention: sessions=${res.sessionsDeleted} otp_codes=${res.otpCodesDeleted}`);
  return res;
}
```

Then call it from **both** existing entry points — `scripts/purge-docs.ts` and
`POST /api/cron/purge` — right after `purgeExpiredVerificationDocs`, and add the
two counts to the cron route's JSON summary. The daily 03:15 cron in `DEPLOY.md`
§7 then covers it with no new scheduling.

Raw SQL equivalent, if you would rather do it in the cron shell script:

```sql
DELETE FROM sessions   WHERE expires_at < now();
DELETE FROM otp_codes  WHERE expires_at < now();
-- optional, once notifications get fat:
DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days';
```

If either table is ever large enough that a single `DELETE` holds locks too long,
batch it: `DELETE … WHERE ctid IN (SELECT ctid FROM … WHERE expires_at < now() LIMIT 10000)`
in a loop.
