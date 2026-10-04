import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedAdmin, seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { api } from "./support/journey";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-3 · H — NO INTERACTIVE ELEMENT INSIDE ANOTHER, ON ANY PAGE.

   The student page's « Rejoindre le direct » was a <button> inside an <a>: invalid
   HTML, and a click lands on one or the other depending on the browser (and a screen
   reader announces two controls for one action). It is now ONE link styled as a
   button — and so are the « Se connecter » of the admin pages' refusal panels, which
   had the same <Link><Button/></Link>.

   This crawls EVERY route of tools/ui-audit/routes.mjs plus EXTRA (the routes the list
   cannot name, and other identities on the same route), each as the identity it
   serves — signed out, a verified tutor with classes and a booking, a draft tutor, a
   student with an upcoming and a live-now class, a student with no birth date, the
   allowlisted admin, and a tutor on the admin pages (their refusal panel) — at 1440 and
   390 wide, and fails on any interactive element (a link, button, form field, summary,
   [role=button|link|checkbox|switch|tab|menuitem|radio], [tabindex≥0]) found INSIDE a
   link, a button, a [role=button|link] or a <summary>.

   TO EXTEND: add a { path, who } to EXTRA (the room team's « Démarrer la séance » links
   on Mes classes and Accueil are on /dashboard/classes and /dashboard, already crawled
   as the tutor with classes). A positive control proves the check sees a nesting.
   ADDED as its own spec. The static twin is guardrail 9 (tools/ui-audit/guardrails.mjs).
   ════════════════════════════════════════════════════════════════════════════ */

type Who = "anon" | "tutor" | "draft" | "student" | "newcomer" | "admin";
type Visit = { path: string; who: Who };
type Route = { path: string; name: string; auth?: boolean | "student" | "admin" };

