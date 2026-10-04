import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";
import { fillWallTime, wallDaysAhead } from "./support/datetime";

/* live-fixes-3 · D — the refusal toast hidden behind the action bar.

   Live case: an unverified prof pressed « Publier la classe »; the not-verified toast
   came up exactly where the pinned action bar is, so the click looked dead.

     D1  a toast always sits ABOVE whatever is pinned to the bottom of the screen —
         the action bar, the phone tab bar, the storefront's sticky « Réserver » bar:
         the boxes do not overlap, the toast's centre is the toast (elementFromPoint),
         it is inside the screen. 1440×900 and 390×844, FR and AR.
     D2  a draft / pending / rejected prof is offered « Enregistrer le brouillon », not
         « Publier »: it keeps the local draft and says so; the verification blocker
         stays on top. A verified prof still has « Publier la classe ». A crafted POST
         still gets not-verified: apps/api/test/lf3-d-not-verified.test.ts.

   ADDED as its own spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const HOST = new URL(BASE_URL).hostname;
const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] as const;
const LOCALES = ["fr", "ar"] as const;

const T = {
  fr: {
    save: "Enregistrer le brouillon",
    saved: "Brouillon enregistré sur cet appareil. Tu pourras publier ta classe dès que ton compte est vérifié.",
    status: "Brouillon enregistré",
    restored: "Brouillon repris",
    publish: "Publier la classe",
    blocker: "Tu peux préparer ta classe maintenant",
  },
  ar: {
    save: "سجّل المسودة",
    saved: "المسودة تسجّلت في الجهاز هذا. تنجّم تنشر حصتك أوّل ما حسابك يتثبّت.",
    status: "المسودة تسجّلت",
    restored: "رجّعنا المسودة",
    publish: "انشر الحصة",
    blocker: "تنجّم تحضّر حصتك توّا",
  },
} as const;

async function tutorCtx(browser: Browser, profileId: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

async function tutor(status: "draft" | "pending" | "rejected" | "verified") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const t = await seedTutor({ profileId: profile.id, status, fullName: "Walid Tester" });
  return { profile, tutor: t };
}

/** The toast is up, fully inside the screen, entirely ABOVE the bar, and hit-testable. */
async function expectToastAbove(page: Page, barSelector: string, label: string) {
  const toast = page.locator("[data-e2e=toast]");
  await expect(toast, `${label}: a toast`).toBeVisible();
  await expect(page.locator(barSelector).first(), `${label}: the bar`).toBeVisible();
  const r = await page.evaluate((sel) => {
    const t = document.querySelector("[data-e2e=toast]")!.getBoundingClientRect();
    const bars = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((b) => b.width && b.height);
    const top = Math.min(...bars.map((b) => b.top));
    const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
    return {
      t: { top: t.top, bottom: t.bottom, left: t.left, right: t.right },
      barTop: top,
      hit: Boolean(hit?.closest("[data-e2e=toast]")),
      vw: document.documentElement.clientWidth,
      vh: document.documentElement.clientHeight,
    };
  }, barSelector);
  expect(r.t.bottom, `${label}: the toast ends above the bar (no overlap)`).toBeLessThanOrEqual(r.barTop);
  expect(r.barTop - r.t.bottom, `${label}: 16px of air`).toBeGreaterThanOrEqual(15);
  expect(r.hit, `${label}: elementFromPoint at the toast's centre is the toast`).toBe(true);
  expect(r.t.top, `${label}: on screen`).toBeGreaterThanOrEqual(0);
  expect(r.t.left).toBeGreaterThanOrEqual(0);
  expect(r.t.right).toBeLessThanOrEqual(r.vw);
}

const titleInput = (page: Page) => page.locator("main form.nc-form input[type=text]").first();

