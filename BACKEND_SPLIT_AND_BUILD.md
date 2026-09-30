# Tnajem — Backend separation + feature build
## Full-auto, step-by-step, gated

> Paste this whole file as your opening prompt in Claude Code, from the repo root.

---

# HOW THIS WORKS — read before anything else

There are **16 steps**. Each step has a **GATE**: a set of commands that must exit 0.

**The rules of full-auto mode:**

1. Do the step.
2. Run the gate **yourself**.
3. **If the gate passes → commit with the step's tag → go to the next step.**
4. **If the gate fails → fix it and re-run the gate. Do not advance.**
5. If you fail the same gate **3 times**, **STOP**, write what you tried and why it failed, and wait for me.
6. **Never mark a step done without pasting the actual gate output.** Not a summary — the output.

Commit format: `git commit -m "step-07: tutor cancels a class"`
This makes every step revertible. If step 11 breaks something, `git revert` step 11 only.

**Do not batch steps. Do not skip a gate because a step "obviously" works.**
Every prior failure on this project came from a step reported as done that had never been run.

---

# ⛔ LANDMINES — these have already cost days

1. **NEVER run `npm run db:push`.** It is deliberately disabled. `drizzle-kit@0.28` is not aware of how modern Postgres stores `NOT NULL` and emits `DROP CONSTRAINT` for ~60 columns — it tries to strip `NOT NULL` off most of the database. **All schema changes go through `npm run db:sql`** as numbered, idempotent, transactional files in `scripts/sql/`.

2. **Postgres is 18.1**, not 17. Docs saying 17 are stale.

3. **`AUTH_SECRET` is resolved lazily on purpose.** A module-load throw kills `next build` on any box that injects secrets at runtime. **Do not "fix" it by throwing at import time.**

4. **Auth is EMAIL OTP** (`OTP_CHANNEL=email`), not phone. Several `.md` briefs in this repo still say phone — **they are out of date. The code is the truth.**

5. **`.env` and `.env.local` disagree.** `.env.local` points at a database that works; `.env` points at one whose credentials fail. **Reconcile them in Step 0** or you will deploy against the broken one.

