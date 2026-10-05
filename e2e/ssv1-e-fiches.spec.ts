import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedFollow, seedProfile, seedTutor } from "./support/seed";
import { mintSession } from "./support/session";
import { API, contextAs, notificationTexts } from "./support/journey";

/* student-space-v1 · E — MES FICHES (/student/fiches), mockup 3a.

   Every fiche the student may open (the file endpoint's own rule), grouped by prof;
   origin (« Séance « … » · date » / « Fiche de sa page ») and type; « Ouvrir » /
   « Regarder »; chips Toutes · Mes séances · Vidéos (no « Prises sur leur page »: no
   such access exists); search by title; « Nouveau » until the page has been seen;
   ?class= narrows to one class; the privacy line; the bell item when the prof adds a
   material to a booked class. FR + AR, 1440×900 and 390×844. ADDED as its own spec. */

const T = {
  fr: { all: /Toutes · 3/, classes: /Mes séances · 2/, videos: /Vidéos · 1/, page: "Fiche de sa page", seance: /Séance « testing right now »/, open: "Ouvrir", watch: "Regarder", note: /privées/, emptyT: "Pas encore de fiche", emptyCta: "Voir mes cours", search: "Chercher une fiche par son titre" },
  ar: { all: /الكل · 3/, classes: /حصصي · 2/, videos: /فيديوات · 1/, page: "ملف من صفحتو", seance: /حصة « testing right now »/, open: "حلّ", watch: "شوف", note: /خاصّة/, emptyT: "ما زال ما فمّا حتى ملف", emptyCta: "شوف حصصي", search: "لوّج على ملف بالعنوان متاعو" },
} as const;

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

async function seedWorld() {
  const walid = await seedTutor({ fullName: "Walid Trabelsi" });
  const sana = await seedTutor({ fullName: "Sana Ben Salah" });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const past = await seedClass({ tutorId: walid.id, hoursFromNow: -26, isFreeFirst: false });
  await sql`update classes set title = 'testing right now' where id = ${past.id}`;
  await seedBooking({ classId: past.id, studentId: student.id, isFree: false });
  await seedFollow(student.id, sana.id);
  await sql`insert into materials (tutor_id, class_id, kind, visibility, title, mime, file_name, storage_path, size_bytes)
            values (${walid.id}, ${past.id}, 'file', 'students', 'Corrigé — série 3', 'application/pdf', 'c.pdf', 'materials/x/c.pdf', 1258291),
                   (${walid.id}, ${past.id}, 'file', 'students', 'Énoncé — intégrales', 'image/png', 'e.png', 'materials/x/e.png', 90000)`;
  await sql`insert into materials (tutor_id, kind, visibility, title, youtube_id)
            values (${sana.id}, 'youtube', 'public', 'Vidéo — circuits RC', 'dQw4w9WgXcQ')`;
  return { walid, sana, student, past };
}

