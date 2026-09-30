import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { resetRateLimits } from "./support/otp";
import { email } from "./support/seed";
import { fillOtp, OTP_DIGIT, OTP_GROUP } from "./support/otp-ui";

/* ════════════════════════════════════════════════════════════════════════════
   Auth Option B (UI_AUTH_OPTION_B.md) — the sign-up and login pages as ONE flow:
   a brand panel beside the form, and a code step that REPLACES the address step
   in the same card instead of being appended under it.

   Pinned here, on /fr/signup/prof, /fr/signup/eleve, /fr/auth and /ar/signup/prof:
     • "J'ai déjà un code" swaps step 1 out for the code step — the address field
       is gone (not disabled), the H1 says where the code went, and focus is on
       the first of six boxes built for SMS autofill (one-time-code, numeric,
       always left-to-right, even on the Arabic page).
     • The brand panel mirrors with the page: left in French, right in Arabic.
     • The bug fix: "J'ai déjà un code" used to demand the birth date and never
       opened the code field. It now needs a valid email only…
     • …and the A24 guarantee moves to VERIFY, where it always lived: a code typed
       with no birth date goes back to step 1, on the birth field, and nothing is
       sent to the API — no account can be born without an age.
     • The boxes themselves: typing advances, Backspace on an empty box goes back,
       a pasted code fills all six; a refused code turns every box rose, marks it
       invalid and describes it with the one error message.
     • The global fixes that ride along: the .inp icon is centred in a 48px field,
       the primary button lost its glow, the terms sentence flows inline.

   Selectors are the contract's data-e2e hooks and the copy the contract fixes.
   The only class names used are the two global ones the fixes are ABOUT (.inp,
   .btn-primary); the panel is found by its headings, not by a layout class.

   ADDED, never edited into an existing spec. */

/* Reduced motion: the card and the code step animate in, and a bounding box read
   mid-animation is not the layout. Every test runs at the desktop width. */
test.use({ contextOptions: { reducedMotion: "reduce" }, viewport: { width: 1440, height: 900 } });

const STEP1 = '[data-e2e="auth-step-identifier"]';
const STEP2 = '[data-e2e="auth-step-code"]';
const HAVE_CODE = '[data-e2e="have-code"]';
const OTP_ERROR = '[data-e2e="otp-error"]';

/* RFC 2606 .invalid, and the e2e- prefix teardown matches. */
const fresh = (what: string) => email(`e2e-authb-${what}-${randomBytes(4).toString("hex")}`);

test.beforeEach(async () => {
  /* rate_limits is Postgres-backed and outlives runs (see auth.spec.ts). The A24
     test also READS it: every verify that reaches the API spends the per-IP budget,
     so an empty table is proof that none did. */
  await resetRateLimits();
});

/* networkidle = hydrated. "J'ai déjà un code" is a type=button with a React
   handler: clicked before hydration it does nothing at all. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await expect(page.locator(STEP1)).toBeVisible();
}

async function openCodeStep(page: Page, path: string, address = fresh("step")): Promise<void> {
  await open(page, path);
  await page.locator('input[type="email"]').fill(address);
  await page.locator(HAVE_CODE).click();
  await expect(page.locator(STEP2)).toBeVisible();
}

/** The six boxes as the contract describes them, focus on the first. */
async function expectOtpBoxes(page: Page): Promise<void> {
  await expect(page.locator(OTP_GROUP), "the code reads left to right in every locale").toHaveAttribute("dir", "ltr");
  const boxes = page.locator(OTP_DIGIT);
  await expect(boxes).toHaveCount(6);
  await expect(boxes.first(), "SMS/email autofill targets the first box").toHaveAttribute("autocomplete", "one-time-code");
  for (let i = 0; i < 6; i++) {
    await expect(boxes.nth(i), `box ${i + 1} opens the numeric keypad`).toHaveAttribute("inputmode", "numeric");
  }
  await expect(boxes.first(), "focus lands on the first box when the step appears").toBeFocused();
}

