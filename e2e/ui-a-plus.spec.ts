import { test, expect, type Page } from "@playwright/test";
import { seedProfile, seedTutor, seedClass } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* Phase A+ — UI follow-ups to Option A. Colours are asserted as COMPUTED values. */

const BLUE50 = "rgb(233, 241, 250)"; // --blue50
const GREEN50 = "rgb(227, 244, 237)"; // --green50

const bgOf = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);

/* ── U1: information is blue; "Bientôt" starts its own line ─────────────────── */
test.describe("U1 — info notes are blue, and the payment sentence starts its own line", () => {
  test("tutor page sidebar: the payment note is blue50, and 'Bientôt' opens its line", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/fr/yassine-math");
    const note = page.locator("[data-sf-aside] .sf-trust");
    await expect(note).toBeVisible();
    expect(await bgOf(page, "[data-sf-aside] .sf-trust")).toBe(BLUE50);
    const story = note.locator("[data-payment-story]");
    expect(await story.evaluate((el) => getComputedStyle(el).display)).toBe("block");
    // The tag is the first thing in the sentence's block — never mid-sentence.
    expect(await story.evaluate((el) => (el.firstElementChild as HTMLElement | null)?.textContent?.trim())).toBe("Bientôt");
  });

  test("/fr/tarifs: the pilot banner is blue50, not green50", async ({ page }) => {
    await page.goto("/fr/tarifs");
    const bg = await page.locator("main .note-info, main .trust").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe(GREEN50);
    expect(bg).toBe(BLUE50);
  });

  test("every rendered payment sentence is a block that starts with its tag", async ({ page }) => {
    for (const path of ["/fr", "/fr/tarifs", "/fr/yassine-math"]) {
      await page.goto(path);
      const stories = page.locator("[data-payment-story=soon]");
      const n = await stories.count();
      expect(n, path).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        /* Block-LEVEL is the rule (the sentence starts its own line): the home page's
           payment card lays it out as a flex pill row (home v2 · C), still its own line. */
        expect(["block", "flex"], `${path} #${i}`).toContain(await stories.nth(i).evaluate((el) => getComputedStyle(el).display));
      }
    }
  });
});

/* ── U2: the header button is never orange ───────────────────────────────────── */
/* home v2 · D: signed out, « Créer ma page » became the mockup's FILLED cobalt
   (UI_options/home-v2-reference.png). What U2 protects is unchanged: the header is
   never orange, and the page's own action is the one ochre button in view. The
   signed-in outline (« Tableau de bord ») is still asserted in ui-option-a.spec.ts. */
test.describe("U2 — the header CTA is cobalt, never orange", () => {
  test("signed out on a tutor page: exactly ONE ochre button in view — 'Réserver la séance'", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/fr/yassine-math");
    await expect(page.locator("header .qh-cta").first()).toBeVisible();
    const inView = await page.locator(".btn-primary").evaluateAll((els) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" &&
            r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
        })
        .map((el) => (el.textContent ?? "").trim()),
    );
    expect(inView).toEqual(["Réserver la séance"]);
    const cta = await page.locator("header .qh-cta").first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color };
    });
    expect(cta).toEqual({ bg: "rgb(14, 90, 166)", color: "rgb(255, 255, 255)" });
  });
});

/* ── U3: "En direct" is never green ───────────────────────────────────────────── */
const GREENS = ["rgb(23, 133, 95)", "rgb(27, 156, 111)", "rgb(227, 244, 237)"]; // --green-btn, --green, --green50

async function liveLabels(page: Page) {
  // Every element whose own text is the live label, with its and its parent's background.
  return page.locator("body *").evaluateAll((els) =>
    els
      .filter((el) => /^(en direct|live|دايركت|مباشر)$/i.test((el.textContent ?? "").trim()) && el.children.length <= 2)
      .map((el) => ({
        text: (el.textContent ?? "").trim(),
        bg: getComputedStyle(el).backgroundColor,
        parentBg: el.parentElement ? getComputedStyle(el.parentElement).backgroundColor : "",
        dot: getComputedStyle(el, "::before").backgroundColor,
      })),
  );
}

test.describe("U3 — 'En direct' is a paper pill with a rose dot, never green", () => {
  test("/fr/pour-les-profs: the phone mock's EN DIRECT is not green", async ({ page }) => {
    await page.goto("/fr/pour-les-profs");
    const labels = await liveLabels(page);
    expect(labels.length, "the mock shows a live label").toBeGreaterThan(0);
    for (const l of labels) {
      expect(GREENS, JSON.stringify(l)).not.toContain(l.bg);
      expect(GREENS, JSON.stringify(l)).not.toContain(l.parentBg);
    }
  });

  test("the tutor dashboard: a class happening now shows 'En direct', not green, with a rose dot", async ({ browser }) => {
    const profile = await seedProfile({ role: "tutor", birthYear: 1990 });
    const tutor = await seedTutor({ status: "verified", profileId: profile.id });
    await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 10 * 60_000) });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAs(ctx, profile.id);
    await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: new URL(BASE_URL).hostname, path: "/" }]);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    const chip = page.locator("[data-e2e=class-phase][data-phase=live]").first();
    await expect(chip).toHaveText("En direct");
    const c = await chip.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, dot: getComputedStyle(el, "::before").backgroundColor }));
    expect(GREENS).not.toContain(c.bg);
    expect(c.dot, "the rose dot is the only red").toBe("rgb(201, 48, 43)"); // --rose
    await ctx.close();
  });
});

/* ── U4: the sticky booking bar never covers the end of the page ───────────────
   Checked on the live page, not a full-page screenshot: the bar is position:sticky
   (bottom:0) and sits AFTER the content in the flow, so while scrolling it docks
   over what passes under it, and at the end it rests below the last element —
   nothing is ever out of reach. Not reproduced; this pins it. */
test.describe("U4 — the mobile booking bar leaves the content visible", () => {
  test("390x844, scrolled to the bottom: the last content element ends above the bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/fr/yassine-math");
    const bar = page.locator("[data-sf-mobilecta=true]");
    await expect(bar).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => {
      const barEl = document.querySelector("[data-sf-mobilecta=true]")!.getBoundingClientRect();
      const grid = document.querySelector("[data-sf-grid=true]")!;
      // The lowest VISIBLE element of the page content — whatever the student reads last.
      let lastBottom = -Infinity;
      for (const el of grid.querySelectorAll("*")) {
        const rect = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        if (rect.width > 0 && rect.height > 0 && st.visibility !== "hidden" && st.display !== "none") lastBottom = Math.max(lastBottom, rect.bottom);
      }
      return { barTop: barEl.top, gridBottom: grid.getBoundingClientRect().bottom, lastBottom };
    });
    expect(r.gridBottom, JSON.stringify(r)).toBeLessThanOrEqual(r.barTop + 0.5);
    expect(r.lastBottom, JSON.stringify(r)).toBeLessThanOrEqual(r.barTop + 0.5);
  });
});
