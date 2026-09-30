# Tnajem — Fix the 14 Sept review findings
## One issue at a time. Reproduce → fix → prove → commit.

> Paste this whole file as your opening prompt in Claude Code, from the repo root.
> The findings below were observed in a real browser against `localhost:3000` on 2026-09-14.

---

# HOW THIS WORKS

**12 issues, in order.** For each one:

1. **REPRODUCE IT FIRST.** Every issue below has exact steps. Run them and paste the output.
   - If it reproduces → fix it.
   - **If it does NOT reproduce, say so and move on.** Do not "fix" something that isn't broken,
     and do not claim you fixed something you never saw fail.
2. **Fix it.**
3. **Run the gate.** Paste the actual command output — not a summary.
4. **Commit** with the tag: `git commit -m "fix-01: 404 on unknown tutor slug"`
5. **Only then** move to the next issue.

**Fail the same gate 3 times → STOP**, report what you tried, and wait for me.

**Do not batch issues. Do not skip a gate.** Every past failure on this project came from a step
reported as done that had never been run.

**The dev server must be running** (`npm run dev`) for every reproduce step.

---

# ⛔ LANDMINES

1. **NEVER run `npm run db:push`.** It is deliberately disabled. `drizzle-kit@0.28` emits
   `DROP CONSTRAINT` for ~60 columns against this Postgres. Schema changes go through
   `npm run db:sql` as numbered, idempotent, transactional files.
2. **Postgres is 18.1.** Docs saying 17 are stale.
3. **`AUTH_SECRET` is resolved lazily on purpose.** A module-load throw kills `next build`. Do not
   "fix" it by throwing at import time.
4. **Auth is EMAIL OTP** (`OTP_CHANNEL=email`), not phone. Briefs saying phone are out of date —
   **the code is the truth.**
5. **RTL: logical CSS properties only.** Never `left`, `right`, `ml-`, `mr-`, `pl-`, `pr-`,
   `text-left`. Use `margin-inline-start`, `padding-inline-end`, `text-align: start`.
6. **FR/AR key parity is compiler-enforced** via `ar: typeof fr`. Every string you add goes in
   **both** locales.
7. **Design tokens only.** No hardcoded hex, px radius or one-off spacing.
8. **Never print an env var value.** Report set / empty / missing only.

---

# 🚫 THE TRUTH RULE

No invented statistics, testimonials, ratings, review counts, session counts or user counts — in
the UI **or** in structured data. No claim about payments, commission or refunds that isn't true
today. If a number would be persuasive but isn't real, **say the true thing instead.**

Several fixes below involve removing numbers. **Remove them. Do not replace them with smaller
invented numbers.**

---

# ISSUE 01 — 🔴 No 404: every unknown URL renders a real tutor's storefront

