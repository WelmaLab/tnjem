import { test, expect, type Browser, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* live-fixes-1 · H — the empty states of Mes classes, Mes élèves and Ma vitrine.

   Each view has ONE clear primary action: one ochre button (.btn-primary) on screen,
   at 1440 and at 390, in French and in Arabic. With nothing to list the empty state
   carries it (the header button steps aside); with a blocker on top (no page yet, not
   verified) the blocker's button is the ochre one. Ma vitrine's « Vues · Clics ·
   Abonnés » with no visit yet says how the first one comes — sharing — with the
   Share button. */

type Who = "verified" | "draft" | "pending" | "nopage";

async function account(who: Who): Promise<string> {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  if (who !== "nopage") await seedTutor({ profileId: me.id, status: who });
  return me.id;
}

async function open(browser: Browser, id: string, vp: { width: number; height: number }, path: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(id))]);
  await ctx.addInitScript(() => { window.open = (() => null) as typeof window.open; });
  const page = await ctx.newPage();
  await page.goto(path, { waitUntil: "networkidle" });
  return { page, close: () => ctx.close() };
}

const ochre = (page: Page) => page.locator("main .btn-primary:visible");

const VPS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }];

test.describe("H · Mes classes", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`verified, no class (${loc}): the empty state's « Créer ma 1ʳᵉ classe » is the one ochre button`, async ({ browser }) => {
      const id = await account("verified");
      for (const vp of VPS) {
        const { page, close } = await open(browser, id, vp, `/${loc}/dashboard/classes`);
        await expect(page.locator("[data-e2e=shell-empty]")).toBeVisible();
        await expect(ochre(page)).toHaveCount(1);
        const cta = page.locator("[data-e2e=classes-empty-cta]");
        await expect(cta).toHaveClass(/btn-primary/);
        await expect(cta).toHaveText(loc === "fr" ? "Créer ma 1ʳᵉ classe" : "اعمل أول حصة متاعك");
        await expect(cta).toHaveAttribute("href", `/${loc}/dashboard/new-class`);
        await close();
      }
    });

    test(`not verified (${loc}): the blocker holds the ochre; the empty state offers to prepare a draft`, async ({ browser }) => {
      const id = await account("draft");
      for (const vp of VPS) {
        const { page, close } = await open(browser, id, vp, `/${loc}/dashboard/classes`);
        await expect(ochre(page)).toHaveCount(1);
        await expect(page.locator("main [data-e2e=shell-blocker] .btn-primary")).toBeVisible();
        const cta = page.locator("[data-e2e=classes-empty-cta]");
        await expect(cta).toHaveClass(/btn-outline/);
        await expect(cta).toHaveText(loc === "fr" ? "Préparer ma 1ʳᵉ classe" : "حضّر أول حصة متاعك");
        await close();
      }
    });
  }

  test("verification pending: no blocker, so « Préparer ma 1ʳᵉ classe » is the ochre one", async ({ browser }) => {
    const id = await account("pending");
    const { page, close } = await open(browser, id, { width: 1440, height: 900 }, "/fr/dashboard/classes");
    await expect(ochre(page)).toHaveCount(1);
    await expect(page.locator("[data-e2e=classes-empty-cta]")).toHaveClass(/btn-primary/);
    await close();
  });

  test("no page yet: « Créer ma page » (the blocker) is the one action", async ({ browser }) => {
    const id = await account("nopage");
    const { page, close } = await open(browser, id, { width: 1440, height: 900 }, "/fr/dashboard/classes");
    await expect(ochre(page)).toHaveCount(1);
    await expect(ochre(page)).toHaveText("Créer ma page");
    await expect(page.locator("[data-e2e=classes-empty-cta]")).toHaveCount(0);
    await close();
  });
});

test.describe("H · Mes élèves", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`nobody yet (${loc}): « Partager ma page » is the one ochre button, and it opens the share sheet`, async ({ browser }) => {
      const id = await account("verified");
      for (const vp of VPS) {
        const { page, close } = await open(browser, id, vp, `/${loc}/dashboard/students`);
        await expect(page.locator("[data-e2e=shell-empty]")).toBeVisible();
        await expect(ochre(page)).toHaveCount(1);
        await expect(ochre(page)).toHaveText(loc === "fr" ? "Partager ma page" : "شارك صفحتي");
        await ochre(page).click();
        await expect(page.locator("[data-e2e=share-sheet][open]")).toBeVisible();
        await close();
      }
    });
  }

  test("no page yet: « Créer ma page »", async ({ browser }) => {
    const id = await account("nopage");
    const { page, close } = await open(browser, id, { width: 1440, height: 900 }, "/fr/dashboard/students");
    await expect(ochre(page)).toHaveCount(1);
    await expect(ochre(page)).toHaveText("Créer ma page");
    await expect(ochre(page)).toHaveAttribute("href", "/fr/onboarding");
    await close();
  });
});

test.describe("H · Ma vitrine", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`no visit yet (${loc}): how the first visit comes, and the Share button — the one ochre`, async ({ browser }) => {
      const id = await account("verified");
      for (const vp of VPS) {
        const { page, close } = await open(browser, id, vp, `/${loc}/dashboard/storefront`);
        const empty = page.locator("[data-e2e=vitrine-stats-empty]");
        await expect(empty).toBeVisible();
        await expect(empty).toContainText(loc === "fr" ? "Pas encore de visite" : "ما فماش زيارات لتوّا");
        await expect(empty).toContainText(loc === "fr" ? "Ta première visite arrive quand tu partages ton lien" : "أوّل زيارة تجي كي تشارك اللينك متاعك");
        const share = empty.locator("[data-e2e=share-open-profile]");
        await expect(share).toHaveClass(/btn-primary/);
        await expect(ochre(page)).toHaveCount(1);
        await share.click();
        await expect(page.locator("[data-e2e=share-sheet][open]")).toBeVisible();
        await close();
      }
    });
  }

  test("not verified: the blocker's button is the ochre one, the stats' Share is an outline", async ({ browser }) => {
    const id = await account("draft");
    const { page, close } = await open(browser, id, { width: 1440, height: 900 }, "/fr/dashboard/storefront");
    await expect(page.locator("[data-e2e=vitrine-stats-empty] [data-e2e=share-open-profile]")).toHaveClass(/btn-outline/);
    await expect(ochre(page)).toHaveCount(1);
    await expect(page.locator("main [data-e2e=shell-blocker] .btn-primary")).toBeVisible();
    await close();
  });
});
