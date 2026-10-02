import { test, expect } from "@playwright/test";
import { seedProfile, seedTutor, seedClass, seedAdmin } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* Phase A · lane L5 — "the misplaced fields" (A18). Written by the lane, run by
   the orchestrator after merge (lanes never run Playwright). Each describe block
   names the A18 item it proves. Wherever an item has logic (limits, levels,
   subjects, next session, material visibility, roles) it ALSO has an API/unit
   test in apps/api/test/l5-*.test.ts; these specs cover what only a browser sees. */

const minorYear = () => new Date().getFullYear() - 15;

test.describe("A18.1 — the child never declares to be the parent", () => {
  test("the consent form has no self-declaration tick, and says the parent confirms", async ({ browser }) => {
    const child = await seedProfile({ role: "student", birthYear: minorYear() });
    const ctx = await contextAs(browser, child.id);
    const page = await ctx.newPage();
    await page.goto("/fr/auth/consent", { waitUntil: "networkidle" });

    const html = await page.content();
    expect(html).not.toContain("Je confirme être le parent");
    await expect(page.getByRole("checkbox")).toHaveCount(0);

    /* playwright.config.ts runs the web server with ALLOW_MINORS=1, so the form
       renders; without it the page says the pilot is 18+ and shows no form. */
    await expect(page.locator("[data-e2e=consent-info]")).toContainText("Ton parent recevra un e-mail pour confirmer.");
    await ctx.close();
  });
});

