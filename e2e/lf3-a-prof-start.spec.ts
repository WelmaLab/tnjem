import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-3 · A — the prof has a way into their own class.

   Live, 4 Oct 2026: the only link to /live/<id> in the whole web app was on the
   STUDENT page. The tutor who had just published a class could not reach it; their
   own class page offered them « Réserver cette séance », and the checkout answered
   the API's `own-class` refusal with « La réservation n'a pas marché. Réessaie ».

     A1  Mes classes: « Démarrer la séance » on each upcoming row — ochre with a
         pulsing dot from 30 min before the start, a secondary button before that.
     A2  Accueil › Prochaines séances: the same button, and the title → /live/<id>.
     A3  The owner's own /class/<id>: « C'est ta séance » + Démarrer / Modifier /
         Partager, and never the booking CTA — not even for a frame.
     A4  /checkout?class=<own id> → /live/<id>, server-side.
     A5  `own-class` at the checkout reads « C'est ta propre séance » (FR/AR).
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;

async function ctxAs(
  browser: Browser, profileId: string, role: "tutor" | "student", viewport = { width: 1440, height: 900 },
  reducedMotion: "reduce" | "no-preference" = "reduce",
): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  return ctx;
}

async function world() {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName: "Walid Tester" });
  const soon = await seedClass({ tutorId: tutor.id, hoursFromNow: 10 / 60, seats: 6 }); // in 10 min: the window is open
  const later = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, seats: 6 });
  const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -50 });
  return { profile, tutor, soon, later, past };
}

test.describe("A1 · Mes classes", () => {
  test("one click from Mes classes to /live/<id>; ochre with a live dot in the window, secondary before, none after", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor");
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/classes");

    const row = (id: string) => page.locator(`[data-e2e=class-row][data-class-id="${id}"]`);
    const hot = row(w.soon.id).locator("[data-e2e=class-start]");
    await expect(hot).toHaveText("Démarrer la séance");
    await expect(hot).toHaveAttribute("data-state", "open");
    await expect(hot).toHaveClass(/btn-primary/);
    await expect(hot.locator(".lf3-live-dot")).toHaveCount(1);
    await expect(hot).toHaveAttribute("href", `/fr/live/${w.soon.id}`);
    expect(await hot.evaluate((el) => el.tagName), "one link — never a <button> inside an <a>").toBe("A");
    expect(await hot.locator("button").count()).toBe(0);

    const cold = row(w.later.id).locator("[data-e2e=class-start]");
    await expect(cold).toHaveAttribute("data-state", "soon");
    await expect(cold).toHaveClass(/btn-outline/);
    await expect(cold).not.toHaveClass(/btn-primary/);
    await expect(cold.locator(".lf3-live-dot")).toHaveCount(0);
    await expect(row(w.past.id).locator("[data-e2e=class-start]"), "an ended class has no start button").toHaveCount(0);

    // One ochre per view: while a class can be started, « Nouvelle classe » steps back.
    await expect(page.locator("main").getByRole("link", { name: "Nouvelle classe" })).toHaveClass(/btn-outline/);

    await hot.click();
    await expect(page).toHaveURL(new RegExp(`/fr/live/${w.soon.id}$`));
    await expect(page.getByText("Tu es le prof de cette séance.")).toBeVisible();
    await ctx.close();
  });

  test("AR: « ابدا الحصة », and the pulse is still under prefers-reduced-motion", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor");
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard/classes");
    const hot = page.locator(`[data-e2e=class-row][data-class-id="${w.soon.id}"] [data-e2e=class-start]`);
    await expect(hot).toHaveText("ابدا الحصة");
    await expect(hot).toHaveAttribute("href", `/ar/live/${w.soon.id}`);
    // reducedMotion: "reduce" (ctxAs): the dot must not keep pulsing.
    const iterations = await hot.locator(".lf3-live-dot").evaluate((el) => getComputedStyle(el).animationIterationCount);
    expect(iterations).not.toBe("infinite");
    await ctx.close();
  });

  test("the pulse runs for a visitor who has not asked for reduced motion", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor", { width: 1440, height: 900 }, "no-preference");
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/classes");
    const dot = page.locator(`[data-e2e=class-row][data-class-id="${w.soon.id}"] .lf3-live-dot`);
    await expect(dot).toHaveCount(1);
    expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("live-pulse");
    await ctx.close();
  });
});

