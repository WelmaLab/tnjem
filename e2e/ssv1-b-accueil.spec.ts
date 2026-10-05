import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedFollow, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";

/* student-space-v1 · B — ACCUEIL (/student), mockup 1.

   The next-class hero (countdown, « Rejoindre le direct » → /live/<id>, « Fiches (n) »
   → that class's fiches, Message → /messages/with/<tutorId>, Calendrier (.ics),
   « Annuler ma place » behind « ⋯ »), « Cette semaine » (my other seats + the open
   classes of followed profs with « Réserver · prix »), « Mes profs », « Nouvelles
   fiches », and the nothing-at-all state (« Trouve ton premier prof » + suggested
   profs). FR + AR, 1440×900 and 390×844; no horizontal scroll; a tutor is sent to
   /dashboard. ADDED as its own spec. */

const SIZES = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

const T = {
  fr: { hello: "Salut", join: "Rejoindre le direct", fiches: /Fiches \(1\)/, cancel: "Annuler ma place", yes: "Oui, annuler", week: "Cette semaine", profs: "Mes profs", newFiches: "Nouvelles fiches", book: /Réserver · 40 TND/, booked: "Inscrit", first: "Trouve ton premier prof", explore: "Explorer les profs", flash: /Réservation annulée/ },
  ar: { hello: "أهلا", join: "ادخل للدايركت", fiches: /الملفات \(1\)/, cancel: "ألغي مكاني", yes: "إيه، ألغي", week: "الجمعة هاذي", profs: "أساتذتي", newFiches: "ملفات جديدة", book: /احجز · 40 د\.ت/, booked: "مسجّل", first: "لقّى أول أستاذ متاعك", explore: "اكتشف الأساتذة", flash: /الحجز تلغى/ },
} as const;

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "no horizontal scroll").toBeLessThanOrEqual(1);
}

async function seedWorld() {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "Walid Trabelsi" });
  const other = await seedTutor({ fullName: "Sana Ben Salah" });
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Ahmed Malek" });
  const next = await seedClass({ tutorId: tutor.id, hoursFromNow: 9, isFreeFirst: false });
  const later = await seedClass({ tutorId: tutor.id, hoursFromNow: 50, isFreeFirst: false });
  await seedBooking({ classId: next.id, studentId: student.id, isFree: false });
  await seedBooking({ classId: later.id, studentId: student.id, isFree: false });
  await seedFollow(student.id, other.id);
  const open = await seedClass({ tutorId: other.id, hoursFromNow: 80, isFreeFirst: false, priceTnd: 40 });
  const [m] = await sql<{ id: string }[]>`
    insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id)
    values (${tutor.id}, ${next.id}, 'youtube', 'students', 'Vidéo — intégrales', 'dQw4w9WgXcQ') returning id`;
  return { tutor, other, student, next, later, open, materialId: m.id, tutorProfile };
}

