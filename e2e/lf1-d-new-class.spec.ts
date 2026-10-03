import { test, expect, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* live-fixes-1 · D — « Nouvelle classe ».

   D1  The free first session: OFF in Réglages → one muted line « 1re séance offerte :
       désactivée · Activer dans Réglages › », no disabled checkbox; ON → a toggle.
   D2  The preview's empty state (« — TND », the date tile) in the brand face (C1).
   D3  The calendar opens UPWARD when the room under the date field — down to the
       sticky action bar or the phone tab bar — is too short; never cut off by a bar. */

async function tutor(offers: boolean) {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  const t = await seedTutor({ profileId: me.id, status: "verified", offersFreeFirstSession: offers });
  return { me, t };
}

test.describe("D1 · « 1re séance offerte »", () => {
  test("off: one muted line + the way to Réglages (FR + AR); the API still refuses", async ({ browser }) => {
    const { me } = await tutor(false);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    for (const [loc, line, cta] of [
      ["fr", "1re séance offerte : désactivée", "Activer dans Réglages ›"],
      ["ar", "الحصة الأولى فابور: مطفية", "فعّلها في الإعدادات ‹"],
    ] as const) {
      await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });
      const off = page.locator("[data-e2e=free-first-off]");
      await expect(off).toContainText(line);
      await expect(off.getByRole("link", { name: cta })).toHaveAttribute("href", `/${loc}/dashboard/settings?tab=vitrine#free-first`);
      await expect(page.locator("[data-e2e=free-first-box]")).toHaveCount(0);
      await expect(page.locator("main [role=checkbox][aria-disabled=true]")).toHaveCount(0);
      // One line: no box, no card around it.
      const box = await off.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(48);
    }
    await ctx.close();
  });

  test("on: a toggle (role=switch) that flips, labelled, FR + AR", async ({ browser }) => {
    const { me } = await tutor(true);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    for (const [loc, label] of [["fr", "Offrir la 1ère séance gratuitement"], ["ar", "أعطي أول حصة فابور"]] as const) {
      await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });
      const sw = page.getByRole("switch", { name: label });
      await expect(sw).toHaveAttribute("data-e2e", "free-first-box");
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-e2e=class-preview]")).toContainText(loc === "fr" ? "Gratuite" : "فابور");
      await sw.press("Space");
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(page.locator("[data-e2e=free-first-off]")).toHaveCount(0);
    }
    await ctx.close();
  });
});

test.describe("D2 · the preview's empty state in the brand face", () => {
  test("« — TND » and the date tile: not Space Grotesk, tabular", async ({ browser }) => {
    const { me } = await tutor(false);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    const price = page.locator(".nc-preview-price");
    await expect(price).toHaveText("— TND");
    await expect(page.locator("[data-e2e=class-preview]")).toContainText("Date à choisir");
    for (const el of [price, page.locator(".nc-date")]) {
      const f = await el.evaluate((n) => ({ family: getComputedStyle(n).fontFamily, num: getComputedStyle(n).fontVariantNumeric }));
      expect(f.family).not.toMatch(/Space Grotesk/);
      expect(f.family).toMatch(/Plus Jakarta Sans/);
      expect(f.num).toContain("tabular-nums");
    }
    await ctx.close();
  });
});

/** Scroll so the date field sits `gap` px above the action bar (or right under the top bar). */
async function placeDateField(page: Page, where: "low" | "high" | "middle"): Promise<void> {
  await page.evaluate((w) => {
    const field = document.querySelector(".aps-dp-inp")!;
    const r = field.getBoundingClientRect();
    if (w === "middle") {
      // The field's centre at the centre of the band between the pinned bars.
      const top = document.querySelector(".aps-top")?.getBoundingClientRect().bottom ?? 0;
      const bars = [...document.querySelectorAll<HTMLElement>(".aps-actionbar, .aps-tabs")]
        .map((b) => b.getBoundingClientRect())
        .filter((b) => b.height > 0 && b.top < window.innerHeight);
      const limit = Math.min(window.innerHeight, ...bars.map((b) => b.top));
      window.scrollBy(0, r.top + r.height / 2 - (top + limit) / 2);
      return;
    }
    if (w === "high") {
      const top = document.querySelector(".aps-top")?.getBoundingClientRect().bottom ?? 0;
      window.scrollBy(0, r.top - top - 24);
      return;
    }
    const bars = [...document.querySelectorAll<HTMLElement>(".aps-actionbar, .aps-tabs")]
      .map((b) => b.getBoundingClientRect())
      .filter((b) => b.height > 0 && b.top < window.innerHeight);
    const limit = Math.min(window.innerHeight, ...bars.map((b) => b.top));
    window.scrollBy(0, r.bottom - (limit - 16));
  }, where);
  await page.waitForTimeout(150);
}