const ROUTES: Route[] = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { ROUTES } = await import(${JSON.stringify(pathToFileURL(resolve(__dirname, "../tools/ui-audit/routes.mjs")).href)});
       process.stdout.write(JSON.stringify(ROUTES));`,
    ],
    { encoding: "utf8" },
  ),
);

type Ids = { classId: string; liveClassId: string; draftSlug: string; tutorSlug: string; threadId: string };

/** Routes the harness list cannot name, or the same route as another identity. Extend freely. */
const EXTRA = (ids: Ids): Visit[] => [
  { path: `/class/${ids.classId}`, who: "anon" },
  { path: `/class/${ids.classId}`, who: "student" },
  { path: `/checkout?class=${ids.classId}`, who: "student" },
  { path: `/live/${ids.classId}`, who: "student" },
  { path: `/live/${ids.liveClassId}`, who: "student" },
  { path: `/live/${ids.liveClassId}`, who: "tutor" },
  { path: `/${ids.tutorSlug}`, who: "anon" },
  { path: `/${ids.tutorSlug}`, who: "student" },
  { path: `/messages/${ids.threadId}`, who: "tutor" },
  { path: `/messages/${ids.threadId}`, who: "student" },
  { path: "/messages", who: "student" },
  { path: "/account", who: "student" },
  { path: "/onboarding/upgrade", who: "student" },
  // The admin pages as someone who is not an admin: their « Accès réservé » panel.
  { path: "/admin/verifications", who: "tutor" },
  { path: "/admin/plans", who: "tutor" },
  { path: "/admin/accounts", who: "tutor" },
  { path: "/admin/moderation", who: "tutor" },
];

/** The harness's routes, each with the identity it is meant for. */
function routeVisits(ids: Ids): Visit[] {
  const out: Visit[] = [];
  for (const r of ROUTES) {
    let path = r.path;
    if (path === "/class/c1") path = `/class/${ids.classId}`;
    if (path === "/live/c1") path = `/live/${ids.classId}`;
    if (path === "/checkout") path = `/checkout?class=${ids.classId}`;
    if (path === "/audit-harness") path = `/${ids.draftSlug}`;
    let who: Who = r.auth === "admin" ? "admin" : r.auth === "student" ? "student" : r.auth ? "tutor" : "anon";
    if (path === "/onboarding" || path === "/onboarding/verify") who = "draft";
    if (path === "/onboarding/upgrade") who = "newcomer";
    out.push({ path, who });
  }
  return out;
}

/** Every interactive element that sits inside another one, on the rendered page. */
async function nested(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const OUTER = "a[href], button, summary, [role=button], [role=link]";
    const INNER =
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [role=radio], [tabindex]:not([tabindex="-1"])';
    const tag = (el: Element) =>
      `<${el.tagName.toLowerCase()}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}${el.getAttribute("href") ? ` href=${el.getAttribute("href")}` : ""}${el.className && typeof el.className === "string" ? ` class="${el.className.slice(0, 50)}"` : ""}> « ${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)} »`;
    const out: string[] = [];
    for (const outer of document.querySelectorAll(OUTER)) {
      for (const inner of outer.querySelectorAll(INNER)) out.push(`${tag(inner)} inside ${tag(outer)}`);
    }
    return out;
  });
}

async function world() {
  const tutorP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Hela Nest" });
  const tutor = await seedTutor({ profileId: tutorP.id, status: "verified", fullName: "Hela Nest" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
  // Started ten minutes ago: the « live now » states (student hero card, the lobby).
  const live = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 10 * 60_000) });
  const draftP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Karim Draft" });
  const draft = await seedTutor({ profileId: draftP.id, status: "draft", fullName: "Karim Draft" });
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
  const newcomer = await seedProfile({ role: "student", birthYear: null, birthMonth: null, fullName: "Nour Sans Date" });
  const admin = await seedAdmin();
  const booking = await seedBooking({ classId: klass.id, studentId: student.id });
  await seedBooking({ classId: live.id, studentId: student.id });
  const thread = (await api("/threads", await mintSession(student.id), { bookingId: booking.id })) as { threadId?: string };
  expect(thread.threadId, "a conversation to visit").toBeTruthy();
  return {
    ids: { tutor: tutorP.id, draft: draftP.id, student: student.id, newcomer: newcomer.id, admin: admin.id } as Record<Exclude<Who, "anon">, string>,
    route: { classId: klass.id, liveClassId: live.id, draftSlug: draft.slug, tutorSlug: tutor.slug, threadId: thread.threadId as string },
  };
}

async function contextFor(browser: Browser, w: Awaited<ReturnType<typeof world>>, who: Who, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  if (who !== "anon") await ctx.addCookies([sessionCookie(await mintSession(w.ids[who]))]);
  return ctx;
}

test("H · the check itself: it sees a control inside a link or a button", async ({ page }) => {
  await page.goto("/fr/aide", { waitUntil: "networkidle" });
  expect(await nested(page)).toEqual([]);
  await page.locator("main").evaluate((main) => {
    main.insertAdjacentHTML(
      "beforeend",
      `<a id="x-a" href="/fr/explore"><button type="button">Rejoindre</button></a>` +
        `<button id="x-b" type="button"><a href="/fr/explore">lien</a></button>` +
        `<a id="x-ok" href="/fr/explore" class="btn btn-primary">Un seul lien</a>`,
    );
  });
  const seen = await nested(page);
  expect(seen).toHaveLength(2);
  expect(seen.join("\n")).toContain("Rejoindre");
  expect(seen.join("\n"), "a single link styled as a button is fine").not.toContain("Un seul lien");
});

for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`H · every route, every role, ${vp.width}×${vp.height}: no interactive element inside another`, async ({ browser }) => {
    test.setTimeout(600_000);
    const w = await world();
    const visits: Visit[] = [...routeVisits(w.route), ...EXTRA(w.route)];
    const contexts = new Map<Who, BrowserContext>();
    const offenders: string[] = [];
    const seen: string[] = [];
    let controls = 0;
    try {
      for (const v of visits) {
        if (!contexts.has(v.who)) contexts.set(v.who, await contextFor(browser, w, v.who, vp));
        const page = await contexts.get(v.who)!.newPage();
        const url = `/fr${v.path === "/" ? "" : v.path}`;
        await page.goto(url);
        await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
        const at = `${url} as ${v.who}`;
        if (v.who !== "anon") expect(new URL(page.url()).pathname, `${at}: still signed in`).not.toMatch(/\/(fr|ar)\/auth$/);
        for (const n of await nested(page)) offenders.push(`${at}: ${n}`);
        controls += await page.locator("main a[href], main button").count();
        seen.push(at);
        await page.close();
      }
    } finally {
      for (const ctx of contexts.values()) await ctx.close();
    }
    expect(seen.length, "every route was visited").toBe(visits.length);
    expect(controls, "the pages rendered their controls").toBeGreaterThan(visits.length);
    expect(offenders, "interactive elements nested in another").toEqual([]);
  });
}

test("H · the student page: « Rejoindre le direct » is ONE link, styled as a button", async ({ browser }) => {
  const w = await world();
  const ctx = await contextFor(browser, w, "student", { width: 1440, height: 900 });
  const page = await ctx.newPage();
  await page.goto("/fr/student");
  const join = page.getByRole("link", { name: "Rejoindre le direct" }).first();
  await expect(join).toBeVisible({ timeout: 20_000 });
  await expect(join).toHaveClass(/\bbtn\b/);
  await expect(join).toHaveAttribute("href", /\/fr\/live\//);
  expect(await join.locator("button, a").count(), "nothing interactive inside it").toBe(0);
  await expect(page.getByRole("button", { name: "Rejoindre le direct" })).toHaveCount(0);
  await join.click();
  await expect(page).toHaveURL(/\/fr\/live\//);
  await ctx.close();
});
