import { test, expect, type Page, type Request } from "@playwright/test";
import { chooseBirthDate } from "./support/select-ui";
import { CONTACT_EMAIL } from "@tnajem/shared";

/* ════════════════════════════════════════════════════════════════════════════
   december-sprint · D — D15 (company identity) and D16 (the age message).

   The age message is true only while the pilot is adults-only (ALLOW_MINORS off),
   and the suite's own server runs with minors ON (playwright.config.ts). So, like
   pilot-tag.spec.ts, the adults-only checks go to the second web process built
   from the same bundle with ALLOW_MINORS unset (E2E_PILOT_BASE_URL, :3212 by
   default), and the last test proves the suite's server shows none of it.

   D15: every identity value in legal.ts is empty today → the footer has no
   identity line and the « Qui sommes-nous » block no identity list (the filled
   cases are apps/api/test/ds-d-company-identity.test.ts).
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const PILOT = process.env.E2E_PILOT_BASE_URL ?? "http://localhost:3212";

const T = {
  fr: {
    open: "Pendant le pilote, Tnajem est ouvert aux élèves de 18 ans et plus : classes de Bac, étudiants et adultes.",
    minor: "Pour l'instant, Tnajem est réservé aux 18 ans et plus.",
    home: "Retour à l'accueil",
    about: "Qui sommes-nous ?",
  },
  ar: {
    open: "في فترة التجربة، Tnajem مفتوح للتلامذة اللّي عمرهم 18 سنة وفوق: أقسام الباك، الطلبة والكبار.",
    minor: "توّا، Tnajem كان للّي عمرهم 18 سنة وفوق.",
    home: "ارجع للصفحة الرئيسية",
    about: "شكون إحنا؟",
  },
} as const;

const minorYear = () => new Date().getFullYear() - 15;

async function aboutBlockIsHonest(page: Page, locale: "fr" | "ar") {
  const about = page.locator("[data-e2e=home-about]");
  await expect(about).toBeVisible();
  await expect(about.getByRole("heading", { level: 2 })).toHaveText(T[locale].about);
  await expect(about.locator("[data-e2e=home-about-email]")).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  // D15: all six values are empty → no identity anywhere, and no empty label left behind.
  await expect(page.locator("[data-e2e=home-identity]")).toHaveCount(0);
  await expect(page.locator("[data-e2e=footer-identity]")).toHaveCount(0);
  const footer = (await page.locator(".site-footer").innerText()).replace(/\s+/g, " ");
  expect(footer).not.toMatch(/\bMF\b|\bRNE\b|INPDP|Tnajem — |المعرّف الجبائي/);
  // The block is the last thing before the footer.
  const lastSection = await page.locator("section").last().getAttribute("data-e2e");
  expect(lastSection).toBe("home-about");
}

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}, ALLOW_MINORS unset: the home age line and « Qui sommes-nous », no identity line`, async ({ page }) => {
    await page.goto(`${PILOT}/${locale}`);
    await expect(page.locator("[data-e2e=home-age]")).toHaveText(T[locale].open);
    await expect(page.locator("[data-e2e=home-about] [data-e2e=home-age]")).toBeVisible();
    await aboutBlockIsHonest(page, locale);
  });
}

test("/fr/signup/eleve, ALLOW_MINORS unset: the 18+ note, then a minor's date → the message, a link home, and nothing is sent", async ({ page }) => {
  await page.goto(`${PILOT}/fr/signup/eleve`, { waitUntil: "networkidle" });
  // The note under the birth date is the home page's sentence (no second 18+ note).
  await expect(page.getByText(T.fr.open, { exact: true })).toHaveCount(1);
  await expect(page.locator("[data-e2e=signup-minor]")).toHaveCount(0);

  // The live region is mounted, empty, before anything is chosen (so it is announced when filled).
  const live = page.locator("[data-e2e=signup-minor-live]");
  await expect(live).toHaveAttribute("role", "status");
  await expect(live).toBeEmpty();

  await page.locator('input[type="email"]').fill("e2e-ds-d-minor@tnajem.invalid");
  // From the minor's birth date on, nothing may leave the page: no server action (POST), no auth call.
  const sent: Request[] = [];
  page.on("request", (r) => {
    // A server action (requestOtp, accountStatus, verifyOtp) is a POST with a next-action header.
    if (r.method() !== "GET" || r.headers()["next-action"] || /otp|account-status/i.test(r.url())) sent.push(r);
  });
  await chooseBirthDate(page, { month: 1, year: minorYear() });

  const box = live.locator("[data-e2e=signup-minor]");
  await expect(box).toBeVisible();
  await expect(box).toContainText(T.fr.minor);
  const home = box.locator("[data-e2e=signup-minor-home]");
  await expect(home).toHaveText(T.fr.home);
  await expect(home).toHaveAttribute("href", "/fr");

  const submit = page.locator("[data-e2e=auth-step-identifier] button[type=submit]");
  await expect(submit).toBeDisabled();
  await expect(page.locator("[data-e2e=have-code]")).toBeDisabled();
  // Every way in: Enter in the address field, a programmatic submit, a forced click.
  await page.locator('input[type="email"]').press("Enter");
  await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await page.locator("[data-e2e=have-code]").evaluate((b: HTMLButtonElement) => b.click());
  await page.waitForTimeout(1500);
  expect(sent.map((r) => `${r.method()} ${r.url()}`), "no request from the minor's birth date on").toEqual([]);
  await expect(page.locator('[data-e2e="auth-step-code"]')).toHaveCount(0);
  await expect(page.locator("[data-e2e=auth-error]")).toHaveCount(0);

  // An adult date clears it (the rule is isAdult(), unchanged).
  await chooseBirthDate(page, { month: 1, year: 1995 });
  await expect(box).toHaveCount(0);
  await expect(submit).toBeEnabled();

  // And the link goes home.
  await chooseBirthDate(page, { month: 1, year: minorYear() });
  await page.locator("[data-e2e=signup-minor-home]").click();
  await expect(page).toHaveURL(/\/fr$/);
});

test("/ar/signup/eleve, ALLOW_MINORS unset: the Arabic note and minor message", async ({ page }) => {
  await page.goto(`${PILOT}/ar/signup/eleve`, { waitUntil: "networkidle" });
  await expect(page.getByText(T.ar.open, { exact: true })).toHaveCount(1);
  await chooseBirthDate(page, { month: 1, year: minorYear(), locale: "ar" });
  const box = page.locator("[data-e2e=signup-minor]");
  await expect(box).toContainText(T.ar.minor);
  await expect(box.locator("[data-e2e=signup-minor-home]")).toHaveText(T.ar.home);
  await expect(box.locator("[data-e2e=signup-minor-home]")).toHaveAttribute("href", "/ar");
});

test("ALLOW_MINORS=1 (the suite's own server): no age line, no minor message; the block still renders", async ({ page }) => {
  await page.goto("/fr");
  await page.waitForLoadState("networkidle"); // the line asks /api/pilot after hydration
  await expect(page.locator("[data-e2e=home-age]")).toHaveCount(0);
  const visible = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  expect(visible).not.toContain(T.fr.open);
  await aboutBlockIsHonest(page, "fr");

  await page.goto("/fr/signup/eleve", { waitUntil: "networkidle" });
  await chooseBirthDate(page, { month: 1, year: minorYear() });
  await expect(page.locator("[data-e2e=signup-minor]")).toHaveCount(0);
});