for (const locale of ["fr", "ar"] as const) {
  for (const size of SIZES) {
    test(`Accueil · ${locale} · ${size.name}: the hero, this week, my profs, new fiches`, async ({ browser }) => {
      const w = await seedWorld();
      const t = T[locale];
      const ctx = await contextAs(browser, w.student.id);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/${locale}/student`);

      await expect(page.locator("h1")).toContainText(t.hello);
      await expect(page.locator("h1")).toContainText("Ahmed");
      const hero = page.locator("[data-e2e=next-class]");
      await expect(hero).toContainText(w.next.title);
      await expect(hero).toContainText("Walid T.");
      await expect(hero).not.toContainText("Trabelsi");
      await expect(hero.locator("[data-e2e=countdown]")).toBeVisible();
      await expect(hero.getByRole("link", { name: t.join })).toHaveAttribute("href", `/${locale}/live/${w.next.id}`);
      await expect(hero.locator("[data-e2e=next-class-fiches]")).toHaveText(t.fiches);
      await expect(hero.locator("[data-e2e=next-class-fiches]")).toHaveAttribute("href", `/${locale}/student/fiches?class=${w.next.id}`);
      await expect(hero.locator("[data-e2e=message-prof]")).toHaveAttribute("href", `/${locale}/messages/with/${w.tutor.id}`);
      await expect(hero.locator("[data-e2e=add-to-calendar]")).toHaveAttribute("href", new RegExp(`/api/calendar/`));

      // « Annuler ma place » is behind « ⋯ », not on the hero.
      await expect(hero.getByRole("button", { name: t.cancel })).toBeHidden();
      await hero.locator("[data-e2e=seat-menu]").click();
      await expect(hero.getByRole("button", { name: t.cancel })).toBeVisible();
      await page.keyboard.press("Escape");

      const week = page.locator("[data-e2e=home-week]");
      await expect(week).toContainText(t.week);
      await expect(week.locator("[data-e2e=week-booked]")).toContainText(w.later.title);
      await expect(week.locator("[data-e2e=week-booked]")).toContainText(t.booked);
      await expect(week.locator("[data-e2e=week-open]")).toContainText(w.open.title);
      await expect(week.locator("[data-e2e=week-book]")).toHaveText(t.book);
      await expect(week.locator("[data-e2e=week-book]")).toHaveAttribute("href", `/${locale}/checkout?class=${w.open.id}`);

      const profs = page.locator("[data-e2e=home-profs]");
      await expect(profs).toContainText(t.profs);
      await expect(profs.locator("[data-e2e=home-prof]")).toHaveCount(2);
      await expect(profs).toContainText("Sana B.");
      const fiches = page.locator("[data-e2e=home-fiches]");
      await expect(fiches).toContainText(t.newFiches);
      await expect(fiches.locator("[data-e2e=home-fiche]")).toContainText("Vidéo — intégrales");

      // No fake recording anywhere on the page.
      await expect(page.locator("main")).not.toContainText(/Enregistrement|التسجيل ما زال/);
      await noHorizontalScroll(page);
      await ctx.close();
    });
  }

  test(`Accueil · ${locale}: nothing at all → « Trouve ton premier prof » + suggested verified profs`, async ({ browser }) => {
    const t = T[locale];
    const match = await seedTutor({ fullName: "Nadia Gharbi" });
    await sql`update tutors set subject = 'physique', levels = '{bac}' where id = ${match.id}`;
    const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Youssef Amri" });
    await sql`update profiles set level = 'bac', subjects = 'physique' where id = ${student.id}`;
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(`/${locale}/student`);
      const empty = page.locator("[data-e2e=home-nothing]");
      await expect(empty).toContainText(t.first);
      // ONE primary action: Explore.
      await expect(empty.locator(".btn-primary")).toHaveCount(1);
      await expect(empty.getByRole("link", { name: t.explore })).toHaveAttribute("href", `/${locale}/explore`);
      const sug = page.locator("[data-e2e=suggestions]");
      await expect(sug).toHaveAttribute("data-matched", "true");
      await expect(sug.locator("[data-e2e=suggested-prof]").first()).toContainText("Nadia G.");
      await noHorizontalScroll(page);
    }
    await ctx.close();
  });
}

test("Accueil: « Annuler ma place » from « ⋯ » cancels the seat, says what was retained, and the next class takes its place", async ({ browser }) => {
  const w = await seedWorld();
  const ctx = await contextAs(browser, w.student.id);
  const page = await ctx.newPage();
  await page.goto("/fr/student");
  const hero = page.locator("[data-e2e=next-class]");
  await expect(hero).toContainText(w.next.title);
  await hero.locator("[data-e2e=seat-menu]").click();
  await hero.getByRole("button", { name: T.fr.cancel }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toContainText("Annuler cette réservation ?");
  await dialog.getByRole("button", { name: T.fr.yes }).click();
  await expect(page.locator("[data-e2e=cancel-flash]")).toContainText(T.fr.flash);
  await expect(hero).toContainText(w.later.title);
  const [b] = await sql<{ status: string }[]>`select status from bookings where class_id = ${w.next.id} and student_id = ${w.student.id}`;
  expect(b.status).toBe("cancelled");
  await ctx.close();
});

test("Accueil: a prof opening /student is sent to their dashboard", async ({ browser }) => {
  const w = await seedWorld();
  const ctx = await contextAs(browser, w.tutorProfile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/student");
  await expect(page).toHaveURL(/\/fr\/dashboard/);
  await ctx.close();
});
