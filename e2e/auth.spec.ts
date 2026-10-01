import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { email } from "./support/seed";
import { fillOtp } from "./support/otp-ui";
import { completePasswordStep } from "./support/password-ui"; // espace prof v2 · auth
import { randomBytes } from "node:crypto";

/* The REAL login flow, end to end, through the browser.

   Every other spec mints a session row directly, which is right — they are about
   booking and moderation, not about login. But that means nothing exercised
   requestOtp/verifyOtp, so when they were ported to apps/api the whole suite
   would have stayed green even if the port were completely broken.

   This spec is the one that would catch it. It also exercises the single most
   fragile agreement in the split: apps/web and apps/api must hash an OTP
   identically, or a code minted by one cannot be verified by the other and login
   fails intermittently depending on which process served the request.
   support/otp.ts recovers the plaintext by brute force from otp_codes.code_hash
   (10^6 space, ~1s) using AUTH_SECRET — no production code change, and it fails
   loudly if the hash construction ever drifts. */

test.beforeEach(async () => {
  /* rate_limits is Postgres-backed, so it persists across runs and server
     restarts. The OTP request limiter is 10 sends per 10 minutes per IP and every
     worker shares 127.0.0.1 — without this reset, run 2 of the day fails in a way
     that looks exactly like an application bug. */
  await resetRateLimits();
});

/* Longer than the 60s default: this is a two-step browser flow plus an OTP
   preimage search, and it runs against servers shared with every other spec. The
   assertions inside are all bounded; this only stops a slow CI box from reporting
   a timeout as a product failure. */
test.setTimeout(120_000);

