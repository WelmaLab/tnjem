import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   student-space-v1 · A — THE STUDENT SHELL (UI_options/espace-eleve-1-shell-accueil.png,
   espace-eleve-4-profil-mobile-ar.png 4c).

   The frame only, never the pages inside it (the pages lane rebuilds those): the
   sidebar (Accueil · APPRENDRE · ÉCHANGER · COMPTE), its active item and its badges on
   real rows, the avatar card and its menu (Profil · Aide · Se déconnecter), the top bar
   (breadcrumbs, FR·ع, messages, the bell), the phone's five tabs and its avatar; where
   the shell applies (students on /student/**, /account, /messages/**) and where it does
   not (tutors, parents, guests, /live/<id>); the old « /student » bell links; and the
   public header and footer in their three states — logged out, student, prof — with
   the server HTML still the logged-out one (ISR).
   FR + AR, at 1440×900 and 390×844. The API side is apps/api/test/ssv1-a-student-shell.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

type Role = "student" | "tutor" | "guardian";

async function ctxAs(browser: Browser, profileId: string | null, role: Role | null, viewport = DESKTOP): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  if (profileId) await loginAs(ctx, profileId);
  // The readable role hint the public chrome reads (lib/auth.ts sets it with the session).
  if (role) await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  return ctx;
}

async function newStudent(fullName = "Ahmed Malek") {
  return seedProfile({ role: "student", birthYear: 1998, fullName });
}

async function newTutor(fullName = "Walid Tester") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  return { profile, tutor };
}

/** A conversation where the prof wrote last and the student never opened it: 1 unread. */
async function seedUnreadMessage(tutorProfileId: string, studentId: string, bookingId: string, classId: string) {
  const [t] = await sql<{ id: string }[]>`
    insert into message_threads (booking_id, class_id, tutor_profile_id, student_profile_id, last_message_at)
    values (${bookingId}, ${classId}, ${tutorProfileId}, ${studentId}, now())
    returning id`;
  await sql`insert into messages (thread_id, sender_profile_id, body) values (${t.id}, ${tutorProfileId}, ${"Bonjour, à jeudi !"})`;
}

const sidebar = (page: Page) => page.locator("[data-e2e=shell-sidebar]");
const crumbs = (page: Page) => page.locator("[data-e2e=shell-crumbs] li");

const L = {
  fr: {
    groups: ["Apprendre", "Échanger", "Compte"],
    links: ["Accueil", "Mes cours", "Mes profs", "Mes fiches", "Messages", "Profil", "Aide"],
    tabs: ["Accueil", "Cours", "Profs", "Fiches", "Messages"],
    home: ["Accueil"],
    account: ["Compte", "Profil"],
    messages: ["Échanger", "Messages"],
    line: "Élève · Pilote",
    profile: "Profil",
    help: "Aide",
    logout: "Se déconnecter",
    space: "Mon espace",
  },
  ar: {
    groups: ["نتعلّم", "نتواصلو", "الحساب"],
    links: ["الرئيسية", "حصصي", "أساتذتي", "ملخّصاتي", "الرسائل", "حسابي", "مساعدة"],
    tabs: ["الرئيسية", "حصصي", "أساتذتي", "ملخّصاتي", "الرسائل"],
    home: ["الرئيسية"],
    account: ["الحساب", "حسابي"],
    messages: ["نتواصلو", "الرسائل"],
    line: "تلميذ · تجربة",
    profile: "حسابي",
    help: "مساعدة",
    logout: "اخرج من حسابك",
    space: "فضائي",
  },
} as const;

for (const locale of ["fr", "ar"] as const) {
  const l = L[locale];

  test.describe(`desktop 1440×900 · ${locale}`, () => {
    test("the frame: sidebar groups and items, the active item, the avatar card, no public chrome", async ({ browser }) => {
      const student = await newStudent();
      const ctx = await ctxAs(browser, student.id, "student");
      const page = await ctx.newPage();
      await page.goto(`/${locale}/student`);

      await expect(page.locator("[data-e2e=student-shell]")).toBeVisible();
      await expect(page.locator("[data-e2e=app-shell]"), "not the prof's shell").toHaveCount(0);
      await expect(page.locator(".site-header")).toHaveCount(0);
      await expect(page.locator(".site-footer")).toHaveCount(0);
      await expect(page.locator("main")).toHaveCount(1);
      await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");

      const side = sidebar(page);
      await expect(side).toBeVisible();
      await expect(side.locator(".aps-group-t")).toHaveText([...l.groups]);
      await expect(side.locator(".aps-link-t")).toHaveText([...l.links]);
      const hrefs = await side.locator(".aps-link").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      expect(hrefs).toEqual(["/student", "/student/cours", "/student/profs", "/student/fiches", "/messages", "/account", "/aide"].map((h) => `/${locale}${h}`));
      await expect(side.locator("[data-e2e=nav-home]")).toHaveAttribute("aria-current", "page");
      await expect(side.locator("[aria-current=page]")).toHaveCount(1);

      // The avatar card: "Ahmed M.", "Élève · Pilote" (payments are off).
      await expect(page.locator("[data-e2e=shell-me]")).toContainText("Ahmed M.");
      await expect(page.locator("[data-e2e=shell-me] .aps-me-av")).toHaveText("AM");
      await expect(page.locator("[data-e2e=shell-plan]")).toHaveText(l.line);

      // The top bar: crumbs, FR·ع, messages, the bell. The phone's pieces are not shown.
      await expect(crumbs(page)).toHaveText([...l.home]);
      const top = page.locator("[data-e2e=shell-topbar]");
      await expect(top.locator(".qlt")).toBeVisible();
      await expect(top.locator("[data-e2e=shell-messages]")).toHaveAttribute("href", `/${locale}/messages`);
      await expect(top.locator("[data-e2e=shell-bell]")).toBeVisible();
      await expect(top.locator("[data-e2e=shell-me-top]")).toBeHidden();
      await expect(page.locator("[data-e2e=shell-tabs]")).toBeHidden();

      if (locale === "ar") {
        const s = await side.boundingBox();
        const m = await page.locator("main").boundingBox();
        expect(s && m && s.x > m.x, "the sidebar is on the inline start — the right, in Arabic").toBe(true);
      }
      await ctx.close();
    });

    test("the avatar menu: Profil · Aide · Se déconnecter; Escape closes it and gives focus back", async ({ browser }) => {
      const student = await newStudent();
      const ctx = await ctxAs(browser, student.id, "student");
      const page = await ctx.newPage();
      await page.goto(`/${locale}/student`);
      const me = page.locator("[data-e2e=shell-me]");
      await expect(me).toHaveAttribute("aria-expanded", "false");
      await me.click();
      await expect(me).toHaveAttribute("aria-expanded", "true");
      const menu = page.locator("[data-e2e=shell-me-menu]");
      await expect(menu.locator(".aps-menu-item")).toHaveText([l.profile, l.help, l.logout]);
      await expect(menu.getByRole("link", { name: l.profile })).toHaveAttribute("href", `/${locale}/account`);
      await expect(menu.getByRole("link", { name: l.help })).toHaveAttribute("href", `/${locale}/aide`);
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(me).toBeFocused();

      // « Profil » opens /account inside the shell: COMPTE › Profil, the item lit.
      await me.click();
      await menu.getByRole("link", { name: l.profile }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
      await expect(crumbs(page)).toHaveText([...l.account]);
      await expect(sidebar(page).locator("[data-e2e=nav-profile]")).toHaveAttribute("aria-current", "page");
      await expect(page.locator(".site-header")).toHaveCount(0);
      await ctx.close();
    });

    test("badges on real rows: upcoming classes, unread messages, the bell; nothing invented at zero", async ({ browser }) => {
      const student = await newStudent();
      const { profile, tutor } = await newTutor();
      const k1 = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
      const k2 = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
      const b1 = await seedBooking({ classId: k1.id, studentId: student.id });
      await seedBooking({ classId: k2.id, studentId: student.id });
      // Not upcoming: a cancelled seat, and a class that ended yesterday.
      const k3 = await seedClass({ tutorId: tutor.id, hoursFromNow: 120 });
      await seedBooking({ classId: k3.id, studentId: student.id, status: "cancelled" });
      const past = await seedClass({ tutorId: tutor.id, hoursFromNow: -26 });
      await seedBooking({ classId: past.id, studentId: student.id });
      await seedUnreadMessage(profile.id, student.id, b1.id, k1.id);
      await sql`insert into notifications (id, profile_id, kind, msg_key, msg_params, href)
                values (${randomUUID()}, ${student.id}, 'booking_confirmed', 'bookingConfirmed',
                        ${sql.json({ classTitle: k1.title, at: new Date(Date.now() + 48 * 3600_000).toISOString() })}, ${`/class/${k1.id}`})`;

      const ctx = await ctxAs(browser, student.id, "student");
      const page = await ctx.newPage();
      await page.goto(`/${locale}/student`);
      const side = sidebar(page);
      await expect(side.locator("[data-e2e=nav-badge-courses]")).toHaveText("2");
      await expect(side.locator("[data-e2e=nav-badge-messages]")).toHaveText("1");
      // No fiche was ever added: no badge at all (never a « 0 » pill).
      await expect(side.locator("[data-e2e=nav-badge-fiches]")).toHaveCount(0);
      await expect(side.locator("[data-e2e=nav-badge-tutors]")).toHaveCount(0);
      // The screen reader hears what the number means.
      await expect(side.locator("[data-e2e=nav-courses]")).toContainText(locale === "fr" ? "2 séances à venir" : "2 حصص جايين");
      await expect(page.locator("[data-e2e=shell-messages-count]")).toHaveText("1");
      await expect(page.locator("[data-e2e=shell-bell-count]")).toHaveText("1");

      // Opening the bell reads it; the badge drops.
      await page.locator("[data-e2e=shell-bell]").click();
      await expect(page.locator("#aps-bell-panel .aps-note")).toHaveCount(1);
      await expect(page.locator("[data-e2e=shell-bell-count]")).toHaveCount(0);
      await ctx.close();
    });

    test("breadcrumbs and the active item follow the page: Messages, the welcome screen, Profil in the other language", async ({ browser }) => {
      const student = await newStudent();
      const ctx = await ctxAs(browser, student.id, "student");
      const page = await ctx.newPage();
      await page.goto(`/${locale}/messages`);
      await expect(page.locator("[data-e2e=student-shell]")).toBeVisible();
      await expect(crumbs(page)).toHaveText([...l.messages]);
      await expect(sidebar(page).locator("[data-e2e=nav-messages]")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("[data-e2e=shell-messages]")).toHaveAttribute("aria-current", "page");

      await page.goto(`/${locale}/student/welcome`);
      await expect(page.locator("[data-e2e=student-shell]")).toBeVisible();
      await expect(crumbs(page).first().locator("a")).toHaveAttribute("href", `/${locale}/student`);
      await expect(sidebar(page).locator("[data-e2e=nav-home]")).toHaveAttribute("aria-current", "page");

      // FR·ع in the top bar switches the language and keeps the page.
      const other = locale === "fr" ? "ar" : "fr";
      await page.goto(`/${locale}/account`);
      await page.locator("[data-e2e=shell-topbar] .qlt button").filter({ hasText: other === "ar" ? "ع" : "FR" }).first().click();
      await expect(page).toHaveURL(new RegExp(`/${other}/account$`));
      await expect(crumbs(page)).toHaveText([...L[other].account]);
      await ctx.close();
    });
  });

  test.describe(`phone 390×844 · ${locale}`, () => {
    test("five tabs (no « + », no Profil tab), the unread count on Messages, 44px targets, mirrored in Arabic", async ({ browser }) => {
      const student = await newStudent();
      const { profile, tutor } = await newTutor();
      const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
      const b = await seedBooking({ classId: k.id, studentId: student.id });
      await seedUnreadMessage(profile.id, student.id, b.id, k.id);

      const ctx = await ctxAs(browser, student.id, "student", PHONE);
      const page = await ctx.newPage();
      await page.goto(`/${locale}/student`);

      await expect(sidebar(page)).toBeHidden();
      const tabs = page.locator("[data-e2e=shell-tabs]");
      await expect(tabs).toBeVisible();
      await expect(tabs.locator(".aps-tab")).toHaveCount(5);
      for (const [i, label] of l.tabs.entries()) await expect(tabs.locator(".aps-tab").nth(i)).toContainText(label);
      const hrefs = await tabs.locator(".aps-tab").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
      expect(hrefs).toEqual(["/student", "/student/cours", "/student/profs", "/student/fiches", "/messages"].map((h) => `/${locale}${h}`));
      await expect(tabs.locator("[data-e2e=tab-home]")).toHaveAttribute("aria-current", "page");
      await expect(page.locator("[data-e2e=shell-fab]")).toHaveCount(0);
      await expect(page.locator("[data-e2e=tab-profile]")).toHaveCount(0);
      await expect(tabs.locator("[data-e2e=tab-badge-messages]")).toHaveText("1");
      for (const h of await tabs.locator(".aps-tab").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
        expect(h).toBeGreaterThanOrEqual(44);
      }
      // The tab bar spans the screen; the top bar keeps the bell and the avatar, and leaves
      // the messages button to the tab.
      const bar = await tabs.boundingBox();
      expect(bar && Math.round(bar.width)).toBe(PHONE.width);
      const top = page.locator("[data-e2e=shell-topbar]");
      await expect(top.locator("[data-e2e=shell-bell]")).toBeVisible();
      await expect(top.locator("[data-e2e=shell-me-top]")).toBeVisible();
      await expect(top.locator("[data-e2e=shell-messages]")).toBeHidden();
      const topWidth = await top.evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(topWidth, "the top bar fits 390px").toBe(true);

      // Arabic mirrors: Accueil is the tab on the right.
      const first = await tabs.locator("[data-e2e=tab-home]").boundingBox();
      const last = await tabs.locator("[data-e2e=tab-messages]").boundingBox();
      expect(first && last && (locale === "ar" ? first.x > last.x : first.x < last.x)).toBe(true);

      // A tab goes where it says (Messages exists in every lane).
      await tabs.locator("[data-e2e=tab-messages]").click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/messages$`));
      await expect(tabs.locator("[data-e2e=tab-messages]")).toHaveAttribute("aria-current", "page");
      await ctx.close();
    });

    test("Profil through the avatar: Profil · Aide · Se déconnecter; signing out ends the session", async ({ browser }) => {
      const student = await newStudent();
      const ctx = await ctxAs(browser, student.id, "student", PHONE);
      const page = await ctx.newPage();
      await page.goto(`/${locale}/student`);
      const av = page.locator("[data-e2e=shell-me-top]");
      await expect(av).toHaveText("AM");
      const box = await av.boundingBox();
      expect(box && box.width >= 44 && box.height >= 44).toBe(true);
      await av.click();
      const menu = page.locator("[data-e2e=shell-me-top-menu]");
      await expect(menu.locator(".aps-menu-item")).toHaveText([l.profile, l.help, l.logout]);
      // The menu stays on screen.
      const mb = await menu.boundingBox();
      expect(mb && mb.x >= 0 && mb.x + mb.width <= PHONE.width).toBe(true);
      await menu.getByRole("link", { name: l.profile }).click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/account$`));
      await expect(page.locator("[data-e2e=student-shell]")).toBeVisible();

      await av.click();
      await menu.getByRole("button", { name: l.logout }).click();
      await page.waitForURL((u) => !u.pathname.includes("/account"));
      const left = await ctx.cookies();
      expect(left.find((c) => c.name === "tnajem_session"), "the session cookie is gone").toBeUndefined();
      await page.goto(`/${locale}/student`);
      await expect(page).toHaveURL(new RegExp(`/${locale}/auth`));
      await ctx.close();
    });
  });
}

