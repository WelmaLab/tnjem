import { test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { seedBooking, seedClass, seedProfile, seedTutor } from "../support/seed";
import { loginAs } from "../support/session";
import { sql } from "../support/db";
import { AUTH_SECRET, BASE_URL } from "../support/env";
import { createHmac } from "node:crypto";

/* espace prof v2 · phase 6 (shell) — the polished pages in FR and AR, at 1440 and 390.
   NOT part of `npm run test` (*.capture.ts). Run with

     npx playwright test -c e2e/visual/visual.config.ts ep2-polish

   against a running production build. Output: ui-espace-prof-v2/phase6/ (gitignored).

   Tutors: a DRAFT (blockers, the 3-step verification), a PENDING and a REJECTED one
   (the status pages), and a VERIFIED one with classes and bookings. */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? join("ui-espace-prof-v2", "phase6"));

type Who = "anon" | "draft" | "pending" | "rejected" | "verified";
type Act = "fill-class" | "verify-2" | "verify-3" | "pack-file" | "publish-class";
const PAGES: { name: string; path: string; who: Who; act?: Act }[] = [
  { name: "settings-compte", path: "/dashboard/settings", who: "verified" },
  { name: "settings-vitrine", path: "/dashboard/settings?tab=vitrine", who: "verified" },
  { name: "settings-notifications", path: "/dashboard/settings?tab=notifications", who: "verified" },
  { name: "settings-securite", path: "/dashboard/settings?tab=securite", who: "verified" },
  { name: "plan", path: "/dashboard/plan", who: "verified" },
  { name: "tarifs", path: "/tarifs", who: "anon" },
  { name: "new-class-draft", path: "/dashboard/new-class", who: "draft" },
  { name: "new-class-filled", path: "/dashboard/new-class", who: "verified", act: "fill-class" },
  { name: "new-class-published", path: "/dashboard/new-class", who: "verified", act: "publish-class" },
  { name: "new-pack", path: "/dashboard/new-pack", who: "verified" },
  { name: "new-pack-file", path: "/dashboard/new-pack", who: "verified", act: "pack-file" },
  { name: "verify-1", path: "/onboarding/verify", who: "draft" },
  { name: "verify-2", path: "/onboarding/verify", who: "draft", act: "verify-2" },
  { name: "verify-3", path: "/onboarding/verify", who: "draft", act: "verify-3" },
  { name: "verify-pending", path: "/onboarding/verify", who: "pending" },
  { name: "verify-rejected", path: "/onboarding/verify", who: "rejected" },
  { name: "verify-verified", path: "/onboarding/verify", who: "verified" },
  { name: "home-verified", path: "/dashboard", who: "verified" },
  { name: "classes", path: "/dashboard/classes", who: "verified" },
  { name: "students", path: "/dashboard/students", who: "verified" },
  { name: "unsubscribe-tutor", path: "/email/unsubscribe?token=__TOKEN__", who: "verified" },
];

const VIEWPORTS = [
  { tag: "1440", width: 1440, height: 900 },
  { tag: "390", width: 390, height: 844 },
];

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

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

