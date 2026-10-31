import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/* home v2 · F — the home page in Arabic and at every width.

   1. FR and AR at 1440 · 1280 · 1024 · 768 · 390 · 360: the PAGE never scrolls
      sideways (the chip row scrolls inside its own box), no visible text under
      13px, and every visible link / button / field is at least 44 × 44 — header
      and footer included (the header's nav links were 30px tall, the footer's
      « Tarifs », « دخول », « لوحتي » 31–35px wide).
   2. Arabic mirrors: every doodle and every step arrow is flipped (`scale: -1 1`)
      in AR and not in FR; the forward arrows (CTA, search pill, chevrons) carry
      the flip; the subject row scrolls from the RIGHT edge in AR.
   3. The handwritten note is set in the Arabic face in AR (the hand faces of the
      French note have no Arabic glyph), asked of Chrome itself
      (CSS.getPlatformFontsForNode), as in arabic-font.spec.ts.
   4. Phone details: the hero card's row titles are not cut (« Prof de Physi… »
      at 360px), and below 1180px the rays doodle stays on the card's corner.

   Reduced motion: <Reveal> arms off-screen sections at opacity 0 until they
   scroll in; with reduced motion they render in their final state, so the
   sweep sees every section. The sweep is agnostic of the data: the shared
   database may hold real tutors (long names, prices) or none (subject rows).

   ADDED, never edited into an existing spec. */

const WIDTHS = [1440, 1280, 1024, 768, 390, 360];

type Sweep = { scrollW: number; innerW: number; small: string[]; taps: string[] };

/** Visible text under 13px and interactive elements under 44 × 44, on the whole page. */
async function sweep(page: Page): Promise<Sweep> {
  return page.evaluate(() => {
    const desc = (el: Element) => {
      const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      const txt = (el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} «${txt}»`;
    };
    const shown = (el: Element) => {
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const b = el.getBoundingClientRect();
      return b.width > 1 && b.height > 1; // .sr-only is a 1px clip
    };
    const small: string[] = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.textContent?.trim()) continue;
      seen.add(el);
      if (el.closest("script,style,noscript,[aria-hidden=true]") || !shown(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 13) small.push(`${fs}px ${desc(el)}`);
    }
    const taps: string[] = [];
    for (const el of document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button]")) {
      if (el.matches(".skip-link") || !shown(el)) continue; // the skip link is 1px until focused
      const b = el.getBoundingClientRect();
      // 43.5: sub-pixel layout (a 44px box can measure 43.98)
      if (b.width < 43.5 || b.height < 43.5) taps.push(`${Math.round(b.width)}×${Math.round(b.height)} ${desc(el)}`);
    }
    return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, small, taps };
  });
}

async function usedFonts(ctx: BrowserContext, page: Page, selector: string): Promise<string[]> {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  expect(nodeId, `${selector} exists`).toBeTruthy();
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  return fonts.map((f) => f.familyName);
}

for (const locale of ["fr", "ar"] as const) {
  for (const width of WIDTHS) {
    test(`/${locale} @${width}px: no sideways page scroll, text ≥ 13px, tap targets ≥ 44px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      await page.goto(`/${locale}`);
      await expect(page.locator("[data-e2e=home-prof]")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      const r = await sweep(page);
      expect(r.scrollW, "the page does not scroll sideways").toBeLessThanOrEqual(r.innerW);
      expect(r.small, "no visible text under 13px").toEqual([]);
      expect(r.taps, "every visible control is at least 44 × 44").toEqual([]);
      await ctx.close();
    });
  }
}

test("Arabic mirrors the doodles, the step arrows and the forward arrows; French does not", async ({ browser }) => {
  for (const locale of ["fr", "ar"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`/${locale}`);

    const scales = await page
      .locator(".hv2-doodle, .hv2-step-arrow")
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).scale));
    // The hero (blobs, rays, the note's arrow), the facts, the banner, the 3 step arrows.
    expect(scales.length, `${locale}: the doodles and step arrows are on the page`).toBeGreaterThanOrEqual(10);
    for (const s of scales) expect(s, `${locale}: a doodle's scale`).toBe(locale === "ar" ? "-1 1" : "none");

    // The forward arrows (Forward icon = .flip): mirrored by a transform in Arabic only.
    const flips = await page
      .locator("[data-e2e=home-hero] .flip")
      .evaluateAll((els) => els.map((e) => new DOMMatrix(getComputedStyle(e).transform).a));
    expect(flips.length, `${locale}: the hero's forward arrows`).toBeGreaterThanOrEqual(3);
    for (const a of flips) expect(a, `${locale}: a forward arrow's x scale`).toBe(locale === "ar" ? -1 : 1);
    await ctx.close();
  }
});

test("/ar: the handwritten note is set in the Arabic face; /fr: in a Latin hand", async ({ browser }) => {
  for (const locale of ["ar", "fr"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`/${locale}`);
    await page.evaluate(() => document.fonts.ready);
    const fonts = await usedFonts(ctx, page, ".hv-note-txt");
    // The AR note is weight 600: Chrome names the face « IBM Plex Sans Arabic SemiBold ».
    const arabic = fonts.filter((f) => f.startsWith("IBM Plex Sans Arabic"));
    if (locale === "ar") {
      expect(fonts.length, "the Arabic note uses one face").toBe(1);
      expect(arabic, `the Arabic note: ${fonts}`).toEqual(fonts);
    } else expect(arabic, `the French note: ${fonts}`).toEqual([]);
    await ctx.close();
  }
});

test("/ar on a phone: the subject row starts at the right edge and scrolls towards the left", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/ar");
  const row = page.locator("[data-e2e=home-subjects] nav");
  const r = await row.evaluate((nav) => {
    const first = nav.querySelector("a")!.getBoundingClientRect();
    return {
      overflows: nav.scrollWidth > nav.clientWidth,
      scrollLeft: nav.scrollLeft,
      firstRightGap: window.innerWidth - first.right,
      firstLeft: first.left,
    };
  });
  expect(r.overflows, "nine chips do not fit 390px: the row scrolls").toBe(true);
  expect(r.scrollLeft, "it starts at its inline start").toBe(0);
  expect(r.firstRightGap, "« رياضيات » sits at the right edge").toBeLessThan(48);
  expect(r.firstLeft, "« رياضيات » is the right-most chip").toBeGreaterThan(390 / 2);
  await ctx.close();
});

test("on a phone the hero card's titles are whole, and the rays stay on the card's corner", async ({ browser }) => {
  for (const [locale, width] of [["fr", 360], ["ar", 360], ["fr", 768], ["ar", 768]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`/${locale}`);
    // Cut = held on one line AND wider than its box (the ellipsis). On a phone both wrap.
    const cut = await page
      .locator(".hv-row-title-txt, .hv-row-meta")
      .evaluateAll((els) =>
        els
          .filter((e) => getComputedStyle(e).whiteSpace === "nowrap" && e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent),
      );
    expect(cut, `${locale} @${width}: no row title or level line is cut`).toEqual([]);

    const gap = await page.evaluate((rtl) => {
      const card = document.querySelector("[data-e2e=hero-tutors-card]")!.getBoundingClientRect();
      const rays = document.querySelector(".hv-rays")!.getBoundingClientRect();
      // from the rays' centre to the card's inline-end edge (right in FR, left in AR)
      const mid = rays.left + rays.width / 2;
      return Math.abs(mid - (rtl ? card.left : card.right));
    }, locale === "ar");
    expect(gap, `${locale} @${width}: the rays sit at the card's corner`).toBeLessThan(40);
    await ctx.close();
  }
});
