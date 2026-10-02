import { test, expect } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* live-fixes-1 · F — Réglages.

   F1  Notifications: one line of intro; the e-mails a tutor never receives today
       (Messages, Abonnés — no tutor e-mail is built for them) say « Bientôt » and
       their switch is disabled; Réservations and Rappels keep working switches.
   F2  Vitrine: name, subject and levels edited in place (no more « Modifier le reste
       de ma page » link), through the SAME POST /tutors as onboarding — its checks,
       its contact rule, and a verified tutor's rename still goes to review.
   F3  Compte: the name capitalised and the phone grouped (C2). */

async function tutor(status: "draft" | "verified", fullName = "Sonia Gharbi") {
  const me = await seedProfile({ role: "tutor", birthYear: 1985, fullName, phone: `+2169${String(Date.now()).slice(-7)}` });
  const t = await seedTutor({ profileId: me.id, status, fullName });
  await sql`update tutors set subject = 'math', levels = '{bac}' where id = ${t.id}`;
  return { me, t };
}

test.describe("F1 · Notifications", () => {
  for (const [loc, lead, soon] of [
    ["fr", "Choisis les e-mails que tu reçois. La cloche reste toujours active.", "Bientôt"],
    ["ar", "اختار الإيمايلات اللي توصلك. الجرس يقعد ديما خدّام.", "قريب"],
  ] as const) {
    test(`one-line intro; « ${soon} » and disabled for Messages and Abonnés (${loc})`, async ({ browser }) => {
      const { me } = await tutor("verified");
      const ctx = await contextAs(browser, me.id);
      const page = await ctx.newPage();
      await page.goto(`/${loc}/dashboard/settings?tab=notifications`, { waitUntil: "networkidle" });
      const panel = page.locator("[data-e2e=settings-notifications]");
      await expect(panel.locator("p").first()).toHaveText(lead);
      await expect(panel.locator(".st-row-b")).toHaveCount(5); // the intro + one line per row, nothing else
      for (const k of ["messages", "followers"]) {
        const row = page.locator(`[data-e2e=pref-${k}]`);
        await expect(row.locator(".tag-soon")).toHaveText(soon);
        await expect(row.getByRole("switch")).toBeDisabled();
      }
      for (const k of ["bookings", "reminders"]) {
        const row = page.locator(`[data-e2e=pref-${k}]`);
        await expect(row.locator(".tag-soon")).toHaveCount(0);
        await expect(row.getByRole("switch")).toBeEnabled();
      }
      // A disabled switch changes nothing, even when forced.
      await page.locator("[data-e2e=pref-messages]").getByRole("switch").click({ force: true });
      await page.waitForTimeout(400);
      const rows = await sql`select 1 from notification_prefs where profile_id = ${me.id} and messages = false`;
      expect(rows.length).toBe(0);
      await ctx.close();
    });
  }
});

