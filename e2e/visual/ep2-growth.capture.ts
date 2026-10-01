import { test, type Browser, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sql } from "../support/db";
import { seedAdmin, seedBooking, seedClass, seedFollow, seedOffer, seedProfile, seedPromotion, seedTutor } from "../support/seed";
import { loginAs } from "../support/session";
import { BASE_URL } from "../support/env";

/* espace prof v2 · phases 3–5 (growth) — screenshots of the growth surfaces in FR and
   AR, at 1440 and 390. NOT part of `npm run test` (*.capture.ts). Run with

     npx playwright test -c e2e/visual/visual.config.ts ep2-growth

   against a running production build. Output: ui-espace-prof-v2/growth/ (gitignored).

   One VERIFIED tutor, "Amel Ben Salah", with two paid classes, a monthly offer, a
   public 15 % promotion and a 20 % code, two followers, one subscription request and
   one active subscription ending in two days, one booking, and a month of
   « Vues · Clics » from four sources; one PENDING tutor for « arrive bientôt ». */

const OUT = resolve(process.env.UI_SHOTS_DIR ?? join("ui-espace-prof-v2", "growth"));

type Who = "anon" | "tutor" | "admin";
type Shot = { name: string; path: string; who: Who; open?: "share" | "admin-promos"; full?: boolean };

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
    if (who === "tutor") {
      const u = new URL(BASE_URL);
      await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: u.hostname, path: "/" }]);
    }
  }
  return ctx;
}

test("capture the growth surfaces, FR + AR, 1440 + 390", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  await mkdir(OUT, { recursive: true });

  const tp = await seedProfile({ role: "tutor", birthYear: 1986, fullName: "Amel Ben Salah" });
  const tutor = await seedTutor({ profileId: tp.id, status: "verified", fullName: "Amel Ben Salah" });
  const k1 = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 50 });
  await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 25, hoursFromNow: 120 });
  const offer = await seedOffer({ tutorId: tutor.id, title: "Suivi Bac — 4 séances", sessionsPerMonth: 4, priceTnd: 120 });
  await seedPromotion({ tutorId: tutor.id, percent: 15, endsInDays: 9 });
  await seedPromotion({ tutorId: tutor.id, percent: 20, code: "RENTREE", endsInDays: 20, maxUses: 30 });
  const asking = await seedProfile({ role: "student", birthYear: 1996, fullName: "Rania Trabelsi" });
  const paying = await seedProfile({ role: "student", birthYear: 1995, fullName: "Omar Jlassi" });
  const booked = await seedProfile({ role: "student", birthYear: 1997, fullName: "Ines Gharbi" });
  await seedFollow(asking.id, tutor.id);
  await seedFollow(paying.id, tutor.id);
  await seedBooking({ classId: k1.id, studentId: booked.id, isFree: false });
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd)
            values (${offer.id}, ${tutor.id}, ${asking.id}, 'requested', 4, 102)`;
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd,
                                               period_start, period_end, confirmed_at)
            values (${offer.id}, ${tutor.id}, ${paying.id}, 'active', 4, 120,
                    now() - interval '28 days', now() + interval '2 days', now() - interval '28 days')`;
  for (const [source, views, clicks] of [["whatsapp", 14, 14], ["direct", 9, 0], ["facebook", 5, 5], ["qr", 2, 2]] as const) {
    await sql`insert into vitrine_stats_daily (tutor_id, day, source, views, clicks)
              values (${tutor.id}, (now() at time zone 'Africa/Tunis')::date, ${source}, ${views}, ${clicks})`;
  }
  const pendingP = await seedProfile({ role: "tutor", birthYear: 1990, fullName: "Karim Mansour" });
  const pending = await seedTutor({ profileId: pendingP.id, status: "pending", fullName: "Karim Mansour" });
  const admin = await seedAdmin();
  const ids = { tutor: tp.id, admin: admin.id };

  const SHOTS: Shot[] = [
    { name: "home", path: "/dashboard", who: "tutor" },
    { name: "storefront-stats", path: "/dashboard/storefront", who: "tutor" },
    { name: "share-sheet", path: "/dashboard/storefront", who: "tutor", open: "share" },
    { name: "classes", path: "/dashboard/classes", who: "tutor" },
    { name: "students", path: "/dashboard/students", who: "tutor" },
    { name: "subscriptions", path: "/dashboard/subscriptions", who: "tutor" },
    { name: "promotions", path: "/dashboard/promotions", who: "tutor" },
    { name: "public-profile", path: `/${tutor.slug}`, who: "anon" },
    { name: "public-profile-code", path: `/${tutor.slug}?promo=RENTREE`, who: "anon" },
    { name: "public-class", path: `/class/${k1.id}`, who: "anon" },
    { name: "coming-soon-follow", path: `/${pending.slug}`, who: "anon" },
    { name: "admin-promotions", path: "/admin/accounts", who: "admin", open: "admin-promos" },
  ];

  for (const locale of ["fr", "ar"] as const) {
    for (const vp of VIEWPORTS) {
      for (const s of SHOTS) {
        const ctx = await contextFor(browser, s.who, vp, ids);
        const page = await ctx.newPage();
        await page.goto(`/${locale}${s.path}`);
        await settle(page);
        if (s.open === "share") {
          await page.locator("[data-e2e=share-open-profile]").first().click({ timeout: 5_000 }).catch(() => {});
        }
        if (s.open === "admin-promos") {
          await page.locator('input[type="email"]').fill(tp.email).catch(() => {});
          await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit()).catch(() => {});
          await page.locator("[data-e2e=admin-promotions] button").click({ timeout: 10_000 }).catch(() => {});
          await page.locator("[data-e2e=admin-promo-row]").first().waitFor({ timeout: 10_000 }).catch(() => {});
        }
        await page.waitForTimeout(300);
        await page.screenshot({
          path: join(OUT, `${s.name}-${locale}-${vp.tag}.png`),
          fullPage: s.open !== "share",
          animations: "disabled",
        });
        await ctx.close();
      }
    }
  }
});
