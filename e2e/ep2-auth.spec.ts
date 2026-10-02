import { test, expect, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { email, seedProfile, seedPassword } from "./support/seed";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { fillOtp } from "./support/otp-ui";
import { mintSession, sessionCookie } from "./support/session";
import { api, browserSession } from "./support/journey";
import { E2E_PASSWORD, signUpThroughUi, loginWithPasswordUi } from "./support/password-ui";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 2 — ACCOUNTS AND PASSWORDS, through the browser, against
   the real API and database:

     • sign-up with a password (the third step, required), argon2id in the row;
     • password login, and the ONE generic refusal;
     • « Recevoir un code à la place »;
     • « Mot de passe oublié » — a code, a new password, every other session ends;
     • an address that already has an account → /auth, prefilled, with the notice;
     • the one-time « Crée un mot de passe (recommandé) » after a code sign-in;
     • Réglages › Sécurité (/account for a student; /dashboard/settings?tab=securite
       for a tutor since phase 6): sessions, change the password.

   ADDED, never edited into an existing spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.setTimeout(120_000);

const fresh = (what: string) => email(`e2e-ep2auth-${what}-${randomBytes(4).toString("hex")}`);

test.beforeEach(async () => {
  // rate_limits outlives runs, and this file deliberately spends password failures.
  await resetRateLimits();
});

async function hashOf(address: string): Promise<string | null> {
  const [p] = await sql<{ h: string | null }[]>`select password_hash h from profiles where email = ${address}`;
  return p?.h ?? null;
}

async function toPasswordStep(page: Page, address: string, locale: "fr" | "ar" = "fr"): Promise<void> {
  await page.goto(`/${locale}/auth`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(address);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
}

test("sign-up: email + birth date → code → « Crée ton mot de passe » → onboarding, and the row holds argon2id", async ({ page }) => {
  const address = fresh("signup");
  await page.goto("/fr/signup/prof", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(address);
  await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
  await page.getByLabel("Année de naissance", { exact: true }).selectOption("1988");
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${address}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(address));

  const step = page.locator('[data-e2e="auth-step-password-create"]');
  await expect(step).toBeVisible({ timeout: 20_000 });
  await expect(step.locator("h1")).toHaveText("Crée ton mot de passe");
  await expect(step).toContainText("Tu pourras aussi te connecter avec un code par email.");
  await expect(step.locator('[data-e2e="prompt-skip"]'), "at sign-up the password cannot be skipped").toHaveCount(0);

  const input = page.locator('[data-e2e="new-password"]');
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveAttribute("autocomplete", "new-password");
  const toggle = page.locator('[data-e2e="password-toggle"]');
  const box = await toggle.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44, "the show/hide toggle is a 44px target").toBe(true);
  await toggle.click();
  await expect(input).toHaveAttribute("type", "text");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(input).toHaveAttribute("type", "password");

  // The meter speaks in words; a common password is refused BY THE API, on the field.
  await input.fill("azertyuiop12");
  await expect(page.locator('[data-e2e="password-meter"]')).toContainText("Force du mot de passe");
  await step.locator("xpath=ancestor::form").evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="password-error"]')).toContainText("trop courant", { timeout: 20_000 });
  await expect(input).toHaveAttribute("aria-invalid", "true");
  expect(await hashOf(address), "nothing stored for a refused password").toBeNull();

  await input.fill(E2E_PASSWORD);
  await step.locator("xpath=ancestor::form").evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.waitForURL(/\/fr\/onboarding/, { timeout: 20_000 });
  const hash = await hashOf(address);
  expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456/);
  expect(hash).not.toContain(E2E_PASSWORD);
});

test("password login: the generic refusal, then the right password signs in", async ({ page }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await seedPassword(me.id, E2E_PASSWORD);

  await toPasswordStep(page, me.email);
  await expect(page.locator("main h1")).toHaveText("Entre ton mot de passe");
  await expect(page.locator('[data-e2e="use-code"]')).toHaveText("Recevoir un code à la place");
  await expect(page.locator('[data-e2e="forgot-password"]')).toHaveText("Mot de passe oublié ?");
  await expect(page.locator('[data-e2e="password"]')).toBeFocused();

  await page.locator('[data-e2e="password"]').fill("Pas-le-bon-mot-de-passe");
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="password-error"]')).toHaveText("Email ou mot de passe incorrect.", { timeout: 20_000 });

  await page.locator('[data-e2e="password"]').fill(E2E_PASSWORD);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
  const token = await browserSession(page.context());
  expect(((await api("/me", token)) as { id?: string }).id).toBe(me.id);
});

