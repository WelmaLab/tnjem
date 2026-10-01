import { test, expect, type Browser, type BrowserContext, type Locator } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { seedAdmin, seedClass, seedProfile, seedPromotion, seedTutor } from "./support/seed";
import { loginAs, mintSession } from "./support/session";
import { api, auditActions } from "./support/journey";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 5 — PROMOTIONS, 20 % AT MOST (growth).

   The cap three times: the API refuses 25 % (and 0 %), the database refuses a
   25 % row (CHECK promotions_percent_1_20), and the Promotions page's slider stops
   at 20 — where 20 % is accepted, previewed on the tutor's own prices and written
   to the audit log. Promotions never stack: the student gets the best single one,
   shown as a struck price and a « −15 % » badge on the storefront rows, the class
   page, the Explore card and checkout, and recorded on the booking. A ?promo= code
   only applies through its link. Ending one takes it off every price. An admin
   reads a tutor's promotions read-only, and that read is logged.
   ADDED as its own spec; the API side is apps/api/test/ep2-pricing.test.ts and
   ep2-promotions.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.setTimeout(120_000);

const HOST = new URL(BASE_URL).hostname;

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

/** A first name nobody else in the database has, so Explore's search finds exactly this tutor. */
const uniqueFirst = (stem: string) => `${stem}${[...randomBytes(4)].map((b) => String.fromCharCode(97 + (b % 26))).join("")}`;

async function verifiedTutor(fullName: string) {
  const profile = await seedProfile({ role: "tutor", birthYear: 1984, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  return { profile, tutor };
}

const inTwoWeeks = () => new Date(Date.now() + 14 * 86_400_000).toISOString();

/** The database error a statement fails with ("" if it does not fail). */
async function failure(q: PromiseLike<unknown>): Promise<string> {
  try {
    await q;
    return "";
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

async function expectPrice(scope: Locator, was: string, badge: string, final: string) {
  const price = scope.locator("[data-e2e=promo-price]").first();
  await expect(price.locator("[data-e2e=price-was]")).toHaveText(was);
  await expect(price.locator("[data-e2e=promo-badge]")).toHaveText(badge);
  await expect(price.locator(".pp-amount")).toContainText(final);
}

test("25 % is refused by the API and by the database; the slider stops at 20 %, which is accepted and logged", async ({ browser }) => {
  const { profile, tutor } = await verifiedTutor("Mehdi Remise");
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 90 });
  const token = await mintSession(profile.id);

  for (const percent of [25, 0, 12.5]) {
    expect(await api("/tutor/promotions", token, { percent, scope: "all", endsAt: inTwoWeeks() }), `${percent} %`)
      .toEqual({ ok: false, error: "percent-out-of-range" });
  }
  expect(await failure(sql`insert into promotions (tutor_id, percent, ends_at) values (${tutor.id}, 25, now() + interval '7 days')`))
    .toMatch(/promotions_percent_1_20/);
  expect((await sql`select 1 from promotions where tutor_id = ${tutor.id}`).length).toBe(0);

  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/promotions", { waitUntil: "networkidle" });
  await expect(page.locator("main")).toContainText("Pas encore de promotion");
  const slider = page.locator("[data-e2e=promo-percent]");
  await expect(slider).toHaveAttribute("min", "1");
  await expect(slider).toHaveAttribute("max", "20");
  await slider.fill("20"); // the top of the range: there is no 21
  await expect(page.locator("[data-e2e=promo-percent-value]")).toHaveText("−20 %");
  // The preview is the tutor's own class, through the one price calculation: 40 → 32.
  const preview = page.locator("[data-e2e=promo-preview]");
  await expect(preview).toContainText(klass.title);
  await expect(preview.locator("del")).toHaveText("40 TND");
  await expect(preview.locator("b")).toHaveText("32 TND");

  const end = new Date(Date.now() + 10 * 86_400_000);
  const dd = String(end.getDate()).padStart(2, "0");
  const mm = String(end.getMonth() + 1).padStart(2, "0");
  await page.locator("[data-e2e=promo-form] [data-e2e=date-input]").fill(`${dd}/${mm}/${end.getFullYear()}`);
  await page.locator("[data-e2e=promo-create]").click();

  const row = page.locator("[data-e2e=promo-row]");
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-state", "live");
  await expect(row).toContainText("−20 %");
  await expect(row).toContainText("sur toute ma page");
  await expect(row).toContainText("Pour tout le monde");
  await expect(row).toContainText(`jusqu'au ${dd}/${mm}/${end.getFullYear()}`);
  const [promo] = await sql<{ id: string; percent: number; scope: string; code: string | null }[]>`
    select id, percent, scope, code from promotions where tutor_id = ${tutor.id}`;
  expect(promo).toMatchObject({ percent: 20, scope: "all", code: null });
  // Written to the append-only audit log, in the same transaction.
  expect(await auditActions(promo.id)).toEqual(["promotion.create"]);

  // An admin reads them READ-ONLY on /admin/accounts — an explicit click, logged first.
  const admin = await seedAdmin();
  const actx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(actx, admin.id);
  const ap = await actx.newPage();
  await ap.goto("/fr/admin/accounts", { waitUntil: "networkidle" });
  await ap.locator('input[type="email"]').fill(profile.email);
  await ap.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  const box = ap.locator("[data-e2e=admin-promotions]");
  await expect(box).toBeVisible({ timeout: 15_000 });
  expect(await auditActions(tutor.id)).not.toContain("promotions.read");
  await box.getByRole("button", { name: "Voir ses promotions" }).click();
  const adminRow = ap.locator("[data-e2e=admin-promo-row]");
  await expect(adminRow).toHaveCount(1);
  await expect(adminRow).toContainText("−20 % sur toute la page");
  await expect(adminRow).toContainText("En cours");
  await expect(ap.locator("[data-e2e=admin-promotions] button")).toHaveCount(0); // nothing to change there
  expect(await auditActions(tutor.id)).toContain("promotions.read");
  await actx.close();
  await ctx.close();
});

test("no stacking: the best single promotion, struck price and badge on the storefront, the class page, Explore and checkout", async ({ browser, page }) => {
  const first = uniqueFirst("Olfa");
  const { tutor } = await verifiedTutor(`${first} Prix`);
  const a = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 70 });
  const b = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 50, hoursFromNow: 140 });
  // 10 % on everything, 15 % on class A only: A is 15 % off (not 25 %), B is 10 % off.
  await seedPromotion({ tutorId: tutor.id, percent: 10 });
  const onA = await seedPromotion({ tutorId: tutor.id, percent: 15, scope: "class", targetId: a.id });
  // A 20 % code that only its link unlocks.
  await seedPromotion({ tutorId: tutor.id, percent: 20, code: "RENTREE" });

  await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
  await expectPrice(page.locator(`a[href="/fr/class/${a.id}"]`), "40 TND", "−15 %", "34");
  await expectPrice(page.locator(`a[href="/fr/class/${b.id}"]`), "50 TND", "−10 %", "45");
  await expect(page.locator("[data-e2e=promo-badge]").filter({ hasText: "−25 %" })).toHaveCount(0);
  await expect(page.locator("[data-e2e=promo-badge]").filter({ hasText: "−20 %" })).toHaveCount(0);

  await page.goto(`/fr/class/${a.id}`, { waitUntil: "networkidle" });
  await expectPrice(page.locator("main"), "40 TND", "−15 %", "34");

  // Explore: the « à partir de » price after the best public promotion.
  await page.goto("/fr/explore", { waitUntil: "networkidle" });
  await page.locator('input[type="search"]').fill(first);
  const card = page.locator(`a[href="/fr/${tutor.slug}"]`).first();
  await expect(card.locator("[data-e2e=explore-price] [data-e2e=price-was]")).toHaveText("40 TND", { timeout: 15_000 });
  await expect(card.locator("[data-e2e=explore-price] [data-e2e=promo-badge]")).toHaveText("−15 %");
  await expect(card.locator("[data-e2e=explore-price]")).toContainText("34");

  // The code's link: the banner, and the best one is now the 20 % — still one, never 35 %.
  await page.goto(`/fr/${tutor.slug}?promo=rentree`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-e2e=promo-banner]")).toContainText("RENTREE");
  await expectPrice(page.locator(`a[href="/fr/class/${a.id}"]`), "40 TND", "−20 %", "32");

  // Checkout, and what the booking records: the price after the ONE best public promotion.
  const student = await seedProfile({ role: "student", birthYear: 1992 });
  const sctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(sctx, student.id);
  const sp = await sctx.newPage();
  await sp.goto(`/fr/checkout?class=${a.id}`, { waitUntil: "networkidle" });
  await expect(sp.locator(".ck-pay-detail")).toContainText(/Cette séance est à 34 TND au lieu de 40 TND \(−15 % jusqu'au \d{2}\/\d{2}\/\d{4}\)\./);
  await sp.locator("button.ck-cta").click();
  await expect.poll(async () => (await sql<{ price_tnd: string | null; promotion_id: string | null }[]>`
    select price_tnd, promotion_id from bookings where class_id = ${a.id} and student_id = ${student.id} and status <> 'cancelled'`)[0] ?? null, { timeout: 15_000 })
    .toEqual({ price_tnd: "34.00", promotion_id: onA.id });
  await sctx.close();
});