test.describe("D1 + D2 · Nouvelle classe, as an unverified prof", () => {
  for (const locale of LOCALES) {
    for (const vp of VIEWPORTS) {
      const label = `/${locale}/dashboard/new-class @${vp.width}×${vp.height}`;
      test(`${label}: « ${T[locale].save} », the draft is kept, the toast sits above the action bar`, async ({ browser }) => {
        const { profile, tutor: tu } = await tutor("draft");
        const ctx = await tutorCtx(browser, profile.id, vp);
        const page = await ctx.newPage();
        await page.goto(`/${locale}/dashboard/new-class`);

        // The blocker stays at the top; the primary button saves, it does not publish.
        const blocker = page.locator("[data-e2e=shell-blocker]");
        await expect(blocker).toContainText(T[locale].blocker);
        const save = page.locator("[data-e2e=save-draft]");
        await expect(save).toHaveText(T[locale].save);
        await expect(page.getByRole("button", { name: T[locale].publish })).toHaveCount(0);
        const [bb, fb] = await Promise.all([blocker.boundingBox(), page.locator("main form.nc-form").boundingBox()]);
        expect(bb!.y, "the blocker is above the form").toBeLessThan(fb!.y);

        await titleInput(page).fill(`Brouillon ${locale} ${vp.width}`);
        await save.click();
        await expect(page.locator("[data-e2e=toast]")).toHaveText(T[locale].saved);
        await expectToastAbove(page, "main .aps-actionbar", label);
        await expect(page.locator("[data-e2e=draft-status]")).toContainText(T[locale].status);

        // Nothing was published, and the draft comes back.
        const [n] = await sql<{ n: number }[]>`select count(*)::int n from classes where tutor_id = ${tu.id}`;
        expect(n.n).toBe(0);
        await page.reload();
        await expect(page.locator("[data-e2e=draft-status]")).toContainText(T[locale].restored);
        await expect(titleInput(page)).toHaveValue(`Brouillon ${locale} ${vp.width}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no sideways scroll").toBe(true);
        await ctx.close();
      });
    }
  }

  test("pending and rejected profs get the same button; an empty form says there is nothing to save", async ({ browser }) => {
    for (const status of ["pending", "rejected"] as const) {
      const { profile } = await tutor(status);
      const ctx = await tutorCtx(browser, profile.id, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      await page.goto("/fr/dashboard/new-class");
      await expect(page.locator("[data-e2e=save-draft]"), status).toHaveText("Enregistrer le brouillon");
      await expect(page.getByRole("button", { name: "Publier la classe" })).toHaveCount(0);
      await page.locator("[data-e2e=save-draft]").click();
      await expect(page.locator("[data-e2e=toast]")).toHaveText("Rien à enregistrer pour l'instant : commence par le titre.");
      await ctx.close();
    }
  });

  test("a VERIFIED prof still has « Publier la classe », and a refusal toast sits above the bar on a phone", async ({ browser }) => {
    const { profile } = await tutor("verified");
    const ctx = await tutorCtx(browser, profile.id, { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class");
    await expect(page.getByRole("button", { name: "Publier la classe" })).toBeVisible();
    await expect(page.locator("[data-e2e=save-draft]")).toHaveCount(0);
    // A phone number in the description: refused by the API, said in a toast.
    await titleInput(page).fill("Révision Bac maths");
    await page.locator("main form.nc-form textarea").fill("Appelle-moi au 22 123 456 pour réserver.");
    await fillWallTime(page, wallDaysAhead(5));
    await page.getByPlaceholder("15").fill("40");
    await page.getByRole("button", { name: "Publier la classe" }).click();
    await expect(page.locator("[data-e2e=toast]")).toContainText("les coordonnées ne sont pas autorisées");
    await expectToastAbove(page, "main .aps-actionbar", "verified refusal @390");
    await ctx.close();
  });
});

test.describe("D2 · Nouvelle fiche has the same gate, so the same button", () => {
  test("an unverified prof saves the fiche's draft (not its file), restored on return; a verified prof publishes", async ({ browser }) => {
    const { profile, tutor: tu } = await tutor("draft");
    const ctx = await tutorCtx(browser, profile.id, { width: 1440, height: 900 });
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-pack");
    const save = page.locator("[data-e2e=save-draft]");
    await expect(save).toHaveText("Enregistrer le brouillon");
    await expect(page.getByRole("button", { name: "Publier", exact: true })).toHaveCount(0);
    await page.locator("main form.nc-form input[type=text]").first().fill("Pack révision dérivées");
    await page.getByPlaceholder("8").fill("12");
    await save.click();
    await expect(page.locator("[data-e2e=toast]")).toHaveText("Brouillon enregistré sur cet appareil. Tu pourras publier ta fiche dès que ton compte est vérifié.");
    await expectToastAbove(page, "main .aps-actionbar", "new-pack @1440");
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from packs where tutor_id = ${tu.id}`;
    expect(n.n).toBe(0);
    await page.reload();
    await expect(page.locator("[data-e2e=draft-status]")).toContainText("Brouillon repris");
    await expect(page.locator("main form.nc-form input[type=text]").first()).toHaveValue("Pack révision dérivées");
    await expect(page.getByPlaceholder("8")).toHaveValue("12");
    await ctx.close();

    const v = await tutor("verified");
    const vctx = await tutorCtx(browser, v.profile.id, { width: 1440, height: 900 });
    const vp = await vctx.newPage();
    await vp.goto("/fr/dashboard/new-pack");
    await expect(vp.getByRole("button", { name: "Publier", exact: true })).toBeVisible();
    await expect(vp.locator("[data-e2e=save-draft]")).toHaveCount(0);
    await vctx.close();
  });
});

test.describe("D1 · every other bar: the phone tab bar, the storefront's sticky « Réserver »", () => {
  for (const locale of LOCALES) {
    test(`/${locale}: a toast on a phone sits above the prof space's tab bar`, async ({ browser }) => {
      const { profile } = await tutor("verified");
      const ctx = await tutorCtx(browser, profile.id, { width: 390, height: 844 });
      const page = await ctx.newPage();
      await page.goto(`/${locale}/dashboard/settings?tab=notifications`);
      await expect(page.locator("[data-e2e=shell-tabs]")).toBeVisible();
      await page.locator("[data-e2e=pref-bookings] [role=switch]").click();
      await expectToastAbove(page, "[data-e2e=shell-tabs]", `/${locale} settings @390`);
      await ctx.close();
    });

    test(`/${locale}: following a prof on a phone — the toast sits above the storefront's sticky bar`, async ({ browser }) => {
      const t = await seedTutor({ status: "verified", fullName: "Walid Tester" });
      await seedClass({ tutorId: t.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 30 }); // inside 48 h: the bar carries the C note too
      const student = await seedProfile({ role: "student", birthYear: 1990 });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      await loginAs(ctx, student.id);
      const page = await ctx.newPage();
      await page.goto(`/${locale}/${t.slug}`);
      await expect(page.locator("[data-sf-mobilecta=true] [data-e2e=late-cancel-note]")).toBeVisible({ timeout: 15_000 });
      await page.locator("[data-e2e=follow-button]").first().click();
      await expectToastAbove(page, "[data-sf-mobilecta=true]", `/${locale} storefront @390`);
      await ctx.close();
    });
  }
});
