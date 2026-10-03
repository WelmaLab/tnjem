import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { email, seedAdmin, seedProfile, seedTutor } from "./support/seed";
import { resetRateLimits } from "./support/otp";
import { contextAs } from "./support/journey";
import { chooseBirthDate, chooseOption, selectByLabel } from "./support/select-ui";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-2 · C — THE SHELL'S SELECT WHERE THE LAST NATIVE ONES WERE.

   Signup (birth month + year), student welcome (level), /onboarding/upgrade (birth
   year, birth month) and /admin/plans (the plan to grant) used the browser's own
   <select>: its list in the system's language and style. They are the shell's
   Select (components/app/Select.tsx) now, with the same state, the same checks and
   the same data-e2e — and they work from the keyboard and read right to a screen
   reader (a button named « label + choice », a listbox of options), in FR and AR.
   The « nowhere else either » crawl is lf2-c-native-controls.spec.ts.
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const fresh = (p: string) => email(`e2e-lf2c-${p}-${randomBytes(4).toString("hex")}`);

test.beforeEach(async () => {
  await resetRateLimits();
});

test.describe("C · signup: the birth date", () => {
  test("FR: placeholder, refusal on the field, then month and year from the keyboard → the code step", async ({ page }) => {
    await page.goto("/fr/signup/prof", { waitUntil: "networkidle" });
    await expect(page.locator("main select")).toHaveCount(0);
    const field = page.locator("[data-e2e=birth-date]");
    const month = page.locator("[data-e2e=birth-month]");
    const year = page.locator("[data-e2e=birth-year]");
    await expect(field).toHaveAttribute("role", "group");
    await expect(month).toHaveAttribute("aria-haspopup", "listbox");
    await expect(month).toHaveAccessibleName("Mois de naissance Mois");
    await expect(year).toHaveAccessibleName("Année de naissance Année");
    await expect(month.locator(".lf-sel-v")).toHaveClass(/is-ph/);

    // The same check as before (birthDateOk): no code is asked for, the field says why.
    await page.locator('input[type="email"]').fill(fresh("kb"));
    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    const alert = page.getByRole("alert").filter({ hasText: "Choisis le mois et l'année de naissance." });
    await expect(alert).toBeVisible();
    await expect(month, "focus is on the month").toBeFocused();
    await expect(month).toHaveAttribute("aria-invalid", "true");
    await expect(year).toHaveAttribute("aria-invalid", "true");
    const errId = await alert.getAttribute("id");
    expect((await month.getAttribute("aria-describedby"))?.split(" "), "the error describes the month").toContain(errId);
    await expect(page.locator('[data-e2e="auth-step-code"]')).toHaveCount(0);

    // Keyboard: Enter opens on the first month, ↓↓ Enter picks Mars; focus comes back.
    await page.keyboard.press("Enter");
    const list = page.locator("[data-e2e=birth-month-list]");
    await expect(list).toBeVisible();
    await expect(list.getByRole("option")).toHaveCount(12);
    await expect(list.getByRole("option").first()).toHaveText("Janvier");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(month).toBeFocused();
    await expect(month).toHaveAttribute("data-value", "3");
    await expect(month).toHaveAccessibleName("Mois de naissance Mars");
    await expect(alert, "choosing clears the refusal").toHaveCount(0);
    await expect(month).not.toHaveAttribute("aria-invalid", "true");

    // Escape closes without changing the choice.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(month).toHaveAttribute("data-value", "3");
    await expect(month).toBeFocused();

    // Tab to the year; Space opens; typing the year jumps to it.
    await page.keyboard.press("Tab");
    await expect(year).toBeFocused();
    await page.keyboard.press(" ");
    await expect(page.locator("[data-e2e=birth-year-list]")).toBeVisible();
    await page.keyboard.type("1988");
    await page.keyboard.press("Enter");
    await expect(year).toHaveAttribute("data-value", "1988");
    await expect(year).toHaveAccessibleName("Année de naissance 1988");

    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  });

  test("FR: a tutor under 18 is refused on the field (the year list stops at 18)", async ({ page }) => {
    await page.goto("/fr/signup/prof", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=birth-year]").click();
    const first = page.locator("[data-e2e=birth-year-list] [role=option]").first();
    const youngest = Number(await first.getAttribute("data-value"));
    expect(youngest, "an adults-only form offers no year that cannot be 18").toBe(new Date().getFullYear() - 18);
    await page.keyboard.press("Escape");
    // December of the youngest year: not 18 yet for most of the year → refused, like before.
    await page.locator('input[type="email"]').fill(fresh("minor"));
    await chooseOption(page, page.locator("[data-e2e=birth-month]"), "12");
    await chooseOption(page, page.locator("[data-e2e=birth-year]"), String(youngest));
    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    const now = new Date();
    if (now.getMonth() < 11) {
      await expect(page.locator("[data-e2e=birth-date]").locator("xpath=..").getByRole("alert")).toContainText("18 ans");
      await expect(page.locator("[data-e2e=birth-month]")).toBeFocused();
    }
  });

  test("AR: Arabic months and placeholders; the choice reaches the code step", async ({ page }) => {
    await page.goto("/ar/signup/eleve", { waitUntil: "networkidle" });
    const month = selectByLabel(page, "شهر الولادة");
    await expect(month).toHaveAccessibleName("شهر الولادة الشهر");
    await expect(selectByLabel(page, "عام الولادة")).toHaveAccessibleName("عام الولادة العام");
    await month.click();
    const opts = page.locator("[data-e2e=birth-month-list] [role=option]");
    await expect(opts.first()).toHaveText("جانفي");
    await expect(opts.last()).toHaveText("ديسمبر");
    await page.keyboard.press("Escape");
    await page.locator('input[type="email"]').fill(fresh("ar"));
    await chooseBirthDate(page, { month: 3, year: 1995, locale: "ar" });
    await expect(month).toHaveAccessibleName("شهر الولادة مارس");
    await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("C · student welcome: the level", () => {
  test("chosen with the Select and saved; « Choisir… » clears it (FR), Arabic labels (AR)", async ({ browser }) => {
    const me = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/student/welcome", { waitUntil: "networkidle" });
    await expect(page.locator("main select")).toHaveCount(0);
    const level = page.locator("[data-e2e=welcome-level]");
    await expect(level).toHaveAccessibleName("Ton niveau Choisir…");
    await expect(level.locator(".lf-sel-v")).toHaveClass(/is-ph/);
    await chooseOption(page, level, "lycee");
    await expect(level).toHaveAccessibleName("Ton niveau Lycée");
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect.poll(async () => (await sql<{ level: string | null }[]>`select level from profiles where id = ${me.id}`)[0].level, { timeout: 15_000 }).toBe("lycee");

    // Back on the screen: the stored level is shown; « Choisir… » is still a choice, and clears it.
    await page.goto("/fr/student/welcome", { waitUntil: "networkidle" });
    await expect(level).toHaveAttribute("data-value", "lycee");
    await chooseOption(page, level, "");
    await expect(level.locator(".lf-sel-v")).toHaveClass(/is-ph/);
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await expect.poll(async () => (await sql<{ level: string | null }[]>`select level from profiles where id = ${me.id}`)[0].level, { timeout: 15_000 }).toBeNull();

    await page.goto("/ar/student/welcome", { waitUntil: "networkidle" });
    await level.click();
    const opts = page.locator("[data-e2e=welcome-level-list] [role=option]");
    await expect(opts).toHaveText(["اختر…", "ابتدائي", "إعدادي", "ثانوي", "باكالوريا", "جامعي", "أخرى"]);
    await ctx.close();
  });
});

test.describe("C · /onboarding/upgrade: the birth year and month", () => {
  test("refused without them, focus on the field; with them the student becomes a tutor", async ({ browser }) => {
    const me = await seedProfile({ role: "student", birthYear: null, birthMonth: null, fullName: "Nour Ben Salah" });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/onboarding/upgrade", { waitUntil: "networkidle" });
    await expect(page.locator("main select")).toHaveCount(0);
    const year = page.locator("[data-e2e=upgrade-birth-year]");
    const month = page.locator("[data-e2e=upgrade-birth-month]");
    await expect(year).toHaveAccessibleName("Ton année de naissance Choisir…");
    await expect(month).toHaveAccessibleName("Ton mois de naissance Choisir…");
    const cta = page.getByRole("button", { name: "Oui, passer en compte prof" });

    await cta.click();
    await expect(page.getByRole("alert").filter({ hasText: "Choisis ton année de naissance pour continuer." })).toBeVisible();
    await expect(year).toBeFocused();
    await expect(year).toHaveAttribute("aria-invalid", "true");

    await chooseOption(page, year, "1990");
    await expect(year).not.toHaveAttribute("aria-invalid", "true");
    await cta.click();
    await expect(page.getByRole("alert").filter({ hasText: "Choisis ton mois de naissance pour continuer." })).toBeVisible();
    await expect(month).toBeFocused();

    await chooseOption(page, month, "6");
    await cta.click();
    await expect.poll(async () => (await sql<{ role: string; birth_year: number | null; birth_month: number | null }[]>`
      select role, birth_year, birth_month from profiles where id = ${me.id}`)[0], { timeout: 20_000 })
      .toEqual({ role: "tutor", birth_year: 1990, birth_month: 6 });
    await ctx.close();
  });

  test("AR: the year and month Selects speak Arabic", async ({ browser }) => {
    const me = await seedProfile({ role: "student", birthYear: null, birthMonth: null, fullName: "Nour Ben Salah" });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/ar/onboarding/upgrade", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=upgrade-birth-year]")).toHaveAccessibleName("سنة ولادتك اختر…");
    const month = page.locator("[data-e2e=upgrade-birth-month]");
    await expect(month).toHaveAccessibleName("شهر ولادتك اختار…");
    await chooseOption(page, month, "1");
    await expect(month).toHaveAccessibleName("شهر ولادتك جانفي");
    await ctx.close();
  });
});

test.describe("C · /admin/plans: the plan to grant", () => {
  test("chosen with the Select; « Attribuer » waits for a choice, then grants it", async ({ browser }) => {
    const admin = await seedAdmin();
    const tp = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Aaa Lf2 Plan" });
    const tutor = await seedTutor({ profileId: tp.id, status: "verified", fullName: "Aaa Lf2 Plan" });
    const ctx = await contextAs(browser, admin.id);
    const page = await ctx.newPage();
    /* "load", not "networkidle": /admin/plans lists every tutor (hundreds by this point
       of a full run) and never goes idle in time (see l5-fields.spec.ts). The row auto-waits. */
    await page.goto("/fr/admin/plans");
    const row = page.locator(`[data-e2e=plan-row][data-tutor="${tutor.id}"]`);
    await expect(row).toBeVisible();
    await expect(page.locator("main select")).toHaveCount(0);
    const choice = row.locator("[data-e2e=plan-choice]");
    const grant = row.getByRole("button", { name: "Attribuer", exact: true });
    await expect(choice).toHaveAccessibleName("Offre —");
    await expect(grant).toBeDisabled();

    await chooseOption(page, choice, "pro");
    await expect(choice).toHaveAccessibleName("Offre pro");
    await expect(grant).toBeEnabled();
    await grant.click();
    await expect(page.locator(".toast")).toHaveText("Offre mise à jour ✓");
    await expect.poll(async () => (await sql<{ plan_code: string }[]>`
      select plan_code from subscriptions where tutor_id = ${tutor.id} and status = 'active'`).map((r) => r.plan_code), { timeout: 15_000 })
      .toEqual(["pro"]);
    await ctx.close();
  });
});