test.describe("A2 · Accueil › Prochaines séances", () => {
  test("the title and « Démarrer la séance » both lead to /live/<id> — not to the public page", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor");
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");

    const card = page.locator("[data-e2e=home-upcoming]");
    const hotRow = card.locator(`[data-e2e=home-class-row][data-class-id="${w.soon.id}"]`);
    await expect(hotRow.locator("[data-e2e=home-class-title]")).toHaveAttribute("href", `/fr/live/${w.soon.id}`);
    await expect(card.locator(`a[href="/fr/class/${w.soon.id}"]`), "the row no longer opens the public page").toHaveCount(0);
    await expect(hotRow.locator("[data-e2e=class-start]")).toHaveClass(/btn-primary/);
    await expect(card.locator(`[data-e2e=home-class-row][data-class-id="${w.later.id}"] [data-e2e=class-start]`)).toHaveClass(/btn-outline/);
    await expect(card.locator("a a, a button"), "no nested interactive element").toHaveCount(0);
    await expect(page.locator("[data-e2e=home-new-class]")).toHaveClass(/btn-outline/);

    await hotRow.locator("[data-e2e=class-start]").click();
    await expect(page).toHaveURL(new RegExp(`/fr/live/${w.soon.id}$`));
    await expect(page.getByText("Tu es le prof de cette séance.")).toBeVisible();

    await page.goto("/fr/dashboard");
    await page.locator(`[data-e2e=home-class-row][data-class-id="${w.soon.id}"] [data-e2e=home-class-title]`).click();
    await expect(page).toHaveURL(new RegExp(`/fr/live/${w.soon.id}$`));
    await ctx.close();
  });

  test("a phone: the button wraps under the title, inside the card", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor", { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    const start = page.locator(`[data-e2e=home-class-row][data-class-id="${w.soon.id}"] [data-e2e=class-start]`);
    await expect(start).toBeVisible();
    const card = await page.locator("[data-e2e=home-upcoming]").boundingBox();
    const box = await start.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(card!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // Wrapped UNDER the text, so the title keeps the card's width instead of « Intégrales … ».
    const meta = await page.locator(`[data-e2e=home-class-row][data-class-id="${w.soon.id}"] .hp-row-m`).boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(meta!.y + meta!.height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });
});

