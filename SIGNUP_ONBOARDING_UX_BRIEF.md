# Tnajem — Signup → Onboarding UX brief for Claude Code

> Paste this whole file as your prompt in Claude Code, from the repo root.
> Work through it in order. Do not skip Phase 0 or Phase 5.

---

## Why this flow matters more than any other

This is the **acquisition funnel for your paying customer.** Tutors pay Tnajem; students don't.
Tutor supply is the growth constraint — the model needs ~310 active tutors to break even, and
every point of friction here loses one.

It also contains the single hardest ask in the product: **"upload a photo of your national ID."**
That is an enormous trust request from a brand nobody has heard of. If the UX doesn't earn it,
tutors abandon and the marketplace stays empty.

**The standard:** a 24-year-old maths graduate in Sfax, on a 3-year-old Android, over 3G, in
Arabic, decides in about 90 seconds whether this is legitimate. Design for her.

---

## PHASE 0 — Map the real flow before touching anything

**There is no `/signup` route.** Find the actual routes. As of the last audit they are:

```
/[locale]/auth              → phone entry + OTP verification, role choice
/[locale]/auth/consent      → guardian consent (students / minors)
/[locale]/onboarding        → create the tutor storefront (name, subject, bio, slug)
/[locale]/onboarding/verify → identity document upload
```

Plus `middleware.ts`, `app/actions.ts` (`requestOtp`, `verifyOtp`, `saveConsent`, `createTutor`,
`submitVerification`), and `lib/auth.ts`.

**Read every one of these files completely before editing anything.** Then write out the exact
step-by-step flow, including every branch: tutor vs student, new vs returning, verified vs
pending vs rejected. **Report that map to me first.**

---

## PHASE 1 — Instrument it. You cannot fix what you haven't seen.

Use whatever tools you have — Playwright, Puppeteer, the browser MCP, whatever is available.

1. **Start the dev server.**
2. **Walk the entire flow yourself as a real user would**, capturing a screenshot at *every*
   step, in **both locales**, at **380px** (the real device width) and **1280px**:
   - Land on `/fr/auth` → choose "prof" → enter a phone → request the code → the OTP screen →
     enter a wrong code → enter the right code → `/onboarding` → fill the form → submit →
     `/onboarding/verify` → upload a file → submit → the pending state
   - Repeat the whole thing at `/ar/auth`
3. **Actually LOOK at every screenshot** with the Read tool. Reading the JSX is not seeing it.
4. Run **axe-core** on each page in both locales.
5. Note every moment where you had to guess what to do next. Those are the defects.

---

## PHASE 2 — Known defects (confirmed in a previous audit — verify each, then fix)

**Critical**

1. **The OTP code is printed on screen in production.** `app/actions.ts` — `requestOtp` returns
   `{ devCode }` with no `NODE_ENV`/`demoEnabled` guard, and the auth page renders it. If SMS
   isn't configured, anyone can log in as any phone number. The comment claiming "dev only" is
   false. **Gate it properly.**

2. **Every returning tutor lands on a blank "create your page" form.** `auth/page.tsx` pushes
   `/onboarding` unconditionally when `role === "tutor"`. Worse: `createTutor` **renames their
   slug**, silently breaking every WhatsApp link they've already shared.
   **Fix:** if the tutor already has a storefront, send them to `/dashboard`. If they land on
   `/onboarding` anyway, **prefill the form** and never change an existing slug without an
   explicit confirmation.

3. **A wrong OTP shows "Une erreur s'est produite."** Every `verifyOtp` failure collapses to one
   generic string, including `invalid-code`. Give each case a specific, human message: wrong
   code, expired code, too many attempts, network failure.

**High**

4. **Rejected tutors get a 404** — the notification links to `/dashboard/verification`, which
   doesn't exist. The real route is `/onboarding/verify`.

5. **Nobody is told a tutor is waiting for review.** `submitVerification` notifies no admin, and
   `/admin/verifications` is linked from nowhere. Five screens promise "réponse sous 24–48h" and
   nothing makes that happen. At minimum: notify the admin, and only promise a timeframe you can
   actually keep.

6. **`--ochre` primary button fails contrast at 2.78:1** (needs 4.5). It's the main CTA on these
   pages. Fix per the token approach in `UI_UX_MASTER_BRIEF.md` — add an accessible button token,
   don't change the brand colour.

7. **The slug is generated client-side** with no reserved-word check in the UI. The server
   rejects reserved slugs, but the user only finds out after submitting. **Validate live.**

---

## PHASE 3 — Flow UX: fix the friction

Go through each step and fix what a real user would stumble on.

### `/auth` — phone + OTP
- **Phone input:** does it make `+216` obvious? Use `type="tel"`, `inputmode="numeric"`,
  `autocomplete="tel"`. Accept `20123456`, `+21620123456`, `20 123 456` — normalise silently
  instead of erroring.
