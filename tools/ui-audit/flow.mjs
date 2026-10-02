/* flow.mjs — walk the SIGNUP → ONBOARDING funnel end to end, as a real tutor.

   Why this exists alongside shots.mjs. That runner screenshots ROUTES: it visits a
   URL, waits, and captures. It can never see the funnel, because the funnel is a
   sequence — the code-entry step does not exist until a send succeeds, the "wrong
   code" error does not exist until you submit one, and /onboarding/verify's form
   only appears once a storefront exists. Every defect this walk was written to
   catch lives in a transition, not on a page.

   It drives a REAL browser against a REAL database and reads the dev OTP off the
   screen (requestOtp returns it only when NODE_ENV is not production and no mail
   or SMS provider is configured — which is exactly local dev).

   Requires: dev server on UI_AUDIT_BASE, and a localhost DATABASE_URL. Without a
   database pageGuard() returns "inert", every guard is bypassed, and the walk
   proves nothing — so we fail loudly instead of producing green nonsense.

     npm run dev -- -p 3111
     node tools/ui-audit/flow.mjs

   Output: tools/ui-audit/shots/flow-<locale>-<width>-<NN>-<step>.png

   Dev tooling only. Never imported by the app. */

import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, assertServer } from "./routes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "shots");

const LOCALES = ["fr", "ar"];
/* 380 is the real device width the rest of the harness tests at; 1280 catches the
   desktop layout. 320/768 are covered by shots.mjs on the static routes. */
const WIDTHS = [380, 1280];

/* A fresh address per run, so we always exercise the NEW-tutor path rather than
   colliding with a profile a previous run created. `.invalid` is reserved by
   RFC 2606 and can never route mail, which matters because a typo'd real domain
   here would send login codes to a stranger. */
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let shotIndex = 0;
async function shot(page, locale, width, name) {
  const n = String(++shotIndex).padStart(2, "0");
  await page.screenshot({
    path: join(OUT, `flow-${locale}-${width}-${n}-${name}.png`),
    fullPage: true,
  });
}

/** Fail with the page's own text — a bare timeout tells you nothing about why. */
async function must(page, selector, what) {
  try {
    await page.waitForSelector(selector, { timeout: 15_000, state: "visible" });
  } catch {
    const body = (await page.locator("main").innerText().catch(() => "")).slice(0, 400);
    throw new Error(`FLOW: expected ${what} (${selector}) at ${page.url()}\n--- page said ---\n${body}`);
  }
}