for (const locale of ["fr", "ar"] as const) {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    test(`Mes fiches · ${locale} · ${width}: grouped by prof, chips, search, open/watch, the privacy line`, async ({ browser }) => {
      const w = await seedWorld();
      const t = T[locale];
      const ctx = await contextAs(browser, w.student.id);
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/student/fiches`);

      await expect(page.locator("[data-e2e=fiche-chip-all]")).toHaveText(t.all);
      await expect(page.locator("[data-e2e=fiche-chip-classes]")).toHaveText(t.classes);
      await expect(page.locator("[data-e2e=fiche-chip-videos]")).toHaveText(t.videos);
      await expect(page.locator("[data-e2e=fiche-chips] button")).toHaveCount(3);
      await expect(page.locator("main")).not.toContainText(/Prises sur leur page/);
      await expect(page.locator("[data-e2e=fiche-group]")).toHaveCount(2);
      const walid = page.locator(`[data-e2e=fiche-group][data-tutor-id="${w.walid.id}"]`);
      await expect(walid).toContainText("Walid T.");
      await expect(walid).not.toContainText("Trabelsi");
      const corrige = walid.locator("[data-e2e=fiche]", { hasText: "Corrigé — série 3" });
      await expect(corrige).toContainText(t.seance);
      await expect(corrige.locator("[data-e2e=fiche-open]")).toHaveText(t.open);
      await expect(corrige.locator("[data-e2e=fiche-open]")).toHaveAttribute("href", /^\/api\/material\//);
      const video = page.locator("[data-e2e=fiche]", { hasText: "Vidéo — circuits RC" });
      await expect(video).toContainText(t.page);
      await expect(video.locator("[data-e2e=fiche-watch]")).toHaveText(t.watch);
      await expect(page.locator("[data-e2e=fiche-note]")).toContainText(t.note);

      // Chips and search.
      await page.locator("[data-e2e=fiche-chip-videos]").click();
      await expect(page.locator("[data-e2e=fiche]")).toHaveCount(1);
      await page.locator("[data-e2e=fiche-chip-all]").click();
      await page.getByLabel(t.search).fill("enonce");
      await expect(page.locator("[data-e2e=fiche]")).toHaveCount(1);
      await expect(page.locator("[data-e2e=fiche]")).toContainText("Énoncé — intégrales");
      await noHorizontalScroll(page);
      await ctx.close();
    });
  }

  test(`Mes fiches · ${locale}: nothing yet → one primary action`, async ({ browser }) => {
    const t = T[locale];
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/student/fiches`);
      const empty = page.locator("[data-e2e=shell-empty]");
      await expect(empty).toContainText(t.emptyT);
      await expect(empty.locator(".btn-primary")).toHaveCount(1);
      await expect(empty.getByRole("link", { name: t.emptyCta })).toHaveAttribute("href", `/${locale}/student/cours`);
      await noHorizontalScroll(page);
    }
    await ctx.close();
  });
}

test("Mes fiches: the prof adds a fiche to my class → a bell item, « Nouveau » once, then seen; ?class= narrows to that class", async ({ browser }) => {
  const w = await seedWorld();
  // Everything seeded so far is already seen.
  await sql`update profiles set last_seen_fiches_at = now() where id = ${w.student.id}`;
  await new Promise((r) => setTimeout(r, 30));

  // The prof (the seeded tutor row, given an account) adds a video to the class, through the real endpoint.
  const prof = await seedProfile({ role: "tutor", birthYear: 1985 });
  await sql`update tutors set profile_id = ${prof.id} where id = ${w.walid.id}`;
  const form = new FormData();
  form.set("title", "Vidéo — la primitive");
  form.set("classId", w.past.id);
  form.set("youtubeUrl", "https://youtu.be/dQw4w9WgXcQ");
  const res = await fetch(`${API}/materials`, { method: "POST", body: form, headers: { cookie: `tnajem_session=${await mintSession(prof.id)}` } });
  expect(await res.json()).toMatchObject({ ok: true });

  const bell = await notificationTexts(w.student.id, "material_added");
  expect(bell).toHaveLength(1);
  expect(bell[0].title).toBe("Nouvelle vidéo pour ta séance");
  expect(bell[0].body).toContain("« Vidéo — la primitive »");
  const ar = await notificationTexts(w.student.id, "material_added", "ar");
  expect(ar[0].title).toBe("فيديو جديد لحصّتك");

  const ctx = await contextAs(browser, w.student.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/student/fiches?class=${w.past.id}`);
  await expect(page.locator("[data-e2e=fiche-class-filter]")).toContainText("testing right now");
  await expect(page.locator("[data-e2e=fiche]")).toHaveCount(3, { timeout: 10_000 }); // the class's two files + the new video; not Sana's
  const fresh = page.locator("[data-e2e=fiche]", { hasText: "Vidéo — la primitive" });
  await expect(fresh).toHaveAttribute("data-new", "true");
  await expect(fresh.locator("[data-e2e=fiche-new]")).toBeVisible();
  await expect(page.locator("[data-e2e=fiche][data-new=true]")).toHaveCount(1);
  // Seen: the badge is back to 0 and the dot is gone on the next visit.
  await expect.poll(async () => (await sql<{ at: Date | null }[]>`select last_seen_fiches_at at from profiles where id = ${w.student.id}`)[0].at?.getTime() ?? 0).toBeGreaterThan(Date.now() - 60_000);
  await page.reload();
  await expect(page.locator("[data-e2e=fiche]", { hasText: "Vidéo — la primitive" })).toHaveAttribute("data-new", "false");
  await ctx.close();
});
