import { test, expect, type Browser, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";

/* A month that needs six rows (November 2026 starts on a Sunday) makes the calendar 46px
   taller, and it ran under the action bar. Its days go compact on a window under 760px,
   and wherever the page cannot scroll further and the full calendar fits on neither side.

   The clock is pinned, so these keep proving six rows and five rows in every month. */
const SIX_ROWS = new Date("2026-11-15T10:00:00");
const FIVE_ROWS = new Date("2026-10-15T10:00:00");

async function open(browser: Browser, vp: { width: number; height: number }, loc: "fr" | "ar", now: Date) {
  const me = await seedProfile({ role: "tutor", birthYear: 1990 });
  await seedTutor({ profileId: me.id, status: "verified" });
  const ctx = await contextAs(browser, me.id);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(now);
  await page.setViewportSize(vp);
  await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });
  return { ctx, page };
}

/** Scroll so the date field sits at the top (page end permitting) or the bottom of the free band. */
async function place(page: Page, where: "high" | "low") {
  await page.evaluate((w) => {
    const r = document.querySelector(".aps-dp-inp")!.getBoundingClientRect();
    const top = document.querySelector(".aps-top")?.getBoundingClientRect().bottom ?? 0;
    const limit = Math.min(
      window.innerHeight,
      ...[...document.querySelectorAll<HTMLElement>(".aps-actionbar, .aps-tabs")]
        .map((b) => b.getBoundingClientRect())
        .filter((b) => b.height > 0 && b.top < window.innerHeight)
        .map((b) => b.top),
    );
    window.scrollBy(0, w === "high" ? r.top - top - 24 : r.bottom - (limit - 16));
  }, where);
  await page.waitForTimeout(150);
}

/** The calendar's rows, its day height, and whether it stands clear of every pinned bar, on screen. */
async function calendar(page: Page) {
  return page.evaluate(() => {
    const pop = document.querySelector<HTMLElement>("[data-e2e=date-calendar]")!;
    const p = pop.getBoundingClientRect();
    const under = [".aps-top", ".aps-actionbar", ".aps-tabs"].filter((s) => {
      const el = document.querySelector<HTMLElement>(s);
      if (!el || !el.getBoundingClientRect().height) return false;
      const b = el.getBoundingClientRect();
      return p.top < b.bottom - 1 && p.bottom > b.top + 1;
    });
    const day = pop.querySelector<HTMLElement>("button[data-date]")!.getBoundingClientRect();
    return {
      rows: pop.querySelectorAll("tbody tr").length,
      dayH: Math.round(day.height),
      under,
      onScreen: p.top >= 0 && p.bottom <= window.innerHeight,
    };
  });
}

for (const vp of [{ width: 1440, height: 674 }, { width: 1280, height: 720 }, { width: 1440, height: 759 }, { width: 390, height: 667 }]) {
  for (const loc of ["fr", "ar"] as const) {
    test(`${vp.width}×${vp.height} ${loc}, six rows: compact days, the whole month clear of the bars`, async ({ browser }) => {
      const { ctx, page } = await open(browser, vp, loc, SIX_ROWS);
      for (const where of ["high", "low"] as const) {
        await place(page, where);
        await page.locator("[data-e2e=date-open]").click();
        const c = await calendar(page);
        expect(c.rows, where).toBe(6);
        expect(c.dayH, where).toBe(38);
        expect(c.under, `${where}: no bar over the calendar`).toEqual([]);
        expect(c.onScreen, where).toBe(true);
        await page.keyboard.press("Escape");
      }
      await ctx.close();
    });
  }
}

test("a short window, five rows: the days keep their 44px", async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1440, height: 674 }, "fr", FIVE_ROWS);
  await page.locator("[data-e2e=date-open]").click();
  const c = await calendar(page);
  expect(c.rows).toBe(5);
  expect(c.dayH).toBe(44);
  await ctx.close();
});

test("a tall window with room, six rows: the days keep their 44px", async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1440, height: 1200 }, "fr", SIX_ROWS);
  await page.locator("[data-e2e=date-open]").click();
  const c = await calendar(page);
  expect(c.rows).toBe(6);
  expect(c.dayH).toBe(44);
  expect(c.under).toEqual([]);
  await ctx.close();
});

for (const loc of ["fr", "ar"] as const) {
  test(`1440×900 ${loc}, at the end of the page, six rows: compact, below the field, clear of the bar`, async ({ browser }) => {
    const { ctx, page } = await open(browser, { width: 1440, height: 900 }, loc, SIX_ROWS);
    await place(page, "high");
    await page.locator("[data-e2e=date-open]").click();
    const c = await calendar(page);
    expect(c.dayH).toBe(38);
    await expect(page.locator("[data-e2e=date-calendar]")).toHaveAttribute("data-place", "below");
    expect(c.under).toEqual([]);
    await ctx.close();
  });
}

test("from a five-row month to a six-row one on a short window: compact, and still clear", async ({ browser }) => {
  const { ctx, page } = await open(browser, { width: 1440, height: 674 }, "fr", FIVE_ROWS);
  await place(page, "high");
  await page.locator("[data-e2e=date-open]").click();
  expect((await calendar(page)).dayH).toBe(44);
  await page.locator("[data-e2e=date-calendar] .aps-dp-head button").nth(1).click(); // next month: November 2026
  await expect(page.locator("[data-e2e=date-calendar] tbody tr")).toHaveCount(6);
  const c = await calendar(page);
  expect(c.dayH).toBe(38);
  expect(c.under).toEqual([]);
  await ctx.close();
});
