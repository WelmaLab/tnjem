import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { seedPassword, seedProfile, seedTutor, seedClass } from "./support/seed";
import { loginAs } from "./support/session";
import { loginWithPasswordUi } from "./support/password-ui";
import { resetRateLimits } from "./support/otp";
import { API } from "./support/journey";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   student-space-v1 · I — ONE STUDENT, THE WHOLE STUDENT SPACE, THROUGH THE REAL UI.

   The four lanes (shell, pages, messages, fixes) were built without each other's
   code; this is the joined product, walked by one student (and their prof):

     6a · signed in with a password on /auth, nothing yet: Accueil suggests the
          newest verified profs; the student sets level + subjects on Profil › Moi
          → « Profs pour toi » changes to the matching prof;
     1 · « Suivre » on the prof's page, then the class row → the class page →
         « Réserver cette séance » → the checkout → « Confirmer ma place »;
     2 · the class is the Accueil hero and in Mes cours › À venir (and the shell's
         « Mes cours » badge says 1); « Profs pour toi » is still at the bottom of
         Accueil, without the prof the student now follows; Mes fiches is still
         empty — that visit is the « last seen » the next fiche is new against;
     3 · the prof adds a file to that class through « Mes fiches » (the library
         form, the class picked in the shell's Select) → the student's shell shows
         the fiches badge, Mes fiches shows it with « Nouveau », and so does the
         class detail; once seen, the badge is gone;
     4 · « Message » on the class detail → the merged conversation → a message;
         the student's /messages has ONE entry for that prof, the prof's /messages
         ONE entry for that student (« Mehdi J. »), and the prof's reply lands in
         the same conversation;
     5 · the class ends (its start moved into the past in the DB, like
         past-class.spec.ts): GET /classes/:id already says `done` while the row
         still says `scheduled`; Mes cours › Passées has it, « Passée », with the
         review form; /cron/reminders then writes `done`; the booking keeps its
         status (no attendance is ever recorded);
     6b · the profile edit stuck; a second edit (physique → SVT) on a student who
          now has a prof, a class and fiches changes « Profs pour toi » again.

   FR at 1440×900, AR at 390×844 (the phone: the class detail is its own page; the
   fiches badge lives in the sidebar, checked at 1440 for a moment). ADDED as its
   own spec. */

const HOST = new URL(BASE_URL).hostname;
const DESKTOP = { width: 1440, height: 900 };

const T = {
  fr: {
    follow: "Suivre",
    following: "Suivi ✓",
    book: "Réserver cette séance",
    confirm: "Confirmer ma place",
    booked: "C'est réservé !",
    tag: "Inscrit",
    past: "Passée",
    review: "Ton avis",
    star: "4 étoiles",
    saved: "Ton profil est enregistré.",
    send: "Envoyer",
    marker: "Séance «",
    emptyFiches: "Pas encore de fiche",
  },
  ar: {
    follow: "تابع",
    following: "تتابع ✓",
    book: "احجز الحصة هاذي",
    confirm: "أكّد مكاني",
    booked: "حجزت بلاصتك!",
    tag: "مسجّل",
    past: "فاتت",
    review: "تقييمك",
    star: "4 نجوم",
    saved: "البروفايل متاعك تسجّل.",
    send: "ابعث",
    marker: "حصة «",
    emptyFiches: "ما زال ما فمّا حتى ملف",
  },
} as const;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** Letters only: the public name keeps the letters of the first name (« Nadiaxq G. »). */
const letters = (n: number) => [...randomBytes(n)].map((b) => String.fromCharCode(97 + (b % 26))).join("");

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "no horizontal scroll").toBeLessThanOrEqual(1);
}

