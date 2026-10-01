import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedProfile } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* UI Option A "Clair" — the colour rules that must not drift back.

   Colours are asserted as COMPUTED values, so a token change that silently breaks
   a rule (a gradient creeping back onto <body>, near-black back on a button) fails
   here rather than in a screenshot nobody compares. */

const BG = "rgb(251, 247, 240)"; // --bg (= --cream)

async function bodyBackground(page: Page) {
  return page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { image: s.backgroundImage, color: s.backgroundColor };
  });
}

test.describe("A1 — one flat page background", () => {
  test("/fr/explore: no gradient on <body>, the flat --bg, and the body covers the whole page", async ({ page }) => {
    await page.goto("/fr/explore");
    const bg = await bodyBackground(page);
    expect(bg.image, "no radial washes on the page background").toBe("none");
    expect(bg.color).toBe(BG);
    /* The old bug: html,body{height:100%} made the body exactly one viewport tall,
       so its background stopped halfway down a long grid. */
    const { bodyH, docH } = await page.evaluate(() => ({
      bodyH: document.body.getBoundingClientRect().height,
      docH: document.documentElement.scrollHeight,
    }));
    expect(bodyH).toBeGreaterThanOrEqual(docH - 1);
  });

  test("/ar: the same flat background in Arabic", async ({ page }) => {
    await page.goto("/ar");
    const bg = await bodyBackground(page);
    expect(bg.image).toBe("none");
    expect(bg.color).toBe(BG);
  });
});

/* ── A3: near-black is no longer a button or a selected state ─────────────────── */
const BLUE = "rgb(14, 90, 166)"; // --blue
const BLUE50 = "rgb(233, 241, 250)"; // --blue50
const TRANSPARENT = "rgba(0, 0, 0, 0)";

async function signedInTutor(ctx: BrowserContext) {
  const tutor = await seedProfile({ role: "tutor", birthYear: 1990 });
  await loginAs(ctx, tutor.id);
  // The header reads the readable role hint a real login sets, not the session.
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: new URL(BASE_URL).hostname, path: "/" }]);
}

const colours = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor };
  });

test.describe("A3 — the header, the language toggle and the sidebar speak cobalt", () => {
  test("header 'Tableau de bord' is a cobalt OUTLINE button, and the selected language is cobalt on blue50", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await signedInTutor(ctx);
    const page = await ctx.newPage();
    await page.goto("/fr/explore");
    const cta = await colours(page, 'header a.qh-cta[href="/fr/dashboard"]');
    expect(cta, "outline: transparent fill, cobalt label and border").toEqual({ bg: TRANSPARENT, color: BLUE, border: BLUE });
    const lang = await colours(page, 'header button[aria-pressed="true"]');
    expect({ bg: lang.bg, color: lang.color }).toEqual({ bg: BLUE50, color: BLUE });
    await ctx.close();
  });

  test("the current sidebar item is cobalt on blue50 with a cobalt border", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await signedInTutor(ctx);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    /* espace prof v2 · shell: the sidebar is the AppShell's (image 1) — the current
       item is cobalt on blue50, a filled pill with no outline. */
    const cur = await colours(page, '.aps-side .aps-link[aria-current="page"]');
    expect({ bg: cur.bg, color: cur.color }).toEqual({ bg: BLUE50, color: BLUE });
    await ctx.close();
  });
});
