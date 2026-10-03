#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════
   keyboard.mjs — tab through every route and assert the four things that make a
   page operable without a mouse.

     RING     every element that receives keyboard focus paints a VISIBLE
              indicator (WCAG 2.4.7). Checked as a real computed style after a
              real Tab press, so :focus-visible has actually matched — an
              outline declared in CSS that some other rule overrides would still
              fail here, which is the point.
     ORDER    focus follows DOM order. Any positive tabindex is reported: it
              takes an element out of document order and pushes it ahead of
              everything with tabindex 0, which reorders the whole page.
     NO TRAP  focus never sticks on one element, and the tab cycle reaches
              essentially every focusable control rather than looping inside a
              small subset (WCAG 2.1.2).
     REACH    the first Tab lands on the skip link, so the sticky header can
              actually be bypassed.

   live-fixes-2 · F (the keyboard pass on the prof shell) adds three more, because a
   ring nobody can see is no ring:
     SEEN     every stop is on screen once focused — not a zero-size or invisible
              control (unless its visible box rings instead: a hidden radio inside
              its chip), not outside the viewport, and not ENTIRELY covered by the
              sticky top bar, the pinned action bar or the phone tab bar
              (WCAG 2.4.11 — the page scrolls a field above them on purpose).
     REGIONS  in the prof shell, focus visits the frame in one order and never comes
              back: skip link → sidebar → top bar → main → action bar → tab bar
              (the sidebar only exists from 900px; the phone has the top bar and the
              tab bar instead). The sidebar runs the full height at the inline start
              and holds the logo, so it is read first, as it is seen.

   Both locales — RTL reading order is a real source of tab-order surprises.
     UI_AUDIT_VIEWPORTS  "1440x900,390x844" — the screens to walk (default 380x900)
     UI_AUDIT_ROUTES     a regex on the locale-bare path, e.g. "^/(dashboard|onboarding|messages)"
   Exit code 1 on any failure.
   ══════════════════════════════════════════════════════════════════════════════ */

import { chromium } from "playwright";
import { expand, assertServer, applySession } from "./routes.mjs";

const MAX_TABS = 90;

/* Describe whatever currently has focus, plus whether it is visibly ringed. */
const SNAP = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const fv = el.matches(":focus-visible");

  /* The ring is not always on the focused element. A text input inside .inp is a
     BORDERLESS control in a styled box: the box is what the user perceives as
     the field, so the box is what gets ringed (:focus-within). Look one or two
     levels up for a ring that appeared because this element has focus —
     otherwise the check would demand a second, redundant ring on the control
     and make the design worse. */
  const ringed = (n) => {
    const s = getComputedStyle(n);
    const w = parseFloat(s.outlineWidth) || 0;
    return s.outlineStyle !== "none" && w >= 1;
  };
  let hasOutline = ringed(el);
  let shadow = cs.boxShadow && cs.boxShadow !== "none";
  for (let n = el.parentElement, hops = 0; n && hops < 2 && !hasOutline; n = n.parentElement, hops++) {
    if (n.matches(":focus-within") && ringed(n)) hasOutline = true;
  }
  const r = el.getBoundingClientRect();

  /* SEEN — measured on the box the user perceives: the element, or the ancestor that
     rings for it (a sr-only radio inside its chip carries the global outline on a 1×1px
     box that nobody sees; its chip is what is ringed). */
  let box = el;
  if (!(ringed(el) && r.width >= 2 && r.height >= 2)) {
    for (let n = el.parentElement, hops = 0; n && hops < 2; n = n.parentElement, hops++) {
      if (n.matches(":focus-within") && ringed(n)) { box = n; break; }
    }
  }
  const b = box.getBoundingClientRect();
  const bs = getComputedStyle(box);
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const hidden = b.width < 2 || b.height < 2 || bs.visibility === "hidden" || Number(bs.opacity) === 0;
  const outside = !hidden && (b.right <= 0 || b.bottom <= 0 || b.left >= vw || b.top >= vh);
  /* Covered: every sampled point of the box lands on something that is neither the
     box, inside it, nor around it (an ancestor) — the sticky bars, a pinned bar. */
  let covered = false;
  let coveredBy = "";
  if (!hidden && !outside) {
    const ix = Math.min(4, b.width / 4);
    const iy = Math.min(4, b.height / 4);
    const pts = [
      [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
      [b.left + ix, b.top + iy], [b.right - ix, b.top + iy],
      [b.left + ix, b.bottom - iy], [b.right - ix, b.bottom - iy],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
    const hits = pts.map(([x, y]) => document.elementFromPoint(x, y));
    const foreign = hits.filter((h) => h && h !== box && !box.contains(h) && !h.contains(box) && !el.contains(h));
    covered = pts.length > 0 && foreign.length === pts.length;
    if (covered) {
      const h = foreign[0];
      coveredBy = `${h.tagName.toLowerCase()}.${String(h.className || "").trim().split(/\s+/)[0] || ""}`;
    }
  }

  /* REGIONS — where the stop sits in the prof shell's frame (null outside the shell). */
  const region = !el.closest(".aps") ? null
    : el.matches(".skip-link") ? "skip"
    : el.closest(".aps-side") ? "sidebar"
    : el.closest(".aps-top") ? "topbar"
    : el.closest(".aps-actionbar") ? "actionbar"
    : el.closest("main") ? "main"
    : el.closest(".aps-tabs") ? "tabbar"
    : "other";

  return {
    tag: el.tagName.toLowerCase(),
    cls: String(el.className || "").trim().slice(0, 44),
    txt: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 28),
    id: el.id || "",
    tabindex: el.getAttribute("tabindex"),
    ring: hasOutline || (fv && shadow),
    focusVisible: fv,
    offscreen: r.width === 0 && r.height === 0,
    hidden, outside, covered, coveredBy, region,
    /* Identity for cycle detection = the element's POSITION in the document, not
       its tag+class+text. Two rows of a settings list can legitimately be
       identical strings, and a name-based key made the walker think it had
       looped after 5 stops and report a phantom trap. */
    key: [...document.querySelectorAll("*")].indexOf(el),
  };
};