async function profContext(browser: Browser, profileId: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

for (const run of [
  { loc: "fr" as const, vp: { width: 1440, height: 900 } },
  { loc: "ar" as const, vp: { width: 390, height: 844 } },
]) {
  const { loc, vp } = run;
  const L = T[loc];
  const phone = vp.width < 900;

  test(`I · ${loc} ${vp.width}×${vp.height}: one student — suggestions, follow, book, Accueil + Mes cours, a new fiche, one conversation, done + review`, async ({ browser }) => {
    test.setTimeout(300_000);
    await resetRateLimits();

    // The prof who matches level + subjects — created FIRST, so the « newest verified » list does not hold them.
    const matchFirst = `Nadia${letters(5)}`;
    const match = await seedTutor({ fullName: `${matchFirst} Gharbi` });
    await sql`update tutors set subject = 'physique', levels = '{bac}' where id = ${match.id}`;

    // The journey's prof, and two newer verified profs: the newest three before the profile says anything.
    const profProfile = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Walid Tester" });
    const tutor = await seedTutor({ profileId: profProfile.id, status: "verified", fullName: "Walid Tester" });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, isFreeFirst: false, priceTnd: 20, seats: 8 });
    await seedTutor({ fullName: `Karim${letters(4)} Ayari` });
    await seedTutor({ fullName: `Sonia${letters(4)} Mrad` });

    const student = await seedProfile({ role: "student", birthYear: 1996, fullName: "Mehdi Jaziri" });
    const password = `Tnajem-journey-${letters(6)}`;
    await seedPassword(student.id, password);

    const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
    const s = await ctx.newPage();
    const prof = await profContext(browser, profProfile.id, vp);
    const p = await prof.newPage();
    let bookingId = "";
    const ficheTitle = loc === "fr" ? "Corrigé — série 1" : "تصحيح — السلسلة 1";
    const msg = loc === "fr" ? "Bonjour, l'exercice 2 de la série, je bloque sur la dérivée." : "عسلامة، التمرين 2 ما فهمتوش.";
    const reply = loc === "fr" ? "On le reprend ensemble jeudi." : "نعاودوه مع بعضنا نهار الخميس.";

    try {
      await test.step("sign in through /auth with the password: the student space", async () => {
        await loginWithPasswordUi(s, student.email, password, loc);
        await s.goto(`/${loc}/student`);
        await expect(s.locator("[data-e2e=student-shell]")).toBeVisible();
        await expect(s.locator("h1")).toContainText("Mehdi");
      });

      await test.step("6a · nothing yet: the newest verified profs; Profil › Moi (bac + physique) → the matching prof first", async () => {
        const sug = s.locator("[data-e2e=suggestions]");
        await expect(s.locator("[data-e2e=home-nothing]")).toBeVisible();
        await expect(sug).toHaveAttribute("data-matched", "false");
        await expect(sug.locator(`a[href="/${loc}/${match.slug}"]`), "not among the newest three").toHaveCount(0);

        await s.goto(`/${loc}/account?tab=moi`);
        await s.locator('[data-e2e=moi-levels] [data-level="bac"]').click();
        await s.locator('[data-e2e=moi-subjects] [data-subject="physique"]').click();
        await expect(s.locator('[data-e2e=moi-subjects] [data-subject="physique"]')).toHaveAttribute("aria-pressed", "true");
        await s.locator("[data-e2e=moi-save]").click();
        await expect(s.locator(".toast")).toHaveText(L.saved);
        await expect
          .poll(async () => (await sql<{ level: string | null; subjects: string | null }[]>`select level, subjects from profiles where id = ${student.id}`)[0])
          .toEqual({ level: "bac", subjects: "physique" });

        await s.goto(`/${loc}/student`);
        await expect(sug).toHaveAttribute("data-matched", "true");
        await expect(sug.locator("[data-e2e=suggested-prof]").first()).toContainText(`${matchFirst[0].toUpperCase()}${matchFirst.slice(1)} G.`);
        await expect(sug.locator("[data-e2e=suggested-prof]").first().locator("a")).toHaveAttribute("href", `/${loc}/${match.slug}`);
        await noHorizontalScroll(s);
      });

      await test.step("1 · « Suivre » on the prof's page, then the class → checkout → « Confirmer ma place »", async () => {
        await s.goto(`/${loc}/${tutor.slug}`, { waitUntil: "networkidle" });
        const follow = s.locator("[data-e2e=follow-button]").filter({ visible: true }).first();
        await expect(follow).toHaveText(L.follow, { timeout: 15_000 });
        await follow.click();
        await expect(follow).toHaveText(L.following);
        await expect
          .poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from tutor_follows where student_profile_id = ${student.id} and tutor_id = ${tutor.id}`)[0].n)
          .toBe(1);

        await s.locator(`a.sf-row[href="/${loc}/class/${klass.id}"]`).filter({ visible: true }).first().click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/class/${klass.id}$`));
        const book = s.getByRole("link", { name: L.book }).filter({ visible: true }).first();
        await expect(book).toBeVisible({ timeout: 20_000 });
        await book.click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/checkout\\?class=${klass.id}$`));
        await s.getByRole("button", { name: L.confirm }).click({ timeout: 20_000 });
        await expect(s.locator("[data-e2e=checkout-success-title]")).toHaveText(L.booked, { timeout: 20_000 });
        const [b] = await sql<{ id: string; status: string }[]>`select id, status from bookings where class_id = ${klass.id} and student_id = ${student.id}`;
        expect(b.status).toBe("reserved");
        bookingId = b.id;

        // Back on the class page: the booked panel, never « Réserver » again (H1, under the auth-aware header).
        await s.goto(`/${loc}/class/${klass.id}`, { waitUntil: "networkidle" });
        await expect(s.locator("[data-e2e=booked-panel]").filter({ visible: true })).toHaveCount(1);
        await expect(s.locator(`a[href*="/checkout?class=${klass.id}"]`).filter({ visible: true })).toHaveCount(0);
      });

      await test.step("2 · Accueil's hero and Mes cours › À venir; the « Mes cours » badge; Mes fiches still empty", async () => {
        await s.goto(`/${loc}/student`);
        const hero = s.locator("[data-e2e=next-class]");
        await expect(hero).toContainText(klass.title);
        await expect(hero).toContainText("Walid T.");
        await expect(hero).not.toContainText("Tester");
        // « Profs pour toi » stays (follow-up 1): matched on the profile, never the prof now followed.
        const forYou = s.locator("[data-e2e=home-for-you] [data-e2e=suggestions]");
        await expect(forYou).toHaveAttribute("data-matched", "true");
        await expect(forYou.locator("[data-e2e=suggested-prof]").first().locator("a")).toHaveAttribute("href", `/${loc}/${match.slug}`);
        await expect(forYou.locator(`a[href="/${loc}/${tutor.slug}"]`), "never a followed prof").toHaveCount(0);
        await noHorizontalScroll(s);

        await s.locator(phone ? "[data-e2e=tab-courses]" : "[data-e2e=nav-courses]").click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/student/cours$`));
        const row = s.locator(`[data-e2e=class-row][data-booking-id="${bookingId}"]`);
        await expect(row).toContainText(klass.title);
        await expect(row.locator("[data-e2e=class-status]")).toHaveText(L.tag);
        if (!phone) await expect(s.locator("[data-e2e=nav-badge-courses]")).toHaveText("1");

        await s.locator(phone ? "[data-e2e=tab-fiches]" : "[data-e2e=nav-fiches]").click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/student/fiches$`));
        await expect(s.locator("[data-e2e=shell-empty]")).toContainText(L.emptyFiches);
        await expect
          .poll(async () => (await sql<{ at: Date | null }[]>`select last_seen_fiches_at at from profiles where id = ${student.id}`)[0].at)
          .not.toBeNull();
      });

      await test.step("3 · the prof adds a file to that class (Mes fiches › the library form)", async () => {
        await new Promise((r) => setTimeout(r, 50)); // strictly after the student's « last seen »
        await p.goto(`/${loc}/dashboard/materials`, { waitUntil: "networkidle" });
        await p.locator("[data-e2e=library-toggle]").click();
        await p.locator("#m-title").fill(ficheTitle);
        await p.locator("[data-e2e=material-file-input]").setInputFiles({ name: "serie1.png", mimeType: "image/png", buffer: PNG });
        await expect(p.locator("[data-e2e=material-file]")).toContainText("serie1.png");
        await p.locator("[data-e2e=material-class]").click();
        await p.locator(`[data-e2e=material-class-list] [data-value="${klass.id}"]`).click();
        await expect(p.locator("[data-e2e=material-class]")).toHaveAttribute("data-value", klass.id);
        await p.locator("[data-e2e=material-submit]").click();
        await expect
          .poll(async () => (await sql<{ class_id: string | null }[]>`select class_id from materials where tutor_id = ${tutor.id} and title = ${ficheTitle}`)[0]?.class_id ?? null, { timeout: 15_000 })
          .toBe(klass.id);
        // The bell item for the booked student (E).
        await expect
          .poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${student.id} and kind = 'material_added'`)[0].n)
          .toBe(1);
      });

      await test.step("3 · the student: the fiches badge, « Nouveau » in Mes fiches, the fiche in the class detail", async () => {
        // The badge lives in the sidebar: on the phone run, look at it at 1440 for a moment.
        if (phone) await s.setViewportSize(DESKTOP);
        await s.goto(`/${loc}/student`);
        await expect(s.locator("[data-e2e=nav-badge-fiches]")).toHaveText("1");
        const homeFiche = s.locator("[data-e2e=home-fiches] [data-e2e=home-fiche]");
        await expect(homeFiche).toContainText(ficheTitle);
        if (phone) await s.setViewportSize(vp);

        await s.locator(phone ? "[data-e2e=tab-fiches]" : "[data-e2e=nav-fiches]").click();
        const fiche = s.locator("[data-e2e=fiche]", { hasText: ficheTitle });
        await expect(fiche).toHaveAttribute("data-new", "true");
        await expect(fiche.locator("[data-e2e=fiche-new]")).toBeVisible();
        await expect(fiche.locator("[data-e2e=fiche-open]")).toHaveAttribute("href", /^\/api\/material\//);
        await expect(s.locator(`[data-e2e=fiche-group][data-tutor-id="${tutor.id}"]`)).toContainText("Walid T.");
        await noHorizontalScroll(s);
        // Seen: the badge goes once the page has been opened.
        if (phone) await s.setViewportSize(DESKTOP);
        await expect(s.locator("[data-e2e=nav-badge-fiches]")).toHaveCount(0, { timeout: 15_000 });
        if (phone) await s.setViewportSize(vp);

        // The class detail: right column on a computer, its own page on a phone.
        await s.goto(`/${loc}/student/cours`);
        if (phone) {
          await s.locator(`[data-e2e=class-row][data-booking-id="${bookingId}"] a`).first().click();
          await expect(s).toHaveURL(new RegExp(`/${loc}/student/cours/${bookingId}$`));
        }
        const detail = s.locator(phone ? "[data-e2e=class-detail]" : "[data-e2e=cours-detail-column] [data-e2e=class-detail]");
        await expect(detail).toContainText(klass.title);
        await expect(detail.locator("[data-e2e=class-fiches] [data-e2e=fiche]")).toContainText(ficheTitle);
      });

      await test.step("4 · « Message » → the merged conversation; one entry on each side", async () => {
        const detail = s.locator(phone ? "[data-e2e=class-detail]" : "[data-e2e=cours-detail-column] [data-e2e=class-detail]");
        const message = detail.locator("[data-e2e=message-prof]");
        await expect(message).toHaveAttribute("href", `/${loc}/messages/with/${tutor.id}`);
        await message.click();
        await expect(s).toHaveURL(new RegExp(`/${loc}/messages/with/${tutor.id}$`));
        const conv = s.locator("[data-e2e=conv]");
        await expect(conv.getByRole("heading", { name: "Walid T." })).toBeVisible();
        await s.locator("textarea#msg").fill(msg);
        await s.getByRole("button", { name: L.send }).click();
        await expect(conv.locator(".msg-bubble.is-mine")).toContainText(msg);
        await expect(conv.locator("[data-e2e=conv-marker]")).toContainText(klass.title);

        await s.goto(`/${loc}/messages`);
        await expect(s.locator("[data-e2e=conv-item]"), "one entry for the one prof").toHaveCount(1);
        await expect(s.locator("[data-e2e=conv-item]")).toContainText("Walid T.");

        // The prof's side: one conversation for this student, by first name + initial.
        await p.goto(`/${loc}/messages`);
        const items = p.locator("[data-e2e=conv-item]");
        await expect(items).toHaveCount(1);
        await expect(items.first()).toContainText("Mehdi J.");
        await expect(p.locator("main")).not.toContainText("Jaziri");
        await items.first().click();
        await expect(p).toHaveURL(new RegExp(`/${loc}/messages/with/${student.id}$`));
        await expect(p.locator("[data-e2e=conv]").getByText(msg)).toBeVisible();
        await p.locator("textarea#msg").fill(reply);
        await p.locator("textarea#msg").press("Enter");
        await expect(p.locator("[data-e2e=conv] .msg-bubble.is-mine").last()).toContainText(reply);

        // The reply is in the student's same conversation — still one entry.
        await s.goto(`/${loc}/messages/with/${tutor.id}`);
        await expect(s.locator("[data-e2e=conv]").getByText(reply)).toBeVisible();
        const threads = await sql<{ n: number }[]>`
          select count(distinct t.id)::int n from message_threads t join bookings b on b.id = t.booking_id
          where b.student_id = ${student.id}`;
        expect(threads[0].n, "the data model is unchanged: one thread per booking").toBe(1);
      });

      await test.step("5 · the class ends: `done` on the read path before the cron, Passées with the review form, then the cron writes it", async () => {
        await sql`update classes set scheduled_at = now() - interval '3 hours' where id = ${klass.id}`; // 90 min: ended 1 h 30 ago
        const read = (await (await fetch(`${API}/classes/${klass.id}`)).json()) as { status?: string };
        expect(read.status, "derived from start + duration").toBe("done");
        expect((await sql<{ status: string }[]>`select status from classes where id = ${klass.id}`)[0].status, "the cron has not run").toBe("scheduled");

        await s.goto(`/${loc}/student/cours?tab=passees`);
        const row = s.locator(`[data-e2e=class-row][data-booking-id="${bookingId}"]`);
        await expect(row).toContainText(klass.title);
        await expect(row.locator("[data-e2e=class-status]")).toHaveText(L.past);
        await expect(s.locator("main")).not.toContainText(/Absent|Suivie|Enregistrement|التسجيل/);
        if (phone) {
          await row.locator("a").first().click();
          await expect(s).toHaveURL(new RegExp(`/${loc}/student/cours/${bookingId}$`));
        }
        const review = s.locator(phone ? "[data-e2e=class-review]" : "[data-e2e=cours-detail-column] [data-e2e=class-review]");
        await expect(review).toContainText(L.review);
        await expect(review.getByRole("button", { name: L.star })).toBeVisible();
        await noHorizontalScroll(s);

        const secret = process.env.CRON_SECRET?.trim();
        expect(secret, "CRON_SECRET is set for the lane's API").toBeTruthy();
        const res = await fetch(`${API}/cron/reminders`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { ok: boolean; classesDone: number };
        expect(body.ok).toBe(true);
        expect(body.classesDone).toBeGreaterThanOrEqual(1);
        expect((await sql<{ status: string }[]>`select status from classes where id = ${klass.id}`)[0].status).toBe("done");
        expect((await sql<{ status: string }[]>`select status from bookings where id = ${bookingId}`)[0].status, "no attendance recorded").toBe("reserved");
        const after = (await (await fetch(`${API}/classes/${klass.id}`)).json()) as { status?: string };
        expect(after.status).toBe("done");
      });

      await test.step("6b · the profile stuck; physique → SVT changes « Profs pour toi » on a full Accueil", async () => {
        // The newest SVT/bac prof: with level AND subject matching, they lead the block once the profile says SVT.
        const svtFirst = `Ines${letters(5)}`;
        const svt = await seedTutor({ fullName: `${svtFirst} Mejri` });
        await sql`update tutors set subject = 'svt', levels = '{bac}' where id = ${svt.id}`;

        await s.goto(`/${loc}/account?tab=moi`);
        await expect(s.locator('[data-e2e=moi-levels] [data-level="bac"]')).toHaveAttribute("aria-pressed", "true");
        await expect(s.locator('[data-e2e=moi-subjects] [data-subject="physique"]')).toHaveAttribute("aria-pressed", "true");
        await s.locator('[data-e2e=moi-subjects] [data-subject="physique"]').click();
        await s.locator('[data-e2e=moi-subjects] [data-subject="svt"]').click();
        await expect(s.locator('[data-e2e=moi-subjects] [data-subject="svt"]')).toHaveAttribute("aria-pressed", "true");
        await s.locator("[data-e2e=moi-save]").click();
        await expect(s.locator(".toast")).toHaveText(L.saved);
        await expect
          .poll(async () => (await sql<{ subjects: string | null }[]>`select subjects from profiles where id = ${student.id}`)[0].subjects)
          .toBe("svt");

        await s.goto(`/${loc}/student`);
        await expect(s.locator("[data-e2e=home-profs] [data-e2e=home-prof]").first()).toContainText("Walid T.");
        const forYou = s.locator("[data-e2e=home-for-you] [data-e2e=suggestions]");
        await expect(forYou).toHaveAttribute("data-matched", "true");
        await expect(forYou.locator("[data-e2e=suggested-prof]").first().locator("a")).toHaveAttribute("href", `/${loc}/${svt.slug}`);
        await expect(forYou.locator(`a[href="/${loc}/${tutor.slug}"]`), "never a followed prof").toHaveCount(0);
        await noHorizontalScroll(s);
      });
    } finally {
      await ctx.close();
      await prof.close();
    }
  });
}
