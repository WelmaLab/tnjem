import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";

/* student-space-v1 · C — MES COURS (/student/cours), mockup 2a.

   Tabs À venir · Passées · Annulées with their counts; rows with the status tags
   « Inscrit » / « Passée » / « Annulée par toi » (+ the late note) / « Annulée par le
   prof » — never an attendance tag, never a recording; the detail (right column on a
   computer, /student/cours/<bookingId> on a phone) with « Fiches de la séance », « Ton
   avis » (the review flow, inline), « Réserver la prochaine », Message. The AR past row
   at 390 keeps its title and its tag apart (spec H3). FR + AR, 1440×900 and 390×844.
   ADDED as its own spec. */

const T = {
  fr: { avenir: /À venir · 1/, passees: /Passées · 1/, annulees: /Annulées · 2/, booked: "Inscrit", past: "Passée", byMe: "Annulée par toi", byProf: "Annulée par le prof", late: /Annulation à moins de 48 h : 16 TND/, fiches: "Fiches de la séance", review: "Ton avis", bookNext: "Réserver la prochaine", emptyT: "Aucune séance à venir", emptyCta: "Trouver une séance" },
  ar: { avenir: /الجاية · 1/, passees: /اللي فاتت · 1/, annulees: /الملغية · 2/, booked: "مسجّل", past: "فاتت", byMe: "لغيتها إنتي", byProf: "لغاها الأستاذ", late: /إلغاء في أقل من 48 ساعة : 16 د\.ت/, fiches: "ملفات الحصة", review: "تقييمك", bookNext: "احجز الجاية", emptyT: "ما فمّا حتى حصة جاية", emptyCta: "لقّى حصة" },
} as const;

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function seedWorld() {
  const tutor = await seedTutor({ fullName: "Walid Trabelsi" });
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Ahmed Malek" });
  const upcoming = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, isFreeFirst: false });
  const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -26, isFreeFirst: false }); // still `scheduled` in the table
  await sql`update classes set title = 'testing right now' where id = ${past.id}`;
  const nextOpen = await seedClass({ tutorId: tutor.id, hoursFromNow: 96, isFreeFirst: false });
  const mine = await seedClass({ tutorId: tutor.id, hoursFromNow: 30, isFreeFirst: false });
  const byProf = await seedClass({ tutorId: tutor.id, hoursFromNow: 40, isFreeFirst: false });
  await seedBooking({ classId: upcoming.id, studentId: student.id, isFree: false });
  const pastB = await seedBooking({ classId: past.id, studentId: student.id, isFree: false });
  const mineB = await seedBooking({ classId: mine.id, studentId: student.id, isFree: false, status: "cancelled" });
  const profB = await seedBooking({ classId: byProf.id, studentId: student.id, isFree: false, status: "cancelled" });
  await sql`update classes set status = 'cancelled' where id = ${byProf.id}`;
  await sql`insert into cancellations (booking_id, class_id, actor_profile_id, actor, hours_before_start, late, amount_tnd, retained_tnd, released_tnd, retained_pct)
            values (${mineB.id}, ${mine.id}, ${student.id}, 'student', 20, true, 40, 16, 24, 0.4),
                   (${profB.id}, ${byProf.id}, ${tutor.profileId}, 'tutor', 40, false, 40, 0, 40, 0)`;
  await sql`insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id)
            values (${tutor.id}, ${past.id}, 'youtube', 'students', 'Corrigé — série 3', 'dQw4w9WgXcQ')`;
  return { tutor, student, upcoming, past, pastB, nextOpen, mine, byProf };
}