test("the same generic answer for an address with no password: the API cannot be asked who has one", async () => {
  const noPw = await seedProfile({ role: "student" });
  const ghost = fresh("ghost");
  const a = await api("/auth/password/login", undefined, { identifier: noPw.email, password: E2E_PASSWORD });
  const b = await api("/auth/password/login", undefined, { identifier: ghost, password: E2E_PASSWORD });
  expect(a).toEqual({ ok: false, error: "invalid-credentials" });
  expect(b).toEqual(a);
});

test("« Recevoir un code à la place »: an account with a password can still sign in by code", async ({ page }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await seedPassword(me.id, E2E_PASSWORD);
  await toPasswordStep(page, me.email);
  await page.locator('[data-e2e="use-code"]').click();
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(me.email));
  // It already has a password: no offer, straight in.
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
  await expect(page.locator('[data-e2e="auth-step-prompt"]')).toHaveCount(0);
});

test("« Mot de passe oublié »: a code + a new password; every other session ends and the new password works", async ({ page, browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await seedPassword(me.id, E2E_PASSWORD);
  const elsewhere = await mintSession(me.id);
  expect(((await api("/me", elsewhere)) as { id?: string }).id).toBe(me.id);

  await toPasswordStep(page, me.email);
  await page.locator('[data-e2e="forgot-password"]').click();
  const step = page.locator('[data-e2e="auth-step-reset"]');
  await expect(step).toBeVisible({ timeout: 20_000 });
  await expect(step.locator("h1")).toHaveText("Choisis un nouveau mot de passe");
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  const code = await recoverOtp(me.email);
  await fillOtp(page, code);
  await expect(page.locator('[data-e2e="new-password"]'), "six digits move on to the password, they do not submit").toBeFocused();
  const NEW = "Une-nouvelle-phrase-2026";
  await page.locator('[data-e2e="new-password"]').fill(NEW);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });

  expect(await api("/me", elsewhere), "the other session is revoked").toBeNull();
  const here = await browserSession(page.context());
  expect(((await api("/me", here)) as { id?: string }).id, "this device is signed in").toBe(me.id);
  expect(await api("/auth/password/login", undefined, { identifier: me.email, password: E2E_PASSWORD })).toEqual({ ok: false, error: "invalid-credentials" });

  // And through the page, with the new one.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginWithPasswordUi(await ctx.newPage(), me.email, NEW);
  await ctx.close();
});