### Reproduce
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/fr/does-not-exist-xyz-123
curl -s http://localhost:3000/fr/does-not-exist-xyz-123 | grep -o "<title>[^<]*</title>"
```
**Observed:** `200`, and `<title>Yassine Khelifi — Prof de Maths · Bac · Tnajem</title>`.
The page renders his full storefront including a working **"Réserver"** button.

### Why this is first
Your distribution model is a tutor pasting `tnajem.com/their-name` into WhatsApp. One wrong
character sends a student to a **different tutor's page**, with no sign anything is wrong, and
lets them book a seat. It also gives Google unlimited duplicate URLs on the route that must rank.

### Fix
- The `[slug]` route must call `notFound()` when the slug resolves to nothing. Find why it is
  currently falling back to a tutor — a default, a `?? fixtures[0]`, or a catch-all — and remove it.
- Build a real 404 page with content in **both locales**: what happened, a link to `/explore`, a
  link home.
- **The 404 must render its content server-side.** Check it works with JavaScript disabled — an
  empty 404 body is its own bug.
- Confirm `/fr/<unknown>` and `/ar/<unknown>` both 404, and that **real slugs still resolve.**

### GATE 01
```bash
curl -s -o /dev/null -w "unknown-fr: %{http_code}\n" http://localhost:3000/fr/does-not-exist-xyz-123
curl -s -o /dev/null -w "unknown-ar: %{http_code}\n" http://localhost:3000/ar/does-not-exist-xyz-123
curl -s -o /dev/null -w "real-slug:  %{http_code}\n" http://localhost:3000/fr/yassine-math
curl -s http://localhost:3000/fr/does-not-exist-xyz-123 | grep -c "Yassine"
npx tsc --noEmit && npm run build
```
**Expect:** `404`, `404`, `200`, and **`0`** occurrences of "Yassine".

Add a test asserting a nonsense slug returns 404. This bug class returns quietly.

---

# ISSUE 02 — 🔴 One tutor, three contradictory histories

### Reproduce
```bash
curl -s http://localhost:3000/fr/yassine-math | grep -o "Nouveau prof[^<]*" | head -3
curl -s http://localhost:3000/fr/yassine-math | grep -o "1[ ,]240" | head -3
curl -s http://localhost:3000/fr/explore     | grep -oE "4[.,]9|37 avis" | head -3
```
**Observed:**

| Where | Claim |
|---|---|
| `/explore` card | **4,9 ★ (37 avis)** · **1 240** |
| storefront header | **Nouveau prof · 1 240 élèves** |
| storefront reviews | **Pas encore d'avis** — "Ce prof vient d'arriver." |

"Nouveau prof · 1 240 élèves" contradicts itself inside one line.

### Fix
- **One source of truth.** Rating, review count and session count all derive from the same query
  as the reviews panel. If that panel says "no reviews", no other surface may show a rating.
- **Make the contradiction unrepresentable.** `Nouveau` and a session count are mutually
  exclusive — encode that in the type (a discriminated union: `{kind:'new'} | {kind:'rated',
  rating, reviewCount, sessions}`), not in a template conditional.
- Same component renders the badge on `/explore` and the storefront. Two renderers is how they
  drifted.

### GATE 02
```bash
npm run build
# A tutor with zero reviews must show NO rating and NO session count anywhere:
curl -s http://localhost:3000/fr/yassine-math | grep -cE "1[ ,]240|4[.,]9"
curl -s http://localhost:3000/fr/explore     | grep -c "Nouveau"
```
**Expect:** `0` for the first. Then paste a screenshot of the storefront header and the matching
`/explore` card side by side, and confirm they agree.

---

# ISSUE 03 — 🔴 Fabricated ratings and session counts still render

### Reproduce
Open `/fr/explore`. Cards show `4,9 (37 avis) · 1 240` and `4,8 (12 avis) · 640`. All invented.

**Already correct — do not break it:** the storefront emits **no `AggregateRating` and no
`Review` JSON-LD**. I verified this. Only `Organization`, `WebSite` and `Person` are present.
**Keep it that way.**

Also already correct: the third card shows **`Nouveau`** instead of a fake rating. That is the
pattern — apply it to the others.

### Fix
Pick one, and apply it consistently:
- **Preferred:** remove the invented numbers from demo tutors entirely. Show `Nouveau`.
- **If the numbers must stay for a demo:** the disclaimer moves **onto every card**, not above the
  grid. The current "Aperçu démo" chip is small, low-emphasis, sits above the fold of the cards,
  and reads as "a preview of the product" rather than "these people are not real."

### GATE 03
```bash
npm run build
curl -s http://localhost:3000/fr/explore | grep -oE "4[.,][89]|37 avis|12 avis|1[ ,]240|640" | sort -u
node -e "const h=require('child_process').execSync('curl -s http://localhost:3000/fr/yassine-math').toString(); const j=[...h.matchAll(/application\/ld\+json[^>]*>([^<]*)/g)].map(m=>m[1]).join(); console.log('aggregateRating:', /aggregateRating/i.test(j)); console.log('Review:', /\"Review\"/.test(j));"
```
**Expect:** no invented figures, and both JSON-LD checks `false`.

---

# ISSUE 04 — 🟠 Past classes are sold as the next session

### Reproduce
Open `/fr/yassine-math`. Today is well past June 2026, yet:
- `23 JUIN · 18:00` is labelled **"PROCHAINE SÉANCE"** with **"8 places restantes"** and a live
  Réserver button
- `25 JUIN · 17:00` shows **"12 places restantes"**

### Fix
Two separate things — **do both**:

1. **The product bug (the important one).** A class whose start time has passed must not appear in
   "Cours en direct", must not be "PROCHAINE SÉANCE", and **must be refused by the booking action
   server-side** — not merely hidden in the UI. Verify a crafted POST for a past class is rejected.
2. **The demo data.** Seed dates relative to `now()` so they never expire again.

Also add: a tutor with **no** upcoming class needs a real empty state on the storefront, in both
locales. That state almost certainly doesn't exist yet — check.

### GATE 04
```bash
npm run db:sql && npm run build
curl -s http://localhost:3000/fr/yassine-math | grep -o "PROCHAINE SÉANCE" -A5 | head -10
npm run test -- booking   # or the equivalent in this repo
```
Tests that must exist and pass: a past class is **absent** from the storefront listing · booking a
past class returns an error from the server action · a tutor with no upcoming classes renders the
empty state in **both** locales.

---

# ISSUE 05 — 🟠 French text renders broken inside Arabic pages (bidi)

### Reproduce
Open `http://localhost:3000/ar/yassine-math` and read the bio. It renders:
```
Spécialiste révisions Bac. On révise les dérivées, intégrales et annales — en darija, à »
                                          « .ton rythme. 1ère séance offerte
```
Guillemets swapped end-for-end; the full stop jumped to the **left** of "ton rythme".