/** Tomorrow at 18:00, as the DD/MM/YYYY the date field takes. */
function tomorrow(): string {
  const d = new Date(Date.now() + 36 * 3600_000);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

async function act(page: Page, a: Act | undefined, locale: "fr" | "ar") {
  if (!a) return;
  if (a === "fill-class" || a === "publish-class") {
    await page.locator("main form input[type=text]").first().fill(locale === "fr" ? "Intégrales : révision express" : "التكامل: مراجعة سريعة");
    await page.locator("[data-e2e=date-input]").fill(tomorrow()).catch(() => {});
    await page.locator("[data-e2e=time-input]").fill("18:00").catch(() => {});
    await page.locator("[data-e2e=class-level] label").nth(1).click().catch(() => {});
    await page.locator("main form input[type=number]").first().fill("15");
    await page.locator("[data-e2e=class-seats]").fill("6");
    if (a === "publish-class") {
      await page.locator("main form button[type=submit]").click();
      await page.locator("[data-e2e=class-published]").waitFor({ timeout: 10_000 }).catch(() => {});
    } else {
      await page.waitForTimeout(800); // the draft autosave
    }
  }
  if (a === "pack-file") {
    await page.locator("main form input[type=text]").first().fill(locale === "fr" ? "Pack révision : Dérivées" : "پاك مراجعة: المشتقات");
    await page.locator("main form input[type=text]").nth(1).fill(locale === "fr" ? "42 pages · 3 exercices corrigés" : "42 صفحة · 3 تمارين");
    await page.locator("[data-e2e=pack-file-input]").setInputFiles({ name: "derivees.png", mimeType: "image/png", buffer: PNG });
    await page.locator("main form input[type=number]").first().fill("8");
  }
  if (a === "verify-2" || a === "verify-3") {
    await page.locator("input[name=idFront]").setInputFiles({ name: "cin-recto.png", mimeType: "image/png", buffer: PNG });
    await page.locator("[data-e2e=verify-next]").click();
    if (a === "verify-3") await page.locator("[data-e2e=verify-skip]").click();
  }
  await page.waitForTimeout(250);
}

test("capture every phase-6 page, FR + AR, 1440 + 390", async ({ browser }) => {
  test.setTimeout(25 * 60_000);
  await mkdir(OUT, { recursive: true });

  const mk = async (name: string, status: "draft" | "pending" | "rejected" | "verified") => {
    const p = await seedProfile({ role: "tutor", fullName: name, birthYear: 1990 });
    const t = await seedTutor({ profileId: p.id, status, fullName: name });
    return { p, t };
  };
  const draft = await mk("Walid Tester", "draft");
  const pending = await mk("Sami Pending", "pending");
  const rejected = await mk("Rim Rejected", "rejected");
  await sql`update tutors set review_note = ${"La photo de la CIN est floue : reprends-la en pleine lumière."} where id = ${rejected.t.id}`;
  const ver = await mk("Amel Ben Salah", "verified");
  const soon = await seedClass({ tutorId: ver.t.id, hoursFromNow: 30, seats: 6 });
  await seedClass({ tutorId: ver.t.id, hoursFromNow: 120, seats: 10 });
  const past = await seedClass({ tutorId: ver.t.id, hoursFromNow: -96, seats: 8 });
  for (const name of ["Yosra Trabelsi", "Mehdi Jaziri"]) {
    const s = await seedProfile({ role: "student", fullName: name, birthYear: 1999 });
    await seedBooking({ classId: soon.id, studentId: s.id });
    await seedBooking({ classId: past.id, studentId: s.id, status: "attended" });
  }
  // A public promotion on everything (phase 5): the new-class price hint and preview.
  await sql`insert into promotions (tutor_id, percent, scope, ends_at)
            values (${ver.t.id}, 10, 'all', ${new Date(Date.now() + 20 * 86_400_000)})`;
  // A follower, for Mes élèves' « Suit ta page ».
  const fan = await seedProfile({ role: "student", fullName: "Ines Suiveuse", birthYear: 1997 });
  await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${fan.id}, ${ver.t.id})`;
  const sig = createHmac("sha256", AUTH_SECRET).update(`tnajem:unsubscribe:v1:${ver.p.id}:bookings`).digest("base64url").slice(0, 32);
  const token = encodeURIComponent(`v1.${ver.p.id}.bookings.${sig}`);
  const ids = { draft: draft.p.id, pending: pending.p.id, rejected: rejected.p.id, verified: ver.p.id };

  for (const locale of ["fr", "ar"] as const) {
    for (const vp of VIEWPORTS) {
      for (const p of PAGES) {
        const ctx = await contextFor(browser, p.who, vp, ids);
        const page = await ctx.newPage();
        await page.goto(`/${locale}${p.path.replace("__TOKEN__", token)}`);
        await settle(page);
        await act(page, p.act, locale).catch(() => {});
        await page.screenshot({ path: join(OUT, `${p.name}-${locale}-${vp.tag}.png`), fullPage: true, animations: "disabled" });
        await ctx.close();
      }
    }
  }
});
