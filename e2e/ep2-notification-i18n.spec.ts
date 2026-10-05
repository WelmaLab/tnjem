import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sql } from "./support/db";
import { seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* Notifications in the reader's language (0040). A row is a message key + JSON
   parameters, rendered by the API in the page's language; a row stored before 0040
   keeps its French text, and the bell gives each text its own language and
   direction so it reads correctly inside either panel. */

const HOST = new URL(BASE_URL).hostname;

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

test("the bell renders a stored key in the page's language — French on /fr, Arabic on /ar; an old French row stays French", async ({ browser }) => {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  await seedTutor({ profileId: profile.id, status: "verified", fullName: "Walid Tester" });
  await sql`insert into notifications (id, profile_id, kind, msg_key, msg_params, href, created_at)
            values (${randomUUID()}, ${profile.id}, 'new_follower', 'followNew', ${sql.json({ who: "Yosra" })}, '/dashboard/students', now())`;
  await sql`insert into notifications (id, profile_id, kind, title, body, href, created_at)
            values (${randomUUID()}, ${profile.id}, 'new_booking', 'Nouvelle réservation 🎉',
                    'Amine a réservé « Intégrales » (08 oct., 18:00).', '/dashboard', now() - interval '1 hour')`;

  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();
  const panel = page.locator("#aps-bell-panel");
  const keyed = panel.locator("li").filter({ hasText: "Yosra" });
  const legacy = panel.locator("li").filter({ hasText: "Intégrales" });

  await page.goto("/fr/dashboard");
  await page.locator("[data-e2e=shell-bell]").click();
  await expect(keyed).toContainText("Un élève te suit");
  await expect(keyed).toContainText("Yosra te suit : il sera prévenu de tes nouvelles séances et fiches.");
  await expect(keyed.locator("span[lang]").first()).toHaveAttribute("lang", "fr");
  await expect(legacy).toContainText("Amine a réservé « Intégrales »");

  await page.goto("/ar/dashboard");
  await page.locator("[data-e2e=shell-bell]").click();
  await expect(keyed).toContainText("متابع جديد");
  await expect(keyed).toContainText("ولّى يتبع فيك");
  await expect(keyed).not.toContainText("te suit");
  for (const span of await keyed.locator("span[lang]").all()) {
    await expect(span).toHaveAttribute("lang", "ar");
    await expect(span).toHaveAttribute("dir", "rtl");
  }
  // Stored before 0040: French text, set left-to-right inside the Arabic panel.
  await expect(legacy).toContainText("Amine a réservé « Intégrales »");
  for (const span of await legacy.locator("span[lang]").all()) {
    await expect(span).toHaveAttribute("lang", "fr");
    await expect(span).toHaveAttribute("dir", "ltr");
  }
  await ctx.close();
});
