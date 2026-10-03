import { test, expect, type Browser, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-2 · A — THE SIDEBAR'S GROUP TITLES LINE UP WITH THE ICONS.

   The founder's live review: in Arabic the titles (التدريس, صفحتي, الحساب) looked
   flush against the sidebar's edge while the rows under them were inset; in French
   they line up with the icons. A title and a row now take their inline padding from
   ONE token (--aps-row-x), so the title's text starts where the first icon starts.

   Measured as the spec says — at 1440 wide, the inline-START edge of the title's TEXT
   (a Range over it: the right edge in Arabic, the left in French) against the same
   edge of the first row's icon, within ±2px — in AR and in FR (so neither direction
   can regress), at 1440×900 and at 1440×674 (the short-screen variant, < 800px tall),
   and in the phone « Profil » sheet, which renders the same list.
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const LOCALES = ["ar", "fr"] as const;

type Row = { title: string; titleEdge: number; iconEdge: number; frameEdge: number; titlePad: string; rowPad: string };

/** For every group of the list inside `scope`: the title's text edge and the first icon's,
    both at the inline START (right in RTL, left in LTR), and the frame's own start edge. */
async function measure(page: Page, scope: string): Promise<Row[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const rtl = getComputedStyle(root).direction === "rtl";
    const start = (r: DOMRect) => (rtl ? r.right : r.left);
    return [...root.querySelectorAll(".aps-group")].map((g) => {
      const t = g.querySelector(".aps-group-t")!;
      const link = g.querySelector(".aps-link")!;
      const range = document.createRange();
      range.selectNodeContents(t);
      return {
        title: t.textContent ?? "",
        titleEdge: start(range.getBoundingClientRect()),
        iconEdge: start(link.querySelector("svg")!.getBoundingClientRect()),
        frameEdge: start(root.getBoundingClientRect()),
        titlePad: getComputedStyle(t).paddingInlineStart,
        rowPad: getComputedStyle(link).paddingInlineStart,
      };
    });
  }, scope);
}

function expectAligned(rows: Row[], where: string) {
  expect(rows.map((r) => r.title), `${where}: the three group titles`).toHaveLength(3);
  for (const r of rows) {
    expect(Math.abs(r.titleEdge - r.iconEdge), `${where} « ${r.title} »: title ${r.titleEdge} vs icon ${r.iconEdge}`).toBeLessThanOrEqual(2);
    // Inset like the rows — never against the frame's edge.
    expect(Math.abs(r.titleEdge - r.frameEdge), `${where} « ${r.title} » is inset from the edge`).toBeGreaterThanOrEqual(12);
    expect(r.titlePad, `${where} « ${r.title} »: the same padding-inline-start as a row`).toBe(r.rowPad);
  }
}

async function tutorPage(browser: Browser, profileId: string, viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return { ctx, page: await ctx.newPage() };
}

async function verifiedTutor() {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  await seedTutor({ profileId: profile.id, status: "verified", fullName: "Walid Tester" });
  return profile;
}

test.describe("A · the sidebar's group titles start where the icons start", () => {
  for (const loc of LOCALES) {
    for (const vp of [{ width: 1440, height: 900 }, { width: 1440, height: 674 }]) {
      test(`${loc} · ${vp.width}×${vp.height}`, async ({ browser }) => {
        const profile = await verifiedTutor();
        const { ctx, page } = await tutorPage(browser, profile.id, vp);
        await page.goto(`/${loc}/dashboard`, { waitUntil: "networkidle" });
        await expect(page.locator("[data-e2e=shell-sidebar]")).toBeVisible();
        expectAligned(await measure(page, "[data-e2e=shell-sidebar]"), `${loc} ${vp.width}×${vp.height}`);
        await ctx.close();
      });
    }
  }

  for (const loc of LOCALES) {
    test(`${loc} · the phone « Profil » sheet (390×844)`, async ({ browser }) => {
      const profile = await verifiedTutor();
      const { ctx, page } = await tutorPage(browser, profile.id, { width: 390, height: 844 });
      await page.goto(`/${loc}/dashboard`, { waitUntil: "networkidle" });
      await page.locator("[data-e2e=tab-profile]").click();
      await expect(page.locator("[data-e2e=shell-sheet] .aps-group").first()).toBeVisible();
      expectAligned(await measure(page, "[data-e2e=shell-sheet] .aps-nav"), `${loc} sheet`);
      await ctx.close();
    });
  }
});