/** The calendar's box against every pinned bar: no overlap, and its last day is hit-testable. */
async function calendarClear(page: Page): Promise<{ overlaps: string[]; lastDayHit: boolean; place: string | null }> {
  return page.evaluate(() => {
    const pop = document.querySelector<HTMLElement>("[data-e2e=date-calendar]")!;
    const p = pop.getBoundingClientRect();
    const overlaps: string[] = [];
    for (const sel of [".aps-actionbar", ".aps-tabs", ".aps-top"]) {
      document.querySelectorAll<HTMLElement>(sel).forEach((b) => {
        const cs = getComputedStyle(b);
        if (cs.display === "none") return;
        const r = b.getBoundingClientRect();
        if (r.height === 0) return;
        if (r.top < p.bottom - 1 && r.bottom > p.top + 1) overlaps.push(sel);
      });
    }
    const days = pop.querySelectorAll<HTMLElement>("button[data-date]");
    const last = days[days.length - 1].getBoundingClientRect();
    const hit = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
    return { overlaps, lastDayHit: Boolean(hit && pop.contains(hit)), place: pop.getAttribute("data-place") };
  });
}

test.describe("D3 · the calendar is never cut off by a bar", () => {
  for (const vp of [{ width: 1440, height: 674 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const loc of ["fr", "ar"] as const) {
      test(`${vp.width}×${vp.height} ${loc}: low on the screen it opens upward, high it opens downward`, async ({ browser }) => {
        const { me } = await tutor(false);
        const ctx = await contextAs(browser, me.id);
        const page = await ctx.newPage();
        await page.setViewportSize(vp);
        await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });

        await placeDateField(page, "low");
        await page.locator("[data-e2e=date-open]").click();
        let r = await calendarClear(page);
        expect(r.place).toBe("above");
        expect(r.overlaps, "no bar over the calendar").toEqual([]);
        expect(r.lastDayHit, "the last day is clickable, not under a bar").toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-e2e=date-calendar]")).toHaveCount(0);

        await placeDateField(page, "high");
        await page.locator("[data-e2e=date-open]").click();
        r = await calendarClear(page);
        expect(r.place).toBe("below");
        expect(r.lastDayHit).toBe(true);

        // Picking a day still works from the upward calendar too.
        await page.keyboard.press("Escape");
        await placeDateField(page, "low");
        await page.locator("[data-e2e=date-open]").click();
        await expect(page.locator("[data-e2e=date-calendar]")).toHaveAttribute("data-place", "above");
        await page.locator("[data-e2e=date-calendar] button[data-date]:not([aria-disabled=true])").last().click();
        await expect(page.locator("[data-e2e=date-input]")).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
        await ctx.close();
      });
    }
  }

  /* live-fixes-1 · K: found in the K screenshots — mid-screen on a 674px-high window
     there is room on NEITHER side; the calendar opened on the roomier side and ran
     under the action bar and off the screen. The page now makes room. */
  for (const vp of [{ width: 1440, height: 674 }, { width: 390, height: 844 }]) {
    for (const loc of ["fr", "ar"] as const) {
      test(`${vp.width}×${vp.height} ${loc}: mid-screen with room on neither side, the page scrolls so no bar covers the calendar`, async ({ browser }) => {
        const { me } = await tutor(false);
        const ctx = await contextAs(browser, me.id);
        const page = await ctx.newPage();
        await page.setViewportSize(vp);
        await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });
        await placeDateField(page, "middle");
        await page.locator("[data-e2e=date-open]").click();
        const r = await calendarClear(page);
        expect(r.overlaps, "no bar over the calendar").toEqual([]);
        expect(r.lastDayHit, "the last day is clickable, not under a bar or off the screen").toBe(true);
        // The field stays in view above or below it.
        const fieldSeen = await page.evaluate(() => {
          const f = document.querySelector(".aps-dp-inp")!.getBoundingClientRect();
          const top = document.querySelector(".aps-top")?.getBoundingClientRect().bottom ?? 0;
          return f.top >= top - 1 && f.bottom <= window.innerHeight;
        });
        expect(fieldSeen, "the date field is still on screen").toBe(true);
        await page.locator("[data-e2e=date-calendar] button[data-date]:not([aria-disabled=true])").last().click();
        await expect(page.locator("[data-e2e=date-input]")).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
        await ctx.close();
      });
    }
  }
});

test.afterAll(async () => {
  await sql`select 1`;
});