/** The house a11y contract for a refused field (form-a11y.spec.ts). */
async function expectFieldError(page: Page, input: Locator, message: string): Promise<void> {
  await expect(input, "the field is marked invalid").toHaveAttribute("aria-invalid", "true");
  const describedBy = (await input.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "the field points at its message").not.toBe("");
  const described = page.locator(describedBy.split(/\s+/).map((d) => `[id="${d}"]`).join(", "));
  await expect(described.filter({ hasText: message }), "aria-describedby resolves to the message").toHaveCount(1);
  await expect(described.filter({ hasText: message })).toHaveAttribute("role", "alert");
  await expect(input, "focus moves to the field").toBeFocused();
}

/* The brand panel and the form side, found by what they HOLD rather than by class
   name: the visible H2 in <main> is the panel's title, the visible H1 is the form's.
   Each side is the child of their lowest common ancestor that contains it. */
async function sides(page: Page) {
  const r = await page.evaluate(() => {
    const shown = (el: Element) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const h1 = [...document.querySelectorAll("main h1")].find(shown);
    const h2 = [...document.querySelectorAll("main h2")].find(shown);
    if (!h1 || !h2) return null;
    const up = (el: Element) => {
      const chain: Element[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) chain.push(e);
      return chain;
    };
    const aboveH2 = new Set(up(h2));
    const lca = up(h1).find((e) => aboveH2.has(e));
    if (!lca) return null;
    const side = (el: Element) => up(el).find((e) => e.parentElement === lca) ?? el;
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right };
    };
    return { panel: box(side(h2)), form: box(side(h1)) };
  });
  expect(r, "a visible panel H2 and form H1 inside <main>").not.toBeNull();
  return r!;
}

/** How many verifies reached the API since beforeEach: each one spends the per-IP
    verify budget (apps/api routes/auth.ts, key otp:vfy:ip:…) before the code is read. */
