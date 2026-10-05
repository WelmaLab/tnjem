import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile } from "./support/seed";
import { contextAs } from "./support/journey";

/* student-space-v1 · F — PROFIL (/account for a student), mockup 4a.

   Tabs Moi · Notifications · Sécurité (?tab=). Moi: first and last name, level (one),
   subjects (several, the profs' subject list), the phone grouped « +216 97 029 699 »,
   saved with the onboarding validation, a toast above any bar; the photo is initials
   only. Notifications: the e-mails a student really gets, « Bientôt » (disabled, OFF)
   for messages, the bell always on. Sécurité: language, role, password, sessions,
   « Déconnecter partout », closing the account. A parent gets Sécurité alone.
   FR + AR, 1440×900 and 390×844. ADDED as its own spec. */

const T = {
  fr: { title: "Mon profil", tabs: ["Moi", "Notifications", "Sécurité"], soon: "Bientôt", role: "Élève", logoutAll: "Déconnecter partout" },
  ar: { title: "البروفايل متاعي", tabs: ["أنا", "الإشعارات", "الأمان"], soon: "قريب", role: "تلميذ", logoutAll: null },
} as const;

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const locale of ["fr", "ar"] as const) {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`Profil · ${locale} · ${width}: identity, three tabs, Moi prefilled, Notifications honest, Sécurité complete`, async ({ browser }) => {
      const t = T[locale];
      const digits = String(20_000_000 + Math.floor(Math.random() * 9_000_000)); // unique: profiles.phone is UNIQUE
      const me = await seedProfile({ role: "student", birthYear: 1995, fullName: "Ahmed Malek", phone: `+216${digits}` });
      await sql`update profiles set level = 'bac', subjects = 'math,physique' where id = ${me.id}`;
      const ctx = await contextAs(browser, me.id);
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/account`);

      await expect(page.locator("h1")).toHaveText(t.title);
      const id = page.locator("[data-e2e=profile-identity]");
      await expect(id).toContainText("Ahmed Malek");
      await expect(id).toContainText(me.email);
      await expect(page.locator("[data-e2e=profile-tabs] [role=tab]")).toHaveText([...t.tabs]);

      // Moi
      await expect(page.locator("[data-e2e=moi-first]")).toHaveValue("Ahmed");
      await expect(page.locator("[data-e2e=moi-last]")).toHaveValue("Malek");
      await expect(page.locator("[data-e2e=moi-phone]")).toHaveValue(`+216 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`);
      await expect(page.locator('[data-e2e=moi-levels] [data-level="bac"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[data-e2e=moi-subjects] [data-subject="math"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[data-e2e=moi-subjects] [data-subject="svt"]')).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator("[data-e2e=moi-subjects] button")).toHaveCount(11); // the profs' subject list
      await noHorizontalScroll(page);

      // Notifications
      await page.locator("[data-e2e=profile-tab-notifications]").click();
      await expect(page).toHaveURL(/tab=notifications/);
      for (const k of ["bookings", "reminders", "followers"]) {
        await expect(page.locator(`[data-e2e=pref-${k}] [role=switch]`)).toBeEnabled();
        await expect(page.locator(`[data-e2e=pref-${k}] [role=switch]`)).toHaveAttribute("aria-checked", "true");
      }
      const msg = page.locator("[data-e2e=pref-messages]");
      await expect(msg).toContainText(t.soon);
      await expect(msg.locator("[role=switch]")).toBeDisabled();
      await expect(msg.locator("[role=switch]")).toHaveAttribute("aria-checked", "false");
      const bell = page.locator("[data-e2e=pref-bell] [role=switch]");
      await expect(bell).toBeDisabled();
      await expect(bell).toHaveAttribute("aria-checked", "true");
      await noHorizontalScroll(page);

      // Sécurité
      await page.locator("[data-e2e=profile-tab-securite]").click();
      await expect(page.locator("[data-e2e=account-role]")).toHaveText(t.role);
      await expect(page.locator("[data-e2e=security-panel]")).toBeVisible();
      if (t.logoutAll) await expect(page.getByRole("button", { name: t.logoutAll })).toBeVisible();
      await expect(page.locator("[data-e2e=account-delete]")).toBeVisible();
      await noHorizontalScroll(page);
      await ctx.close();
    });
  }
}

test("Profil › Moi: edit and save → a toast, the database, the phone grouped; a bad number is said on the field", async ({ browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1995, fullName: "Ahmed Malek" });
  const ctx = await contextAs(browser, me.id);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fr/account?tab=moi");
  await page.locator("[data-e2e=moi-first]").fill("Youssef");
  await page.locator("[data-e2e=moi-last]").fill("Amri");
  await page.locator('[data-e2e=moi-levels] [data-level="college"]').click();
  await page.locator('[data-e2e=moi-subjects] [data-subject="svt"]').click();
  await page.locator("[data-e2e=moi-phone]").fill("12");
  await page.locator("[data-e2e=moi-save]").click();
  await expect(page.locator("[data-e2e=profile-moi] [role=alert]")).toContainText("Ce numéro n'est pas valide.");
  await expect(page.locator("[data-e2e=moi-phone]")).toBeFocused();

  const digits = String(30_000_000 + Math.floor(Math.random() * 9_000_000));
  await page.locator("[data-e2e=moi-phone]").fill(digits);
  await page.locator("[data-e2e=moi-save]").click();
  const toast = page.locator(".toast");
  await expect(toast).toHaveText("Ton profil est enregistré.");
  await expect(page.locator("[data-e2e=moi-phone]")).toHaveValue(`+216 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`);
  await expect(page.locator("[data-e2e=profile-identity]")).toContainText("Youssef Amri");
  const [p] = await sql<{ full_name: string; level: string; subjects: string; phone: string }[]>`select full_name, level, subjects, phone from profiles where id = ${me.id}`;
  expect(p).toEqual({ full_name: "Youssef Amri", level: "college", subjects: "svt", phone: `+216${digits}` });

  // Emptying the phone removes it.
  await page.locator("[data-e2e=moi-phone]").fill("");
  await page.locator("[data-e2e=moi-save]").click();
  await expect.poll(async () => (await sql<{ phone: string | null }[]>`select phone from profiles where id = ${me.id}`)[0].phone).toBeNull();
  await ctx.close();
});

test("Profil › Notifications: a switch saves, and says so", async ({ browser }) => {
  const me = await seedProfile({ role: "student", birthYear: 1995 });
  const ctx = await contextAs(browser, me.id);
  const page = await ctx.newPage();
  await page.goto("/fr/account?tab=notifications");
  const sw = page.locator("[data-e2e=pref-followers] [role=switch]");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".toast")).toHaveText("Préférence enregistrée.");
  await expect.poll(async () => (await sql<{ followers: boolean }[]>`select followers from notification_prefs where profile_id = ${me.id}`)[0]?.followers).toBe(false);
  await ctx.close();
});

test("Profil: a parent (guardian) gets the account's security content alone, no student tabs", async ({ browser }) => {
  const parent = await seedProfile({ role: "guardian", birthYear: 1975, fullName: "Mounir Parent" });
  const ctx = await contextAs(browser, parent.id);
  const page = await ctx.newPage();
  await page.goto("/fr/account");
  await expect(page.locator("main")).toContainText("Mounir Parent");
  await expect(page.locator("[data-e2e=profile-tabs]")).toHaveCount(0);
  await expect(page.locator("[data-e2e=security-panel]")).toBeVisible();
  await expect(page.locator("[data-e2e=profile-moi]")).toHaveCount(0);
  await ctx.close();
});
