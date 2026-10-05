import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedFollow, seedOffer, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";

/* student-space-v1 · D — MES PROFS (/student/profs), mockup 2b.

   The union of followed and had-a-class profs; cards with Vérifié, subject + levels,
   the next class, « n séances passées · n fiches · n nouvelles »; Réserver · Message ·
   « Suivi ✓ » (unfollow after a confirmation); the dashed « Un autre prof ? » → Explore;
   « Abonnements mensuels » only with a student_subscriptions row. The follow label is
   « Suivre » / « Suivi ✓ » (AR « تابع » / « تتابع ✓ »), never « Abonné ». FR + AR,
   1440×900 and 390×844. ADDED as its own spec. */

const T = {
  fr: { following: "Suivi ✓", follow: "Suivre", other: "Un autre prof ?", subs: "Abonnements mensuels", active: "Actif", taken: /1 séance passée/, emptyT: "Pas encore de prof", find: "Trouver un prof", confirm: "Ne plus suivre" },
  ar: { following: "تتابع ✓", follow: "تابع", other: "أستاذ آخر ؟", subs: "الاشتراكات الشهرية", active: "خدّام", taken: /حصة فاتت/, emptyT: "ما زال ما عندكش أستاذ", find: "لقّى أستاذ", confirm: "ما عادش نتابع" },
} as const;

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function seedWorld() {
  const walid = await seedTutor({ fullName: "Walid Trabelsi" });
  await sql`update tutors set subject = 'math', levels = '{bac,universite}' where id = ${walid.id}`;
  const sana = await seedTutor({ fullName: "Sana Ben Salah" });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const past = await seedClass({ tutorId: walid.id, hoursFromNow: -30, isFreeFirst: false });
  await seedBooking({ classId: past.id, studentId: student.id, isFree: false });
  const next = await seedClass({ tutorId: walid.id, hoursFromNow: 50, isFreeFirst: false });
  await seedFollow(student.id, sana.id);
  const offer = await seedOffer({ tutorId: walid.id, title: "Pack Bac maths", sessionsPerMonth: 8, priceTnd: 160 });
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end)
            values (${offer.id}, ${walid.id}, ${student.id}, 'active', 8, 160, now() - interval '2 days', now() + interval '28 days')`;
  return { walid, sana, student, next };
}

for (const locale of ["fr", "ar"] as const) {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`Mes profs · ${locale} · ${width}: followed ∪ had-a-class, the cards, « Un autre prof ? », the subscriptions`, async ({ browser }) => {
      const w = await seedWorld();
      const t = T[locale];
      const ctx = await contextAs(browser, w.student.id);
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/student/profs`);

      const cards = page.locator("[data-e2e=prof-card]");
      await expect(cards).toHaveCount(2);
      const walid = page.locator(`[data-e2e=prof-card][data-tutor-id="${w.walid.id}"]`);
      await expect(walid).toContainText("Walid T.");
      await expect(walid).not.toContainText("Trabelsi");
      await expect(walid.locator("[data-e2e=prof-counts]")).toContainText(t.taken);
      await expect(walid.locator("[data-e2e=prof-book]")).toHaveAttribute("href", `/${locale}/checkout?class=${w.next.id}`);
      await expect(walid.locator("[data-e2e=message-prof]")).toHaveAttribute("href", `/${locale}/messages/with/${w.walid.id}`);
      await expect(walid.locator("[data-e2e=follow-button]")).toHaveText(t.follow, { timeout: 10_000 });
      const sana = page.locator(`[data-e2e=prof-card][data-tutor-id="${w.sana.id}"]`);
      await expect(sana.locator("[data-e2e=follow-button]")).toHaveText(t.following, { timeout: 10_000 });
      await expect(page.locator("[data-e2e=prof-other]")).toContainText(t.other);
      await expect(page.locator("[data-e2e=prof-other] a")).toHaveAttribute("href", `/${locale}/explore`);
      const subs = page.locator("[data-e2e=subscriptions]");
      await expect(subs).toContainText(t.subs);
      await expect(subs).toContainText("Pack Bac maths");
      await expect(subs.locator("[data-e2e=subscription-status]")).toHaveText(t.active);
      await expect(page.locator("main")).not.toContainText(/Abonné\b|متابِع|Suivie/);
      await noHorizontalScroll(page);
      await ctx.close();
    });
  }

  test(`Mes profs · ${locale}: nobody yet → one primary action; no subscriptions section without a row`, async ({ browser }) => {
    const t = T[locale];
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/student/profs`);
      const empty = page.locator("[data-e2e=shell-empty]");
      await expect(empty).toContainText(t.emptyT);
      await expect(page.locator("main .btn-primary")).toHaveCount(1);
      await expect(empty.getByRole("link", { name: t.find })).toHaveAttribute("href", `/${locale}/explore`);
      await expect(page.locator("[data-e2e=subscriptions]")).toHaveCount(0);
      await noHorizontalScroll(page);
    }
    await ctx.close();
  });
}

test("Mes profs: « Suivi ✓ » asks first, then unfollows — the followed-only prof leaves the list", async ({ browser }) => {
  const w = await seedWorld();
  const ctx = await contextAs(browser, w.student.id);
  const page = await ctx.newPage();
  await page.goto("/fr/student/profs");
  const sana = page.locator(`[data-e2e=prof-card][data-tutor-id="${w.sana.id}"]`);
  const btn = sana.locator("[data-e2e=follow-button]");
  await expect(btn).toHaveText("Suivi ✓", { timeout: 10_000 });
  await btn.click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("Ne plus suivre Sana B. ?");
  await dialog.getByRole("button", { name: "Garder" }).click();
  await expect(btn).toHaveText("Suivi ✓");
  await btn.click();
  await page.locator("dialog[open]").getByRole("button", { name: T.fr.confirm }).click();
  await expect(sana).toHaveCount(0);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from tutor_follows where student_profile_id = ${w.student.id} and tutor_id = ${w.sana.id}`;
  expect(n).toBe(0);
  await ctx.close();
});
