import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedOffer, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { API, notificationBodies } from "./support/journey";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 5 — MONTHLY SUBSCRIPTIONS (growth).

   Payments are OFF, so the month is paid outside Tnajem and the tutor confirms it:
   a student asks (« S'abonner — 120 TND / mois », the « Bientôt » note beside it)
   → the tutor confirms on Abonnements (« Confirmer (paiement reçu hors Tnajem) »,
   in a dialog) → the student's next seat with that tutor is covered by the
   subscription (bookings.subscription_id, the quota counted) → the nightly job
   expires the month → the tutor renews it in one click. And the tutor's side of
   the offers: create, refuse an out-of-range one, hide, archive.
   ADDED as its own spec; the API side is apps/api/test/ep2-subscriptions.test.ts.
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

async function verifiedTutor(fullName = "Hela Mensuel") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1985, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  return { profile, tutor };
}

const subOf = async (studentId: string, tutorId: string) =>
  (await sql<{ id: string; status: string; price_tnd: string; payments_enabled: boolean; period_start: Date | null; period_end: Date | null }[]>`
    select id, status, price_tnd, payments_enabled, period_start, period_end from student_subscriptions
    where student_profile_id = ${studentId} and tutor_id = ${tutorId} order by created_at desc limit 1`)[0] ?? null;

/** The database error a statement fails with ("" if it does not fail). */
async function failure(q: PromiseLike<unknown>): Promise<string> {
  try {
    await q;
    return "";
  } catch (e) {
    return String((e as Error).message ?? e);
  }
}

const cron = () => fetch(`${API}/cron/purge`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });

