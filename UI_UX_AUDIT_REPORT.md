# Tnajem — UI/UX audit report

Everything below is measured, not asserted. Every number comes from a runner in
[`scripts/ui-audit/`](scripts/ui-audit/) that you can re-run; every one of them
exits non-zero on failure, so `npm run ui:audit` is a gate rather than a report.

```
npm run dev -- -p 3111     # then
npm run ui:audit           # contrast · guardrails · nojs · a11y · keyboard
node scripts/ui-audit/shots.mjs      # 160 screenshots + overflow/clipping
npm run ui:weight                    # first-visit bytes per route
npm run ui:lighthouse                # needs a production build (see README)
```

---

## 0. The harness

| runner | what it proves | server |
|---|---|---|
| `contrast.mjs` | 65 fg/bg pairs the app actually renders clear WCAG 2.1 AA. Reads token values straight out of `globals.css`, so the table cannot drift from the CSS | no |
| `guardrails.mjs` | RTL logical-properties-only · FR/AR key sets identical · no hardcoded French · no untokenised colour | no |
| `nojs.mjs` | every public route shows h1 + sub-headline + primary CTA with **JavaScript disabled** | yes |
| `a11y.mjs` | axe-core, both locales, 40 routes — plus skip-link, 44px targets and a 13px text floor, which axe's WCAG tags never report | yes |
| `keyboard.mjs` | Tab through every route: skip link first, every stop visibly ringed, no traps, no positive tabindex | yes |
| `shots.mjs` | 160 full-page screenshots at 320/380/768/1280 + viewport-overflow and text-clipping detection | yes |
| `lighthouse.mjs` | Performance ≥ 80, Accessibility = 100, mobile, simulated 3G, **production build** | yes |

Two helpers make refactors provable rather than hopeful: `diff.mjs` (SHA-256 of
each PNG — Playwright's encoding is deterministic, so equal hash means
pixel-identical) and `geom.mjs` (box **and computed style** of every element on
every route). `to-tailwind.mjs` is the codemod from Phase 5.

---

## 1. Contrast — 16 measured AA failures → 0

The brand did not change. `--ochre` and `--green` keep their exact values for
fills, gradients and illustrations; new role-specific tokens carry text. Each
value is the **lightest** shade of the hue that clears the floor (found by
`tune.mjs`, which walks HSL lightness while holding hue and saturation) — an
over-darkened accent passes the audit but reads as brown and quietly loses the
brand.

| # | pair | before | after | token | where |
|---|---|---|---|---|---|
| 1 | white on ochre | **2.78** | **4.60** | `--ochre-btn` `#AE621A` | `.btn-primary` `globals.css:78` — 25 call sites |
| 2 | white on ochre600 | 3.79 | 5.52 | `--ochre-btn-hover` `#9B5816` | `.btn-primary:hover` `globals.css:79` |
| 3 | white on green | 3.48 | 4.61 | `--green-btn` `#17855F` | `.btn-green` `globals.css:81` |
| 4 | white on green | 3.48 | 4.61 | `--green-btn` | `.chip-free` `globals.css:108` |
| 5 | white on green | 3.48 | 4.61 | `--green-btn` | pilot chip `pour-les-profs:739` |
| 6 | white on green | 3.48 | 4.61 | `--green-btn` | phone-mock LIVE chip `pour-les-profs:350` |
| 7 | green on green50 | **3.06** | **4.98** | `--green-ink` `#147553` | "Nouveau" `ExploreClient.tsx:406` |
| 8 | green on green50 | 3.06 | 4.98 | `--green-ink` | "done" chip `dashboard/page.tsx` |
| 9 | green on paper | 3.48 | 5.68 | `--green-ink` | `.sf-free` "Gratuite" `StorefrontView.tsx` |
| 10 | green on cream | 3.26 | 5.32 | `--green-ink` | "0 TND" `page.tsx:378` |
| 11 | green on sand | 2.84 | 4.63 | `--green-ink` | green micro-copy `pour-les-profs` |
| 12 | ochre on sand | **2.27** | **4.64** | `--ochre-ink` `#995617` | step line `student/page.tsx` |
| 13 | ochre on cream | 2.60 | 5.32 | `--ochre-ink` | step line `verify/page.tsx` |
| 14 | ochre on ochre-tint | 2.55 | 5.21 | `--ochre-ink` | "3 things" tile `page.tsx:174` |
| 15 | ochre on cream *(large)* | **2.60** | **6.30** | `--ochre-ink` | h1 "**vérifié**" `page.tsx:319` |
| 16 | ochre on sand *(large)* | 2.27 | 5.49 | `--ochre-ink` | same h1 over the page wash |
| 17 | green on sand *(large)* | **2.84** | **6.54** | `--green-ink` | h1 "Tu gardes 100 %" `pour-les-profs:745` |