test("pause and end from the Promotions page: an ended promotion leaves every price", async ({ browser }) => {
  const { profile, tutor } = await verifiedTutor("Sonia Fin");
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 100 });
  const promo = await seedPromotion({ tutorId: tutor.id, percent: 10 });

  const visitor = await browser.newContext({ reducedMotion: "reduce" });
  const vp = await visitor.newPage();
  await vp.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
  await expectPrice(vp.locator(`a[href="/fr/class/${klass.id}"]`), "30 TND", "−10 %", "27");

  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/promotions", { waitUntil: "networkidle" });
  const row = page.locator("[data-e2e=promo-row]");
  await row.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(row).toHaveAttribute("data-state", "paused");
  await expect(row).toContainText("En pause");
  await row.getByRole("button", { name: "Reprendre" }).click();
  await expect(row).toHaveAttribute("data-state", "live");

  await row.locator("[data-e2e=promo-end]").click();
  const dialog = page.locator("[data-e2e=confirm-dialog]");
  await expect(dialog).toContainText("Terminer cette promotion ?");
  await dialog.getByRole("button", { name: "Terminer" }).click();
  await expect(row).toHaveAttribute("data-state", "ended");
  await expect(row.locator("[data-e2e=promo-end]")).toHaveCount(0);
  expect(await auditActions(promo.id)).toContain("promotion.end");

  // The public page is revalidated: the plain price again.
  await vp.reload({ waitUntil: "networkidle" });
  const price = vp.locator(`a[href="/fr/class/${klass.id}"] [data-e2e=promo-price]`).first();
  await expect(price.locator("[data-e2e=promo-badge]")).toHaveCount(0);
  await expect(price.locator(".pp-amount")).toContainText("30");
  await visitor.close();
  await ctx.close();
});
