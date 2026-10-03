import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { seedAdmin, seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { api } from "./support/journey";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-2 · C — NO VISIBLE NATIVE <select> OR FILE INPUT, ON ANY PAGE.

   live-fixes-1 · B checked the prof pages; this crawls EVERY route of
   tools/ui-audit/routes.mjs (the audit harness's list of the product's screens),
   in FR and AR, on a phone and a computer, each as the identity it serves:
     · signed out for the public pages and the signup forms (the birth date);
     · a verified tutor for the prof space (plus the forms a click reveals:
       the library form of Mes fiches, the offer form, the promotion form), and a
       DRAFT tutor for /onboarding and /onboarding/verify (the ID uploads);
     · a student for theirs — and, for /onboarding/upgrade, one with no birth date
       on file, the state where the page asks for it;
     · the allowlisted admin for /admin/*;
   plus the routes the list cannot name (a real class, live room, checkout, a
   conversation, the « arrive bientôt » page of a real draft slug).

   A control that is visually hidden (.sr-only: a clipped 1px box) behind a styled,
   labelled one is fine — FileDrop, the verification cards and the profile photo
   keep the real <input type=file> for the keyboard, screen readers and the phone's
   picker. A native control the visitor can SEE is not.

   Positive controls, so a blank or redirected page cannot pass: the four screens
   that had native selects show the shell's Select (a listbox button) in their place,
   and the hidden file inputs are found (and judged hidden).
   The static twin of this check is guardrail 7 (tools/ui-audit/guardrails.mjs).
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

type Who = "anon" | "tutor" | "draft" | "student" | "newcomer" | "admin";
type Visit = { path: string; who: Who; open?: (p: Page) => Promise<unknown> };
type Route = { path: string; name: string; auth?: boolean | "student" | "admin" };

/* The harness's own list, read by Node's ES module loader in a child process: the
   spec runner compiles what it imports as CommonJS, and routes.mjs is a module
   (import.meta). The list is data, so a JSON copy is all this needs. */
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

/** Every <select> / <input type=file> on the page that is RENDERED where a person can see it. */
async function visibleNative(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("select, input[type=file]")) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      // .sr-only: a 1px box, clipped away — there for the keyboard and screen readers, never seen.
      if (r.width <= 2 || r.height <= 2 || cs.clipPath !== "none" || cs.clip !== "auto") continue;
      out.push(el.outerHTML.slice(0, 100));
    }
    return out;
  });
}

/** Hidden file inputs on the page (the positive control for the check above). */
async function hiddenFileInputs(page: Page): Promise<number> {
  return page.locator("input[type=file]").count();
}

/** The routes of the harness, each with the identity it is meant for. */
function routeVisits(ids: { classId: string; draftSlug: string }): Visit[] {
  const out: Visit[] = [];
  for (const r of ROUTES) {
    const auth = r.auth;
    let path = r.path;
    if (path === "/class/c1") path = `/class/${ids.classId}`;
    if (path === "/live/c1") path = `/live/${ids.classId}`;
    if (path === "/checkout") path = `/checkout?class=${ids.classId}`;
    if (path === "/audit-harness") path = `/${ids.draftSlug}`;
    let who: Who = auth === "admin" ? "admin" : auth === "student" ? "student" : auth ? "tutor" : "anon";
    if (path === "/onboarding" || path === "/onboarding/verify") who = "draft";
    if (path === "/onboarding/upgrade") who = "newcomer";
    out.push({ path, who });
  }
  return out;
}

/* The forms a click reveals on the prof pages (the same ones live-fixes-1 · B opens). */
const OPEN: Record<string, (p: Page) => Promise<unknown>> = {
  "/dashboard/materials": (p) => p.locator("[data-e2e=library-toggle]").click(),
  "/dashboard/subscriptions": (p) => p.locator("[data-e2e=offer-new]").click(),
  "/dashboard/promotions": (p) => p.locator("[data-e2e=promo-scope-class]").click(),
};

/* Where a native select used to be: the shell's Select must be there instead. */
const REPLACED: Record<string, string[]> = {
  "/signup/prof": ["birth-month", "birth-year"],
  "/signup/eleve": ["birth-month", "birth-year"],
  "/student/welcome": ["welcome-level"],
  "/onboarding/upgrade": ["upgrade-birth-year", "upgrade-birth-month"],
  "/admin/plans": ["plan-choice"],
};