await assertServer();

const ROUTE_RE = process.env.UI_AUDIT_ROUTES ? new RegExp(process.env.UI_AUDIT_ROUTES) : null;
const targets = expand((r) => !ROUTE_RE || ROUTE_RE.test(r.path));
const VIEWPORTS = (process.env.UI_AUDIT_VIEWPORTS || "380x900").split(",").map((v) => {
  const [width, height] = v.trim().split("x").map(Number);
  return { width, height, tag: `${width}x${height}` };
});
const REGION_ORDER = ["skip", "sidebar", "topbar", "main", "actionbar", "tabbar"];
const browser = await chromium.launch();

let failed = 0;
let runs = 0;
const noRing = new Map();
const positiveTabindex = new Map();

console.log(
  `\nKeyboard operability — Tab through ${ROUTE_RE ? `the routes matching ${ROUTE_RE}` : "every route"}, ` +
  `both locales, ${VIEWPORTS.map((v) => v.tag).join(" + ")}\n`
);

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  for (const r of targets) {
    runs++;
    // Per route, not once: the tutor screens and the student screens need
    // DIFFERENT sessions now that both are role-guarded server-side.
    await applySession(ctx, r);
    const label = `/${r.locale}${r.path === "/" ? "" : r.path}${VIEWPORTS.length > 1 ? ` @${vp.tag}` : ""}`;
    const page = await ctx.newPage();
    const problems = [];
    try {
      await page.goto(r.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(900);

      const focusableCount = await page.evaluate(() => {
        const SEL = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
        return [...document.querySelectorAll(SEL)].filter((e) => {
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          return cs.visibility !== "hidden" && cs.display !== "none" && (b.width > 0 || e.matches("a[href^='#']"));
        }).length;
      });

      const seen = [];
      const keys = new Set();
      let stuck = 0;
      for (let i = 0; i < Math.min(MAX_TABS, focusableCount + 4); i++) {
        await page.keyboard.press("Tab");
        const s = await page.evaluate(SNAP);
        if (!s) break;
        if (seen.length && s.key === seen[seen.length - 1].key) {
          stuck++;
          if (stuck >= 2) {
            problems.push(`TRAP: focus stuck on <${s.tag}.${s.cls}> "${s.txt}"`);
            break;
          }
        } else stuck = 0;
        if (keys.has(s.key) && keys.size > 3) break; // completed the cycle
        keys.add(s.key);
        seen.push(s);
      }

      // 1. first stop must be the skip link
      if (seen.length && seen[0].id !== "" ) { /* id on the target, not the link */ }
      const first = seen[0];
      if (!first || !(first.tag === "a" && /skip-link/.test(first.cls))) {
        problems.push(`first Tab stop is <${first?.tag}.${first?.cls}>, not the skip link`);
      }

      // 2. every stop paints a ring
      for (const s of seen) {
        if (s.offscreen) continue;
        if (!s.ring) {
          const k = `${s.tag}.${s.cls}`;
          if (!noRing.has(k)) noRing.set(k, { ...s, routes: [] });
          noRing.get(k).routes.push(label);
        }
      }

      // 3. positive tabindex reorders the page
      for (const s of seen) {
        if (s.tabindex && Number(s.tabindex) > 0) {
          const k = `${s.tag}.${s.cls}[tabindex=${s.tabindex}]`;
          if (!positiveTabindex.has(k)) positiveTabindex.set(k, []);
          positiveTabindex.get(k).push(label);
        }
      }

      // 5. SEEN — on screen, not hidden, not entirely covered by a bar
      for (const s of seen) {
        const what = `<${s.tag}.${s.cls}> "${s.txt}"`;
        if (s.hidden && !s.ring) problems.push(`HIDDEN: focus lands on an invisible ${what}`);
        else if (s.outside) problems.push(`OFF-SCREEN: ${what} is focused outside the viewport`);
        else if (s.covered) problems.push(`OBSCURED: ${what} is entirely under <${s.coveredBy}>`);
      }

      // 6. REGIONS — the shell's frame is visited in one order, never revisited
      let at = -1;
      for (const s of seen) {
        if (!s.region || s.region === "other") continue;
        const i = REGION_ORDER.indexOf(s.region);
        if (i < at) {
          problems.push(`ORDER: <${s.tag}.${s.cls}> "${s.txt}" (${s.region}) comes after the ${REGION_ORDER[at]}`);
          break;
        }
        at = i;
      }

      // 4. the cycle must actually reach the page's controls
      if (focusableCount > 6 && keys.size < Math.min(focusableCount, 6)) {
        problems.push(`cycle covered only ${keys.size} of ${focusableCount} focusable elements`);
      }

      const ringless = seen.filter((s) => !s.ring && !s.offscreen).length;
      if (problems.length) failed++;
      console.log(
        `  ${problems.length ? "FAIL" : "ok  "}  ${label.padEnd(26)} ${String(keys.size).padStart(2)} stops` +
        `${ringless ? `, ${ringless} without a ring` : ""}`
      );
      for (const p of problems) console.log(`          ${p}`);
    } catch (e) {
      failed++;
      console.log(`  ERR   ${label.padEnd(26)} ${e.message.split("\n")[0]}`);
    }
    await page.close();
  }
  await ctx.close();
}

await browser.close();

if (noRing.size) {
  console.log("\n  ── FOCUSED WITHOUT A VISIBLE RING (WCAG 2.4.7) ──");
  for (const [k, v] of noRing) {
    console.log(`  <${k}> "${v.txt}"  focus-visible=${v.focusVisible}`);
    console.log(`    ${v.routes.length} route(s): ${v.routes.slice(0, 5).join(", ")}${v.routes.length > 5 ? ", …" : ""}`);
  }
}
if (positiveTabindex.size) {
  console.log("\n  ── POSITIVE tabindex (reorders the page) ──");
  for (const [k, routes] of positiveTabindex) console.log(`  ${k}  ${routes.length} route(s)`);
}

const total = failed + noRing.size + positiveTabindex.size;
console.log(
  `\n  ${runs} route runs (${targets.length} routes × ${VIEWPORTS.length} screen(s)) — ${failed} route failure(s), ` +
  `${noRing.size} unringed control(s), ${positiveTabindex.size} positive tabindex\n`
);
if (total) {
  console.error("  x Keyboard operability failures.\n");
  process.exit(1);
}
console.log("  OK — skip link first, every stop ringed and on screen, the shell's frame in order, no traps, no positive tabindex.\n");