async function verifiesSeenByApi(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from rate_limits where key like 'otp:vfy:%'`;
  return r.n;
}

/* ── 1. "J'ai déjà un code" REPLACES step 1 ─────────────────────────────────── */
for (const path of ["/fr/signup/prof", "/fr/signup/eleve", "/fr/auth"]) {
  test(`${path}: "J'ai déjà un code" replaces step 1 with the code step`, async ({ page }) => {
    await openCodeStep(page, path);

    await expect(page.locator(STEP1), "step 1 is replaced, not kept above the code").toHaveCount(0);
    await expect(page.locator('input[type="email"]'), "the address field is gone, not disabled").toHaveCount(0);
    await expect(page.locator("main h1")).toHaveText("Vérifie ta boîte mail");
    await expectOtpBoxes(page);
  });
}

/* ── 2. RTL: the boxes stay LTR, the panel mirrors ─────────────────────────── */
test("/ar/signup/prof: the code step works the same, and its boxes still read left to right", async ({ page }) => {
  await openCodeStep(page, "/ar/signup/prof");
  await expect(page.locator(STEP1)).toHaveCount(0);
  await expectOtpBoxes(page);

  const boxes = page.locator(OTP_DIGIT);
  const first = await boxes.first().boundingBox();
  const last = await boxes.last().boundingBox();
  expect(first && last && first.x < last.x, "box 1 is on the LEFT even on the RTL page").toBe(true);
});

test("the brand panel mirrors with the page at 1440: left of the form in FR, right of it in AR", async ({ page }) => {
  await open(page, "/fr/signup/prof");
  const fr = await sides(page);
  expect(fr.panel.right, "FR: the panel ends where the form begins").toBeLessThanOrEqual(fr.form.left + 1);

  await open(page, "/ar/signup/prof");
  const ar = await sides(page);
  expect(ar.panel.left, "AR: the panel starts where the form ends").toBeGreaterThanOrEqual(ar.form.right - 1);
});

/* ── 3. The bug fix: a valid email is all "J'ai déjà un code" needs ──────────── */
test("/fr/signup/prof: \"J'ai déjà un code\" needs a valid email — and no birth date", async ({ page }) => {
  await open(page, "/fr/signup/prof");
  const input = page.locator('input[type="email"]');
  const haveCode = page.locator(HAVE_CODE);

  await haveCode.click();
  await expectFieldError(page, input, "Entre ton adresse email.");
  await expect(page.locator(STEP2), "an empty address stays on step 1").toHaveCount(0);

  await input.fill("pas-une-adresse");
  await haveCode.click();
  await expectFieldError(page, input, "Cette adresse email n'est pas valide.");
  await expect(page.locator(STEP2), "a malformed address stays on step 1").toHaveCount(0);

  await input.fill(fresh("nobirth"));
  await haveCode.click();
  await expect(page.locator(STEP2), "the code step opens with no birth date chosen").toBeVisible();
  await expect(page.getByText("Choisis le mois et l'année de naissance.")).toHaveCount(0);
});

/* ── 4. …and the birth date is still enforced on VERIFY (A24) ───────────────── */
test("/fr/signup/prof: a code typed with no birth date goes back to the birth field, and never reaches the API", async ({ page }) => {
  const address = fresh("a24");
  await openCodeStep(page, "/fr/signup/prof", address);

  /* check:false — the refusal happens on the client in the same render as the sixth
     digit, so the boxes are already gone when fillOtp could read them. */
  await fillOtp(page, "123456", { check: false });

  await expect(page.locator(STEP1), "back on step 1").toBeVisible();
  await expect(page.locator(STEP2)).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: "Choisis le mois et l'année de naissance." }),
    "the birth field says what is missing",
  ).toBeVisible();
  await expect(page.getByLabel("Mois de naissance", { exact: true }), "focus is on the month").toBeFocused();

  expect(await verifiesSeenByApi(), "no verify was sent: the age is checked before the code is spent").toBe(0);
  const [p] = await sql<{ n: number }[]>`select count(*)::int n from profiles where email = ${address}`;
  expect(p.n, "no account without a birth date").toBe(0);

  /* Positive control for the probe above: with a birth date, the very same code
     DOES reach the API (and is refused there — this address never had a code). */
  await open(page, "/fr/signup/prof");
  await page.locator('input[type="email"]').fill(address);
  await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
  await page.getByLabel("Année de naissance", { exact: true }).selectOption("1988");
  await page.locator(HAVE_CODE).click();
  await expect(page.locator(STEP2)).toBeVisible();
  await fillOtp(page, "123456");
  await expect(page.locator(OTP_ERROR)).toContainText("Code incorrect ou expiré", { timeout: 20_000 });
  expect(await verifiesSeenByApi(), "with a birth date the verify reaches the API").toBeGreaterThan(0);
  const [again] = await sql<{ n: number }[]>`select count(*)::int n from profiles where email = ${address}`;
  expect(again.n).toBe(0);
});

/* ── 5. The boxes: typing, Backspace, paste ─────────────────────────────────── */
test("the code boxes: each digit moves to the next box, Backspace on an empty box goes back", async ({ page }) => {
  /* /fr/signup/prof with no birth date, and never six digits: nothing here can
     complete the code, so nothing verifies and the step stays on screen. */
  await openCodeStep(page, "/fr/signup/prof");
  const boxes = page.locator(OTP_DIGIT);
  await expect(boxes.first()).toBeFocused();

  for (let i = 0; i < 5; i++) {
    const d = String(i + 1);
    await page.keyboard.press(d);
    await expect(boxes.nth(i)).toHaveValue(d);
    await expect(boxes.nth(i + 1), `after digit ${i + 1}, focus is on box ${i + 2}`).toBeFocused();
  }

  await expect(boxes.nth(5)).toHaveValue("");
  await page.keyboard.press("Backspace");
  await expect(boxes.nth(4), "Backspace on the empty sixth box goes back to the fifth").toBeFocused();
  await expect(boxes.nth(5)).toHaveValue("");
  await expect(page.locator(STEP2), "five digits verify nothing").toBeVisible();
  expect(await verifiesSeenByApi()).toBe(0);
});

test("the code boxes: a 6-digit code pasted into the THIRD box fills all six", async ({ page }) => {
  await openCodeStep(page, "/fr/auth");

  /* A complete code verifies at once (onComplete). Hold that server action in the
     browser while the boxes are read, so the answer (invalid-code: this address
     never had one) cannot race the reads — whatever the form does with the boxes
     once it has it. Released below, then the route is dropped. */
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = () => r()));
  let held = 0;
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST" && req.headers()["next-action"]) {
      held++;
      await gate;
    }
    await route.continue();
  });

  try {
    const third = page.locator(OTP_DIGIT).nth(2);
    await third.focus();
    await third.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, "123456");

    const boxes = page.locator(OTP_DIGIT);
    for (let i = 0; i < 6; i++) {
      await expect(boxes.nth(i), `box ${i + 1} holds digit ${i + 1}`).toHaveValue(String(i + 1));
    }
    await expect.poll(() => held, { message: "a pasted code is complete, so it is verified at once" }).toBeGreaterThanOrEqual(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
  await expect(page.locator(OTP_ERROR)).toBeVisible({ timeout: 20_000 });
});

/* ── 6. A refused code: rose, invalid, described ────────────────────────────── */
test("/fr/auth: a refused code turns every box rose, marks it invalid and describes it with the error", async ({ page }) => {
  // A fresh address that never had a code: the API answers invalid-code (the code is
  // checked before the no-account branch — apps/api routes/auth.ts).
  await openCodeStep(page, "/fr/auth", fresh("otperr"));
  await fillOtp(page, "123456");

  const err = page.locator(OTP_ERROR);
  await expect(err).toBeVisible({ timeout: 20_000 });
  await expect(err).toHaveAttribute("role", "alert");
  await expect(err).toContainText("Code incorrect ou expiré");
  const errId = await err.getAttribute("id");
  expect(errId, "the error has an id the boxes can point at").toBeTruthy();

  /* Measured at rest: no hover (the mouse clicked "J'ai déjà un code" where the
     boxes now are) and no focus (invalid() focuses the first box). */
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const rose = await page.evaluate(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--rose").trim();
    const probe = document.createElement("span");
    probe.style.color = raw;
    document.body.append(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return { raw, rgb };
  });
  expect(rose.raw, "--rose is defined on :root").not.toBe("");

  const boxes = page.locator(OTP_DIGIT);
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const box = boxes.nth(i);
    await expect(box, `box ${i + 1} is invalid`).toHaveAttribute("aria-invalid", "true");
    await expect
      .poll(
        () => box.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor];
        }),
        { message: `box ${i + 1} has a --rose border (${rose.raw})` },
      )
      .toEqual([rose.rgb, rose.rgb, rose.rgb, rose.rgb]);
    const describedBy = ((await box.getAttribute("aria-describedby")) ?? "").split(/\s+/);
    expect(describedBy, `box ${i + 1} is described by the error`).toContain(errId);
  }
});

/* ── 7. The global fixes, measured ──────────────────────────────────────────── */
test("/fr/signup/prof: centred .inp icon, no glow on the CTA, a terms sentence that flows", async ({ page }) => {
  await open(page, "/fr/signup/prof");
  await page.mouse.move(0, 0);

  const field = page.locator(".inp").filter({ has: page.locator('input[type="email"]') });
  const geo = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const icon = el.querySelector("svg")?.getBoundingClientRect();
    return { height: r.height, centre: r.top + r.height / 2, icon: icon ? icon.top + icon.height / 2 : null };
  });
  expect(geo.icon, "the email field has its leading icon").not.toBeNull();
  expect(Math.abs((geo.icon ?? 0) - geo.centre), "the mail icon is vertically centred").toBeLessThanOrEqual(2);
  expect(Math.round(geo.height), "the field is 48px tall").toBeGreaterThanOrEqual(48);

  const cta = page.locator("main form .btn-primary").first();
  await expect(cta).toBeVisible();
  expect(await cta.evaluate((el) => getComputedStyle(el).boxShadow), "the primary button has no glow").toBe("none");

  const terms = page.locator('[data-e2e="signup-terms"]');
  await expect(terms).toHaveText(
    "En créant ton compte, tu acceptes les conditions d'utilisation et la politique de confidentialité.",
  );
  const links = terms.locator("a");
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    expect(await link.evaluate((el) => getComputedStyle(el).display), "the links flow inside the sentence").toBe("inline");
  }
  const m = await terms.evaluate((el) => {
    const s = getComputedStyle(el);
    const lineHeight = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.2;
    const pad = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    return { height: el.getBoundingClientRect().height - pad, lineHeight };
  });
  expect(m.height, "at 1440 the sentence is at most two lines, not broken into three").toBeLessThanOrEqual(2 * m.lineHeight + 1);

  // Under the CTA (UI_AUTH_OPTION_B.md §1.5).
  const ctaBox = await cta.boundingBox();
  const termsBox = await terms.boundingBox();
  expect(ctaBox && termsBox && termsBox.y >= ctaBox.y + ctaBox.height - 1, "the terms sentence sits under the CTA").toBe(true);
});
