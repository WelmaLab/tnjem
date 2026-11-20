import { test, expect } from "@playwright/test";
import { seedProfile, seedPassword } from "./support/seed";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { fillOtp } from "./support/otp-ui";
import { sql } from "./support/db";
import { api } from "./support/journey";
import { E2E_PASSWORD, loginWithPasswordUi } from "./support/password-ui";

/* ════════════════════════════════════════════════════════════════════════════
   VULN-001 follow-up — the « trusted browser » cookie, through the real web app.

   A successful sign-in leaves an httpOnly `tnajem_tb` cookie (≈ 180 days, SameSite
   Lax, Secure in production over https) holding a signed token and never the
   address. The web forwards it to the API's /auth/* routes, where it keeps the
   lenient brute-force delay: while strangers (no token) are held by the strict
   identity-wide one, this browser still signs in. Signing out ends the session,
   not the trust. The token's rules are proven in
   apps/api/test/sec-001b-trusted-browser.test.ts; this spec proves the cookie's
   attributes and the web→API forwarding. ADDED, never edited into an existing spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.setTimeout(120_000);

const TB = "tnajem_tb";
const TOKEN = /^v1\.[0-9a-f]{32}\.\d{13}\.[0-9a-f]{64}$/;
const WRONG = "Pas-le-bon-mot-de-passe-26";

test.beforeEach(async () => {
  await resetRateLimits(); // Postgres-backed, outlives runs
});

test("a password sign-in sets the httpOnly trusted-browser cookie; the next sign-in forwards it while strangers wait", async ({ page, browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await seedPassword(me.id, E2E_PASSWORD);

  await loginWithPasswordUi(page, me.email, E2E_PASSWORD);
  const tb = (await page.context().cookies()).find((c) => c.name === TB);
  expect(tb, "a successful sign-in marks the browser").toBeDefined();
  expect(tb!.httpOnly, "httpOnly: page script never reads it").toBe(true);
  expect(tb!.sameSite).toBe("Lax");
  expect(tb!.path).toBe("/");
  const days = (tb!.expires * 1000 - Date.now()) / 86_400_000;
  expect(days, `≈ 180 days (${days})`).toBeGreaterThan(179);
  expect(days).toBeLessThanOrEqual(180);
  expect(decodeURIComponent(tb!.value)).toMatch(TOKEN);
  expect(tb!.value).not.toContain(me.email.split("@")[0]);
  expect(await page.evaluate(() => document.cookie), "invisible to page script").not.toContain(TB);

  // Signing out ends the SESSION; the device stays trusted (the web's destroySession
  // never touches tnajem_tb). Here: the session cookie goes, the trust cookie stays.
  await page.context().clearCookies({ name: "tnajem_session" });

  // A stranger (no token) spends 3 wrong passwords: the strict identity-wide delay is armed.
  for (let i = 0; i < 3; i++) {
    expect(await api("/auth/password/login", undefined, { identifier: me.email, password: WRONG })).toMatchObject({ error: "invalid-credentials" });
  }
  expect(await api("/auth/password/login", undefined, { identifier: me.email, password: E2E_PASSWORD }), "even the right password waits without a token").toMatchObject({
    ok: false,
    error: "too-many-attempts",
  });

  // This browser still signs in: the web forwarded tnajem_tb to the API.
  await loginWithPasswordUi(page, me.email, E2E_PASSWORD);
  expect((await page.context().cookies()).some((c) => c.name === "tnajem_session"), "signed in again").toBe(true);

  // A fresh browser has no token: it is told to wait.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto("/fr/auth", { waitUntil: "networkidle" });
  await stranger.locator('input[type="email"]').fill(me.email);
  await stranger.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(stranger.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
  await stranger.locator('[data-e2e="password"]').fill(E2E_PASSWORD);
  await stranger.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(stranger.getByRole("alert").filter({ hasText: "Trop d'essais" })).toBeVisible({ timeout: 20_000 });
  expect(new URL(stranger.url()).pathname).toBe("/fr/auth");
  expect((await other.cookies()).some((c) => c.name === "tnajem_session" || c.name === TB), "no session, no trust").toBe(false);
  await other.close();
});

test("a code sign-in sets it too", async ({ page }) => {
  const me = await seedProfile({ role: "student", birthYear: 1994 });
  await page.goto("/fr/auth", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(me.email);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${me.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(me.email));
  await expect.poll(async () => (await page.context().cookies()).find((c) => c.name === TB)?.httpOnly, { timeout: 20_000 }).toBe(true);
  const tb = (await page.context().cookies()).find((c) => c.name === TB)!;
  expect(decodeURIComponent(tb.value)).toMatch(TOKEN);
});
