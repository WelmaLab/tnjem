import { test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { seedBooking, seedClass, seedProfile, seedTutor } from "../support/seed";
import { loginAs } from "../support/session";
import { BASE_URL } from "../support/env";

/* espace prof v2 · phase 1 (shell) — screenshots of every prof page in FR and AR, at
   1440 and 390. NOT part of `npm run test` (*.capture.ts). Run with

     npx playwright test -c e2e/visual/visual.config.ts ep2-shell

   against a running production build. Output: ui-espace-prof-v2/phase1/ (gitignored).

   Two tutors: "Walid Tester", a fresh DRAFT (image 1's state: step 2 of 5, the
   « Fais-toi vérifier » blocker), and "Amel Ben Salah", VERIFIED, with classes and
   bookings (the populated lists). */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? join("ui-espace-prof-v2", "phase1"));

type Who = "anon" | "draft" | "verified";
const PAGES: { name: string; path: string; who: Who; open?: "sheet" | "fab" | "bell" | "calendar" }[] = [
  { name: "home-draft", path: "/dashboard", who: "draft" },
  { name: "home-verified", path: "/dashboard", who: "verified" },
  { name: "classes", path: "/dashboard/classes", who: "verified" },
  { name: "students", path: "/dashboard/students", who: "verified" },
  { name: "storefront", path: "/dashboard/storefront", who: "draft" },
  { name: "preview-draft", path: "/dashboard/storefront/preview", who: "draft" },
  { name: "plan", path: "/dashboard/plan", who: "verified" },
  { name: "materials", path: "/dashboard/materials", who: "verified" },
  { name: "new-class", path: "/dashboard/new-class", who: "verified" },
  { name: "new-class-calendar", path: "/dashboard/new-class", who: "verified", open: "calendar" },
  { name: "new-pack", path: "/dashboard/new-pack", who: "draft" },
  { name: "verify", path: "/onboarding/verify", who: "draft" },
  { name: "messages", path: "/messages", who: "verified" },
  { name: "account", path: "/account", who: "verified" },
  { name: "home-sheet", path: "/dashboard", who: "draft", open: "sheet" },
  { name: "home-fab", path: "/dashboard", who: "draft", open: "fab" },
  { name: "coming-soon", path: "/__DRAFT_SLUG__", who: "anon" },
];

const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function contextFor(browser: Browser, who: Who, viewport: { width: number; height: number }, ids: Record<Exclude<Who, "anon">, string>) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  if (who !== "anon") {
    await loginAs(ctx, ids[who]);
    const u = new URL(BASE_URL);
    await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: u.hostname, path: "/" }]);
  }
  return ctx;
}

test("capture every phase-1 prof page, FR + AR, 1440 + 390", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  await mkdir(OUT, { recursive: true });

  const draftP = await seedProfile({ role: "tutor", fullName: "Walid Tester", birthYear: 1990 });
  const draft = await seedTutor({ profileId: draftP.id, status: "draft", fullName: "Walid Tester" });
  const verP = await seedProfile({ role: "tutor", fullName: "Amel Ben Salah", birthYear: 1988 });
  const ver = await seedTutor({ profileId: verP.id, status: "verified", fullName: "Amel Ben Salah" });
  const soon = await seedClass({ tutorId: ver.id, hoursFromNow: 30, seats: 6 });
  await seedClass({ tutorId: ver.id, hoursFromNow: 120, seats: 10 });
  const past = await seedClass({ tutorId: ver.id, hoursFromNow: -96, seats: 8 });
  for (const name of ["Yosra Trabelsi", "Mehdi Jaziri"]) {
    const s = await seedProfile({ role: "student", fullName: name, birthYear: 1999 });
    await seedBooking({ classId: soon.id, studentId: s.id });
    await seedBooking({ classId: past.id, studentId: s.id, status: "attended" });
  }
  const ids = { draft: draftP.id, verified: verP.id };

  for (const locale of ["fr", "ar"] as const) {
    for (const vp of VIEWPORTS) {
      for (const p of PAGES) {
        // The tab bar and the « + » exist on phones only.
        if ((p.open === "sheet" || p.open === "fab") && vp.width >= 900) continue;
        const ctx = await contextFor(browser, p.who, vp, ids);
        const page = await ctx.newPage();
        await page.goto(`/${locale}${p.path.replace("__DRAFT_SLUG__", draft.slug)}`);
        await settle(page);
        if (p.open === "sheet") await page.locator("[data-e2e=tab-profile]").click({ timeout: 5_000 }).catch(() => {});
        if (p.open === "fab") await page.locator("[data-e2e=shell-fab]").click({ timeout: 5_000 }).catch(() => {});
        if (p.open === "calendar") await page.locator("[data-e2e=date-open]").click({ timeout: 5_000 }).catch(() => {});
        await page.waitForTimeout(150);
        await page.screenshot({
          path: join(OUT, `${p.name}-${locale}-${vp.tag}.png`),
          fullPage: !p.open,
          animations: "disabled",
        });
        await ctx.close();
      }
    }
  }
});
