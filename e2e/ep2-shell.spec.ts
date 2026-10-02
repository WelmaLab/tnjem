import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs, mintSession } from "./support/session";
import { api } from "./support/journey";
import { BASE_URL } from "./support/env";
import { fillWallTime, wallTimeOf } from "./support/datetime";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 1 — THE SHELL (UI_options/espace-prof-1-shell.png).

   One frame for every prof page: the grouped sidebar with its active state and the
   Vérification badge, the avatar card, the top bar (breadcrumbs, FR·ع, the bell on
   real notifications, the messages count on real unread messages), no marketing
   footer. On a phone: the bottom tab bar and the « + ». The home with real numbers;
   Mes classes / Mes élèves / Ma vitrine; the DD/MM/YYYY picker; and the owner
   preview against the public « Ce prof arrive bientôt » (unknown slugs still 404).
   ADDED as its own spec; the API side is apps/api/test/ep2-shell.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;

async function tutorCtx(browser: Browser, profileId: string, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

async function newTutor(status: "draft" | "pending" | "verified" | "rejected", fullName = "Walid Tester") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status, fullName });
  return { profile, tutor };
}

const sidebar = (page: Page) => page.locator("[data-e2e=shell-sidebar]");

test.describe("the frame", () => {
  test("sidebar: Accueil, then ENSEIGNER · MA PAGE · COMPTE, the current item, the badge, the avatar card", async ({ browser }) => {
    const { profile } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");

    const side = sidebar(page);
    await expect(side).toBeVisible();
    await expect(side.locator(".aps-group-t")).toHaveText(["Enseigner", "Ma page", "Compte"]);
    await expect(side.locator(".aps-link-t")).toHaveText([
      "Accueil", "Mes classes", "Mes fiches", "Mes élèves", "Abonnements",
      "Ma vitrine", "Promotions", "Vérification", "Mon offre", "Réglages",
      "Aide", // espace prof v2 · pro (P7, C9): the help page, in the nav config
    ]);
    await expect(side.locator("[data-e2e=nav-help]")).toHaveAttribute("href", "/fr/aide");
    await expect(side.locator("[data-e2e=nav-home]")).toHaveAttribute("aria-current", "page");
    await expect(side.locator("[aria-current=page]")).toHaveCount(1);
    // Draft: verification is still to do → the badge.
    await expect(side.locator("[data-e2e=nav-badge-verify]")).toHaveText("1");
    await expect(side.locator("[data-e2e=nav-settings]")).toHaveAttribute("href", "/fr/dashboard/settings"); // phase 6

    // The avatar card: first name, "Prof · Pilote" (no grant, payments off), and its menu.
    await expect(page.locator("[data-e2e=shell-me]")).toContainText("Walid");
    await expect(page.locator("[data-e2e=shell-plan]")).toHaveText("Prof · Pilote");
    await page.locator("[data-e2e=shell-me]").click();
    const menu = page.locator("[data-e2e=shell-me-menu]");
    await expect(menu.getByRole("link", { name: "Réglages" })).toHaveAttribute("href", "/fr/dashboard/settings"); // phase 6
    await expect(menu.getByRole("button", { name: "Se déconnecter" })).toBeVisible();

    // The current item follows the page, sub-pages light their parent.
    await page.goto("/fr/dashboard/classes");
    await expect(side.locator("[data-e2e=nav-classes]")).toHaveAttribute("aria-current", "page");
    await page.goto("/fr/dashboard/new-class");
    await expect(side.locator("[data-e2e=nav-classes]")).toHaveAttribute("aria-current", "page");
    await page.goto("/fr/onboarding/verify");
    await expect(side.locator("[data-e2e=nav-verify]")).toHaveAttribute("aria-current", "page");
    await ctx.close();
  });

  test("a verified tutor has no Vérification badge", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    await expect(sidebar(page).locator("[data-e2e=nav-verify]")).toBeVisible();
    await expect(page.locator("[data-e2e=nav-badge-verify]")).toHaveCount(0);
    await ctx.close();
  });

  test("top bar: breadcrumbs per page, the FR·ع switch; no site header, no marketing footer", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    const crumbs = page.locator("[data-e2e=shell-crumbs] li");

    await page.goto("/fr/onboarding/verify");
    await expect(crumbs).toHaveText(["Ma page", "Vérification"]);
    await page.goto("/fr/dashboard/plan");
    await expect(crumbs).toHaveText(["Compte", "Mon offre"]);
    await page.goto("/fr/dashboard/new-class");
    await expect(crumbs).toHaveText(["Mes classes", "Nouvelle classe"]);
    await expect(page.locator("[data-e2e=shell-crumbs] a")).toHaveAttribute("href", "/fr/dashboard/classes");

    await page.goto("/fr/dashboard");
    await expect(crumbs).toHaveText(["Accueil"]);
    await expect(page.locator(".site-header")).toHaveCount(0);
    await expect(page.locator(".site-footer")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Tableau de bord" })).toHaveCount(0);
    await expect(page.locator("main")).toHaveCount(1);

    await page.locator("[data-e2e=shell-topbar]").getByRole("button", { name: "العربية" }).click();
    await expect(page).toHaveURL(/\/ar\/dashboard$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("[data-e2e=shell-crumbs] li")).toHaveText(["الرئيسية"]);
    await ctx.close();
  });

  test("the shell is the TUTOR's: a student keeps the public layout on /messages and /account; a tutor's /account is Réglages", async ({ browser }) => {
    const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Sarra Mejri" });
    const ctx = await browser.newContext();
    await loginAs(ctx, student.id);
    const page = await ctx.newPage();
    for (const path of ["/fr/messages", "/fr/account"]) {
      await page.goto(path);
      await expect(page.locator(".site-header"), path).toBeVisible();
      await expect(page.locator("[data-e2e=app-shell]"), path).toHaveCount(0);
    }
    await ctx.close();

    const { profile } = await newTutor("verified");
    const tctx = await tutorCtx(browser, profile.id);
    const tpage = await tctx.newPage();
    for (const path of ["/fr/messages", "/fr/account"]) {
      await tpage.goto(path);
      await expect(tpage.locator("[data-e2e=app-shell]"), path).toBeVisible();
      await expect(tpage.locator(".site-header"), path).toHaveCount(0);
    }
    // Phase 6: a tutor's /account is « Réglages » (the old URL keeps working).
    await expect(tpage).toHaveURL(/\/fr\/dashboard\/settings$/);
    // The legal links the footer carried live in Réglages › Sécurité, under « Ce qui est effacé ».
    await tpage.goto("/fr/dashboard/settings?tab=securite");
    await tpage.locator("[data-e2e=what-is-erased] summary").click();
    await expect(tpage.locator("[data-e2e=settings-legal] a[href='/fr/terms']")).toBeVisible();
    await expect(tpage.locator("[data-e2e=settings-legal] a[href='/fr/privacy']")).toBeVisible();
    await tctx.close();
  });
});