for (const locale of ["fr", "ar"] as const) {
  test(`Mes cours · ${locale} · desktop: tabs with counts, rows and tags, the detail in the right column`, async ({ browser }) => {
    const w = await seedWorld();
    const t = T[locale];
    const ctx = await contextAs(browser, w.student.id);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}/student/cours`);

    await expect(page.locator("[data-e2e=cours-tab-avenir]")).toHaveText(t.avenir);
    await expect(page.locator("[data-e2e=cours-tab-passees]")).toHaveText(t.passees);
    await expect(page.locator("[data-e2e=cours-tab-annulees]")).toHaveText(t.annulees);
    const up = page.locator("[data-e2e=class-row]");
    await expect(up).toHaveCount(1);
    await expect(up.locator("[data-e2e=class-status]")).toHaveText(t.booked);
    await expect(page.locator("[data-e2e=cours-detail-column] [data-e2e=class-detail]")).toContainText(w.upcoming.title);

    await page.locator("[data-e2e=cours-tab-passees]").click();
    await expect(page).toHaveURL(/tab=passees/);
    const row = page.locator("[data-e2e=class-row]");
    await expect(row).toContainText("testing right now");
    await expect(row.locator("[data-e2e=class-status]")).toHaveText(t.past);
    const detail = page.locator("[data-e2e=cours-detail-column] [data-e2e=class-detail]");
    await expect(detail).toContainText("testing right now");
    await expect(detail).toContainText("Walid T.");
    await expect(detail.locator("[data-e2e=class-fiches]")).toContainText(t.fiches);
    await expect(detail.locator("[data-e2e=fiche]")).toContainText("Corrigé — série 3");
    await expect(detail.locator("[data-e2e=class-review]")).toContainText(t.review);
    await expect(detail.locator("[data-e2e=detail-book-next]")).toHaveText(t.bookNext);
    // The prof's next class with a seat I do not hold: the one I cancelled (30 h) comes before nextOpen (96 h).
    await expect(detail.locator("[data-e2e=detail-book-next]")).toHaveAttribute("href", `/${locale}/checkout?class=${w.mine.id}`);
    await expect(detail.locator("[data-e2e=message-prof]")).toHaveAttribute("href", `/${locale}/messages/with/${w.tutor.id}`);
    await expect(detail.locator("[data-e2e=detail-see-page]")).toHaveAttribute("href", `/${locale}/${w.tutor.slug}`);

    await page.locator("[data-e2e=cours-tab-annulees]").click();
    const cancelled = page.locator("[data-e2e=class-row]");
    await expect(cancelled).toHaveCount(2);
    await expect(page.locator(`[data-e2e=class-row]:has-text("${w.mine.title}")`)).toContainText(t.byMe);
    await expect(page.locator(`[data-e2e=class-row]:has-text("${w.mine.title}")`)).toContainText(t.late);
    await expect(page.locator(`[data-e2e=class-row]:has-text("${w.byProf.title}")`)).toContainText(t.byProf);

    // No attendance, no recording — anywhere on the page.
    await expect(page.locator("main")).not.toContainText(/Enregistrement|Absent|Suivie|التسجيل/);
    await noHorizontalScroll(page);
    await ctx.close();
  });

  test(`Mes cours · ${locale} · phone: a row opens its own page; the past row keeps its title and tag apart (H3)`, async ({ browser }) => {
    const w = await seedWorld();
    const t = T[locale];
    const ctx = await contextAs(browser, w.student.id);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${locale}/student/cours?tab=passees`);
    const row = page.locator("[data-e2e=class-row]");
    await expect(row).toContainText("testing right now");
    await expect(page.locator("[data-e2e=cours-detail-column]")).toHaveCount(0);

    // H3: inside the screen, the title and the tag never overlap, and no play icon / recording line.
    const title = await row.locator(".ssv-row-t").boundingBox();
    const tag = await row.locator("[data-e2e=class-status]").boundingBox();
    expect(title && tag).toBeTruthy();
    const overlap = !(title!.x + title!.width <= tag!.x || tag!.x + tag!.width <= title!.x || title!.y + title!.height <= tag!.y || tag!.y + tag!.height <= title!.y);
    expect(overlap, "title and tag overlap").toBe(false);
    for (const b of [title!, tag!]) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await expect(row.locator("svg.fill")).toHaveCount(0);
    await noHorizontalScroll(page);

    await row.locator("a").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/student/cours/${w.pastB.id}$`));
    const detail = page.locator("[data-e2e=class-detail]");
    await expect(detail).toContainText("testing right now");
    await expect(detail.locator("[data-e2e=fiche]")).toContainText("Corrigé — série 3");
    await expect(detail.locator("[data-e2e=detail-book-next]")).toHaveText(t.bookNext);
    await noHorizontalScroll(page);
    await ctx.close();
  });

  test(`Mes cours · ${locale}: the empty « À venir » has one primary action`, async ({ browser }) => {
    const t = T[locale];
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/student/cours`);
      const empty = page.locator("[data-e2e=shell-empty]");
      await expect(empty).toContainText(t.emptyT);
      await expect(empty.locator(".btn-primary")).toHaveCount(1);
      await expect(empty.getByRole("link", { name: t.emptyCta })).toHaveAttribute("href", `/${locale}/explore`);
      await noHorizontalScroll(page);
    }
    await ctx.close();
  });
}

test("Mes cours: « Ton avis » — the review flow inline, saved, and shown as given", async ({ browser }) => {
  const w = await seedWorld();
  const ctx = await contextAs(browser, w.student.id);
  const page = await ctx.newPage();
  await page.goto("/fr/student/cours?tab=passees");
  const review = page.locator("[data-e2e=cours-detail-column] [data-e2e=class-review]");
  await review.getByRole("button", { name: "4 étoiles" }).click();
  await review.getByLabel(/Un mot pour les autres élèves/).fill("Très clair, merci.");
  await review.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expect(review).toContainText("Merci !");
  await expect(review.getByRole("img", { name: "Ta note : 4 sur 5" })).toBeVisible();
  const [r] = await sql<{ rating: number; text: string }[]>`select rating, text from reviews where class_id = ${w.past.id} and student_id = ${w.student.id}`;
  expect(r).toMatchObject({ rating: 4, text: "Très clair, merci." });
  await ctx.close();
});

test("Mes cours: another student's booking page is a not-found, with a way back", async ({ browser }) => {
  const w = await seedWorld();
  const stranger = await seedProfile({ role: "student", birthYear: 1995 });
  const ctx = await contextAs(browser, stranger.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/student/cours/${w.pastB.id}`);
  await expect(page.locator("[data-e2e=class-detail-missing]")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("testing right now");
  await ctx.close();
});