test.describe("where the shell applies, and where it does not", () => {
  test("a tutor on a student page goes to /dashboard; /account to Réglages; /messages keeps the prof's shell", async ({ browser }) => {
    const { profile } = await newTutor();
    const ctx = await ctxAs(browser, profile.id, "tutor");
    for (const path of ["/fr/student", "/fr/student/welcome", "/ar/student"]) {
      const res = await ctx.request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBeGreaterThanOrEqual(300);
      expect(res.headers()["location"], path).toMatch(/\/(fr|ar)\/dashboard$/);
    }
    const page = await ctx.newPage();
    await page.goto("/fr/account");
    await expect(page).toHaveURL(/\/fr\/dashboard\/settings$/);
    await page.goto("/fr/messages");
    await expect(page.locator("[data-e2e=app-shell]")).toBeVisible();
    await expect(page.locator("[data-e2e=student-shell]")).toHaveCount(0);
    await ctx.close();
  });

  test("a parent and a guest keep the pages as before (no shell)", async ({ browser }) => {
    const parent = await seedProfile({ role: "guardian", birthYear: 1975, fullName: "Mounira Parent" });
    const ctx = await ctxAs(browser, parent.id, "guardian");
    const page = await ctx.newPage();
    for (const path of ["/fr/account", "/fr/messages"]) {
      await page.goto(path);
      await expect(page.locator(".site-header"), path).toBeVisible();
      await expect(page.locator("[data-e2e=student-shell]"), path).toHaveCount(0);
      await expect(page.locator("[data-e2e=app-shell]"), path).toHaveCount(0);
    }
    await ctx.close();

    const guest = await browser.newContext();
    const res = await guest.request.get("/fr/student", { maxRedirects: 0 });
    expect(res.headers()["location"]).toMatch(/\/fr\/auth/);
    await guest.close();
  });

  test("/live/<id> stays full-screen: no shell around the live room", async ({ browser }) => {
    const student = await newStudent();
    const { tutor } = await newTutor();
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 0.25 });
    await seedBooking({ classId: k.id, studentId: student.id });
    const ctx = await ctxAs(browser, student.id, "student");
    const page = await ctx.newPage();
    await page.goto(`/fr/live/${k.id}`);
    await expect(page.locator("main, body").first()).toBeVisible();
    await expect(page.locator("[data-e2e=student-shell]")).toHaveCount(0);
    await expect(page.locator("[data-e2e=shell-sidebar]")).toHaveCount(0);
    await expect(page.locator("[data-e2e=shell-tabs]")).toHaveCount(0);
    await ctx.close();
  });

  test("old deep links: a bell row that says « /student » lands where it meant", async ({ browser }) => {
    const student = await newStudent();
    await sql`insert into notifications (id, profile_id, kind, msg_key, msg_params, href, created_at)
              values (${randomUUID()}, ${student.id}, 'booking_cancelled', 'classCancelledByTutor',
                      ${sql.json({ classTitle: "Intégrales", at: new Date().toISOString() })}, '/student', now()),
                     (${randomUUID()}, ${student.id}, 'class_reminder', 'classMoved',
                      ${sql.json({ classTitle: "Suites", at: new Date().toISOString() })}, '/student', now() - interval '1 minute')`;
    const ctx = await ctxAs(browser, student.id, "student");
    const page = await ctx.newPage();
    await page.goto("/fr/student");
    await page.locator("[data-e2e=shell-bell]").click();
    const links = page.locator("#aps-bell-panel a.aps-note");
    await expect(links).toHaveCount(2);
    expect(await links.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual([
      "/fr/student/cours?tab=annulees",
      "/fr/student/cours?tab=avenir",
    ]);
    await ctx.close();
  });
});