6. **Storage paths are written with `\` separators.** They will not resolve on Linux. **Fixed in Step 0.**

7. **`node_modules` has been silently corrupt before.** A bizarre "cannot find module" or a syntax error *inside* `node_modules` → don't debug it, `rm -rf node_modules package-lock.json && npm install`.

---

# 🚫 THE TRUTH RULE — non-negotiable, applies to every step

This product once shipped invented students, invented Bac scores, "+1 240 séances · 4.9 ★", fake testimonials, a fake balance, and a refund guarantee it could not honour. All removed.

- **No invented statistics, testimonials, ratings, user counts, or success stories.**
- **Never emit `AggregateRating` / `Review` JSON-LD unless real rows exist.** Google issues manual actions for this.
- **No claim about payments, commission, refunds or payouts that isn't true today.**
- Future pricing may be shown **only if unmistakably labelled as future**.
- If a number would be persuasive but isn't real, **say the true thing instead.**

---

# ⛔ THINGS THAT ARE ALREADY GOOD — do not "improve" them

Verified programmatically. Breaking them is a regression.

1. **RTL is architecturally correct.** Zero physical `left`/`right`/`ml-`/`mr-`/`pl-`/`pr-`/`text-left` anywhere. **Logical properties only** (`margin-inline-start`, `padding-inline-end`, `text-align: start`).
2. **FR/AR key parity is exact** and compiler-enforced via `ar: typeof fr`. **Every string you add goes into both locales.**
3. **`prefers-reduced-motion`** has a global backstop that exempts the spinner. Keep the exemption.
4. **Design tokens.** Every colour, radius and shadow comes from `globals.css :root`. Never hardcode a hex.
5. **No `<img>` tags.** `next/image` only.

---

# THE TARGET ARCHITECTURE

```
tnajem/
├── apps/
│   ├── web/          Next.js 14 — UI only, no direct DB access
│   └── api/          Fastify — the only thing that touches Postgres
├── packages/
│   ├── db/           Drizzle schema + scripts/sql/  (shared)
│   └── shared/       Zod schemas, types, constants  (the contract)
└── package.json      npm workspaces
```

**Why Fastify and not NestJS:** you are one engineer. Fastify + Zod is ~200 lines of setup, TypeScript-native, and fast. NestJS brings decorators and DI you don't need yet. If you disagree, say so before Step 2 — not during Step 8.

**Auth across the boundary:** keep **HttpOnly cookies**, scoped to `.tnajem.com` so `tnajem.com` and `api.tnajem.com` share them. **Do not move to JWT-in-localStorage** — it is strictly worse (XSS-readable) and a bigger diff.

**Server actions stay, as a thin proxy.** `app/actions.ts` keeps its function signatures; each body becomes a `fetch` to the API, forwarding the cookie. This keeps SSR and every call-site intact, so the refactor diff is small and provable. **Do not rewrite the whole frontend to client-side fetching.**

---

# STAGE A — SEPARATE THE BACKEND
### Steps 0–5. **Zero behaviour change.** If a user could tell the difference, you did it wrong.

---

## STEP 0 — Baseline, safety net, and the config landmines

**You cannot refactor safely without a test that proves behaviour didn't change. Build it first.**

**Do:**
1. Fix `.env` so it points at the same working database as `.env.local`. **Report set/empty/missing — never print a value.**
2. Set `ADMIN_EMAILS`, and **fix `/api/admin/doc/[id]` to authorise on `ADMIN_EMAILS`, not `ADMIN_PHONES`.** Login is email-only, so no admin has a phone and the route currently 403s every time — the admin literally cannot open an ID scan.
3. Set `CRON_SECRET` and make `npm run db:purge` runnable. `/privacy` promises 90-day ID deletion and nothing enforces it.
4. Normalise every stored storage path to `/` separators. Write a one-off migration for existing rows.
5. **Write E2E tests capturing today's behaviour** in `e2e/` with Playwright:
   - student: signup → consent → book → dashboard → join → cancel → review
   - tutor: signup → storefront → upload ID → publish class → see booking
   - admin: queue → **open a document** → approve
   - concurrency: two simultaneous claims on the last seat → exactly one wins
6. `git push` — 18 commits are unpushed and this is your only backup.

**GATE 0** — all must exit 0:
```bash
npx tsc --noEmit
npm run build
npm run db:sql
npx playwright test          # every test green
git status --porcelain | wc -l    # expect 0
git log origin/HEAD..HEAD | wc -l # expect 0 — everything pushed
```
Plus: paste proof the admin doc route returns **200** for an allowlisted admin and **403** for everyone else.

> **These E2E tests are the contract for Steps 1–5. They must stay green through the entire refactor without being edited.** If you find yourself changing a test to make it pass, you have changed behaviour — stop and tell me.

---

## STEP 1 — Monorepo scaffold, no code moved yet

**Do:**
- npm workspaces at the root: `apps/*`, `packages/*`
- Move the existing app to `apps/web/` unchanged
- Create empty `packages/db` and `packages/shared` with `package.json` + `tsconfig.json`
- Root scripts: `dev`, `build`, `test`, `lint` fanning out to workspaces
- **Change zero application code.**

**GATE 1:**
```bash
npm install
npx tsc --noEmit -p apps/web
npm run build -w apps/web
npx playwright test          # still green, unedited
```

---

## STEP 2 — Extract `packages/db` and `packages/shared`

**Do:**
- Move the Drizzle schema, the client, and `scripts/sql/` into `packages/db`. Export a `createDb(url)` factory — **no module-level connection**.
- Move shared Zod schemas, enums, subject lists, and DTO types into `packages/shared`.
- `apps/web` imports from both. **Still a monolith — it just imports its schema from a package now.**

**GATE 2:**
```bash
npx tsc --noEmit                 # all workspaces
npm run build -w apps/web
npm run db:sql
npx playwright test
grep -rn "drizzle-orm" apps/web/app apps/web/components | wc -l   # expect 0
```

---

## STEP 3 — Stand up `apps/api`

**Do:**
- Fastify + `@fastify/cookie`, `@fastify/cors`, `@fastify/multipart`, `@fastify/rate-limit`
- Zod validation on every route, from `packages/shared`
- `GET /health` → `{ ok: true, db: true, version }`
- Port the session logic from `lib/auth.ts` — **same cookie name, same signing, same lazy `AUTH_SECRET`**
- **Move the rate limiter into Postgres.** It is currently in-process: it resets on deploy and multiplies by instance count, so it stops working the moment you run more than one instance.
- CORS: exact origin allow-list from env, `credentials: true`. **Never `*`.**
- Structured request logging with a request ID. **Never log a token, an OTP, or a document path.**

**GATE 3:**
```bash
npm run build -w apps/api
npm run dev -w apps/api &
curl -sf localhost:4000/health | jq -e '.ok and .db'
npm run test -w apps/api         # auth + rate-limit unit tests
```

---

## STEP 4 — Port every server action to an API endpoint

**This is the big one. Go one domain at a time, and keep the E2E suite green after each.**

Order — safest first: `auth → profile → tutors → classes → bookings → reviews → uploads → admin`

For each action in `app/actions.ts`:
1. Build the endpoint in `apps/api` with identical logic and identical validation
2. **Preserve every guardrail exactly** — atomic seat claim, guardian consent enforced server-side, `canJoinClass`, magic-byte upload sniffing, URL allow-list, path containment, the admin allowlist
3. Replace the server-action body with a `fetch` to the API, forwarding the cookie
4. **Keep the exported signature identical** so call-sites don't change
5. Run the E2E suite

**Uploads:** the API owns `STORAGE_DIR` and streams documents back. Keep the CSP + `nosniff` headers on the doc route.

**GATE 4** — after each domain, and again at the end:
```bash
npx tsc --noEmit
npm run build
npx playwright test
npm run test -w apps/api
# The proof this step exists:
grep -rn "from '@tnajem/db'" apps/web/app apps/web/components | wc -l   # expect 0
```
**Also re-run the concurrency test.** The atomic seat claim now runs in a different process — prove it still can't oversell.

---

## STEP 5 — Cut over and clean up

**Do:**
- Delete the dead DB code from `apps/web`
- `apps/web` env: only `NEXT_PUBLIC_*` + `API_URL`. **No `DATABASE_URL` in the web app at all.**
- Dockerfile per app; `docker-compose.yml` for web + api + postgres
- `README.md` — rewrite for the new layout. Delete the stale phone-OTP and PG17 claims.

**GATE 5:**
```bash
docker compose up -d --build
sleep 15
curl -sf localhost:3000/fr | grep -q "<h1"
curl -sf localhost:4000/health | jq -e '.ok'
npx playwright test --config=e2e/docker.config.ts
grep -rn "DATABASE_URL" apps/web | wc -l    # expect 0
```

> **🏁 STAGE A COMPLETE.** The backend is separated and the product behaves identically. **Tag it: `git tag stage-a-complete`.** Everything from here is new behaviour.

---

# STAGE B — POLICY CHANGES
### Small code, high copy risk. Each one touches money or safety.

---

## STEP 6 — Free first session becomes a tutor toggle

**Today** the free first session is assumed everywhere. **It becomes opt-in, per tutor, default OFF.**

**Do:**
- `tutors.offers_free_first_session boolean not null default false` (via `db:sql`)
- Toggle in the tutor's storefront editor, with a one-line explanation of why it converts
- **Enforce it server-side in the booking endpoint.** A tutor who has it off must not be bookable for free even by a crafted request.
- **The storefront only shows "1ère séance offerte" when that tutor actually offers it.** Grep the whole repo for the free-session copy — it is currently unconditional in several places, including `/explore` badges and JSON-LD.

**GATE 6:**
```bash
npx tsc --noEmit && npm run build && npx playwright test
npm run test -w apps/api -- free-session
```
E2E must cover: tutor with it ON → free seat bookable · tutor with it OFF → **the free path is rejected by the API, not just hidden in the UI** · the badge appears only for the first tutor.

---

## STEP 7 — Cancellation: 48h / 40%

**Replaces the current 24h-free rule.**

| Who cancels | When | Outcome |
|---|---|---|
| Student | > 48h before | Full release, nothing owed |
| Student | ≤ 48h before | **40% of what was paid is retained**, 60% released |
| Student | free session | No money, no penalty — but count no-shows |
| **Tutor** | any time | **Student gets 100% back, always.** The tutor cancelled. |

**Do:**
- `cancellation_policy` constants in `packages/shared` — **one source of truth, never a hardcoded 0.4 in a component**
- `cancellations` ledger table: booking, actor, when, amount paid, amount retained, amount released, reason
- Compute against **server time**, never client time
- The confirmation dialog must state the exact amount **before** the student confirms
- Update Terms + Privacy in **both locales**

> **Payments are OFF.** Nothing can actually be charged. The ledger **records** what would be retained and the UI states the policy — but it must **never** say or imply the student has been charged. Add a visible line: *"Aucun montant n'est prélevé pendant le pilote."* / *"ما نخلّصو حتى مليم في فترة التجربة."*

**GATE 7:**
```bash
npm run test -w apps/api -- cancellation   # boundary cases: 47h59m, 48h00m, 48h01m
npx tsc --noEmit && npm run build && npx playwright test
grep -rn "0\.4\|40 %" apps/web/components apps/web/app | grep -v "shared" | wc -l  # expect 0
```

---

## STEP 8 — Zero contact exchange + leak prevention

**The most sensitive step in this document. Read it twice.**

### The rule

> **A tutor and a student never see each other's contact details or location. Ever. In any case.**
>
> No phone. No email. No address. No city. No GPS. No social handle.
> Not before a booking, not after, not in a receipt, not in a notification, not in an ICS file.
>
> The only identity either side sees is a **first name** and a **profile photo**.
> Everything happens inside Tnajem: booking, messaging, materials, the live class.

**This is architecture, not a privacy setting.** A field that isn't rendered but is still present in the JSON response is a leak — someone will open DevTools.

### Part A — Close the fields

- **No `city` / location column on any profile.** Do not add one. If one exists, drop it.
- **Strip PII from every API response** a counterparty can reach. Audit each serialiser by hand:
  - `GET /classes/:id/bookings` (the tutor's booking list) currently returns the **student's email** — **remove it.** First name and level only.
  - Storefront, explore, reviews, notifications, threads, receipts, ICS exports — same sweep.
- **Build one `publicProfile()` serialiser in `packages/shared`** and route every response through it. An allow-list of fields, never a deny-list — a deny-list silently leaks the next column someone adds.
- Never put an email, phone or name in a URL, a query string, or a log line.
- **The guardian's contact is not an exception.** It exists so *Tnajem* can reach the parent — not so the tutor can.

### Part B — Close the text channels

The moment contact fields are empty, **free text becomes the leak.** Tutors have the strongest incentive: one WhatsApp number in a bio and they never pay you again.

Build **one** redaction module in `packages/shared` — `detectContactInfo(text)` — and apply it to **every** user-authored string: tutor bio, storefront tagline, class title and description, material titles and notes, review text, profile display name, and messages.

It must catch, at minimum:
- **Tunisian mobile numbers**: 8 digits beginning `2`, `4`, `5`, `9`; with or without `+216` / `00216`; with spaces, dots, dashes or slashes between any digits
- **Obvious obfuscation**: digits spelled out in French or Derija, `zero`, `sifr`, `صفر`, letter-for-digit swaps (`O` for `0`, `l` for `1`)
- **Emails**, including `nom (at) gmail (dot) com` styles
- **Social handles and platform names**: `@handle`, `wa.me/`, `instagram.com/`, `facebook.com/`, `t.me/`, `snap`, `whatsapp`, `واتساب`, `انستا`
- **Any URL** not on a short allow-list (YouTube for materials, and nothing else)

**Behaviour, by surface:**

| Surface | On detection |
|---|---|
| Tutor bio, class title/description, material title/note, display name | **Reject on save**, with a clear bilingual message explaining why |
| Message in a thread | **Mask the match**, deliver the rest, warn the sender once, **flag for admin** |
| Review text | Mask and flag |

**Mask, don't hard-block, in chat.** A hard block on a live conversation is infuriating and users route around it in ways you can't see. Masking plus a visible warning keeps the conversation usable and gives you the signal.

- Log every hit to a `contact_leak_flags` table: user, surface, the matched pattern class (**not** the raw match), timestamp
- **Strike counter**: first hit warns, repeat hits reach the admin queue (Step 15)
- State plainly in the Terms **that you filter and why.** A rule users understand is accepted; silent mangling is not.

### Be honest about the ceiling

**This cannot be made airtight.** A tutor can read a number aloud on the Jitsi call or hold it up to the camera. No filter catches that, and you should not pretend otherwise or spend a week trying.

The goal is what Airbnb and Upwork achieve: move contact exchange from *the default path* to *a deliberate, visible violation*. That is the entire difference between a marketplace and a directory. Do not gold-plate this step beyond that.

**GATE 8:**
```bash
npm run test -w apps/api -- privacy
npm run test -w packages/shared -- redaction
```

Tests that must exist and pass:
- **No endpoint reachable by a counterparty returns an email, phone, address or city** — assert against the raw JSON body, not the rendered UI
- The tutor's booking list returns a first name and **no email**
- A booked student's view of the tutor contains no email and no phone
- A minor's guardian contact is absent from every tutor-facing response
- Redaction unit tests: `24 555 666`, `+216 24 555 666`, `24-555-666`, `24.555.666`, `zero six...`, `nom (at) gmail (dot) com`, `@my_handle`, `wa.me/216...`, `واتساب 24555666` → **all detected**
- False-positive guards: `2024`, `15h30`, `Bac 2025`, a price like `50 TND`, `Exercice 24` → **not** flagged
- Saving a bio containing a phone number → **rejected**
- Sending a message containing a phone number → **stored masked**, flag row written
- A raw match never appears in a log line

```bash
npx tsc --noEmit && npm run build && npx playwright test
grep -rn "city\|governorate" packages/db/schema* | wc -l   # expect 0
```

> **⚠️ Step 12 (messaging) is now critical path.** With contact fields closed, in-app messaging is the **only** way a student and tutor can communicate. Consider doing Step 12 immediately after this step, before the rest of Stage C — a marketplace where the two sides cannot talk at all is worse than one where they swap numbers.

---

# STAGE C — NEW FEATURES
### Each step is independently revertible. Ship in this order.

---

## STEP 9 — Storefront editing

Tutors cannot currently change anything after creation. This breaks at ~50 tutors.

**Do:** an edit route reusing the creation form, prefilled. Editable: first name, bio, subjects, price, photo, free-session toggle.

**Not editable, because the fields must not exist:** city, address, phone, email, website, social links. **Every edited string passes through `detectContactInfo()` from Step 8 and is rejected on a hit.**

**Slug changes need care** — either forbid them, or 301 the old slug so shared WhatsApp links keep working. **Do not silently break existing links.** Re-verification is *not* required for a bio edit.

**GATE 9:** `npx tsc --noEmit && npm run build && npx playwright test` + an E2E that edits every field and asserts each one persisted and rendered.

---

## STEP 10 — Materials library

**Schema:**
```
materials(id, tutor_id, kind, title, description,
          visibility,          -- 'public' | 'students' | 'private'
          storage_path | youtube_id | note_html,
          size_bytes, mime, position, created_at)
material_classes(material_id, class_id)     -- optional link, many-to-many
material_views(material_id, user_id, viewed_at)
```
`kind ∈ {pdf, video, youtube, note}`

**Access rules — enforced in the API:**
| Visibility | Who can open it |
|---|---|
| `public` | anyone, including logged-out |
| `students` | a user with a confirmed booking with that tutor, or an active subscription |
| `private` | the owning tutor only |
| linked to a class | additionally requires a booking **on that class** |

**Upload security — reuse the ID-document pipeline, don't invent a new one:**
- **Magic-byte sniffing, never the client's MIME claim**
- Size caps: PDF 20 MB, video 200 MB. Enforce **server-side** and reject the stream, don't buffer it.
- Path containment — a filename must never escape `STORAGE_DIR`
- Serve through an authorised route with `Content-Disposition: attachment`, `nosniff`, and no caching for `students`/`private`
- **Never serve a material from a public static directory.** Anything in `public/` is world-readable forever.

**YouTube:** accept a URL, extract the ID, store **only the ID**. Embed via `youtube-nocookie.com`. Validate the ID shape — it will end up in HTML.

**PDF watermarking:** stamp the student's name and the date on download. It won't stop a determined leaker; it changes the incentive.

> ⚠️ **Copyright.** Tutors will upload scanned textbooks. Add a Terms clause, a **takedown route in the admin console**, and a strike counter. Do not ship the upload without the takedown.

**GATE 10:**
```bash
npm run test -w apps/api -- materials
```
Must pass:
- logged-out user opens `public` → **200**
- logged-out user opens `students` → **403**
- booked student opens `students` → **200**
- **student of a *different* tutor opens `students` → 403**
- anyone but the owner opens `private` → **403**
- a `.exe` renamed to `.pdf` → **rejected** (magic bytes)
- a 300 MB video → **rejected before the disk fills**
- `../../etc/passwd` as a filename → **rejected**

```bash
npx tsc --noEmit && npm run build && npx playwright test
```

---

## STEP 11 — Tutor cancels / reschedules a class

**Do:** tutor-side cancel with a mandatory reason; **every booked student refunded 100%** (ledger entry, no 40% — the tutor cancelled). Reschedule notifies every booked student, who may accept or cancel **free regardless of the 48h rule**. Notify in-app + email, in the student's locale.

**GATE 11:** `npm run test -w apps/api -- tutor-cancel` — asserts every booked student got a full-release ledger row and a notification. Plus tsc + build + playwright.

---

## STEP 12 — Messaging  ⭐ CRITICAL PATH

**Because contact details are permanently closed (Step 8), this is the only way a student and a tutor can communicate at all. Do it early — right after Step 8 if you can.**

**Do:** threads scoped to a booking — **no cold DMs, ever.** Text only in v1 (attachments go through Materials). Rate-limited. Read receipts optional.

**Every message passes through `detectContactInfo()` from Step 8:** matches are masked, the rest is delivered, the sender is warned once, and a flag row is written for the admin queue. **Do not hard-block the send** — masking keeps the conversation usable and preserves the signal.

**Safety, because minors are involved:**
- **A minor's thread is visible to their linked guardian.** Say so in the UI, to both parties.
- A **Report** button in every thread
- Messages are retained for moderation; state the retention period in `/privacy`
- Strip HTML on the way in and escape on the way out — **this is a stored-XSS surface and this codebase has shipped one before**

**GATE 12:**
```bash
npm run test -w apps/api -- messaging
```
Must pass: no booking → cannot open a thread · `<script>alert(1)</script>` is stored escaped and renders inert · a guardian can read their minor's thread · a third party gets 403 · the rate limit trips · **a message containing `+216 24 555 666` is stored masked and produces a flag row** · **no message response body contains either party's email.**

Plus tsc + build + playwright.

---

## STEP 13 — Profile photos

**Do:** upload → magic-byte check → strip EXIF (**GPS in a photo is a location leak**) → resize to 3 sizes via `sharp` → **admin moderation queue before it goes public**. Initials avatar as the fallback.

**Minors: no real photo.** Offer a generated avatar only. Do not put a child's face on a public page.

**GATE 13:** `npm run test -w apps/api -- avatar` — EXIF stripped (assert no GPS tag survives), non-image rejected, unmoderated photo not publicly served, minor's real-photo upload refused. Plus tsc + build + playwright.

---

## STEP 14 — Parent accounts

**Do:** promote the guardian from a consent email into a real account, linked to the child. Parent can: see the child's sessions, see the tutor (**first name, photo, verification status, rating — nothing more**), cancel on the child's behalf, read the child's threads, withdraw consent (**immediately blocks future bookings**), report a problem.

> **The guardian is not a contact bridge.** Their email exists so *Tnajem* can reach them. **The tutor never sees the guardian's phone, email or location either** — Step 8 applies to the parent exactly as it applies to the child.

**GATE 14:** `npm run test -w apps/api -- guardian` — parent sees only their own child · withdrawing consent blocks the next booking attempt · a parent cannot act on an unlinked student · **no tutor-facing response contains the guardian's email or phone.** Plus tsc + build + playwright.

---

## STEP 15 — Reporting, moderation, account deletion

**This is duty of care, not a feature. It ships before launch, not after.**

**Do:**
- Report button on: storefront, class, message, material, profile — **and one route reachable without an account**
- Admin moderation queue with context and actions: dismiss, warn, remove content, suspend, ban — all audit-logged
- **Copyright takedown** flow specifically
- **Self-service account deletion**: 30-day grace, blocked while classes are still booked, then a hard purge of personal data. Anonymise reviews rather than deleting them — don't silently rewrite a tutor's rating history.
- Update `/privacy` to describe deletion, retention and reporting **truthfully**

**GATE 15:**
```bash
npm run test -w apps/api -- moderation
npm run db:purge --dry-run     # shows what a deletion would remove
```
Must pass: a logged-out report is accepted · a banned tutor disappears from `/explore` immediately · a deletion request is honoured after the grace window · a deleted user's ID documents are actually gone from disk. Plus tsc + build + playwright.

---

## STEP 16 — Plans & entitlements (no online payment)

**Do:**
- `plans` + `subscriptions` tables. Gratuit / Essentiel 29 / Pro 59 / Prestige 99 TND per month.
- **Entitlements enforced server-side** — a class limit that only hides a button is not a limit
- `/tarifs` states **both** costs together, always: **10% on payments Tnajem processes, plus the subscription**. Never one without the other; a tutor who discovers the second one later will feel cheated.
- **An admin grants a plan manually.** That is the only activation path until payments exist.
- Prominent, honest banner: *"Gratuit pendant le pilote — aucune de ces offres n'est encore facturée."* / *"فابور في فترة التجربة — ما زال ما نفوترو حتى خطة."*
- Comparison figures — Preply 18–33%, Wyzant 25%+9%, GoStudent ~35% — **cite as published rates, invent nothing**

**GATE 16:**
```bash
npm run test -w apps/api -- entitlements   # limits enforced via the API, not the UI
npx tsc --noEmit && npm run build && npx playwright test
grep -rn "12 %\|12%\|88 %\|88%" apps/web | wc -l          # expect 0 — old commission
grep -rn "Sans carte bancaire\|بلا كارت" apps/web | wc -l  # expect 0
```
Confirm: no page claims money is taken today · no page promises "0% forever" · every tutor-facing fee mention states **both** the 10% and the subscription.

---

# FINAL GATE — all 16 steps

```bash
npx tsc --noEmit
npm run build
npm run test                  # every workspace
npx playwright test           # full E2E, both locales
npm run ui:audit              # contrast + no-JS + axe
docker compose up -d --build && curl -sf localhost:4000/health
```

**Then verify by hand and report with evidence:**
0. **The zero-contact rule holds.** Crawl every API endpoint a tutor or a student can reach and assert the raw JSON contains **no email, phone, address or city** belonging to the other party or to a guardian. Paste the crawl output. This is the one gate that must never be weakened.
1. FR/AR key parity — programmatic count, both locales
2. **Zero physical CSS properties** introduced (`grep -rn "margin-left\|margin-right\|\bml-\|\bmr-\|text-left"`)
3. **Zero `<img>` tags** introduced
4. **Zero fabricated data** anywhere, including JSON-LD
5. Screenshots at **320, 380, 768, 1280** for every changed page, both locales — **and look at them yourself**
6. `git log --oneline` showing 16 tagged step commits

**Final report must contain:** the gate output for every step (actual output, not a summary), `git diff --stat` per stage, the screenshots, and an explicit list of anything you could not complete and why.

---

# IF YOU GET STUCK

**Stop and ask** — do not improvise around any of these:
- A gate fails 3 times
- A step needs a schema change you're unsure is reversible
- You'd have to weaken a security guardrail to make something work
- You'd have to edit a Stage A E2E test to make it pass *(that means behaviour changed)*
- You need a credential, a key, or a paid service
- Something in this document contradicts what you find in the code

**An honest "step 11 is blocked because X" is worth far more to me than a green report that isn't true.** I will check.