**Confirmed cause.** Run this in the browser console on that page:
```js
Array.from(document.querySelectorAll('[dir]')).map(e => e.tagName + ':' + e.getAttribute('dir'))
```
**Observed:** `["HTML:rtl", "A:ltr"]` — only two elements on the entire page carry `dir`. **No
user-authored content carries it**, so French (strong LTR) text sits in an RTL container and its
neutral characters — quotes, periods, commas, colons — inherit RTL and are reordered.

### Fix
Add **`dir="auto"`** to every element rendering user-authored text. The browser then infers
direction from the first strong character, so a French bio reads LTR and an Arabic bio reads RTL
inside the same RTL page.

Apply to: tutor bio · tutor subtitle/headline · class title · class description · pack/material
title and description · review text · tutor display name · any free-text admin note.

**Do it at the component level**, not by sprinkling attributes at call sites — one shared
`<UserText>` (or equivalent) that always sets `dir="auto"`. Otherwise the next field added
reintroduces the bug.

**This is a real fix, not cosmetic:** most Tunisian tutors will write Derija in Latin script, so
without it a large share of your Arabic-side content reads broken.

### GATE 05
```bash
npm run build
```
Then in the browser on `/ar/yassine-math`:
```js
Array.from(document.querySelectorAll('[dir="auto"]')).length   // expect > 0
```
- Screenshot the bio on `/ar/yassine-math` and **look at it** — guillemets and the full stop must
  sit correctly.
- Verify an **Arabic** bio still renders RTL correctly (create one in the seed if none exists).
- Confirm **zero physical CSS properties** were added:
```bash
grep -rn "margin-left\|margin-right\|\bml-\|\bmr-\|text-left" components/ app/ | wc -l
```

---

# ISSUE 06 — 🟠 Nine routes have no page metadata

### Reproduce
```bash
for r in /fr /fr/auth /fr/signup/prof /fr/signup/eleve /fr/pour-les-profs /fr/dashboard \
         /fr/student /fr/onboarding /fr/terms /fr/privacy /fr/explore /fr/tarifs; do
  printf "%-24s %s\n" "$r" "$(curl -s localhost:3000$r | grep -o '<title>[^<]*</title>')"
done
```
**Observed:** all of these return the homepage title **"Tnajem — apprends avec ton prof"**:
`/fr/auth` · `/fr/signup/prof` · `/fr/signup/eleve` · **`/fr/pour-les-profs`** · `/fr/dashboard` ·
`/fr/student` · `/fr/onboarding` · `/fr/terms` · `/fr/privacy`

Already correct: `/fr/explore`, `/fr/tarifs`, the storefront.

### Why `/pour-les-profs` matters most
It is the page tutors share to recruit other tutors. Its WhatsApp and Facebook preview currently
shows **the student pitch**. A tutor forwards it to a colleague and the card says "learn with your
teacher." That's an acquisition leak.

### Fix
Add `generateMetadata` to each route: a distinct title, a distinct description, and Open Graph —
**in both locales**. `/pour-les-profs` gets tutor-facing copy.

Set `robots: noindex` on `/dashboard`, `/student`, `/onboarding` — private surfaces should not be
indexed.

### GATE 06
Re-run the loop above. **Every route must show a distinct title.** Paste the output.
```bash
curl -s localhost:3000/fr/pour-les-profs | grep -o '<meta property="og:[^>]*>'
curl -s localhost:3000/ar/pour-les-profs | grep -o '<title>[^<]*</title>'
npm run build
```

---