The table also grew from 52 to 65 pairs. Thirteen of the new rows are
**text on dark surfaces that had never been measured at all** — the storefront
hero, the live room, the balance card, the income panel — because their colours
were bare hexes scattered across nine files and invisible to any audit. They are
tokens now (`--on-blue`, `--on-dark`, `--on-dark-soft`, `--mint`, `--ink800/900`,
`--blue900`, `--rose200/300/600/700`) and all pass; worst case is
`--on-blue` on `--blue` at 6.14:1.

Twelve of those hexes were **exact duplicates of tokens that already existed**
(`#1B9C6F` = `--green`, `#F3C24B` = `--amber`, `#0E5AA6` = `--blue`,
`#E0852E` = `--ochre`, `#C26E1C` = `--ochre600`), so the avatar gradients, the
floating seat avatars and the checkout confetti would not have followed a brand
change. 59 raw hex values replaced across 11 files; `guardrails.mjs` now fails
the build if one comes back.

---

## 2. Confirmed visual defects

### 2.1 The tutor-landing phone mockup — `app/[locale]/pour-les-profs/page.tsx`

The hero of the page tutors share to recruit other tutors.

* The four floating avatars were positioned at a flat **±120px** inside a
  **300px-wide** phone, so they sat *on* the content. The "A" covered the "1" of
  "1er cours offert" and it rendered **"ler cours offert"**. Offsets now derive
  from `--phone-w` (`page.tsx:284-287`, `:562`), so they cannot re-enter the
  content box at any width in either language.
* "Ta page de prof" and "Maths · primaire → Bac" truncated because the LIVE chip
  shared the name row. The chip moved onto the class card — which is what is
  actually live — and the class title wraps to two lines instead of ellipsing
  (`page.tsx:350`, `:611`).
* **7 horizontal-overflow failures, now 0.** `.lpp-zellige-wash` used
  `inset:-6%`, bleeding 6% of the scene width past *both* edges (`page.tsx:582`).
  And `.lpp-glow` mixed a **logical** `inset-inline-start:50%` with a
  **physical** `translate:-50%` — in Arabic both pulled the same way and threw it
  ~350px off-canvas, so a 320px screen scrolled sideways to **670px**
  (`page.tsx:590`). Centred with `inset-inline:0 + margin-inline:auto` instead.

### 2.2 Routes that rendered blank without JavaScript

All measured against a **production standalone build**, not dev.

| route | before | cause | fix |
|---|---|---|---|
| `/pour-les-profs` | h1, sub and CTA all `opacity:0` | `.lpp-reveal` shipped hidden in the SSR HTML; only an IntersectionObserver in a `useEffect` revealed it | the final state is now the default and JS **arms** the animation, only for off-screen elements (`page.tsx:190-236`) |
| `/` | 3 sections permanently invisible | same shape on `.lp-rv` | same inversion (`page.tsx:176-215`) |
| `/auth` | **no h1, no phone field, no button** | `useSearchParams()` forced the whole form into a Suspense boundary, which Next bails to client-only rendering on a static route | page is a server shell that reads `?next=` and hands it down (`app/[locale]/auth/page.tsx`, `components/auth/AuthInner.tsx`) |
| `/<bad-slug>` | `<body>` was **6 bytes** | `notFound()` renders its boundary client-side only in Next 14 | renders `<NotFoundScreen>` inline (`[slug]/page.tsx:180`) |

