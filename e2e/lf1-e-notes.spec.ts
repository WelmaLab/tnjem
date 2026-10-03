import { test, expect, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* live-fixes-1 · E — one note per page (rule 7).

   new-pack, Abonnements and Promotions stacked the yellow blocker AND a blue info
   note. The blocker stays on top; the information moved: new-pack's into the page
   subtitle, Abonnements' and Promotions' into a « ? » beside the section or field it
   is about — a button whose bubble opens on click or tap (touch has no hover),
   closes on Escape, and whose text is the button's description for a screen reader. */

async function asTutor(page: Page, status: "draft" | "verified") {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedTutor({ profileId: me.id, status });
  await page.context().addCookies([sessionCookie(await mintSession(me.id))]);
}

test.describe("E · the blocker, and no second note", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`unverified tutor (${loc}): one blocker, no blue note on new-pack, Abonnements, Promotions`, async ({ page }) => {
      await asTutor(page, "draft");
      for (const path of ["/dashboard/new-pack", "/dashboard/subscriptions", "/dashboard/promotions"]) {
        await page.goto(`/${loc}${path}`, { waitUntil: "networkidle" });
        await expect(page.locator("main [data-e2e=shell-blocker]"), path).toHaveCount(1);
        await expect(page.locator("main .note-info"), path).toHaveCount(0);
        // The blocker is the first thing under the title.
        const order = await page.evaluate(() => {
          const head = document.querySelector("main .aps-head")!.getBoundingClientRect().bottom;
          const blocker = document.querySelector("main [data-e2e=shell-blocker]")!.getBoundingClientRect().top;
          return blocker - head;
        });
        expect(order, path).toBeLessThan(40);
      }
    });
  }

  test("new-pack: the hint is the subtitle", async ({ page }) => {
    await asTutor(page, "verified");
    await page.goto("/fr/dashboard/new-pack", { waitUntil: "networkidle" });
    await expect(page.locator("main .aps-sub")).toHaveText("Décris ta fiche, ajoute le fichier, fixe ton prix. Tes élèves la voient sur ta page.");
    await expect(page.locator("main .note-info")).toHaveCount(0);
    await page.goto("/ar/dashboard/new-pack", { waitUntil: "networkidle" });
    await expect(page.locator("main .aps-sub")).toContainText("وصّف الملخّص");
  });
});

test.describe("E · the « ? » beside the field", () => {
  const TIPS = [
    { path: "/dashboard/subscriptions", e2e: "subs-info", fr: ["Comment se passe le paiement ?", "Paiement en ligne bientôt"], ar: ["كيفاش يصير الخلاص؟", "الخلاص أونلاين قريب"] },
    { path: "/dashboard/promotions", e2e: "promo-info", fr: ["Comment s'appliquent les promotions ?", "ne s'additionnent pas"], ar: ["كيفاش يتطبّقو التخفيضات؟", "ما يتجمّعوش"] },
  ] as const;

  for (const tip of TIPS) {
    for (const loc of ["fr", "ar"] as const) {
      test(`${tip.path} ${loc}: a labelled button, its text as description; click opens, Escape closes`, async ({ page }) => {
        await asTutor(page, "draft");
        await page.goto(`/${loc}${tip.path}`, { waitUntil: "networkidle" });
        const [label, text] = tip[loc];
        const btn = page.getByRole("button", { name: label });
        await expect(btn).toHaveAttribute("data-e2e", tip.e2e);
        await expect(btn).toHaveAttribute("aria-expanded", "false");
        await expect(btn).toHaveAccessibleDescription(new RegExp(text));
        const bubble = page.locator(`[data-e2e=${tip.e2e}-text]`);
        await expect(bubble).toBeHidden();
        const box = await btn.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);

        await btn.click();
        await expect(btn).toHaveAttribute("aria-expanded", "true");
        await expect(bubble).toBeVisible();
        await expect(bubble).toContainText(text);
        await page.keyboard.press("Escape");
        await expect(bubble).toBeHidden();

        // Keyboard: focus it and press Enter.
        await btn.focus();
        await page.keyboard.press("Enter");
        await expect(bubble).toBeVisible();
        // A click elsewhere closes it.
        await page.locator("main h1").click();
        await expect(bubble).toBeHidden();
      });
    }
  }

  test("on a phone (touch): a tap opens it, inside the screen; a second tap closes it", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await asTutor(page, "draft");
    for (const loc of ["fr", "ar"] as const) {
      await page.goto(`/${loc}/dashboard/promotions`, { waitUntil: "networkidle" });
      const btn = page.locator("[data-e2e=promo-info]");
      const bubble = page.locator("[data-e2e=promo-info-text]");
      await btn.scrollIntoViewIfNeeded();
      await btn.tap();
      await expect(bubble).toBeVisible();
      const b = await bubble.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0);
      expect(b!.x + b!.width).toBeLessThanOrEqual(390);
      await btn.tap();
      await expect(bubble).toBeHidden();
    }
    await ctx.close();
  });
});

/* live-fixes-1 · K — the promo-code hint ends with the link suffix « ?promo=CODE ».
   In Arabic it was split by the bidi algorithm and the line breaker: the « ? » hung
   at the end of one line and « promo=CODE. » started the next. The suffix is now a
   left-to-right isolate with a word joiner after the « ? »: one unit, one line. */
test.describe("K · « ?promo=CODE » stays one unit", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`Promotions (${loc}, 390): the hint's « ?promo=CODE » sits on one line, « ? » first`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await asTutor(page, "verified");
      await page.goto(`/${loc}/dashboard/promotions`, { waitUntil: "networkidle" });
      const geometry = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.querySelector("main")!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const text = n.textContent ?? "";
          const end = text.indexOf("promo=CODE");
          if (end < 0) continue;
          const start = text.lastIndexOf("?", end);
          const range = document.createRange();
          range.setStart(n, start);
          range.setEnd(n, end + "promo=CODE".length);
          const rects = [...range.getClientRects()].filter((r) => r.width > 0);
          const q = document.createRange();
          q.setStart(n, start);
          q.setEnd(n, start + 1);
          const p = document.createRange();
          p.setStart(n, end);
          p.setEnd(n, end + 1);
          return { tops: rects.map((r) => Math.round(r.top)), qLeft: q.getBoundingClientRect().left, pLeft: p.getBoundingClientRect().left };
        }
        return null;
      });
      expect(geometry, "the hint is on the page").not.toBeNull();
      expect(new Set(geometry!.tops).size, `one line: ${JSON.stringify(geometry)}`).toBe(1);
      expect(geometry!.qLeft, "« ? » reads first, left of « promo »").toBeLessThan(geometry!.pLeft);
      await ctx.close();
    });
  }
});