# ISSUE 07 — 🟡 `/tarifs` free plan promises features that don't exist

### Reproduce
Open `/fr/tarifs`. The **Gratuit** column lists as included:
*Messagerie avec tes élèves* · *Ta photo de profil (vérifiée avant publication)* ·
*Tes fiches et vidéos pour tes élèves*

Per the platform inventory, messaging and profile photos **do not exist** and materials are not
deliverable. Meanwhile Essentiel, Pro and Prestige correctly mark their unbuilt features
**"Bientôt"**.

### Fix
Apply the same **"Bientôt"** treatment in the Gratuit column to every feature not shipped today.
Verify against the code which of those three actually exist before labelling — **check, don't
assume**. Both locales.

### GATE 07
```bash
npm run build
curl -s localhost:3000/fr/tarifs | grep -c "Bientôt"
curl -s localhost:3000/ar/tarifs | grep -c "قريبا\|Bientôt"
```
Screenshot the four plan columns and confirm every unshipped feature is marked in **all four**.

---

# ISSUE 08 — 🟡 Auth form accessibility gaps

### Reproduce
Open `/fr/auth`, submit empty. The error *"Entre ton adresse email."* appears and **does** carry
`role="alert"` — that part is correct. Then run in the console:
```js
const i = document.querySelector('input[type="email"]');
({ id: i.id, ariaInvalid: i.getAttribute('aria-invalid'),
   describedby: i.getAttribute('aria-describedby'), focus: document.activeElement.tagName })
```
**Observed:** `{ id: "", ariaInvalid: null, describedby: null, focus: "MAIN" }`

### Fix
- Give the input a stable `id`; give the error message an `id`
- `aria-describedby` on the input pointing at the error
- `aria-invalid="true"` while invalid, removed when corrected
- **Move focus to the invalid field on submit failure**
- Keep `role="alert"`, `type="email"`, `inputmode="email"`, `autocomplete="email"` — all correct

Apply the same pattern to **every** form: signup, onboarding, class creation, contact.

### GATE 08
Re-run the console snippet — expect a real `id`, `aria-invalid="true"`, a matching
`aria-describedby`, and `focus: "INPUT"`.
```bash
npm run build
npx playwright test --grep a11y   # if present
```

---

# ISSUE 09 — 🟡 Free-session promise hardcoded in bio text

### Reproduce
```bash
curl -s localhost:3000/fr/yassine-math | grep -o "1ère séance offerte"
```
The phrase sits inside the tutor's **bio string**, so it won't follow the per-tutor free-session
toggle. A tutor who turns the toggle **off** while leaving that sentence in their bio advertises
something the booking flow will refuse.

### Fix
- Remove it from seed bios — the badge is rendered from the toggle.
- When a tutor saves a bio containing a free-session phrase (FR and Derija variants) **while the
  toggle is off**, show a non-blocking warning: *"Ta page dit que la 1ʳᵉ séance est offerte, mais
  l'option est désactivée."* Warn; don't block — it's their text.

### GATE 09
```bash
npm run build
curl -s localhost:3000/fr/yassine-math | grep -c "1ère séance offerte"   # expect 0 in the bio
```
Test: toggle OFF + bio containing the phrase → warning shown · toggle ON → badge renders from the
toggle, not from bio text.

---

# ISSUE 10 — 🟡 The subscription's unit is hard to follow

### Reproduce
On `/fr/pour-les-profs`, the free tier is *"1 cours en ligne à la fois"*, then this appears:

> *"Deux séances par semaine, ce sont deux cours en ligne ouverts en même temps — au-delà de
> 1 cours en ligne, l'abonnement s'applique. C'est le nombre de cours qui compte, pas le nombre
> d'élèves."*

Two sessions a week with the same group doesn't intuitively equal two concurrently open classes,
and the sentence works visibly hard to justify why the example tutor pays.

### Fix — copy only, no logic change
- Rewrite the earnings example so the limit is **self-evident**, not argued. Either use an example
  that genuinely needs two concurrent classes (a tutor teaching **two different subjects**), or
  keep one class and show the free tier actually covering it.
- State the unit **once, plainly, up front**: *"La limite, c'est le nombre de cours ouverts en même
  temps — pas le nombre d'élèves."* Then don't re-explain it.
- Both locales. Keep it consistent with `/tarifs`.