test("an address that already has an account: signup sends it to /auth, prefilled, with the notice — no code spent", async ({ page }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await page.goto("/fr/signup/eleve?next=%2Ffr%2Fexplore", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(me.email);
  await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
  await page.getByLabel("Année de naissance", { exact: true }).selectOption("1994");
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());

  await page.waitForURL(/\/fr\/auth\?/, { timeout: 20_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("existing")).toBe("1");
  expect(url.searchParams.get("next"), "?next= is carried").toBe("/fr/explore");
  expect(url.search, "the address never travels in the URL").not.toContain("tnajem.invalid");
  await expect(page.locator('[data-e2e="existing-account-notice"]')).toHaveText("Tu as déjà un compte — connecte-toi.");
  await expect(page.locator('input[type="email"]'), "the address is prefilled").toHaveValue(me.email);
  const [codes] = await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`;
  expect(codes.n, "no code was sent for the wrong door").toBe(0);
});

test("after a code sign-in, a password-less account is offered a password ONCE", async ({ page, browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });

  async function codeSignIn(p: Page) {
    await p.goto("/fr/auth", { waitUntil: "networkidle" });
    await p.locator('input[type="email"]').fill(me.email);
    await p.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(p.locator('[data-e2e="auth-step-code"]'), "no password → the code, as before").toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
    await fillOtp(p, await recoverOtp(me.email));
  }

  await codeSignIn(page);
  const prompt = page.locator('[data-e2e="auth-step-prompt"]');
  await expect(prompt).toBeVisible({ timeout: 20_000 });
  await expect(prompt.locator("h1")).toHaveText("Crée un mot de passe (recommandé)");
  await prompt.locator('[data-e2e="prompt-skip"]').click();
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
  expect(await hashOf(me.email)).toBeNull();

  // Second code sign-in, fresh browser: no offer this time.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const again = await ctx.newPage();
  await codeSignIn(again);
  await again.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
  await expect(again.locator('[data-e2e="auth-step-prompt"]')).toHaveCount(0);
  await ctx.close();
});

test("the offer, accepted: the password is created and works", async ({ page }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  await page.goto("/fr/auth", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(me.email);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(me.email));
  await expect(page.locator('[data-e2e="auth-step-prompt"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-e2e="new-password"]').fill(E2E_PASSWORD);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.waitForURL((u) => !u.pathname.endsWith("/auth"), { timeout: 20_000 });
  expect(await hashOf(me.email)).toMatch(/^\$argon2id\$/);
  expect((await api("/auth/password/login", undefined, { identifier: me.email, password: E2E_PASSWORD })).ok).toBe(true);
});

test("signUpThroughUi (the helper other specs use) lands a student, with a password", async ({ page }) => {
  const address = fresh("helper");
  await signUpThroughUi(page, { role: "student", email: address, birthYear: 1996 });
  expect(await hashOf(address)).toMatch(/^\$argon2id\$/);
});

test("Réglages › Sécurité: the sessions as stored, and changing the password signs the others out", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedPassword(me.id, E2E_PASSWORD);
  const other = await mintSession(me.id);
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(me.id))]);
  const page = await ctx.newPage();
  /* espace prof v2 · phase 6: a tutor's /account is Réglages (/dashboard/settings);
     the panel is its « Sécurité » tab, which names it — so no second heading. */
  await page.goto("/fr/dashboard/settings?tab=securite", { waitUntil: "networkidle" });

  const panel = page.locator('[data-e2e="security-panel"]');
  await expect(page.getByRole("tab", { name: "Sécurité" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator('[data-e2e="sessions-count"]')).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('[data-e2e="sessions-count"]')).toHaveText("Connecté sur 2 appareils");
  await expect(panel.locator('[data-e2e="sessions-list"] li')).toHaveCount(2);
  await expect(panel.locator('[data-e2e="sessions-list"]')).toContainText("Cet appareil");
  await expect(panel.getByRole("button", { name: "Se déconnecter", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Déconnecter partout" })).toBeVisible();
  await expect(panel.locator('[data-e2e="password-state"]')).toContainText("Défini le");

  await panel.getByRole("button", { name: "Changer", exact: true }).click();
  await panel.locator('[data-e2e="current-password"]').fill(E2E_PASSWORD);
  await panel.locator('[data-e2e="new-password"]').fill("Ma-nouvelle-phrase-2026");
  await panel.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mot de passe modifié" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('[data-e2e="sessions-count"]')).toHaveText("Connecté sur 1 appareil");
  expect(await api("/me", other), "the other session is signed out").toBeNull();
  expect((await api("/auth/password/login", undefined, { identifier: me.email, password: "Ma-nouvelle-phrase-2026" })).ok).toBe(true);
  await ctx.close();
});

test("Réglages › Sécurité: a password-less account creates one with a fresh code", async ({ browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(me.id))]);
  const page = await ctx.newPage();
  await page.goto("/fr/account", { waitUntil: "networkidle" });
  const panel = page.locator('[data-e2e="security-panel"]');
  await expect(panel.locator('[data-e2e="password-state"]')).toHaveText("Pas encore de mot de passe : tu te connectes avec un code par email.", { timeout: 20_000 });
  await panel.getByRole("button", { name: "Créer un mot de passe" }).click();
  await panel.getByRole("button", { name: "Recevoir un code" }).click();
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(me.email));
  await panel.locator('[data-e2e="new-password"]').fill(E2E_PASSWORD);
  await panel.getByRole("button", { name: "Créer mon mot de passe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mot de passe créé" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('[data-e2e="password-state"]')).toContainText("Défini le");
  expect(await hashOf(me.email)).toMatch(/^\$argon2id\$/);
  await ctx.close();
});

test("/ar/auth: the password step in Derja, the toggle at the inline end (left, in RTL)", async ({ page }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await seedPassword(me.id, E2E_PASSWORD);
  await toPasswordStep(page, me.email, "ar");
  await expect(page.locator("main h1")).toHaveText("حطّ كلمة السرّ متاعك");
  await expect(page.locator('[data-e2e="use-code"]')).toHaveText("ابعثلي كود في بلاصتها");
  const field = await page.locator('[data-e2e="password"]').boundingBox();
  const toggle = await page.locator('[data-e2e="password-toggle"]').boundingBox();
  expect(field && toggle && toggle.x < field.x, "in RTL the toggle sits on the left of the input").toBe(true);
  await expect(page.locator('[data-e2e="password-toggle"]')).toHaveAttribute("aria-label", "ورّي كلمة السرّ");
});