test("a student signs up with a real OTP and lands signed in", async ({ page }) => {
  const identifier = email(`e2e-login-${randomBytes(4).toString("hex")}`);

  await page.goto("/fr/signup/eleve");
  await page.locator('input[type="email"]').fill(identifier);
  /* The birth-year select is `required` — the student signup collects it for the
     minor-consent gate. Leave it blank and HTML5 validation swallows the submit
     with no error in the page, the console, or the server log: the form simply
     does nothing. (Same trap as the required `price` field on new-class.) */
  // phase-a lane L2 (A24): month AND year, two selects now.
  await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
  await page.getByLabel("Année de naissance", { exact: true }).selectOption("1995");

  /* form.requestSubmit(), not button.click().

     The submit button is `disabled={loading}` and is REUSED across both steps of
     this form, so Playwright's actionability wait races React's re-render: the
     locator resolves while the button is enabled and the click then waits for it
     to become "visible, enabled and stable" again, burning the whole test timeout.
     That is what made this the only flaky spec in the suite — reliably ~3s alone,
     intermittently 2 minutes in a full run.

     requestSubmit() fires the real submit path (validation included) directly on
     the form, so there is no element to be actionable. Same trade as the
     dispatchEvent() used on the student dashboard, for the same underlying reason:
     do not make an assertion depend on a UI settling that the product never
     promised. */
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());

  // The code exists in the database, hashed.
  await expect.poll(async () => {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int n from otp_codes where identifier = ${identifier}`;
    return r.n;
  }, { timeout: 20_000, message: "requestOtp did not mint a code" }).toBe(1);

  const code = await recoverOtp(identifier);
  expect(code, "the web and the API must hash an OTP identically").toMatch(/^\d{6}$/);

  // Type it into whichever field the code step presents.
  /* Wait for the code step to actually render before typing. The submit button is
     reused across both steps and is `disabled` while the request is in flight —
     clicking it too early resolves the locator to a disabled "Chargement…" button
     and burns the whole timeout. */
  /* Auth Option B: the code step REPLACES step 1, and the code is six boxes
     (support/otp-ui.ts). fillOtp puts all six digits in the first box, the way SMS
     autofill does, and OtpInput's onComplete starts the verify on the sixth. */
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await fillOtp(page, code);

  /* Kept as a fallback, and harmless: onComplete has already started the verify,
     so this submit lands on verifyWith's `loading` guard and returns. Were two
     verifies ever to reach the server, it is race-safe — one code, one winner
     (otp-race.spec.ts). */
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());

  /* espace prof v2 · auth: a new account then creates its password (required at
     sign-up) before it leaves the page — support/password-ui.ts. */
  await completePasswordStep(page);

  // A profile now exists, and the browser holds a session for it.
  await expect.poll(async () => {
    const [p] = await sql<{ n: number }[]>`
      select count(*)::int n from profiles where email = ${identifier}`;
    return p.n;
  }, { timeout: 20_000, message: "verifyOtp did not create the account" }).toBe(1);

  await expect.poll(async () => {
    const [s] = await sql<{ n: number }[]>`
      select count(*)::int n from sessions s
      join profiles p on p.id = s.profile_id where p.email = ${identifier}`;
    return s.n;
  }, { timeout: 20_000, message: "no session row — the token never came back from the API" }).toBeGreaterThan(0);

  /* WAIT FOR THE NAVIGATION BEFORE READING THE COOKIE JAR.

     The three polls above are all SERVER-side signals — rows in Postgres. The
     assertion below is a BROWSER-side one, and the two are not simultaneous: the
     session row exists the moment verifyOtp commits, while the Set-Cookie is
     still travelling back to Chromium. Reading the jar straight after the row
     appeared is therefore a race the product never promised to win, and it lost
     it once in four full runs against containers, where the extra hop widens the
     window. On a green run this wait returns immediately.

     SignupInner calls router.push(postAuthDestination(...)) once verifyOtp
     resolves, so leaving /signup/eleve is the real readiness signal — and it
     necessarily happens AFTER the response that carried the cookie.

     Deliberately "any path but this one", not the specific destination:
     postAuthDestination is a five-rung priority list and pinning the exact
     landing page here would couple this spec to logic it is not testing.

     The cookie assertion itself is UNCHANGED — still "must be on the browser",
     still "must be httpOnly". This adds a wait; it does not lower a bar. */
  await page.waitForURL((u) => !u.pathname.includes("/signup/eleve"), { timeout: 20_000 });

  // And the cookie actually reached the browser: adoptSession() ran on the web side.
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === "tnajem_session");
  expect(session, "the session cookie must be set on the BROWSER, not the web server").toBeTruthy();
  expect(session?.httpOnly, "the session cookie must stay httpOnly").toBe(true);

  await sql`delete from sessions where profile_id in (select id from profiles where email = ${identifier})`;
  await sql`delete from profiles where email = ${identifier}`;
});

test("a wrong code is refused and does not create an account", async () => {
  const identifier = email(`e2e-badcode-${randomBytes(4).toString("hex")}`);
  const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

  const post = (p: string, b: unknown) =>
    fetch(`${api}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);

  await post("/auth/otp/request", { identifier });
  const real = await recoverOtp(identifier);
  const wrong = real === "000000" ? "111111" : "000000";

  const res = await post("/auth/otp/verify", { identifier, code: wrong, role: "student", birthYear: 1990 });
  expect(res.error, "a wrong code must be invalid-code, never a signed-in session").toBe("invalid-code");

  const [p] = await sql<{ n: number }[]>`
    select count(*)::int n from profiles where email = ${identifier}`;
  expect(p.n, "a failed verification must not create an account").toBe(0);

  /* The attempt is counted IN SQL, not from a value read first — two concurrent
     wrong guesses would otherwise both write attempts = n+1 and cost the attacker
     only one try against a 5-guess budget. */
  const [row] = await sql<{ attempts: number }[]>`
    select attempts from otp_codes where identifier = ${identifier}`;
  expect(row.attempts).toBe(1);

  await sql`delete from otp_codes where identifier = ${identifier}`;
});

test("signing in with an unknown identity and no role does not silently create one", async () => {
  const identifier = email(`e2e-noacct-${randomBytes(4).toString("hex")}`);
  const api = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
  const post = (p: string, b: unknown) =>
    fetch(`${api}${p}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);

  await post("/auth/otp/request", { identifier });
  const code = await recoverOtp(identifier);

  // No `role`: this is SIGN IN, not signup. The signup screens are the only place
  // a profile is born, so a role is always something the user was shown and chose.
  const res = await post("/auth/otp/verify", { identifier, code });
  expect(res.error).toBe("no-account");

  const [p] = await sql<{ n: number }[]>`
    select count(*)::int n from profiles where email = ${identifier}`;
  expect(p.n).toBe(0);

  await sql`delete from otp_codes where identifier = ${identifier}`;
});