async function world() {
  const tutorP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Hela Crawl" });
  const tutor = await seedTutor({ profileId: tutorP.id, status: "verified", fullName: "Hela Crawl" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
  const draftP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Karim Draft" });
  const draft = await seedTutor({ profileId: draftP.id, status: "draft", fullName: "Karim Draft" });
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
  const newcomer = await seedProfile({ role: "student", birthYear: null, birthMonth: null, fullName: "Nour Sans Date" });
  const admin = await seedAdmin();
  const booking = await seedBooking({ classId: klass.id, studentId: student.id });
  const thread = (await api("/threads", await mintSession(student.id), { bookingId: booking.id })) as { threadId?: string };
  expect(thread.threadId, "a conversation to visit").toBeTruthy();
  return {
    ids: { tutor: tutorP.id, draft: draftP.id, student: student.id, newcomer: newcomer.id, admin: admin.id },
    classId: klass.id,
    draftSlug: draft.slug,
    threadId: thread.threadId as string,
  };
}

async function contextFor(browser: Browser, w: Awaited<ReturnType<typeof world>>, who: Who, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  if (who !== "anon") await ctx.addCookies([sessionCookie(await mintSession(w.ids[who]))]);
  return ctx;
}

test("C · the check itself: it sees a native select or file input, and lets a visually hidden one be", async ({ page }) => {
  await page.goto("/fr/signup/prof", { waitUntil: "networkidle" });
  expect(await visibleNative(page)).toEqual([]);
  await page.locator("main form").evaluate((form) => {
    form.insertAdjacentHTML(
      "beforeend",
      `<select id="x-sel"><option>Choose</option></select><input id="x-file" type="file">` +
        `<label><input id="x-hidden" type="file" class="sr-only">Choisis un fichier</label>`,
    );
  });
  const seen = await visibleNative(page);
  expect(seen).toHaveLength(2);
  expect(seen.join(" ")).toContain('id="x-sel"');
  expect(seen.join(" ")).toContain('id="x-file"');
  expect(seen.join(" "), "an .sr-only input behind its label is fine").not.toContain("x-hidden");
});

for (const loc of ["fr", "ar"] as const) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`C · every route, ${loc}, ${vp.width}×${vp.height}: no native select or file input in sight`, async ({ browser }) => {
      test.setTimeout(600_000);
      const w = await world();
      const visits: Visit[] = [
        ...routeVisits({ classId: w.classId, draftSlug: w.draftSlug }),
        { path: `/messages/${w.threadId}`, who: "tutor" },
        { path: `/messages/${w.threadId}`, who: "student" },
        { path: "/onboarding/upgrade", who: "student" }, // a birth date on file: nothing to ask
      ];
      const contexts = new Map<Who, BrowserContext>();
      const seen: string[] = [];
      let hiddenFiles = 0;
      try {
        for (const v of visits) {
          if (!contexts.has(v.who)) contexts.set(v.who, await contextFor(browser, w, v.who, vp));
          const page = await contexts.get(v.who)!.newPage();
          const url = `/${loc}${v.path === "/" ? "" : v.path}`;
          /* "load", then network idle CAPPED: /admin/plans lists every tutor — hundreds
             by this point of a full run — and never goes idle in time (l5-fields.spec.ts
             says the same). What has to be on screen is waited for below. */
          await page.goto(url);
          await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
          const at = `${url} as ${v.who} @${vp.width}`;
          if (v.who !== "anon") {
            expect(new URL(page.url()).pathname, `${at}: still signed in`).not.toMatch(/\/(fr|ar)\/auth$/);
          }
          const bare = v.path.split("?")[0];
          const open = OPEN[bare];
          if (open && v.who === "tutor") await open(page);
          // The positive control first (it waits for the content), then the check on it.
          for (const hook of v.who === "student" && bare === "/onboarding/upgrade" ? [] : REPLACED[bare] ?? []) {
            await expect(page.locator(`[data-e2e=${hook}]`).first(), `${at}: the shell's Select « ${hook} »`).toHaveAttribute("aria-haspopup", "listbox");
          }
          expect(await visibleNative(page), `${at}: a visible native select or file input`).toEqual([]);
          hiddenFiles += await hiddenFileInputs(page);
          seen.push(at);
          await page.close();
        }
      } finally {
        for (const ctx of contexts.values()) await ctx.close();
      }
      expect(seen.length, "every route of the harness was visited").toBe(visits.length);
      expect(hiddenFiles, "the hidden file inputs were found (and judged hidden)").toBeGreaterThan(0);
    });
  }
}
