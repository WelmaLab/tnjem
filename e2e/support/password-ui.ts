/* espace prof v2 · auth (phase 2) — signing up and signing in THROUGH THE UI, now
   that a password exists.

   Sign-up has a third step: email + birth date → code → « Crée ton mot de passe »
   (required) → onboarding / consent / welcome. Any spec that signs up through the
   UI must get past it — call completePasswordStep() right after the code (fillOtp),
   or use signUpThroughUi() for the whole thing.

   Specs that only need a signed-in browser should keep minting a session
   (support/session.ts loginAs / journey.ts contextAs): faster, and not about login.
   Specs that need password LOGIN on a seeded profile: seed.ts seedPassword() + loginWithPasswordUi(). */
import { expect, type Page } from "@playwright/test";
import { sql } from "./db";
import { recoverOtp } from "./otp";
import { fillOtp } from "./otp-ui";

/** Passes the API's policy (10+ characters, not a common password). */
export const E2E_PASSWORD = "Tnajem-e2e-cartable-2026";

const STEP = '[data-e2e="auth-step-password-create"]';
const NEW_PASSWORD = '[data-e2e="new-password"]';

/** The « Crée ton mot de passe » step that follows a sign-up's code. Waits for it,
    types the password, submits. The caller waits for wherever the sign-up lands. */
export async function completePasswordStep(page: Page, password = E2E_PASSWORD): Promise<void> {
  await expect(page.locator(STEP), "a new account is asked to create its password").toBeVisible({ timeout: 20_000 });
  await page.locator(NEW_PASSWORD).fill(password);
  /* requestSubmit, not click: the same reasoning as the code step in auth.spec.ts —
     the submit button is disabled while a request is in flight, and an actionability
     wait on it races React's re-render. */
  await page.locator(STEP).locator("xpath=ancestor::form").evaluate((f: HTMLFormElement) => f.requestSubmit());
}

/** The whole sign-up through /signup/prof or /signup/eleve: address, birth date, the
    real code (recovered from its hash), the password. Resolves once the page has
    left /signup/. Rate limits are the caller's business (resetRateLimits). */
export async function signUpThroughUi(
  page: Page,
  opts: { role: "tutor" | "student"; email: string; birthYear: number; birthMonth?: number; locale?: "fr" | "ar"; password?: string },
): Promise<void> {
  const locale = opts.locale ?? "fr";
  await page.goto(`/${locale}/signup/${opts.role === "tutor" ? "prof" : "eleve"}`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(opts.email);
  const month = locale === "ar" ? "شهر الولادة" : "Mois de naissance";
  const year = locale === "ar" ? "عام الولادة" : "Année de naissance";
  await page.getByLabel(month, { exact: true }).selectOption(String(opts.birthMonth ?? 3));
  await page.getByLabel(year, { exact: true }).selectOption(String(opts.birthYear));
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect
    .poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${opts.email}`)[0].n, {
      timeout: 20_000,
      message: "the sign-up did not mint a code",
    })
    .toBe(1);
  const code = await recoverOtp(opts.email);
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await fillOtp(page, code);
  await completePasswordStep(page, opts.password);
  await page.waitForURL((u) => !u.pathname.includes("/signup/"), { timeout: 20_000 });
}

/** /auth with a password: address → Continuer → password → Se connecter. Resolves
    once the page has left /auth. */
export async function loginWithPasswordUi(page: Page, email: string, password: string, locale: "fr" | "ar" = "fr"): Promise<void> {
  await page.goto(`/${locale}/auth`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-e2e="password"]').fill(password);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
}
