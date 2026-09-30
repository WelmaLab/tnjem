# Prompt for Claude Code — Integrate the new logo

> Paste this as your prompt in Claude Code, from the repo root
> (`D:\work\Startups\New idea claude\tnajem-app`).

---

## Your task

A new brand logo has been saved to **`public/logo.png`**. Replace the current placeholder mark
(the "ق" glyph in a rounded blue square) everywhere it appears, and wire the new logo through the
whole app — header, footer, favicon, app icon, and social preview — correctly and verifiably.

**Work through this in order. Do not skip the verification phase.**

---

## PHASE 0 — Look before you touch

1. **Open `public/logo.png` and actually look at it.** Note: its dimensions, whether the
   background is transparent, whether it's the symbol alone or symbol + wordmark, and what
   colour it is.
2. **Find every place the current logo is rendered.** Grep for the existing mark — it is drawn
   as a "ق" character inside a rounded square, most likely in `components/SiteHeader.tsx`, and
   possibly repeated in `components/SiteFooter.tsx`, the auth pages, and `app/[locale]/layout.tsx`
   metadata. List every occurrence before changing anything.
3. **Check what's already in `public/`** — there should be `favicon.svg`, `favicon.ico`,
   `apple-touch-icon.png` and `og.png` from an earlier pass. All of them are now outdated.

**Report what you found before you start editing.**

---

## PHASE 1 — Core integration

**Create a single `components/Logo.tsx`** so the logo lives in exactly one place. Every other
file imports it. Do not scatter `<Image src="/logo.png">` across the codebase.

It must support:
- `variant`: `"full"` (symbol + wordmark) and `"mark"` (symbol only, for tight spaces)
- `theme`: `"default"` (for light backgrounds) and `"light"` (white, for cobalt/dark backgrounds)
- A sensible default size, overridable

**Rules:**
- Use **`next/image`**, never a raw `<img>`. The codebase currently has zero `<img>` tags — keep
  it that way.
- Set explicit `width` and `height` to prevent layout shift (CLS).
- Add `priority` on the header logo only (it's above the fold); everywhere else should lazy-load.
- **Bilingual alt text** — FR: `"Tnajem"`, AR: `"تنجّم"`. Pull it from the locale, don't hardcode.
- If the logo is purely decorative next to a visible wordmark, use `alt=""` + `aria-hidden` and
  make sure the brand name is still announced to screen readers exactly once.

**Then replace the old "ق" mark in every location you found in Phase 0.** Delete the old markup
entirely — do not leave it commented out.

---

## PHASE 2 — RTL

The site is bilingual with full RTL, and the RTL implementation is currently excellent — **do not
break it.**

- The logo must sit on the correct side in Arabic. Use **logical CSS properties only**
  (`margin-inline-start`, etc.). **Never** add `left`, `right`, `margin-left`, `ml-`, `mr-`.
- **If the logo mark has a direction** (e.g. a thumbs-up leaning one way), decide deliberately
  whether it should be mirrored in RTL. Do not mirror it automatically — flag it to me with a
  screenshot of both options and let me choose.
- Screenshot the header at `/fr` and `/ar` and confirm the layout mirrors correctly.

---

## PHASE 3 — Dark backgrounds

There are cobalt/dark sections (the storefront hero, the footer, the app icon). A dark logo on a
dark background is invisible.

- If `public/logo-white.png` exists, use it for the `"light"` theme.
- **If it does not exist, STOP and tell me** — I need to supply it. Do not fake it with a CSS
  filter (`brightness(0) invert(1)`) as a permanent solution; that produces a muddy result on a
  logo with any anti-aliasing.
- Audit every dark surface and confirm which variant renders there.

---

## PHASE 4 — Favicon, app icon, social preview

These are separate assets, not the same file resized. Generate them from the logo **mark** (the
symbol alone — a wordmark is illegible at 32px).

1. **Favicon** — 32×32 and 16×16. Prefer `app/icon.png` (Next 14 auto-wires it) or update
   `public/favicon.ico`.
2. **Apple touch icon** — 180×180, white mark on a solid cobalt `#0E5AA6` background (iOS does
   not honour transparency — a transparent PNG renders on black).
3. **OG / social image** — 1200×630, `public/og.png`. Logo + brand name on a cream `#FBF7F0` or
   cobalt background. This is what shows in a WhatsApp link preview, which is your main
   distribution channel — make it look good.
4. **Update the metadata** in `app/[locale]/layout.tsx`: `icons`, `openGraph.images`,
   `twitter.images`.

You may use `sharp` (already a Next dependency) via a small script to generate these. Put the
script in `scripts/` so it's repeatable.

---

## PHASE 5 — Performance

- **Check the file size of `public/logo.png`.** If it's over ~50KB, compress it. A logo has few
  colours and should be tiny.
- **Ask me for an SVG.** A PNG logo blurs on high-DPI screens and can't be recoloured in CSS. If
  I can supply `logo.svg`, use it for the header (crisp at any size, a few KB) and keep the PNG
  only for OG/social, where SVG isn't supported. **Tell me if you want the SVG — it's worth it.**
- Confirm you haven't added any new dependency.

---

## PHASE 6 — Verify (do not skip)

1. `npx tsc --noEmit` — clean
2. `npm run build` — green
3. `npm run dev`, then **screenshot and actually look at**:
   - `/fr` and `/ar` headers — logo present, correct side, correct size
   - The footer, on its dark background
   - A storefront page (`/fr/yassine-math`)
   - At widths **320, 380, 768, 1280** — the logo must not overflow, stretch or crowd the nav
4. **Open a browser tab and look at the favicon.** If it's a smudge, the mark is too detailed —
   tell me, don't ship it.
5. Confirm **zero `<img>` tags** were introduced and **zero physical CSS properties** were added.
6. Confirm no layout shift: explicit width/height everywhere.

**Report with:** files changed, screenshots of the header in both locales, the favicon at actual
size, and anything you could not complete.

---

## ⚠️ One decision I need from you before you finish

**The logo says "Tnajem". The app still says "Tnajem" everywhere.**

The brand is being renamed (there is a trademark conflict on the old name — see the research in
the workspace). Shipping a Tnajem logo onto a Tnajem site is incoherent.

**Do NOT do the rename in this task.** It touches i18n, metadata, legal pages, the domain, email
addresses, slugs and the database — it needs its own careful pass.

Instead: **when you finish the logo work, tell me how big the rename is.** Grep for `Tnajem`,
`تنجّم` and `tnajem.com` across the whole repo (including `.md` docs, `.env.example`, legal pages
and `lib/i18n.ts`) and give me a count by file. Then I'll decide whether to do it now or next.

---

## Guardrails

- **Don't break RTL.** No physical CSS properties, ever.
- **Don't break FR/AR key parity** — any string you add goes into both locales.
- **Don't add npm dependencies.**
- **Don't invent assets.** If you need a white logo or an SVG and it doesn't exist, ask me.
- **Don't mark it done without looking at the screenshots yourself.**
