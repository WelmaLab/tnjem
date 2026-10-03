import { test, expect, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resetRateLimits } from "../support/otp";
import { fillOtp } from "../support/otp-ui";
import { chooseBirthDate } from "../support/select-ui"; // live-fixes-2 · C

/* Auth Option B — screenshots of the sign-up and login pages (UI_AUTH_OPTION_B.md §4.4).
   NOT part of `npm run test`: the main config only matches *.spec.ts, and this file
   is *.capture.ts (like option-a.capture.ts). Run it with

     npm run ui:shots-b          → ui-auth-b/          (UI_SHOTS_DIR overrides it)

   against a production build — the usual webServer trio, or E2E_BASE_URL /
   E2E_API_URL pointing at servers already running. ui-auth-b/ is gitignored.

   Per page × {1440×900, 390×844}: step 1 as it loads, and step 2 reached the way a
   returning visitor does — a valid address, then "J'ai déjà un code" (so no code is
   sent and the resend button shows its ready state, not a countdown). Plus the OTP
   error state: a code the API refuses. The address is RFC 2606 .invalid and no
   account is created — a refused verify writes nothing but rate-limit rows.

   Full page, deviceScaleFactor 1, reduced motion (the auth card and the code step
   animate in; a mid-animation frame is not the design), fonts loaded, and the
   mouse parked and focus dropped before each shot so no hover or focus ring leaks. */

const OUT = process.env.UI_SHOTS_DIR ? resolve(process.env.UI_SHOTS_DIR) : resolve("ui-auth-b");

const ADDRESS = "prenom.nom@tnajem.invalid";

const PAGES = [
  { name: "signup-prof-fr", path: "/fr/signup/prof" },
  { name: "signup-prof-ar", path: "/ar/signup/prof" },
  { name: "signup-eleve-fr", path: "/fr/signup/eleve" },
  { name: "auth-fr", path: "/fr/auth" },
] as const;

const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
] as const;

type Viewport = (typeof VIEWPORTS)[number];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function shoot(page: Page, file: string): Promise<void> {
  await settle(page);
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: join(OUT, `${file}.png`), fullPage: true, animations: "disabled", caret: "hide" });
}

async function openPage(browser: Browser, vp: Viewport, path: string) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  // networkidle = hydrated: "J'ai déjà un code" does nothing before hydration.
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.locator('[data-e2e="auth-step-identifier"]')).toBeVisible();
  return { ctx, page };
}

async function toCodeStep(page: Page): Promise<void> {
  await page.locator('input[type="email"]').fill(ADDRESS);
  await page.locator('[data-e2e="have-code"]').click();
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible();
}

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
});

for (const p of PAGES) {
  test(`capture ${p.name}: step 1 and step 2 at 1440 and 390`, async ({ browser }) => {
    test.setTimeout(3 * 60_000);
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await openPage(browser, vp, p.path);
      await shoot(page, `${p.name}-${vp.tag}-step1`);
      await toCodeStep(page);
      await shoot(page, `${p.name}-${vp.tag}-step2`);
      await ctx.close();
    }
  });
}

test("capture the OTP error state: /fr/auth at 1440 and 390, /fr/signup/prof at 1440", async ({ browser }) => {
  test.setTimeout(3 * 60_000);
  await resetRateLimits(); // three refused verifies below; the limiter outlives runs

  const shots: { file: string; path: string; vp: Viewport; birthDate: boolean }[] = [
    { file: "auth-fr-1440-otp-error", path: "/fr/auth", vp: VIEWPORTS[0], birthDate: false },
    { file: "auth-fr-390-otp-error", path: "/fr/auth", vp: VIEWPORTS[1], birthDate: false },
    /* A birth date first, or the verify never leaves the browser: with none, the
       signup form goes back to step 1 on the birth field (the A24 guarantee). */
    { file: "signup-prof-fr-1440-otp-error", path: "/fr/signup/prof", vp: VIEWPORTS[0], birthDate: true },
  ];

  for (const s of shots) {
    const { ctx, page } = await openPage(browser, s.vp, s.path);
    if (s.birthDate) {
      await chooseBirthDate(page, { month: 3, year: 1988 }); // live-fixes-2 · C
    }
    await toCodeStep(page);
    // This address never had a code, so any six digits are refused (invalid-code).
    await fillOtp(page, "123456");
    await expect(page.locator('[data-e2e="otp-error"]')).toBeVisible({ timeout: 20_000 });
    await shoot(page, s.file);
    await ctx.close();
  }
});