- **OTP input:** `autocomplete="one-time-code"` (so Android autofills from the SMS),
  `inputmode="numeric"`, auto-submit on the 6th digit. Consider 6 separate boxes with paste
  support — but only if it degrades gracefully; a single field is better than a broken split one.
- **Resend:** is there one? Is the 60-second cooldown shown as a live countdown rather than an
  error after the fact?
- **Wrong number:** can they go back and edit it without reloading?
- **Waiting state:** "On t'envoie un SMS…" — is it obvious something is happening on 3G?

### `/auth/consent`
- Is it clear *why* this is being asked, in one plain sentence?
- Does it preserve `?next=` so the user returns to what they were doing?

### `/onboarding` — create the storefront
- **Show progress.** "Étape 1 sur 2" / "الخطوة 1 من 2". People abandon flows of unknown length.
- **The slug field is the important one.** Show the live URL preview (`tnajem.com/ton-nom`),
  validate availability as they type, and explain that this is the link they'll share.
- **The bio field:** give a real example, not just a placeholder. Most tutors won't know what to
  write. A one-tap example fills the biggest drop-off point in the form.
- **Never lose their input** on a validation error.

### `/onboarding/verify` — the hardest screen in the product
This is where you ask a stranger for their national ID. Treat it accordingly.

- **Explain BEFORE asking.** Above the upload, in one short paragraph: why you need it, who sees
  it (one admin), where it's stored, and that it's **deleted after 90 days**. That last fact is
  already true and already in `/privacy` — surface it here, where it changes the decision.
- **Mobile camera capture:** `accept="image/*"` + `capture="environment"` so they can photograph
  the ID directly instead of hunting through a file manager.
- **Show a thumbnail preview** after selection, with a way to replace it.
- **Fail fast and kindly:** if the file is too large or the wrong type, say so *immediately* with
  the actual limit — not after a failed submit.
- **Upload progress** — a 5MB photo over 3G takes real time. Silence reads as broken.
- **The pending state must reassure:** what happens next, roughly when, and what they can do in
  the meantime. Don't leave them staring at nothing.
- **The rejected state must be actionable:** why, and a working link to fix it.

### Cross-cutting
- **Back button** must work at every step without losing data.
- **Resuming:** if they close the browser mid-flow and return, they should land where they left
  off — not at the start.
- **Every error must say what to do next**, not just what went wrong.

---

## PHASE 4 — Accessibility & polish

- Every input has a real `<label>` (not just a placeholder)
- Touch targets ≥ 44px — several are currently 40px
- Visible focus ring on every interactive element; full keyboard operability
- `aria-live` on async states (sending code, uploading, validating)
- `<Spinner>` needs `role="status"`
- Heading order sane on every page
- Errors linked to their field via `aria-describedby`
- **RTL:** every screen mirrors correctly. Logical CSS properties only — **never** `left`,
  `right`, `ml-`, `mr-`, `text-left`
- These pages carry many inline `style={{}}` objects (auth ~25, onboarding ~41, verify ~54).
  Convert to the Tailwind idiom used on `/` and `/explore`, **screenshotting before and after to
  prove zero visual change**

---

## PHASE 5 — Verify, then iterate until it passes

**Do not report success without re-measuring.**

1. `npx tsc --noEmit` clean · `npm run build` green
2. **Walk the entire flow again end to end**, both locales, 380px and 1280px, capturing fresh
   screenshots — and **look at all of them**
3. Zero serious/critical axe violations on every page in both locales
4. Contrast: zero WCAG AA failures on these screens
5. Keyboard-only: complete the whole signup as a tutor without touching the mouse
6. FR/AR key parity exact — report the counts
7. **Confirm the OTP code no longer appears in a production build**

Then loop: fix the highest-severity issue → re-run → re-look. If a fix causes a regression,
revert it and try differently. Commit after each green pass.

**Final report:** the flow map, every defect fixed with file:line, before/after screenshots of
the 3 biggest improvements, and anything you could not fix and why.

---

## Guardrails

- **Don't break RTL** — logical properties only. It's currently excellent; keep it that way.
- **Don't break FR/AR parity** — every new string goes into both locales (`ar: typeof fr` is
  enforced, so a miss is a compile error).
- **No fabricated data.** No fake tutor names, no invented stats, no "rejoint par 500 profs".
- **No new npm dependencies** for the app. Dev tools (Playwright, axe) are fine.
- **Design tokens only** — no hardcoded hex, radius or shadow.
- **Don't redesign the brand.** Fix friction and defects; keep the visual language.
- **Don't mark anything done you haven't re-measured.**

---

## The test that matters

When you're finished, answer honestly:

> **Would a 24-year-old maths graduate in Sfax, on a cheap Android over 3G, in Arabic, complete
> this signup and upload her national ID — without asking anyone for help?**

If any step makes you hesitate, that step isn't finished.