test.describe("A3 · the owner's own class page", () => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`${vp.width}px: « C'est ta séance » + Démarrer / Modifier / Partager — and « Réserver » never shows, not even for a frame`, async ({ browser }) => {
      const w = await world();
      const ctx = await ctxAs(browser, w.profile.id, "tutor", vp);
      // Record, from the very first byte, whether a booking link EVER enters the DOM.
      await ctx.addInitScript(() => {
        const seen = () => {
          if (document.querySelector('a[href*="/checkout"]')) (window as unknown as { __sawCheckout: boolean }).__sawCheckout = true;
        };
        (window as unknown as { __sawCheckout: boolean }).__sawCheckout = false;
        new MutationObserver(seen).observe(document, { subtree: true, childList: true });
      });
      const page = await ctx.newPage();
      await page.goto(`/fr/class/${w.later.id}`);

      const panel = page.locator("[data-e2e=owner-panel]:visible");
      await expect(panel).toHaveCount(1);
      await expect(panel).toContainText("C'est ta séance");
      await expect(panel.locator("[data-e2e=class-start]")).toHaveAttribute("href", `/fr/live/${w.later.id}`);
      await expect(panel.locator("[data-e2e=owner-edit]")).toHaveAttribute("href", `/fr/dashboard/classes?edit=${w.later.id}`);
      await expect(panel.locator("[data-e2e=share-open-class]")).toBeVisible();
      await expect(page.locator("main")).not.toContainText("Réserver");
      expect(await page.evaluate(() => (window as unknown as { __sawCheckout: boolean }).__sawCheckout), "a booking link was rendered for the owner").toBe(false);

      // « Modifier » → Mes classes, with this class's date dialog open.
      await panel.locator("[data-e2e=owner-edit]").click();
      await expect(page).toHaveURL(/\/fr\/dashboard\/classes$/);
      await expect(page.locator("dialog[open]")).toContainText("Nouvelle date et heure");
      await ctx.close();
    });
  }

  test("a student — and the AR page — still get the booking CTA; the owner's AR page does not", async ({ browser }) => {
    const w = await world();
    const student = await seedProfile({ role: "student", birthYear: 1996 });
    const sctx = await ctxAs(browser, student.id, "student");
    const spage = await sctx.newPage();
    await spage.goto(`/fr/class/${w.later.id}`);
    await expect(spage.getByRole("link", { name: "Réserver cette séance" }).first()).toBeVisible();
    await expect(spage.locator("[data-e2e=owner-panel]")).toHaveCount(0);
    await sctx.close();

    const ctx = await ctxAs(browser, w.profile.id, "tutor");
    const page = await ctx.newPage();
    await page.goto(`/ar/class/${w.later.id}`);
    const panel = page.locator("[data-e2e=owner-panel]:visible");
    await expect(panel).toContainText("هاذي حصتك");
    await expect(panel.locator("[data-e2e=class-start]")).toHaveText("ابدا الحصة");
    await expect(page.locator('a[href*="/checkout"]')).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("A4 · /checkout?class=<own id>", () => {
  test("the owner is redirected to /live/<id> by the server; a student still gets the checkout", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.profile.id, "tutor");
    const res = await ctx.request.get(`/fr/checkout?class=${w.later.id}`, { maxRedirects: 0 });
    expect(res.status(), "a server-side redirect, before any checkout HTML").toBe(307);
    expect(res.headers()["location"]).toBe(`/fr/live/${w.later.id}`);

    const page = await ctx.newPage();
    await page.goto(`/fr/checkout?class=${w.later.id}`);
    await expect(page).toHaveURL(new RegExp(`/fr/live/${w.later.id}$`));
    await expect(page.getByText("Tu es le prof de cette séance.")).toBeVisible();
    await ctx.close();

    const student = await seedProfile({ role: "student", birthYear: 1996 });
    const sctx = await ctxAs(browser, student.id, "student");
    const spage = await sctx.newPage();
    await spage.goto(`/fr/checkout?class=${w.later.id}`);
    await expect(spage).toHaveURL(new RegExp(`/fr/checkout\\?class=${w.later.id}$`));
    await expect(spage.getByRole("button", { name: "Confirmer ma place" })).toBeVisible();
    await sctx.close();
  });
});

test.describe("A5 · `own-class` at the checkout", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`${loc}: the refusal says it is your own class — not « réessaie »`, async ({ browser }) => {
      /* The redirect (A4) keeps an owner off this screen, so the refusal is reached the
         way a race would reach it: the checkout opens on someone else's class, which
         then becomes this tutor's before they confirm. POST /bookings answers
         `own-class` for real — nothing is mocked. */
      const w = await world();
      const other = await seedTutor({ status: "verified", fullName: "Sami Ben Ali" });
      const theirs = await seedClass({ tutorId: other.id, hoursFromNow: 72 });
      const ctx = await ctxAs(browser, w.profile.id, "tutor");
      const page = await ctx.newPage();
      await page.goto(`/${loc}/checkout?class=${theirs.id}`);
      const confirm = page.getByRole("button", { name: loc === "fr" ? "Confirmer ma place" : "أكّد مكاني" });
      await expect(confirm).toBeVisible();

      await sql`update classes set tutor_id = ${w.tutor.id} where id = ${theirs.id}`;
      await confirm.click();

      const alert = page.locator(".ck-alert[role=alert]");
      await expect(alert).toContainText(loc === "fr" ? "C'est ta propre séance." : "هاذي حصتك إنت.");
      await expect(alert).not.toContainText(loc === "fr" ? "Réessaie" : "عاود حاول");
      await expect(alert.getByRole("link")).toHaveAttribute("href", `/${loc}/live/${theirs.id}`);
      await ctx.close();
    });
  }
});
