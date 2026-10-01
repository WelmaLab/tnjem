import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "../support/db";
import { email, seedProfile, seedPassword } from "../support/seed";
import { recoverOtp, resetRateLimits } from "../support/otp";
import { fillOtp } from "../support/otp-ui";
import { mintSession, sessionCookie } from "../support/session";
import { E2E_PASSWORD } from "../support/password-ui";

/* espace prof v2 · auth (phase 2) — screenshots of every password screen, FR and AR,
   at 1440 and 390. NOT part of `npm run test` (*.capture.ts). Run with

     npx playwright test -c e2e/visual/visual.config.ts ep2-auth      → ui-ep2-auth/

   (UI_SHOTS_DIR overrides the folder; keep it out of the repo). Screens: the /auth
   password step (with the generic refusal), « Mot de passe oublié », the one-time
   offer, the sign-up's « Crée ton mot de passe », the « Tu as déjà un compte »
   notice, and Réglages › Sécurité on /account (with the change form open). */

const OUT = process.env.UI_SHOTS_DIR ? resolve(process.env.UI_SHOTS_DIR) : resolve("ui-ep2-auth");
const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
] as const;
const LOCALES = ["fr", "ar"] as const;

async function shoot(page: Page, file: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.mouse.move(0, 0);
  await page.screenshot({ path: join(OUT, `${file}.png`), fullPage: true, animations: "disabled", caret: "hide" });
}

async function newPage(browser: Browser, vp: (typeof VIEWPORTS)[number], cookie?: string) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (cookie) await ctx.addCookies([sessionCookie(cookie)]);
  return { ctx, page: await ctx.newPage() };
}

async function submit(page: Page) {
  await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
}

async function codeFor(address: string): Promise<string> {
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${address}`)[0].n, { timeout: 20_000 }).toBe(1);
  return recoverOtp(address);
}

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

test.beforeEach(async () => {
  await resetRateLimits();
});

for (const locale of LOCALES) {
  for (const vp of VIEWPORTS) {
    test(`ep2 auth screens ${locale} ${vp.tag}`, async ({ browser }) => {
      test.setTimeout(4 * 60_000);
      const tag = `${locale}-${vp.tag}`;

      // /auth → the password step, then the generic refusal.
      const withPw = await seedProfile({ role: "student", birthYear: 1994 });
      await seedPassword(withPw.id, E2E_PASSWORD);
      {
        const { ctx, page } = await newPage(browser, vp);
        await page.goto(`/${locale}/auth`, { waitUntil: "networkidle" });
        await page.locator('input[type="email"]').fill(withPw.email);
        await submit(page);
        await expect(page.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
        await shoot(page, `auth-password-${tag}`);
        await page.locator('[data-e2e="password"]').fill("Pas-le-bon-2026");
        await submit(page);
        await expect(page.locator('[data-e2e="password-error"]')).toBeVisible({ timeout: 20_000 });
        await shoot(page, `auth-password-refused-${tag}`);

        // « Mot de passe oublié » — code + new password, the meter showing.
        await page.locator('[data-e2e="forgot-password"]').click();
        await expect(page.locator('[data-e2e="auth-step-reset"]')).toBeVisible({ timeout: 20_000 });
        await fillOtp(page, await codeFor(withPw.email));
        await page.locator('[data-e2e="new-password"]').fill("Une phrase assez longue 2026");
        await shoot(page, `auth-reset-${tag}`);
        await ctx.close();
        await sql`delete from otp_codes where identifier = ${withPw.email}`;
      }

      // The one-time offer after a code sign-in.
      const noPw = await seedProfile({ role: "student", birthYear: 1994 });
      {
        const { ctx, page } = await newPage(browser, vp);
        await page.goto(`/${locale}/auth`, { waitUntil: "networkidle" });
        await page.locator('input[type="email"]').fill(noPw.email);
        await submit(page);
        await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
        await fillOtp(page, await codeFor(noPw.email));
        await expect(page.locator('[data-e2e="auth-step-prompt"]')).toBeVisible({ timeout: 20_000 });
        await page.locator('[data-e2e="new-password"]').fill("court");
        await shoot(page, `auth-prompt-${tag}`);
        await ctx.close();
      }

      // Sign-up: « Crée ton mot de passe ».
      {
        const address = email(`e2e-ep2shot-${randomBytes(4).toString("hex")}`);
        const { ctx, page } = await newPage(browser, vp);
        await page.goto(`/${locale}/signup/prof`, { waitUntil: "networkidle" });
        await page.locator('input[type="email"]').fill(address);
        await page.locator("main select").nth(0).selectOption("3");
        await page.locator("main select").nth(1).selectOption("1988");
        await submit(page);
        await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
        await fillOtp(page, await codeFor(address));
        await expect(page.locator('[data-e2e="auth-step-password-create"]')).toBeVisible({ timeout: 20_000 });
        await shoot(page, `signup-password-${tag}`);
        await page.locator('[data-e2e="new-password"]').fill("Ma prof de maths 2026!");
        await shoot(page, `signup-password-filled-${tag}`);
        await ctx.close();
      }

      // An address that already has an account → /auth with the notice.
      {
        const { ctx, page } = await newPage(browser, vp);
        await page.goto(`/${locale}/signup/eleve`, { waitUntil: "networkidle" });
        await page.locator('input[type="email"]').fill(withPw.email);
        await page.locator("main select").nth(0).selectOption("3");
        await page.locator("main select").nth(1).selectOption("1994");
        await submit(page);
        await expect(page.locator('[data-e2e="existing-account-notice"]')).toBeVisible({ timeout: 20_000 });
        await shoot(page, `auth-existing-${tag}`);
        await ctx.close();
      }

      // Réglages › Sécurité on /account, two sessions, the change form open.
      {
        await mintSession(withPw.id);
        const { ctx, page } = await newPage(browser, vp, await mintSession(withPw.id));
        await page.goto(`/${locale}/account`, { waitUntil: "networkidle" });
        await expect(page.locator('[data-e2e="sessions-list"]')).toBeVisible({ timeout: 20_000 });
        await page.locator('[data-e2e="security-panel"]').scrollIntoViewIfNeeded();
        await shoot(page, `account-security-${tag}`);
        await page.locator('[data-e2e="security-panel"] .sec-actions button').first().click();
        await expect(page.locator('[data-e2e="password-change-form"]')).toBeVisible();
        await shoot(page, `account-security-change-${tag}`);
        await ctx.close();
      }
    });
  }
}