test.describe("the public header and footer: logged out, student, prof (client-side, ISR intact)", () => {
  async function storefront(): Promise<string> {
    const { tutor } = await newTutor("Sana Prof");
    return `/${tutor.slug}`;
  }

  for (const locale of ["fr", "ar"] as const) {
    test(`${locale} · the three states at 1440, on a cached public page`, async ({ browser }) => {
      const slug = await storefront();
      const signIn = locale === "fr" ? "Se connecter" : "دخول";

      // Logged out: exactly as before.
      const guest = await ctxAs(browser, null, null);
      let page = await guest.newPage();
      await page.goto(`/${locale}${slug}`);
      await expect(page.locator("[data-e2e=header-signin]")).toBeVisible();
      await expect(page.locator("[data-e2e=header-space]")).toHaveCount(0);
      await expect(page.locator("header a.qh-cta")).toHaveAttribute("href", `/${locale}/signup/prof`);
      await expect(page.locator("[data-e2e=footer-signin]")).toHaveText(signIn);
      await expect(page.locator("[data-e2e=footer-dashboard]")).toBeVisible();
      await expect(page.locator(".site-footer a[href$='/student']")).toHaveCount(1);
      await guest.close();

      // A student: « Mon espace » → /student; the footer hides « Se connecter » and « Tableau de bord ».
      const student = await newStudent();
      const sctx = await ctxAs(browser, student.id, "student");
      page = await sctx.newPage();
      await page.goto(`/${locale}${slug}`);
      await expect(page.locator("[data-e2e=header-space]")).toHaveText(L[locale].space);
      await expect(page.locator("[data-e2e=header-space]")).toHaveAttribute("href", `/${locale}/student`);
      await expect(page.locator("[data-e2e=header-signin]")).toHaveCount(0);
      await expect(page.locator("[data-e2e=footer-space]")).toHaveText(L[locale].space);
      await expect(page.locator("[data-e2e=footer-signin]")).toHaveCount(0);
      await expect(page.locator("[data-e2e=footer-dashboard]")).toHaveCount(0);
      await expect(page.locator(".site-footer").getByText(signIn, { exact: true })).toHaveCount(0);
      await page.locator("[data-e2e=header-space]").click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/student$`));
      await expect(page.locator("[data-e2e=student-shell]")).toBeVisible();

      /* ISR: the SERVER html of the same page, fetched with the student's cookies, is the
         logged-out one — the header and footer change after hydration, never on the server. */
      const html = await (await sctx.request.get(`/${locale}${slug}`)).text();
      expect(html).toContain('data-e2e="footer-signin"');
      expect(html).not.toContain('data-e2e="header-space"');
      await sctx.close();

      // A prof: « Tableau de bord » in the header and the footer; no « Se connecter ».
      const { profile } = await newTutor();
      const tctx = await ctxAs(browser, profile.id, "tutor");
      page = await tctx.newPage();
      await page.goto(`/${locale}${slug}`);
      await expect(page.locator("[data-e2e=header-space]")).toHaveAttribute("href", `/${locale}/dashboard`);
      await expect(page.locator("[data-e2e=header-signin]")).toHaveCount(0);
      await expect(page.locator("[data-e2e=footer-dashboard]")).toHaveAttribute("href", `/${locale}/dashboard`);
      await expect(page.locator("[data-e2e=footer-signin]")).toHaveCount(0);
      await expect(page.locator(".site-footer a[href$='/student']")).toHaveCount(0);
      await tctx.close();
    });
  }

  test("phone 390 · a student finds « Mon espace » in the menu, and no « Se connecter »", async ({ browser }) => {
    const student = await newStudent();
    const ctx = await ctxAs(browser, student.id, "student", PHONE);
    const page = await ctx.newPage();
    await page.goto("/fr/explore");
    await page.locator(".qh-burger").click();
    const menu = page.locator("#qh-menu");
    await expect(menu.getByRole("link", { name: "Mon espace" })).toHaveAttribute("href", "/fr/student");
    await expect(menu.getByRole("link", { name: "Se connecter" })).toHaveCount(0);
    await expect(page.locator("[data-e2e=footer-signin]")).toHaveCount(0);
    await ctx.close();
  });
});