test("request → the tutor confirms (paid outside Tnajem) → a seat is covered → the month expires → one-click renew", async ({ browser }) => {
  const { profile: owner, tutor } = await verifiedTutor();
  const offer = await seedOffer({ tutorId: tutor.id, title: "Suivi Bac — 4 séances", sessionsPerMonth: 4, priceTnd: 120 });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 72 });
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Yassine Abonné" });

  const sctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(sctx, student.id);
  const sp = await sctx.newPage();

  await test.step("the student asks, from the tutor's page", async () => {
    await sp.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    const card = sp.locator("[data-e2e=offer-card]");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("Suivi Bac — 4 séances");
    await expect(card).toContainText("4 séances par mois");
    // Nothing is paid on Tnajem today: the spec's sentence, beside « Bientôt ».
    const note = sp.locator("[data-e2e=offer-payment-note]");
    await expect(note).toContainText("Paiement en ligne bientôt — pour l'instant tu règles directement avec ton prof.");
    await expect(note.getByText("Bientôt", { exact: true })).toBeVisible();

    await card.locator("[data-e2e=subscribe]").click();
    const status = sp.locator("[data-e2e=subscription-status]");
    await expect(status).toHaveAttribute("data-status", "requested", { timeout: 15_000 });
    await expect(status).toContainText(/Demande envoyée le \d{2}\/\d{2}\/\d{4}\. Ton prof la confirme dès qu'il a reçu ton paiement\./);
    const sub = await subOf(student.id, tutor.id);
    expect(sub).toMatchObject({ status: "requested", price_tnd: "120.00", payments_enabled: false, period_start: null });
    expect(await notificationBodies(owner.id, "subscription_requested")).toHaveLength(1);
  });

  const tctx = await tutorCtx(browser, owner.id);
  const tp = await tctx.newPage();

  await test.step("the tutor confirms it on Abonnements, in a dialog", async () => {
    await tp.goto("/fr/dashboard/subscriptions", { waitUntil: "networkidle" });
    await expect(tp.locator("main")).toContainText("Paiement en ligne bientôt");
    const req = tp.locator("[data-e2e=request-row]");
    await expect(req).toHaveCount(1);
    await expect(req).toContainText("Yassine");
    await expect(req).not.toContainText("Abonné"); // the first name only
    await expect(req).toContainText("Suivi Bac — 4 séances · 120 TND / mois");
    await req.locator("[data-e2e=request-confirm]").click();
    const dialog = tp.locator("[data-e2e=confirm-dialog]");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Tu as reçu le paiement ?");
    await dialog.getByRole("button", { name: "Oui, confirmer" }).click();
    await expect(dialog).toBeHidden();
    const live = tp.locator("[data-e2e=active-row]");
    await expect(live).toHaveAttribute("data-status", "active");
    await expect(live).toContainText("0 / 4 séances ce mois");
    await expect(live).toContainText(/jusqu'au \d{2}\/\d{2}\/\d{4}/);
    await expect(tp.locator("[data-e2e=request-row]")).toHaveCount(0);
    const sub = await subOf(student.id, tutor.id);
    expect(sub?.status).toBe("active");
    const days = (sub!.period_end!.getTime() - sub!.period_start!.getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    expect(await notificationBodies(student.id, "subscription_confirmed")).toHaveLength(1);
  });

  await test.step("the student's next seat with this tutor is covered by the subscription", async () => {
    await sp.goto(`/fr/checkout?class=${klass.id}`, { waitUntil: "networkidle" });
    await expect(sp.locator(".ck-pay-detail")).toContainText("Comprise dans ton abonnement mensuel (0 / 4 séances utilisées ce mois).");
    await sp.locator("button.ck-cta").click();
    await expect.poll(async () => (await sql<{ subscription_id: string | null }[]>`
      select subscription_id from bookings where class_id = ${klass.id} and student_id = ${student.id} and status <> 'cancelled'`)[0]?.subscription_id ?? null, { timeout: 15_000 })
      .toBe((await subOf(student.id, tutor.id))!.id);
    await expect(sp.locator("main")).toContainText("Elle est comprise dans ton abonnement.");

    await sp.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    await expect(sp.locator("[data-e2e=subscription-status]")).toContainText("1 / 4 séances utilisées ce mois");
    await tp.reload({ waitUntil: "networkidle" });
    await expect(tp.locator("[data-e2e=active-row]")).toContainText("1 / 4 séances ce mois");
  });

  await test.step("the nightly job expires the month; both sides are told", async () => {
    const sub = (await subOf(student.id, tutor.id))!;
    await sql`update student_subscriptions set period_start = now() - interval '31 days', period_end = now() - interval '1 minute'
              where id = ${sub.id}`;
    expect((await cron()).status).toBe(200);
    expect((await subOf(student.id, tutor.id))?.status).toBe("expired");
    expect(await notificationBodies(student.id, "subscription_expired")).toHaveLength(1);
    expect(await notificationBodies(owner.id, "subscription_expired")).toHaveLength(1);

    // The student can ask again; the next seat is no longer covered.
    await sp.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    await expect(sp.locator("[data-e2e=offers]")).toContainText(/Ton dernier abonnement s'est terminé le \d{2}\/\d{2}\/\d{4}\./);
    await expect(sp.locator("[data-e2e=subscribe]")).toBeEnabled();
  });

  await test.step("the tutor renews it in one click: a fresh month from today", async () => {
    await tp.reload({ waitUntil: "networkidle" });
    const ended = tp.locator("[data-e2e=ended-row]");
    await expect(ended).toContainText("Terminé");
    await ended.getByRole("button", { name: "Renouveler (+1 mois)" }).click();
    const dialog = tp.locator("[data-e2e=confirm-dialog]");
    await expect(dialog).toContainText("Ne renouvelle qu'après avoir reçu le paiement du mois suivant, hors Tnajem.");
    await dialog.getByRole("button", { name: "Oui, renouveler" }).click();
    await expect(tp.locator("[data-e2e=active-row]")).toHaveAttribute("data-status", "active");
    const sub = (await subOf(student.id, tutor.id))!;
    expect(sub.status).toBe("active");
    expect(sub.period_end!.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    expect(await notificationBodies(student.id, "subscription_renewed")).toHaveLength(1);
  });

  // The offer row counts the live subscription.
  await expect(tp.locator("[data-e2e=offer-row]").filter({ hasText: offer.title })).toContainText("1 abonnement en cours");
  await tctx.close();
  await sctx.close();
});

test("the tutor's offers: create, an out-of-range one refused, hide, archive (≤ 3)", async ({ browser }) => {
  const { profile, tutor } = await verifiedTutor("Rim Offres");
  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/subscriptions", { waitUntil: "networkidle" });
  await expect(page.locator("main")).toContainText("Pas encore d'offre mensuelle");

  await page.locator("[data-e2e=offer-new]").click();
  const form = page.locator("[data-e2e=offer-form]");
  await form.locator("[data-e2e=offer-title]").fill("Maths 2ᵉ année — 8 séances");
  await form.locator("[data-e2e=offer-sessions]").fill("40");
  await form.locator("[data-e2e=offer-price]").fill("160");
  await form.locator("[data-e2e=offer-save]").click();
  await expect(form.getByRole("alert")).toHaveText("Le nombre de séances va de 1 à 31.");
  await form.locator("[data-e2e=offer-sessions]").fill("8");
  await form.locator("[data-e2e=offer-price]").fill("0");
  await form.locator("[data-e2e=offer-save]").click();
  await expect(form.getByRole("alert")).toHaveText("Le prix doit être supérieur à 0 TND.");
  await form.locator("[data-e2e=offer-price]").fill("160");
  await form.locator("[data-e2e=offer-save]").click();
  const row = page.locator("[data-e2e=offer-row]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("8 séances par mois · 160 TND / mois · aucun abonné");
  await expect(row).toContainText("Visible sur ma page");
  const [db] = await sql<{ sessions_per_month: number; price_tnd_per_month: string; active: boolean }[]>`
    select sessions_per_month, price_tnd_per_month, active from tutor_offers where tutor_id = ${tutor.id}`;
  expect(db).toEqual({ sessions_per_month: 8, price_tnd_per_month: "160.00", active: true });

  // The database refuses what the form would have: 40 sessions, 0 TND.
  expect(await failure(sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'x', 40, 10)`)).toMatch(/tutor_offers_sessions_1_31/);
  expect(await failure(sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month) values (${tutor.id}, 'x', 4, 0)`)).toMatch(/tutor_offers_price_positive/);

  // Hide → gone from the public page; archive → gone from the list, after a dialog.
  await row.getByRole("button", { name: "Masquer" }).click();
  await expect(row).toContainText("Masquée");
  await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-e2e=offers]")).toHaveCount(0);
  await page.goto("/fr/dashboard/subscriptions", { waitUntil: "networkidle" });
  await page.locator("[data-e2e=offer-row]").getByRole("button", { name: "Archiver" }).click();
  const dialog = page.locator("[data-e2e=confirm-dialog]");
  await expect(dialog).toContainText("Archiver cette offre ?");
  await dialog.getByRole("button", { name: "Archiver" }).click();
  await expect(page.locator("[data-e2e=offer-row]")).toHaveCount(0);
  await expect(page.locator("main")).toContainText("Pas encore d'offre mensuelle");
  await ctx.close();
});
