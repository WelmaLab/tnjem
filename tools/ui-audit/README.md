# scripts/ui-audit — the UI measurement harness

Seven runners, plus two verification helpers. Each exits non-zero on failure, so `npm run ui:audit` is a gate,
not a report you can talk yourself out of.

| script | what it proves | needs a server |
|---|---|---|
| `contrast.mjs` | every foreground/background pair the app renders clears WCAG 2.1 AA | no |
| `guardrails.mjs` | RTL uses logical properties only · FR/AR key sets identical · no hardcoded French · no untokenised colour | no |
| `nojs.mjs` | every public route shows h1 + sub-headline + primary CTA with **JavaScript disabled** | yes |
| `a11y.mjs` | zero serious/critical axe violations + skip link + 44px targets + 13px text floor, every route, **both locales** | yes |
| `keyboard.mjs` | Tab through every route: skip link first, every stop visibly ringed **and on screen** (not hidden, not under a sticky bar), the prof shell's frame in order, no traps, no positive tabindex | yes |
| `lighthouse.mjs` | Performance >= 80 and Accessibility = 100, mobile, simulated 3G (**production build only**) | yes |
| `shots.mjs` | full-page screenshots at 320 / 380 / 768 / 1280, **plus** viewport-overflow and text-clipping detection | yes |
| `weight.mjs` | what a first-time visitor downloads per route, split by resource type (informational) | yes |

```bash
npm run dev -- -p 3111      # then, in another shell:
npm run ui:audit            # contrast + nojs + a11y
node tools/ui-audit/shots.mjs
```

Against the REAL production server — what the harness was built for, since
`next start` does not serve an `output: "standalone"` build:

```bash
npm run build -w @tnajem/web
bash tools/ui-audit/_restart-prod.sh        # standalone on :3222
npm run dev:api                             # the pages proxy to it
UI_AUDIT_BASE=http://localhost:3222 npm run ui:audit
UI_AUDIT_BASE=http://localhost:3222 node tools/ui-audit/shots.mjs
```

> **KILL THE SERVER BEFORE YOU REBUILD.** On Windows a running server holds an
> open handle on `.next`, and `next build` does not fail — it hangs, indefinitely,
> having already emptied the output directory. It looks exactly like a slow
> machine. `_restart-prod.sh` kills :3222 on its way in, so the safe loop is
> **kill -> build -> restart**, never build-while-serving.

`UI_AUDIT_BASE` points the browser runners somewhere else (default
`http://localhost:3111`). `keyboard.mjs` also takes `UI_AUDIT_VIEWPORTS`
(`1440x900,390x844`; default `380x900`) and `UI_AUDIT_ROUTES` (a regex on the
locale-bare path) — the prof shell's keyboard pass (live-fixes-2 · F):

```bash
UI_AUDIT_BASE=http://localhost:3222 UI_AUDIT_VIEWPORTS=1440x900,390x844   UI_AUDIT_ROUTES='^/(dashboard|messages|onboarding(/verify)?$)' node tools/ui-audit/keyboard.mjs
```

## Logged-in routes

Routes marked `auth` in `routes.mjs` are visited with a **real session**, minted by
`sessionCookie()` straight into the `sessions` table — one for a tutor, one for a
student, because the two halves of the product are role-guarded server-side and
cannot share a cookie. Mark a route `auth: "student"` when it belongs to the
student side (`/student`, `/student/welcome`, `/onboarding/upgrade`); `auth: true`
means the tutor side.

This replaced the old `tnajem_session=demo` sentinel, which was never a session:
`getSession()` looks it up in `sessions` and finds nothing whenever a database is
configured, and `middleware.ts` rejects the literal string in production. Every
`auth` route was therefore being measured in its signed-out state — tolerable while
those pages rendered an empty panel, and actively misleading once `/onboarding`,
`/onboarding/verify`, `/student/welcome` and `/onboarding/upgrade` grew server-side
role guards that redirect. The harness would have reported six green route names
while screenshotting `/auth` six times.

Minting writes rows, so it **refuses any database that is not on localhost** and
falls back to the sentinel — which is also what happens in demo mode (no
`DATABASE_URL`), where the page guards are inert by design and the screens render
anyway. The two audit accounts are `+21600000001` (tutor) and `+21600000002`
(student).

## Auditing a production build

Several defects only reproduce in a production build (streaming, Suspense
bail-outs, static vs. dynamic rendering), and `next.config.mjs` sets
`output: "standalone"` — which `next start` refuses to serve correctly. Use the
helper, which also mirrors `.next/static`, `public/` and `.env.local` into the
standalone bundle (Next does not copy those, by design):

```bash
npm run build
bash scripts/ui-audit/_restart-prod.sh /tmp/prod.log
UI_AUDIT_BASE=http://localhost:3222 npm run ui:audit
```

## `tune.mjs`

Not part of the gate. Given a brand hue and a set of surfaces it must sit on, it
finds the **lightest** shade that still clears the contrast floor — so an accent
passes AA without being darkened into mud. Used to derive the `--ochre-btn` /
`--green-ink` family in `globals.css`.

## Verifying that a refactor changed nothing

`to-tailwind.mjs` (the inline-style → Tailwind codemod) and any other mechanical
change are verified two ways, because pixels and geometry catch different things:

```bash
node scripts/ui-audit/shots.mjs --out=shots-baseline   # before
node scripts/ui-audit/geom.mjs  before.json            # before
# ...make the change...
node scripts/ui-audit/shots.mjs && node scripts/ui-audit/diff.mjs   # pixel-identical?
node scripts/ui-audit/geom.mjs "" before.json                       # geometry-identical?
```

`diff.mjs` compares SHA-256 of each PNG — Playwright's encoding is deterministic,
so equal hashes mean pixel-identical. `geom.mjs` dumps the box **and computed
style** of every element on every route and diffs those, which is what actually
localises a regression: a pixel diff says "storefront-fr-380.png changed", while
geom says "this `<p>` lost 12px of bottom margin".

Both were needed. The Tailwind conversion looked clean in review but geom.mjs
caught four real regressions a pixel diff alone would only have flagged, not
explained:

* `tracking-[0.6]` — `letterSpacing` is not a unitless property, so the utility
  was invalid CSS and silently dropped, narrowing a heading by 10px;
* `text-mint` / `text-on-blue` losing to `.trust .ic` / `.trust p` — Tailwind's
  `@layer` here is build-time ordering, not native cascade layers, so a utility
  (0,1,0) does **not** beat a component rule (0,2,0) the way an inline style did;
* `mb-0` losing to `.sf-empty-body`, which is injected unlayered via
  `dangerouslySetInnerHTML` and therefore outranks every Tailwind layer;
* `pb-0` losing to `.web-section.tight`, same specificity story.

That is the general hazard of this codemod: an inline style always wins, a
utility class does not. Anything it converts on an element that also carries a
component class has to be re-measured, not eyeballed.