> ⚠️ **Flag for the founder, do not decide yourself:** a free tier of one concurrent class means
> any tutor teaching two subjects or two levels pays from day one. That may well be intended — but
> if it is, "Gratuit" is close to theoretical and the page shouldn't lean on it. **Raise this; do
> not change the pricing.**

### GATE 10
```bash
npm run build && npm run check:i18n   # or the repo's parity check
```
Confirm `/tarifs` and `/pour-les-profs` describe the limit identically in both locales. Paste both
paragraphs side by side.

---

# ISSUE 11 — 🟡 Dates are not semantic

### Reproduce
On `/fr/yassine-math`:
```js
document.querySelectorAll('time').length   // observed: 0
```

### Fix
Render every class date and time in a `<time datetime="...">` with a machine-readable ISO value.
Applies to the storefront, `/explore`, the dashboard, `/student` and the live page. Do this while
Issue 04 is fresh.

### GATE 11
```js
Array.from(document.querySelectorAll('time')).map(t => t.getAttribute('datetime'))
```
Expect valid ISO strings, and a count matching the number of dates on screen.

---

# ISSUE 12 — 🟡 Avatar initials fail contrast

### Reproduce
On `/fr/pour-les-profs`, the floating avatars use white text on a gradient
`linear-gradient(150deg, rgb(243,194,75), rgb(224,133,46))` — roughly **1.7:1** at the light end
and **2.8:1** at the dark end, against 4.5 required.

### Fix
Either darken the gradient until white passes 4.5:1, or switch the initials to `var(--ink)`, or —
if these are purely decorative — mark them `aria-hidden="true"` and confirm nothing conveys
meaning through them alone. **Pick deliberately and record which and why.**

Check the same gradient isn't reused for meaningful text elsewhere.

### GATE 12
```bash
npm run check:contrast   # if present
```
Otherwise compute the ratio at **both ends** of the gradient and paste both numbers.

---

# FINAL GATE — all 12

```bash
npx tsc --noEmit
npm run build
npm run check:i18n        # FR/AR parity
npm run check:contrast    # if present
npx playwright test       # full suite, both locales
```

**Then verify by hand and report with evidence:**

1. **Unknown slug → 404 in both locales; real slugs still resolve.** Paste the status codes.
2. **No invented rating, review count or session count anywhere.** Paste the grep.
3. **No `AggregateRating` / `Review` JSON-LD.** Paste the check.
4. **Zero physical CSS properties added:**
   `grep -rn "margin-left\|margin-right\|\bml-\|\bmr-\|text-left" components/ app/`
5. **Zero `<img>` tags added.**
6. **Every route has a distinct title.** Paste the loop output.
7. **Screenshots** of `/fr` and `/ar` for the storefront, `/explore`, `/pour-les-profs`, `/tarifs`
   and the new 404 — and **look at them yourself**.
8. `git log --oneline` showing **12 tagged fix commits**.

---

# THINGS THAT ARE ALREADY GOOD — a fix that breaks one of these is a regression

Verified working in the browser on 14 Sept. Do not "improve" them:

- **RTL mirroring on `/ar`** — nav, share control, sidebar and badges all flip correctly
- **No `AggregateRating` / `Review` JSON-LD** on the storefront
- **Gated routes fail closed** — `/fr/dashboard` and `/fr/admin/verifications` render proper
  signed-out compositions with a sign-in CTA, not blank redirects
- **Page structure** — exactly one `<h1>` per page, no heading-level jumps, every `<img>` has an
  `alt`, no unnamed controls, correct `lang`/`dir`, skip link present
- **`/tarifs`** — both costs stated together every time, competitor rates attributed to published
  sources, **GoStudent deliberately left blank because they publish no tutor rate.** Do not add a
  number there.
- **Honest copy** — "Tnajem ne prend rien pendant le pilote", "rien ne s'achète ici" on materials,
  no "Sans carte bancaire", 48h cancellation stated consistently
- **The tutor phone mockup** no longer overlaps its own text

---

# IF YOU GET STUCK

**Stop and ask** — do not improvise around any of these:
- A gate fails 3 times
- A fix would require weakening a security guardrail or disabling a static gate
- A schema change you're unsure is reversible
- An issue does not reproduce **and you cannot explain why**
- You would have to change pricing, a legal statement, or invent a number
- Something here contradicts what you find in the code — **the code is the truth**

**An honest "issue 05 is blocked because X" is worth far more than a green report that isn't true.
I will re-run these reproduce steps myself.**