async function walk(browser, locale, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

  const email = `flow-${stamp()}@tnajem.invalid`;
  const steps = [];
  const note = (s) => { steps.push(s); process.stdout.write(`      ${s}\n`); };

  // ── 1. Land on the tutor signup page ────────────────────────────────────
  await page.goto(`${BASE}/${locale}/signup/prof`, { waitUntil: "networkidle" });
  await must(page, "main h1", "the signup heading");
  await shot(page, locale, width, "signup");
  note("signup/prof renders");

  // ── 2. Ask for a code ───────────────────────────────────────────────────
  await page.locator('main input[type="email"], main input[type="tel"]').first().fill(email);
  // phase-a lane L2 (A14): /signup/prof asks for a birth month + year (18+).
  await page.locator("main select").nth(0).selectOption("3");
  await page.locator("main select").nth(1).selectOption("1988");
  await shot(page, locale, width, "identifier-filled");
  await page.locator('main button[type="submit"]').first().click();

  // ── 3. The code step, with the dev code printed on it ───────────────────
  // Option B: six boxes; the first carries autocomplete="one-time-code".
  await must(page, 'main [data-e2e="otp"] input[autocomplete="one-time-code"]', "the OTP boxes");
  await shot(page, locale, width, "code-step");
  note("code step reached");

  /* Its own hook: the code step also shows the address in a <b dir="ltr">
     ("Code envoyé à …"), so "the first bold ltr run" is no longer the code. */
  const devCode = (await page.locator('main [data-e2e="dev-code"]').first().innerText().catch(() => "")).trim();
  if (!/^\d{6}$/.test(devCode)) {
    throw new Error(
      `FLOW: no dev code on screen (got ${JSON.stringify(devCode)}). ` +
        "Either a mail/SMS provider is configured locally, or NODE_ENV is production.",
    );
  }

  // ── 4. A WRONG code must say something specific ─────────────────────────
  const wrong = devCode === "000000" ? "111111" : "000000";
  // fill() on the first box is the SMS-autofill path: the six digits are spread
  // over the boxes and completing them verifies.
  await page.locator('main [data-e2e="otp"] input').first().fill(wrong);
  await must(page, 'main [role="alert"]', "an error for the wrong code");
  const wrongMsg = (await page.locator('main [role="alert"]').first().innerText()).trim();
  await shot(page, locale, width, "wrong-code");
  note(`wrong code → ${JSON.stringify(wrongMsg.slice(0, 60))}`);
  if (/erreur s'est produite|حصل خطأ/i.test(wrongMsg)) {
    throw new Error(`FLOW: wrong code still shows the generic error: ${wrongMsg}`);
  }

  // ── 5. The right one — auto-submitting once the code is complete ────────
  // A whole code landing in the first box replaces what the wrong one left.
  await page.locator('main [data-e2e="otp"] input').first().fill(devCode);
  // espace prof v2 · auth: a new account then creates its password (required at sign-up).
  await must(page, 'main [data-e2e="new-password"]', "the « Crée ton mot de passe » step");
  await shot(page, locale, width, "password-step");
  await page.locator('main [data-e2e="new-password"]').fill(`Flow-${stamp()}-mot-de-passe`);
  await page.locator('main button[type="submit"]').first().click();
  note("password created");
  await page.waitForURL(/\/onboarding(\?|$)/, { timeout: 20_000 });
  await must(page, "main h1", "the onboarding heading");
  await shot(page, locale, width, "onboarding");
  note("auto-submitted on the completed code → /onboarding");

  // ── 6. Fill the storefront and publish ──────────────────────────────────
  const name = locale === "ar" ? "ياسين خليفي" : "Yassine Flow";
  await page.locator("main .field").filter({ hasText: /.*/ }).first();
  const inputs = page.locator('main input[type="text"]');
  await inputs.nth(0).fill(name);                       // name
  await inputs.nth(1).fill(locale === "ar" ? "رياضيات" : "Maths");  // subject
  await page.locator("main textarea").first().fill(
    locale === "ar" ? "نراجعو الرياضيات مع بعضنا." : "On révise les maths ensemble.",
  );
  await shot(page, locale, width, "onboarding-filled");

  await page.locator('main button:has-text("")').first();
  await page.locator("main form button[type='submit'], main button").filter({ hasNotText: "" }).first();
  // The publish CTA is the primary button in the form column.
  await page.locator("main .btn-primary").first().click();
  await must(page, "main a[href*='/onboarding/verify'], main [role='alert']", "publish result");
  await shot(page, locale, width, "onboarding-published");
  note("storefront published");

  // ── 7. The ID screen ────────────────────────────────────────────────────
  await page.goto(`${BASE}/${locale}/onboarding/verify`, { waitUntil: "networkidle" });
  await must(page, "main input[type='file']", "the ID upload field");
  await shot(page, locale, width, "verify");
  note("verify form renders");

  // Does it explain BEFORE asking, and name the retention period?
  const verifyText = await page.locator("main").innerText();
  if (!/90/.test(verifyText)) {
    throw new Error("FLOW: the verify screen never mentions the 90-day retention period.");
  }

  // capture= should be set so a phone opens the camera, not the file manager.
  const capture = await page.locator("main input[name='idFront']").getAttribute("capture");
  if (capture !== "environment") {
    throw new Error(`FLOW: idFront capture= is ${JSON.stringify(capture)}, expected "environment".`);
  }
  note("explains before asking · 90-day retention stated · camera capture set");

  // ── 8. Pick a file and check the thumbnail + size line appear ───────────
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.locator("main input[name='idFront']").setInputFiles({
    name: "cin.png", mimeType: "image/png", buffer: png,
  });
  await must(page, "main img.dz-thumb", "a thumbnail of the picked image");
  await shot(page, locale, width, "verify-picked");
  note("thumbnail rendered for the picked image");

  // ── 9. The three steps (espace prof v2 · phase 6): Continuer → Passer → declare → send ──
  await page.locator("[data-e2e=verify-next]").click();
  await must(page, "[data-e2e=verify-step-2]:not([hidden])", "step 2 (Ton parcours)");
  await page.locator("[data-e2e=verify-skip]").click();
  await must(page, "[data-e2e=verify-step-3]:not([hidden])", "step 3 (Déclaration)");
  await page.locator("[data-e2e=verify-step-3] input[type='checkbox']").check();
  await shot(page, locale, width, "verify-declaration");
  await page.locator("[data-e2e=verify-submit]").click();
  await must(page, "[data-e2e=verify-status-pending]", "the pending status page");
  await page.waitForTimeout(400);
  await shot(page, locale, width, "verify-pending");
  /* The founder's spec (ESPACE_PROF_V2.md, phase 6) states the review time on this
     page: « En cours · 24–48 h ». It used to be forbidden here; it is now required,
     so it is checked for rather than against. */
  const pending = await page.locator("main").innerText();
  if (!/24.?48/.test(pending)) {
    throw new Error("FLOW: the pending status page does not say « En cours · 24–48 h ».");
  }
  note("submitted → pending status page (« En cours · 24–48 h »)");

  await ctx.close();
  return { steps, consoleErrors };
}

async function main() {
  await assertServer();
  await rm(OUT, { recursive: true, force: true }).catch(() => {});
  await mkdir(OUT, { recursive: true });

  console.log("\nSignup → onboarding flow walk — both locales, 380 + 1280\n");
  const browser = await chromium.launch();
  let failures = 0;
  const errors = [];

  for (const locale of LOCALES) {
    for (const width of WIDTHS) {
      console.log(`  ── /${locale} @ ${width}px ──`);
      try {
        const { consoleErrors } = await walk(browser, locale, width);
        if (consoleErrors.length) {
          console.log(`      ! ${consoleErrors.length} console error(s)`);
          errors.push(...consoleErrors.map((e) => `${locale}@${width}: ${e}`));
        }
      } catch (err) {
        failures++;
        console.log(`      x ${err.message}`);
        errors.push(`${locale}@${width}: ${err.message}`);
      }
      console.log("");
    }
  }
  await browser.close();

  console.log(`  ${shotIndex} screenshots -> tools/ui-audit/shots/`);
  if (failures) {
    console.log(`\n  ${failures} walk(s) failed.\n`);
    process.exit(1);
  }
  if (errors.length) console.log(`\n  ${errors.length} console error(s) (not fatal).`);
  console.log("\n  OK — the funnel completes end to end in both locales.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