Two secondary bugs fixed in passing:

* `threshold: 0.16` (and `0.1` on the home page) — a section **taller than the
  viewport** can never reach a fractional visibility ratio, so it would have
  stayed invisible forever. That is very reachable at 320px in Arabic. Both are
  `threshold: 0` with a negative `rootMargin`, which is height-independent.
* `app/[locale]/loading.tsx` **deleted**. Its Suspense boundary was what turned
  the storefront's cold-ISR render into hidden, JS-dependent content and made
  every bad slug a soft-404. It only ever fired for `[slug]` — every other
  dynamic route is `"use client"` and has no server wait.

`nojs.mjs`: **16 routes, 40 assertions, 0 failures** on dev *and* production.

### 2.3 The stray square-cornered box on every `/explore` card

Not a border-radius problem. Tailwind preflight is off, so nothing zeroes
`border-width`. A single-side utility (`border-t`) sets only the top width, but
the `border-solid` it is paired with sets the *style* on all four sides — at
which point the CSS initial `medium` (3px) width becomes real on the other three.
Restored that one rule of preflight in `@layer base` (`globals.css:70`), which
fixes all three sites at once and prevents the next one.

---

## 3. Accessibility

`a11y.mjs` enforces three obligations axe's WCAG tags never report, all measured
on the **rendered** page so `clamp()` and RTL overrides are accounted for.

| defect | scale | fix |
|---|---|---|
| **No skip link anywhere** (WCAG 2.4.1) | 34 routes | `components/SkipLink.tsx` in `SiteShell`, clipped rather than `display:none` (which would drop it from the tab order), `inset-inline` so it lands top-right in Arabic; `<main id="main" tabIndex={-1}>` so focus actually moves |
| **Text inputs had no focus ring** (WCAG 2.4.7) | 20 routes | `.inp input` sets `outline:0`, leaving only a 1.6px border hue change. The wrapper now takes the same 3px ring every button gets (`globals.css:195`); same on `/explore`'s search bar |
| **Touch targets < 44px** | 6 kinds | LocaleToggle 40→44, footer links 40→44, footer mailto 106×16→44, header brand 86×34→44, `.linklike` 156×16→44 — and the real one: `.inp` carried the vertical padding while the `<input>` was **17px tall**, so the field *looked* 46px but a tap in the padding focused nothing. Padding moved onto the control |
| **Text below 13px** | 122 declarations, 23 files | raised to the 13px daylight floor across four syntaxes (`text-[Npx]`, `text-xs`, `fontSize:N`, `font-size`) |
| `role="progressbar"` with no accessible name | 2 routes | labelled in FR and AR (`onboarding/page.tsx:110`) — the only serious axe violation in the app |
| `role="menu"` with no `menuitem` children | `dashboard/page.tsx:269` | plain `<div>` — the role promised a widget that did not exist |
| Unlabelled review textarea | `student/page.tsx:198` | `aria-label`; a placeholder disappears when you type and is not a label |
| `<Spinner>` with no `role="status"` | `components/ui.tsx:87` | every OTP request and form submit was silent to a screen reader (WCAG 4.1.3) |
| Heading order skips | footer, payout | footer `h3`→`h2`, payout signed-out `h3`→`h2` |
| Dashboard printed its heading and body **twice** | `dashboard/page.tsx` | header carries the page name; the panel carries the message |

**Keyboard:** 40 routes, both locales — skip link is the first stop everywhere,
every stop paints a visible ring, no traps, no positive tabindex.

---

## 4. Performance

Cold cache, 380px, production standalone build.

| | fonts before | fonts after | files |
|---|---|---|---|
| `/fr` | 114.0 kB | **81.2 kB** (−29%) | 4 → 3 |
| `/ar` | 169.5 kB | **142.8 kB** (−16%) | 7 → 6 |

