import { test, expect, type Page, type Locator } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { fillWallTime } from "./support/datetime"; // espace prof v2 · shell

/* ════════════════════════════════════════════════════════════════════════════
   a11y: a form that refuses a field says so ON the field, and puts you there.

   On 14 Sept, submitting /fr/auth empty showed "Entre ton adresse email." with
   role="alert" — and the input had no id, no aria-invalid, no aria-describedby,
   and focus stayed where it was. A screen-reader user heard the message once and
   was left on the button with nothing tying it to the field.

   The contract, per field: a stable id; aria-invalid="true" while invalid, gone
   once corrected; aria-describedby naming the element that carries the message
   (role="alert"); and focus on the field after the failed submit.

   ADDED, never edited into an existing spec. */

async function expectInvalidAndFocused(page: Page, input: Locator, message: string) {
  await expect(input, "the field is marked invalid").toHaveAttribute("aria-invalid", "true");
  const id = await input.getAttribute("id");
  expect(id, "the field has a stable id").toBeTruthy();
  const describedBy = (await input.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "the field points at its message").not.toBe("");
  const described = page.locator(describedBy.split(" ").map((d) => `[id="${d}"]`).join(", "));
  await expect(described.filter({ hasText: message }), "aria-describedby resolves to the message").toHaveCount(1);
  await expect(described.filter({ hasText: message })).toHaveAttribute("role", "alert");
  await expect(input, "focus moves to the field that failed").toBeFocused();
}

for (const [locale, message] of [
  ["fr", "Entre ton adresse email."],
  ["ar", null],
] as const) {
  test(`a11y /${locale}/auth: an empty submit marks, describes and focuses the email field`, async ({ page }) => {
    await page.goto(`/${locale}/auth`);
    const input = page.locator('input[type="email"]');
    await expect(input).toHaveAttribute("autocomplete", "email");
    await expect(input).toHaveAttribute("inputmode", "email");

    await page.locator('main form button[type="submit"]').click();

    // Next's route announcer is also role="alert" and empty — hence the /\S/ filter.
    const text = message ?? ((await page.getByRole("alert").filter({ hasText: /\S/ }).first().textContent()) ?? "").trim();
    expect(text, "a message is shown").not.toBe("");
    await expectInvalidAndFocused(page, input, text);

    await input.fill("someone@tnajem.invalid");
    await expect(input, "corrected → no longer invalid").not.toHaveAttribute("aria-invalid", "true");
  });
}

test("a11y /fr/auth: a malformed address is refused on the field", async ({ page }) => {
  await page.goto("/fr/auth");
  const input = page.locator('input[type="email"]');
  await input.fill("pas-une-adresse");
  await input.press("Enter");
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  await expectInvalidAndFocused(page, input, ((await alert.textContent()) ?? "").trim());
});

test("a11y /fr/signup/eleve: an empty submit marks, describes and focuses the email field", async ({ page }) => {
  await page.goto("/fr/signup/eleve");
  const input = page.locator('input[type="email"]');
  await page.locator('main form button[type="submit"]').click();
  await expectInvalidAndFocused(page, input, "Entre ton adresse email.");
});

test("a11y /fr/onboarding: publishing without a name focuses the name field", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1988 });
  const ctx = await browser.newContext();
  await ctx.addCookies([sessionCookie(await mintSession(me.id))]);
  const page = await ctx.newPage();

  await page.goto("/fr/onboarding");
  await page.getByRole("button", { name: /Publier ma page/i }).click();

  const name = page.getByPlaceholder("ex. Yassine Khelifi");
  const alert = page.getByRole("alert").filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  await expectInvalidAndFocused(page, name, ((await alert.textContent()) ?? "").trim());
  await ctx.close();
});

test("a11y /fr/dashboard/new-class: a server refusal lands on the field it names", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedTutor({ profileId: me.id, status: "verified" });
  const ctx = await browser.newContext();
  await ctx.addCookies([sessionCookie(await mintSession(me.id))]);
  const page = await ctx.newPage();

  await page.goto("/fr/dashboard/new-class");
  await page.locator("form input[type=text]").first().fill("Révision express");
  const when = new Date(Date.now() + 3 * 86_400_000);
  const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T18:00`;
  await fillWallTime(page, local); // espace prof v2 · shell: the DD/MM/YYYY + 24 h picker
  // Passes the browser's own checks (no max on price) — only the server refuses it.
  const price = page.getByPlaceholder("15");
  await price.fill("6000");
  await page.locator('form button[type="submit"]').click();

  await expectInvalidAndFocused(page, price, "Le prix doit être entre 0 et 5000 TND.");
  await ctx.close();
});