test.describe("F2 · Vitrine: name, subject, levels in place", () => {
  test("prefilled; saved through POST /tutors; the link to onboarding is gone", async ({ browser }) => {
    const { me, t } = await tutor("draft");
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    await expect(page.getByRole("link", { name: /Modifier le reste de ma page/ })).toHaveCount(0);
    const name = page.locator("[data-e2e=settings-name]");
    const subject = page.locator("[data-e2e=settings-subject]");
    await expect(name).toHaveValue("Sonia Gharbi");
    await expect(subject).toHaveValue("Maths"); // C2: the label of the stored code, never « math »
    await expect(page.locator("[data-e2e=settings-levels] [data-level=bac]")).toHaveAttribute("aria-pressed", "true");
    const save = page.locator("[data-e2e=settings-page-save]");
    await expect(save).toBeDisabled(); // nothing changed yet

    await subject.fill("Physique-chimie");
    await page.locator("[data-e2e=settings-levels] [data-level=secondaire]").click();
    await name.fill("Sonia B. Gharbi");
    await save.click();
    await expect(page.locator(".toast")).toHaveText("Ta page est enregistrée.");
    await expect
      .poll(async () => (await sql<{ subject: string; levels: string[]; full_name: string }[]>`
        select subject, levels, full_name from tutors where id = ${t.id}`)[0])
      .toEqual({ subject: "Physique-chimie", levels: ["secondaire", "bac"], full_name: "Sonia B. Gharbi" });
    await ctx.close();
  });

  test("a stored code shows as its label (FR + AR); saving another field keeps the code", async ({ browser }) => {
    const { me, t } = await tutor("draft");
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=settings-subject]")).toHaveValue("رياضيات");
    await page.goto("/fr/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=settings-subject]")).toHaveValue("Maths");
    const bio = `Méthode et annales ${Date.now().toString(36)}`;
    await page.locator("[data-e2e=settings-bio]").fill(bio);
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator(".toast")).toHaveText("Ta page est enregistrée.");
    await expect
      .poll(async () => (await sql<{ subject: string; bio: string }[]>`select subject, bio from tutors where id = ${t.id}`)[0])
      .toEqual({ subject: "math", bio });
    // Saved, nothing left to save: the field still reads the label and matches the page.
    await expect(page.locator("[data-e2e=settings-subject]")).toHaveValue("Maths");
    await expect(page.locator("[data-e2e=settings-page-save]")).toBeDisabled();
    await ctx.close();
  });

  test("the same checks as onboarding: a name of 2 letters, a subject, no contact info (FR + AR)", async ({ browser }) => {
    const { me, t } = await tutor("draft");
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    const name = page.locator("[data-e2e=settings-name]");
    await name.fill("S");
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator("[data-e2e=settings-page-form] [role=alert]")).toHaveText("Écris ton nom (2 caractères minimum).");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");

    await name.fill("Sonia Gharbi");
    await page.locator("[data-e2e=settings-subject]").fill("");
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator("[data-e2e=settings-page-form] [role=alert]")).toHaveText("Écris ta matière.");

    // The API's rule (the contact guard), not the page's.
    await page.locator("[data-e2e=settings-subject]").fill("Maths — WhatsApp 22123456");
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator("[data-e2e=settings-page-error]")).toContainText("les coordonnées ne sont pas autorisées");
    const [row] = await sql<{ subject: string }[]>`select subject from tutors where id = ${t.id}`;
    expect(row.subject).toBe("math");

    await page.goto("/ar/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=settings-name]").fill("س");
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator("[data-e2e=settings-page-form] [role=alert]")).toHaveText("اكتب اسمك (حرفين على الأقل).");
    await ctx.close();
  });

  test("a verified tutor's new name waits for review, and the page says so", async ({ browser }) => {
    const { me, t } = await tutor("verified");
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=vitrine", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=settings-page-form]")).toContainText("un nouveau nom est relu par l'équipe");
    await page.locator("[data-e2e=settings-name]").fill("Sonia Ben Gharbi");
    await page.locator("[data-e2e=settings-page-save]").click();
    await expect(page.locator(".toast")).toHaveText("Enregistré. Ton nouveau nom apparaîtra après la relecture de l'équipe.");
    await expect
      .poll(async () => (await sql<{ full_name: string; pending_full_name: string | null }[]>`
        select full_name, pending_full_name from tutors where id = ${t.id}`)[0])
      .toEqual({ full_name: "Sonia Gharbi", pending_full_name: "Sonia Ben Gharbi" });
    await ctx.close();
  });
});

test.describe("F3 · Compte", () => {
  test("the name capitalised, the phone grouped (FR + AR); stored as typed", async ({ browser }) => {
    const { me } = await tutor("verified", "sonia gharbi");
    const [{ phone }] = await sql<{ phone: string }[]>`select phone from profiles where id = ${me.id}`;
    const d = phone.slice(4);
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    for (const loc of ["fr", "ar"] as const) {
      await page.goto(`/${loc}/dashboard/settings?tab=compte`, { waitUntil: "networkidle" });
      await expect(page.locator(".st-id-name")).toHaveText("Sonia Gharbi");
      await expect(page.locator(".st-id-contact")).toContainText(`+216 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`);
    }
    const [p] = await sql<{ full_name: string }[]>`select full_name from profiles where id = ${me.id}`;
    expect(p.full_name).toBe("sonia gharbi");
    await ctx.close();
  });
});