test.describe("the bell and the messages count", () => {
  test("the bell counts unread notifications from the notifications table, and opening it reads them", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    await sql`insert into notifications (id, profile_id, kind, title, body, href)
              values (${randomUUID()}, ${profile.id}, 'new_booking', 'Nouvelle réservation', 'Yosra a réservé « Intégrales ».', '/dashboard/students')`;
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    await expect(page.locator("[data-e2e=shell-bell-count]")).toHaveText("1");
    await page.locator("[data-e2e=shell-bell]").click();
    await expect(page.locator("#aps-bell-panel")).toContainText("Nouvelle réservation");
    await expect(page.locator("[data-e2e=shell-bell-count]")).toHaveCount(0);
    await expect.poll(async () => (await sql<{ n: number }[]>`
      select count(*)::int n from notifications where profile_id = ${profile.id} and read_at is null`)[0].n).toBe(0);
    await ctx.close();
  });

  test("the messages icon counts unread messages in the tutor's own threads; opening the thread clears it", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    const student = await seedProfile({ role: "student", birthYear: 1996, fullName: "Yosra Ammar" });
    const studentToken = await mintSession(student.id);
    expect((await api("/bookings", studentToken, { classId: klass.id })).ok).toBe(true);
    const [{ id: bookingId }] = await sql<{ id: string }[]>`select id from bookings where class_id = ${klass.id} and student_id = ${student.id}`;
    const opened = await api("/threads", studentToken, { bookingId });
    const threadId = String(opened.threadId);
    expect((await api(`/threads/${threadId}/messages`, studentToken, { body: "Bonjour, à jeudi !" })).ok).toBe(true);

    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    await expect(page.locator("[data-e2e=shell-messages-count]")).toHaveText("1");
    await expect(page.locator("[data-e2e=shell-messages]")).toHaveAttribute("aria-label", /1 message non lu/);
    await page.goto(`/fr/messages/${threadId}`);
    await expect(page.locator("main")).toContainText("Bonjour, à jeudi !");
    await expect(page.locator("[data-e2e=shell-crumbs] li").last()).toContainText(klass.title.slice(0, 12));
    await page.goto("/fr/dashboard");
    await expect(page.locator("[data-e2e=shell-bell]")).toBeVisible();
    await expect(page.locator("[data-e2e=shell-messages-count]")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("phone (390 wide)", () => {
  test("bottom tab bar + « + »; the « Profil » sheet reaches the rest; 44px targets", async ({ browser }) => {
    const { profile } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id, { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");

    await expect(sidebar(page)).toBeHidden();
    const tabs = page.locator("[data-e2e=shell-tabs]");
    await expect(tabs).toBeVisible();
    await expect(tabs.locator(".aps-tab")).toHaveText(["Accueil", "Classes", "Élèves", "Vitrine", "Profil"]);
    await expect(tabs.locator("[data-e2e=tab-home]")).toHaveAttribute("aria-current", "page");
    for (const box of await tabs.locator(".aps-tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }

    // The « + » opens « Nouvelle classe / Nouvelle fiche ».
    await page.locator("[data-e2e=shell-fab]").click();
    const fab = page.locator("[data-e2e=shell-fab-menu]");
    await expect(fab.getByRole("link", { name: "Nouvelle classe" })).toHaveAttribute("href", "/fr/dashboard/new-class");
    await expect(fab.getByRole("link", { name: "Nouvelle fiche" })).toHaveAttribute("href", "/fr/dashboard/new-pack");
    await page.keyboard.press("Escape");
    await expect(fab).toHaveCount(0);

    // « Profil »: the full nav, and the way out.
    await page.locator("[data-e2e=tab-profile]").click();
    const sheet = page.locator("[data-e2e=shell-sheet]");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Vérification/ })).toBeVisible();
    await expect(sheet.getByRole("link", { name: "Mon offre" })).toBeVisible();
    // espace prof v2 · pro (P7): « Aide » comes from the nav config — once, not twice.
    await expect(sheet.getByRole("link", { name: "Aide" })).toHaveCount(1);
    await expect(sheet.getByRole("button", { name: "Se déconnecter" })).toBeVisible();
    await sheet.getByRole("link", { name: "Mes fiches" }).click();
    await expect(page).toHaveURL(/\/fr\/dashboard\/materials$/);

    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ctx.close();
  });

  test("in Arabic the frame mirrors: the sidebar on the right at 1440", async ({ browser }) => {
    const { profile } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const side = await sidebar(page).boundingBox();
    const main = await page.locator("main").boundingBox();
    expect(side && main && side.x > main.x, "the sidebar is on the inline START side — the right, in Arabic").toBe(true);
    await expect(sidebar(page).locator(".aps-group-t")).toHaveText(["التدريس", "صفحتي", "الحساب"]);
    await ctx.close();
  });
});

test.describe("home", () => {
  test("a draft tutor: step 2 of 5, the « Fais-toi vérifier » blocker on top, greyed zeros, Revenus « Bientôt »", async ({ browser }) => {
    const { profile, tutor } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");

    await expect(page.locator("main h1")).toHaveText("Salut Walid 👋");
    await expect(page.locator("[data-e2e=setup-summary]")).toHaveText("Étape 2 sur 5 · encore 4 étapes pour être prêt");
    const blocker = page.locator("[data-e2e=shell-blocker]");
    await expect(blocker).toContainText("Fais-toi vérifier");
    await expect(blocker.getByRole("link", { name: "Envoyer mes documents" })).toHaveAttribute("href", "/fr/onboarding/verify");
    await expect(page.locator("[data-e2e=kpi-students]")).toHaveText("0");
    await expect(page.locator("[data-e2e=kpi-students]")).toHaveClass(/is-zero/);
    await expect(page.locator("[data-e2e=kpi-upcoming]")).toHaveText("0");
    await expect(page.locator("[data-e2e=kpi-rating]")).toContainText("—");
    await expect(page.locator("[data-e2e=kpi-revenue]")).toHaveText("Bientôt");
    await expect(page.locator("[data-e2e=home-upcoming]")).toContainText("Aucune séance.");
    await expect(page.locator("main")).not.toContainText("TND");

    // The five steps, behind the toggle.
    await page.locator("[data-e2e=setup-toggle]").click();
    await expect(page.locator("[data-e2e^=setup-step-]")).toHaveCount(5);
    await expect(page.locator("[data-e2e=setup-step-store]")).toHaveAttribute("data-state", "done");
    await expect(page.locator("[data-e2e=setup-step-photo]").getByRole("link", { name: "Ajouter ma photo" })).toHaveAttribute("href", "/fr/dashboard/settings?tab=vitrine#photo");

    // « Ma vitrine »: the link, « Pas encore en ligne », the private preview — and the copy is a share (C2).
    const card = page.locator("[data-e2e=storefront-card]");
    await expect(card.locator("[data-e2e=storefront-url]")).toContainText(`/${tutor.slug}`);
    await expect(card.locator("[data-e2e=storefront-status]")).toHaveText("Pas encore en ligne");
    await expect(card.locator("[data-e2e=storefront-preview-link]")).toHaveAttribute("href", "/fr/dashboard/storefront/preview");
    await card.locator("[data-e2e=copy-link]").click();
    await expect(card.locator("[data-e2e=copy-link]")).toHaveAttribute("data-copied", "true");
    await expect.poll(async () => (await sql<{ s: Date | null }[]>`select link_shared_at s from tutors where id = ${tutor.id}`)[0].s !== null,
      { timeout: 10_000 }).toBe(true);
    await page.reload();
    await expect(page.locator("[data-e2e=setup-summary]")).toHaveText("Étape 2 sur 5 · encore 3 étapes pour être prêt");
    await ctx.close();
  });

  test("a verified tutor with real classes and a booking: real numbers, the next sessions, no blocker", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified", "Amel Ben Salah");
    const soon = await seedClass({ tutorId: tutor.id, hoursFromNow: 30, seats: 6 });
    await seedClass({ tutorId: tutor.id, hoursFromNow: 100, seats: 6 });
    await seedClass({ tutorId: tutor.id, hoursFromNow: -72, seats: 6 });
    const student = await seedProfile({ role: "student", birthYear: 1997, fullName: "Mehdi Jaziri" });
    expect((await api("/bookings", await mintSession(student.id), { classId: soon.id })).ok).toBe(true);

    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    await expect(page.locator("main h1")).toHaveText("Salut Amel 👋");
    await expect(page.locator("[data-e2e=shell-blocker]")).toHaveCount(0);
    await expect(page.locator("[data-e2e=kpi-students]")).toHaveText("1");
    await expect(page.locator("[data-e2e=kpi-upcoming]")).toHaveText("2");
    await expect(page.locator("[data-e2e=kpi-rating]")).toContainText("—"); // no review exists
    const upcoming = page.locator("[data-e2e=home-upcoming]");
    await expect(upcoming).toContainText(soon.title);
    await expect(upcoming).toContainText("1/6 inscrits");
    await expect(page.locator("[data-e2e=home-new-class]")).toHaveClass(/btn-primary/);
    await expect(page.locator("[data-e2e=storefront-status]")).toHaveText("En ligne");
    await expect(page.locator("main")).not.toContainText("Activité récente");
    await expect(page.locator("main")).not.toContainText("0 TND"); // the balance card is gone
    await ctx.close();
  });
});

test.describe("Mes classes · Mes élèves · Ma vitrine · Mon offre", () => {
  test("Mes classes: upcoming and past, duplicate → prefilled form, cancel behind a confirmation", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const ahead = await seedClass({ tutorId: tutor.id, hoursFromNow: 50, seats: 8, priceTnd: 35 });
    const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -50 });
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/classes");

    await expect(page.locator("[data-e2e=classes-upcoming] [data-e2e=class-row]")).toHaveCount(1);
    await expect(page.locator("[data-e2e=classes-past] [data-e2e=class-row]")).toHaveCount(1);
    const row = page.locator(`[data-e2e=class-row][data-class-id="${ahead.id}"]`);
    await expect(row).toContainText(ahead.title);
    await expect(page.locator(`[data-e2e=class-row][data-class-id="${past.id}"] [data-e2e=class-cancel]`)).toHaveCount(0);

    await row.locator("[data-e2e=class-duplicate]").click();
    await expect(page).toHaveURL(new RegExp(`/fr/dashboard/new-class\\?from=${ahead.id}$`));
    await expect(page.getByPlaceholder(/Intégrales/)).toHaveValue(ahead.title);
    await expect(page.getByPlaceholder("15")).toHaveValue("35");
    expect(await wallTimeOf(page), "a copy never inherits the date").toBe("");

    await page.goto("/fr/dashboard/classes");
    await row.locator("[data-e2e=class-cancel]").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Annuler cette séance ?");
    await dialog.getByRole("button", { name: "Garder la séance" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    expect((await sql<{ status: string }[]>`select status from classes where id = ${ahead.id}`)[0].status).toBe("scheduled");

    await row.locator("[data-e2e=class-cancel]").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Oui, annuler" }).click();
    await expect.poll(async () => (await sql<{ status: string }[]>`select status from classes where id = ${ahead.id}`)[0].status,
      { timeout: 15_000 }).toBe("cancelled");
    await expect(page.locator(".toast")).toContainText("Séance annulée");
    await expect(page.locator("[data-e2e=classes-past] [data-e2e=class-row]")).toHaveCount(2);
    await ctx.close();
  });

  test("Mes élèves: everyone who booked, first name only, with status and history", async ({ browser }) => {
    const { profile, tutor } = await newTutor("verified");
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 70 });
    for (const name of ["Yosra Trabelsi", "Mehdi Jaziri"]) {
      const s = await seedProfile({ role: "student", birthYear: 1995, fullName: name });
      expect((await api("/bookings", await mintSession(s.id), { classId: klass.id })).ok).toBe(true);
    }
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/students");
    const rows = page.locator("[data-e2e=student-row]");
    await expect(rows).toHaveCount(2);
    // Both have a class coming up, so the most recent booking leads: Mehdi booked last.
    await expect(page.locator("[data-e2e=student-name]")).toHaveText(["Mehdi", "Yosra"]);
    await expect(page.locator("main")).not.toContainText("Trabelsi");
    await expect(page.locator("main")).not.toContainText("Jaziri");
    await expect(rows.first().locator("[data-e2e=student-status]")).toHaveText("Séance à venir");
    await rows.first().locator("summary").click();
    await expect(rows.first()).toContainText(klass.title);
    await expect(rows.first().getByRole("button", { name: /Écrire à/ })).toBeVisible();
    await ctx.close();
  });

  test("Ma vitrine and Mon offre render in the shell; empty states for a tutor with nothing yet", async ({ browser }) => {
    const { profile, tutor } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/storefront");
    await expect(page.locator("main h1")).toHaveText("Ma vitrine");
    await expect(page.locator("[data-e2e=storefront-url]")).toContainText(tutor.slug);
    await expect(page.locator("[data-e2e=shell-blocker]")).toContainText("Pas encore en ligne");
    await expect(page.locator("[data-e2e=sv-preview]")).toHaveAttribute("href", "/fr/dashboard/storefront/preview");

    await page.goto("/fr/dashboard/plan");
    await expect(page.locator("main h1")).toHaveText("Mon offre");
    await expect(page.locator("[data-e2e=plan-card]")).toContainText("Pilote");
    await expect(page.locator("main a[href='/fr/tarifs']")).toBeVisible(); // phase 6: « Détails des offres », under the summary

    await page.goto("/fr/dashboard/students");
    await expect(page.locator("[data-e2e=shell-empty]")).toContainText("Personne n'a encore réservé");
    await page.goto("/fr/dashboard/classes");
    await expect(page.locator("[data-e2e=shell-empty]")).toContainText("Aucune classe pour l'instant");
    await ctx.close();
  });
});