All three families used to ship to both locales. Now `fr` gets Space Grotesk +
Plus Jakarta + **one** weight of the Arabic face (the brand mark is genuinely
Arabic: the logo glyph is ق and the wordmark is "Tnajem تنجّم"), and `ar` gets
IBM Plex Sans Arabic only — it carries Latin glyphs, so "15 TND" still renders.
`globals.css` now remaps **`--fb` as well as `--fd`** under `dir="rtl"`; without
that, every `font-family:var(--fb)` in Arabic still asked for a font no longer
loaded and fell through to `system-ui`, giving Arabic form fields a different
face from the rest of the screen. Weight 800 dropped (unused) and 500 dropped
after moving the codebase's only two `font-weight:500` declarations to 600.

**The storefront is a server component now.** `StorefrontView.tsx` was 750 lines
of `"use client"` for exactly one interactive element — the native share sheet.
Both locale dictionaries, the price/seats branching and the whole review list
were serialised into the client bundle to render markup that never changes after
paint, on the URL tutors paste into WhatsApp.

```
/[locale]/[slug] route JS   9.43 kB → 2.21 kB
first load JS                117 kB → 110 kB
```

`<ShareButton>` is the island, and it now hides itself where `navigator.share`
does not exist instead of rendering a button that does nothing.

**The root is rewritten, not redirected.** "tnajem.com" is the URL people type and
read out loud; a 307 there cost a whole extra round trip (0.5–1s on 3G) before
the first byte. `GET /` is **200 with 0 redirects**. Deeper paths still redirect
on purpose — `/explore` and `/fr/explore` serving the same page at two URLs would
split ranking signals.

### Lighthouse — mobile, simulated 3G, production build

| route | perf | a11y | best practices | SEO |
|---|---|---|---|---|
| `/fr/yassine-math` | **96** | **100** | 96 | 100 |
| `/ar/yassine-math` | 93 | 100 | 96 | 100 |
| `/fr` | 97 | 100 | 100 | 100 |
| `/ar` | 94 | 100 | 100 | 100 |
| `/fr/explore` | 97 | 100 | 100 | 100 |
| `/ar/explore` | 94 | 100 | 100 | 100 |
| `/fr/pour-les-profs` | 93 | 100 | 96 | 100 |
| `/ar/pour-les-profs` | 92 | 100 | 96 | 100 |

Storefront: FCP 1.7s, LCP 2.7s, TBT 0ms, CLS 0.

---

## 5. Consistency

**`.grid` deleted from the design-system selector list.** It collided by name
with Tailwind's `grid` display utility, so all 10 `className="grid"` sites
silently inherited a 14–22px gap they never asked for. Nothing relied on it — the
design system's grids are `.grid-auto` / `.grid-2` / `.grid-3`.

**Inline styles → Tailwind: 588 → 165 objects** across 16 files. The landing
pages were already in the Tailwind idiom; the logged-in product was not, so every
spacing or colour decision had to be made twice.

Proven inert two independent ways: **160/160 screenshots pixel-identical** and
**0 differences in the box and computed style of every element on all 40
route/locale pairs**.

`geom.mjs` is what made that safe, and it earned its keep — it caught four real
regressions that code review had passed, all instances of one hazard:
**an inline style always wins; a utility class does not.**

1. `tracking-[0.6]` — `letterSpacing` is not a unitless CSS property, so the
   utility was invalid CSS, silently dropped, and a heading lost 10px.
2. `text-mint` / `text-on-blue` losing to `.trust .ic` / `.trust p`. Tailwind's
   `@layer` here is build-time ordering, not native cascade layers, so a utility
   (0,1,0) does **not** beat a component rule (0,2,0). Fixed properly with the
   `.trust-dark` modifier the design system was missing.
3. `mb-0` losing to `.sf-empty-body`, injected unlayered via
   `dangerouslySetInnerHTML` and therefore outranking every Tailwind layer.
4. `pb-0` / `py-0` losing to `.web-section.tight`.

---

## 6. Exit criteria