test.describe("A18.2 — the guardian phone is not collected", () => {
  test("the consent form has no phone field", async ({ browser }) => {
    const child = await seedProfile({ role: "student", birthYear: minorYear() });
    const ctx = await contextAs(browser, child.id);
    const page = await ctx.newPage();
    await page.goto("/fr/auth/consent", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=consent-info]")).toBeVisible();
    await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    await expect(page.getByText("Téléphone du parent")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("A18.6 — no free first session in a class while the option is off", () => {
  test("option off: one muted line that links to the setting, nothing to tick; option on: a toggle", async ({ browser }) => {
    const offMe = await seedProfile({ role: "tutor", birthYear: 1985 });
    await seedTutor({ profileId: offMe.id, status: "verified", offersFreeFirstSession: false });
    const ctx = await contextAs(browser, offMe.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    // live-fixes-1 · D1: not a disabled box any more — one line, and the way to switch it on.
    await expect(page.locator("[data-e2e=free-first-box]")).toHaveCount(0);
    await expect(page.locator("[data-e2e=free-first-off]")).toContainText("1re séance offerte : désactivée");
    const link = page.locator("[data-e2e=free-first-off] a");
    await expect(link).toHaveText("Activer dans Réglages ›");
    // espace prof v2 · phase 6: the option lives in Réglages › Vitrine.
    await expect(link).toHaveAttribute("href", "/fr/dashboard/settings?tab=vitrine#free-first");
    await ctx.close();

    const onMe = await seedProfile({ role: "tutor", birthYear: 1985 });
    await seedTutor({ profileId: onMe.id, status: "verified", offersFreeFirstSession: true });
    const ctx2 = await contextAs(browser, onMe.id);
    const page2 = await ctx2.newPage();
    await page2.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    const box2 = page2.locator("[data-e2e=free-first-box]");
    await expect(box2).toHaveAttribute("role", "switch");
    await expect(box2).toHaveAttribute("aria-checked", "false");
    await box2.click();
    await expect(box2).toHaveAttribute("aria-checked", "true");
    await expect(page2.locator("[data-e2e=free-first-off]")).toHaveCount(0);
    await ctx2.close();
  });
});

test.describe("A18.7 — levels, never a default 'Bac'", () => {
  test("a tutor with no levels shows none; chosen levels show on the storefront and filter Explore", async ({ page }) => {
    /* Phase A+ (P2): Explore search matches the FIRST name (never "first + last"), so
       both tutors share one unique first name and the search types that. */
    const name = `L5niveaux${Date.now().toString(36)}`;
    const none = await seedTutor({ fullName: `${name} Zero` }); // tutors.level = 'Bac', the old default
    const some = await seedTutor({ fullName: `${name} Deux` });
    await sql`update tutors set levels = ${sql.array(["college", "bac"])} where id = ${some.id}`;

    await page.goto(`/fr/${none.slug}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=sf-levels]")).toHaveCount(0);

    await page.goto(`/fr/${some.slug}`, { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=sf-levels] li")).toHaveText(["Collège", "Bac"]);

    await page.goto("/fr/explore", { waitUntil: "networkidle" });
    await page.locator('input[type="search"]').fill(name);
    await page.locator('[data-e2e=level-filter] [data-level="college"]').click();
    await expect(page.locator(`a[href="/fr/${some.slug}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/fr/${none.slug}"]`)).toHaveCount(0);
  });
});

test.describe("A18.8 — a pack shows the tutor's price", () => {
  test("the storefront pack card carries its price, labelled as the tutor's, with no payment promise", async ({ page }) => {
    const tutor = await seedTutor({});
    await sql`insert into packs (tutor_id, title, description, price_tnd)
              values (${tutor.id}, 'Pack L5 annales', '12 fiches', '25')`;
    await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    const price = page.locator("[data-e2e=pack-price]").first();
    await expect(price).toContainText("25");
    await expect(price).toContainText("TND");
    await expect(price).toContainText("Prix du prof");
    await expect(page.locator(".sf-packs")).not.toContainText("Bientôt");
  });
});

test.describe("A18.9 — materials can be attached to a class, and say who sees them", () => {
  test("the form offers the tutor's classes; the audience label follows the choice", async ({ browser }) => {
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: me.id, status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/materials", { waitUntil: "networkidle" });
    // live-fixes-1 · B: the library form is folded, its selects are the shell's own controls.
    await page.locator("[data-e2e=library-toggle]").click();

    const vis = page.locator("[data-e2e=material-visibility] [data-value=students]");
    await expect(vis).toHaveText("Tous mes élèves");
    await page.locator("[data-e2e=material-class]").click();
    await page.locator(`[data-e2e=material-class-list] [data-value="${klass.id}"]`).click();
    await expect(vis).toHaveText("Élèves de cette séance");

    await page.locator("#m-title").fill("Corrigé L5 séance");
    await page.locator("[data-e2e=material-source] [data-value=youtube]").click();
    await page.locator("#m-yt").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect.poll(async () => (await sql<{ class_id: string | null }[]>`
      select class_id from materials where tutor_id = ${tutor.id} and title = 'Corrigé L5 séance'`)[0]?.class_id ?? null,
      { timeout: 15_000 }).toBe(klass.id);
    await expect(page.locator("main")).toContainText("Élèves de cette séance");
    await ctx.close();
  });
});

test.describe("A18.10 — dashboard status badges", () => {
  test("upcoming, finished and cancelled classes each carry their badge", async ({ browser }) => {
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: me.id, status: "verified" });
    const upcoming = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const finished = await seedClass({ tutorId: tutor.id, hoursFromNow: -5 });
    const cancelled = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    await sql`update classes set status = 'cancelled' where id = ${cancelled.id}`;

    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    // espace prof v2 · shell: the class list is « Mes classes ».
    await page.goto("/fr/dashboard/classes", { waitUntil: "networkidle" });
    const badge = (id: string) => page.locator(`[data-e2e=class-row][data-class-id="${id}"] [data-e2e=class-phase]`);
    await expect(badge(upcoming.id)).toHaveText("À venir");
    await expect(badge(finished.id)).toHaveText("Terminée");
    await expect(badge(cancelled.id)).toHaveText("Annulée");
    await ctx.close();
  });
});

test.describe("A18.11 — 'Prochaine séance' is the next session", () => {
  test("a full next session says Complet, and the next class with a seat is offered", async ({ page }) => {
    const tutor = await seedTutor({ status: "verified" });
    const full = await seedClass({ tutorId: tutor.id, hoursFromNow: 30, seats: 5, seatsTaken: 5 });
    const open = await seedClass({ tutorId: tutor.id, hoursFromNow: 80, seats: 5 });
    const cancelled = await seedClass({ tutorId: tutor.id, hoursFromNow: 20, seats: 5 });
    await sql`update classes set status = 'cancelled' where id = ${cancelled.id}`;

    await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    const aside = page.locator("[data-sf-aside=true]");
    const nextFull = aside.locator("[data-e2e=next-full]");
    await expect(nextFull).toContainText(full.title);
    await expect(nextFull).toContainText("Complet");
    await expect(aside).toContainText("Prochaine séance avec une place");
    await expect(aside.locator(`a[href*="/checkout?class=${open.id}"]`)).toBeVisible();
    await expect(aside).not.toContainText(cancelled.title);
  });
});

test.describe("A18.12 — subjects are saved as codes, shown in the viewer's language", () => {
  test("picked in Arabic, stored as a code, shown in French", async ({ browser }) => {
    const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Élève Codes" });
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    await page.goto("/ar/student/welcome", { waitUntil: "networkidle" });
    await page.locator('[data-subject="math"]').click();
    await page.getByRole("button", { name: "كمّل" }).click();
    await expect.poll(async () => (await sql<{ subjects: string | null }[]>`
      select subjects from profiles where id = ${student.id}`)[0].subjects, { timeout: 15_000 }).toBe("math");

    await page.goto("/fr/student/welcome", { waitUntil: "networkidle" });
    const chip = page.locator('[data-subject="math"]');
    await expect(chip).toHaveText("Maths");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await ctx.close();
  });
});

test.describe("A18.13 — /account names the role", () => {
  for (const [role, fr, ar] of [["tutor", "Prof", "أستاذ"], ["student", "Élève", "تلميذ"]] as const) {
    test(`${role}: "${fr}" / "${ar}", never the sign-up button text`, async ({ browser }) => {
      const me = await seedProfile({ role, birthYear: 1990 });
      const ctx = await contextAs(browser, me.id);
      const page = await ctx.newPage();
      await page.goto("/fr/account", { waitUntil: "networkidle" });
      await expect(page.locator("main")).toContainText(fr);
      await expect(page.locator("main")).not.toContainText("Je suis");
      await page.goto("/ar/account", { waitUntil: "networkidle" });
      await expect(page.locator("main")).toContainText(ar);
      await ctx.close();
    });
  }

  test("an admin reads 'Admin'", async ({ browser }) => {
    const admin = await seedAdmin(); // ADMIN_EMAILS is pinned to this identity in playwright.config.ts
    const ctx = await contextAs(browser, admin.id);
    const page = await ctx.newPage();
    await page.goto("/fr/account", { waitUntil: "networkidle" });
    await expect(page.locator("main")).toContainText("Admin");
    await ctx.close();
  });
});

test.describe("A18.14 — a signed-in report names the reporter's role", () => {
  test("the queue says 'Signalé par : Élève' with a link to the account, not 'Signalement anonyme'", async ({ browser }) => {
    const admin = await seedAdmin();
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const reason = `Signalement L5 ${Date.now().toString(36)} : contenu déplacé.`;
    await sql`insert into reports (subject_kind, reporter_profile_id, reason) values ('other', ${student.id}, ${reason})`;

    const ctx = await contextAs(browser, admin.id);
    const page = await ctx.newPage();
    await page.goto("/fr/admin/moderation", { waitUntil: "networkidle" });
    const item = page.locator("[data-e2e=report-item]").filter({ hasText: reason });
    await expect(item.locator("[data-e2e=report-reporter]")).toContainText("Signalé par : Élève");
    await expect(item).not.toContainText("Signalement anonyme");
    await expect(item.getByRole("link", { name: "Voir le compte" }))
      .toHaveAttribute("href", `/fr/admin/accounts?email=${encodeURIComponent(student.email)}`);
    await sql`delete from reports where reason = ${reason}`;
    await ctx.close();
  });
});

test.describe("A18.16 — the form's limits are the server's limits", () => {
  test("title 120, duration chips within 240, seats 200 on the form (FOUNDER defaults)", async ({ browser }) => {
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    await seedTutor({ profileId: me.id, status: "verified" });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await expect(page.getByPlaceholder(/Intégrales/)).toHaveAttribute("maxlength", "120");
    /* espace prof v2 · phase 6 (image 2): the duration is a chip — 60 / 90 / 120, all
       under the server's 240 — and the seats a number capped at the server's 200. */
    await expect(page.locator("[data-e2e=class-duration] input[type=radio]")).toHaveCount(3);
    for (const v of ["60", "90", "120"]) {
      await expect(page.locator(`[data-e2e=class-duration] input[value="${v}"]`)).toHaveCount(1);
    }
    await expect(page.locator("[data-e2e=class-seats]")).toHaveAttribute("max", "200");
    await ctx.close();
  });
});

test.describe("A18.15 — the admin plans page is in the admin nav", () => {
  test("every admin page links to /admin/plans, and it links back", async ({ browser }) => {
    const admin = await seedAdmin();
    const ctx = await contextAs(browser, admin.id);
    const page = await ctx.newPage();
    /* phase-a/integrate: default "load", not "networkidle" — /admin/plans lists every
       tutor (hundreds of seeded rows by this point in a full run) and never went idle
       inside the test timeout. The toHaveCount assertions below auto-wait anyway. */
    for (const path of ["verifications", "accounts", "moderation"]) {
      await page.goto(`/fr/admin/${path}`);
      await expect(page.locator('main a[href="/fr/admin/plans"]'), `/admin/${path} → plans`).toHaveCount(1);
    }
    await page.goto("/fr/admin/plans");
    const nav = page.locator("[data-e2e=admin-nav]");
    for (const path of ["verifications", "accounts", "moderation"]) {
      await expect(nav.locator(`a[href="/fr/admin/${path}"]`)).toHaveCount(1);
    }
    await ctx.close();
  });
});