test.describe("the date picker (rule 6: DD/MM/YYYY, 24 h, never the native one)", () => {
  test("no native date input on the prof pages; the calendar works from the keyboard and mirrors in Arabic", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    await expect(page.locator('input[type="datetime-local"], input[type="date"], input[type="time"]')).toHaveCount(0);

    await page.locator("[data-e2e=date-open]").click();
    const cal = page.locator("[data-e2e=date-calendar]");
    await expect(cal).toBeVisible();
    const focused = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.date ?? "");
    const today = await focused();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await page.keyboard.press("ArrowRight");
    const tomorrow = await focused();
    expect(tomorrow > today).toBe(true);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    expect(await focused(), "yesterday is not pickable, but focus may rest on it").not.toBe("");
    await expect(page.locator("button[data-date][aria-disabled=true]").first()).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(cal).toHaveCount(0);
    const [y, m, d] = tomorrow.split("-");
    await expect(page.locator("[data-e2e=date-input]")).toHaveValue(`${d}/${m}/${y}`);
    await expect(page.locator("[data-e2e=date-open]")).toBeFocused();

    // 24 h, with ArrowUp stepping a quarter hour.
    const time = page.locator("[data-e2e=time-input]");
    await time.fill("1745");
    await expect(time).toHaveValue("17:45");
    await time.press("ArrowUp");
    await expect(time).toHaveValue("18:00");
    expect(await wallTimeOf(page)).toBe(`${tomorrow}T18:00`);

    // Typing works too, and a day that does not exist is refused.
    await fillWallTime(page, "2031-02-30T10:00");
    expect(await wallTimeOf(page)).toBe("");

    // Arabic: the grid is mirrored, so ArrowLeft is the NEXT day.
    await page.goto("/ar/dashboard/new-class", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=date-open]").click();
    const arToday = await focused();
    await page.keyboard.press("ArrowLeft");
    expect((await focused()) > arToday).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-e2e=date-calendar]")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("Ma vitrine: the owner preview vs the public « arrive bientôt » (no more bare 404)", () => {
  test("anonymous: « Ce prof arrive bientôt », 200, noindex, nothing of the tutor's; it is ISR-cached", async ({ page, request }) => {
    const { tutor } = await newTutor("pending", "Secret Person");
    const res = await page.goto(`/fr/${tutor.slug}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("main h1")).toHaveText("Ce prof arrive bientôt");
    await expect(page.locator("[data-e2e=coming-soon] a[href='/fr/explore']")).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("Secret");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);

    // Still a static page: the second hit is the cached HTML (e2e/isr.spec.ts for the storefront).
    const again = await request.get(`/ar/${tutor.slug}`);
    expect(again.status()).toBe(200);
    const third = await request.get(`/ar/${tutor.slug}`);
    expect(third.headers()["x-nextjs-cache"]).toBe("HIT");
    expect(await third.text()).toContain("الأستاذ هذا جاي قريب");
  });

  test("the OWNER opening their own link lands on the private preview, with the banner", async ({ browser }) => {
    const { profile, tutor } = await newTutor("draft");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto(`/fr/${tutor.slug}`);
    await expect(page).toHaveURL(/\/fr\/dashboard\/storefront\/preview$/, { timeout: 15_000 });
    const banner = page.locator("[data-e2e=owner-preview-banner]");
    await expect(banner).toContainText("Aperçu privé · pas encore en ligne");
    await expect(banner).toContainText("Vérifie ton compte");
    await expect(banner).toHaveAttribute("data-online", "false");
    await expect(page.locator("[data-e2e=owner-preview] h1")).toContainText("Walid T.");

    // The dashboard's « Aperçu privé » always opens it.
    await page.goto("/fr/dashboard");
    await page.locator("[data-e2e=storefront-preview-link]").click();
    await expect(page).toHaveURL(/\/fr\/dashboard\/storefront\/preview$/);
    await ctx.close();
  });

  test("a verified owner's preview says the page is online", async ({ browser }) => {
    const { profile } = await newTutor("verified");
    const ctx = await tutorCtx(browser, profile.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/storefront/preview");
    await expect(page.locator("[data-e2e=owner-preview-banner]")).toHaveAttribute("data-online", "true");
    await expect(page.locator("[data-e2e=owner-preview-banner]")).toContainText("ta page est en ligne");
    await ctx.close();
  });

  test("unknown, rejected and suspended slugs are still a hard 404", async ({ request }) => {
    const rejected = await seedTutor({ status: "rejected", fullName: "Rejected Person" });
    const suspended = await seedTutor({ status: "verified", fullName: "Suspended Person" });
    await sql`update tutors set suspended_at = now() where id = ${suspended.id}`;
    for (const slug of [`no-such-tutor-${Date.now()}`, rejected.slug, suspended.slug]) {
      const r = await request.get(`/fr/${slug}`);
      expect(r.status(), slug).toBe(404);
      expect((await r.text()).replace(/&#x27;/g, "'"), slug).toContain("Cette page n'existe pas");
    }
  });
});