```
contrast.mjs    65 pairs checked — 0 FAIL          ✓
guardrails.mjs  0 violations                       ✓
                 · 0 physical left/right declarations
                 · 23 bilingual copy objects, 458 keys per locale, identical
                 · 0 hardcoded French in aria-label/placeholder/title/alt
                 · 0 raw hex outside globals.css
nojs.mjs        16 routes, 40 assertions — 0 failed ✓   (dev AND production)
a11y.mjs        40/40 routes — 0 serious/critical,      ✓
                0 manual-rule failures
keyboard.mjs    40 routes — 0 failures, 0 unringed,     ✓
                0 positive tabindex
shots.mjs       160 screenshots — 0 overflow, 0 clipped ✓
lighthouse      perf 92–97, a11y 100 on 8 public routes ✓
tsc --noEmit    clean                                   ✓
npm run build   green                                   ✓
```

---

## 7. Deliberately not fixed

1. **Four non-text contrast rows below 3.0** (WCAG 1.4.11), reported as advisory
   by `contrast.mjs`: `--line` on paper 1.32 and on cream 1.23; `--paper` card
   fill against cream 1.07 and sand 1.23. These are hairline separators and card
   fills, not the sole means of identifying a component — every field has a
   visible `<label>`, every card has heading text. Darkening `--line` to 3:1
   would visibly change the brand's soft-paper look on every surface. **This is a
   founder call, not a technical blocker.**

2. **A bad tutor slug returns HTTP 200, not 404.** Measured: Next 14.2 renders a
   runtime `notFound()` boundary **client-side only** — the production `<body>`
   came back at 6 bytes, a white screen for anyone whose bundle had not landed.
   You chose the readable page; `generateMetadata` still emits
   `robots: noindex, nofollow`, so dead slugs stay out of the index. Revisit if
   Next ever server-renders that boundary.

3. **165 inline style objects remain.** Every one is dynamic (a ternary or a
   computed value), a 3/4-value padding shorthand, a gradient, or an SVG stroke.
   Those are correct code, not debt — a codemod that converted them would be
   guessing.

4. **`/fr` still downloads 32.7 kB of IBM Plex Sans Arabic** for the brand mark
   alone (ق and تنجّم). Inlining the wordmark as SVG would remove it from the
   critical path of every French page. That is a brand-asset change and I did not
   make it unilaterally.

5. **Only the storefront was converted to a server shell.** Dashboard,
   `/pour-les-profs` and `/onboarding/verify` are still large client components.
   They are logged-in or genuinely interactive, and none is the WhatsApp entry
   point, so the return is much smaller for materially more risk.

6. **Coverage limit worth knowing.** The pixel and geometry proofs cover the
   default rendered state of 40 route/locale pairs at four widths. They do **not**
   cover hover, active, or conditional UI (open modals, filled forms, error
   states). Those were reviewed by reading the diffs, not measured.

---

## 8. Screenshots

`node scripts/ui-audit/shots.mjs` writes 160 PNGs to `scripts/ui-audit/shots/`
(gitignored). A baseline of the last commit before this work
(`5a96b7c`) is in `scripts/ui-audit/shots-before/`; compare any pair with
`node scripts/ui-audit/diff.mjs shots-before shots`.

Worth opening side by side:

| before | after | what changed |
|---|---|---|
| `explore-fr-768.png` | `explore-fr-768.png` | the 3px phantom box around the price row becomes a single hairline rule; "Nouveau" goes from 3.06:1 to 4.98:1 |
| `pour-les-profs-fr-1280.png` | `pour-les-profs-fr-1280.png` | avatars clear the phone; "Ta page de prof" and the share link render in full |
| `pour-les-profs-ar-320.png` | `pour-les-profs-ar-320.png` | 670px of horizontal scroll on a 320px screen → none |
| `storefront-fr-380.png` | `storefront-fr-380.png` | "Gratuite" 3.48:1 → 5.68:1; 13px text floor throughout |
| `dashboard-fr-320.png` | `dashboard-fr-320.png` | the duplicated heading and body are gone |

Note: `shots-before/` is the last **commit** before this work, not the
uncommitted working tree the session started from, so a few unrelated differences
from that in-flight work appear in it too.
