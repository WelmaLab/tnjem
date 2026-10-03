import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedOffer, seedPassword, seedProfile, seedPromotion, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { resetRateLimits } from "./support/otp";
import { E2E_PASSWORD } from "./support/password-ui";
import { BASE_URL } from "./support/env";
import { chooseBirthDate } from "./support/select-ui"; // live-fixes-2 · C

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 8 (gate) — the spec's §8.3 list, where the phase specs
   covered an item more thinly than the spec asks:

     • the share sheet's two other deep links — the monthly offer
       (/{slug}?offre=mensuel) from Abonnements and a promotion (/{slug}?promo=CODE)
       from Promotions — each with utm_source={target}, and each link LANDS: the
       offer section is marked, the code's banner and price show;
     • « email already exists » through the TUTOR door, in Arabic
       (/ar/signup/prof → /ar/auth, prefilled, the notice in Derja);
     • « Suivre » from a CLASS page while signed out → sign in → back on that class
       page, following; « Abonné » unfollows.
   The rest of §8.3 is proved by the phase specs (see ESPACE_PROF_V2_REPORT.md).
   ════════════════════════════════════════════════════════════════════════════ */

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.setTimeout(120_000);

const HOST = new URL(BASE_URL).hostname;

test.beforeEach(async () => {
  // rate_limits outlives runs; the sign-ins below spend password attempts.
  await resetRateLimits();
});

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  // Record the network addresses instead of leaving the machine (same as ep2-share).
  await ctx.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
  return ctx;
}

async function verifiedTutor(fullName: string) {
  const profile = await seedProfile({ role: "tutor", birthYear: 1987, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName });
  return { profile, tutor };
}

const opened = (page: Page) => page.evaluate(() => [...(window as unknown as { __opened: string[] }).__opened]);

async function go(page: Page): Promise<string> {
  const before = (await opened(page)).length;
  await page.locator("[data-e2e=share-sheet] [data-e2e=share-go]").click();
  await expect.poll(async () => (await opened(page)).length).toBe(before + 1);
  return (await opened(page))[before];
}

/** The link inside a network's share address (wa.me, t.me, sharer.php …). */
function linkInside(intent: string): string {
  const u = new URL(intent);
  for (const key of ["u", "url", "link"]) {
    const v = u.searchParams.get(key);
    if (v) return v;
  }
  return /(https?:\/\/\S+)\s*$/.exec(u.searchParams.get("text") ?? "")?.[1] ?? "";
}

test("share sheet: the monthly offer (?offre=mensuel) and a promotion (?promo=CODE), each with utm_source — and both links land", async ({ browser }) => {
  const { profile, tutor } = await verifiedTutor("Sarra Liens");
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 96 });
  await seedOffer({ tutorId: tutor.id, title: "Suivi mensuel — 4 séances", sessionsPerMonth: 4, priceTnd: 100 });
  await seedPromotion({ tutorId: tutor.id, percent: 20, code: "ETE-20", endsInDays: 12 });

  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();
  let offerLink = "";
  let promoLink = "";

  await test.step("Abonnements shares the offer: /{slug}?offre=mensuel&utm_source=…", async () => {
    await page.goto("/fr/dashboard/subscriptions", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=offer-row] [data-e2e=share-open-offer]").first().click();
    const sheet = page.locator("[data-e2e=share-sheet]");
    await expect(sheet.getByRole("heading", { name: "Partager mon abonnement" })).toBeVisible();
    await expect(sheet.locator("[data-e2e=share-link]")).toHaveValue(new RegExp(`/${tutor.slug}\\?offre=mensuel&utm_source=copy$`));
    for (const target of ["whatsapp", "telegram"] as const) {
      await sheet.locator(`[data-e2e=share-target-${target}]`).click();
      const shared = linkInside(await go(page));
      expect(shared, target).toMatch(new RegExp(`/${tutor.slug}\\?offre=mensuel&utm_source=${target}$`));
      if (target === "whatsapp") offerLink = shared;
    }
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  await test.step("Promotions shares the code: /{slug}?promo=ETE-20&utm_source=…", async () => {
    await page.goto("/fr/dashboard/promotions", { waitUntil: "networkidle" });
    await page.locator("[data-e2e=promo-row] [data-e2e=share-open-promo]").first().click();
    const sheet = page.locator("[data-e2e=share-sheet]");
    await expect(sheet.getByRole("heading", { name: "Partager ma promotion" })).toBeVisible();
    await expect(sheet.locator("[data-e2e=share-link]")).toHaveValue(new RegExp(`/${tutor.slug}\\?promo=ETE-20&utm_source=copy$`));
    await sheet.locator("[data-e2e=share-target-facebook]").click();
    promoLink = linkInside(await go(page));
    expect(promoLink).toMatch(new RegExp(`/${tutor.slug}\\?promo=ETE-20&utm_source=facebook$`));
    // The pre-written message names the percentage and the code.
    await expect(sheet.locator("[data-e2e=share-message]")).toHaveValue(/−20 % sur mes cours.*ETE-20/);
  });
  await ctx.close();

  // A visitor opens each link. The shared links are locale-bare (no /fr); the proxy
  // sends a bare path to the default locale, query kept. Same host as this lane.
  const visitor = await browser.newContext({ reducedMotion: "reduce" });
  const vp = await visitor.newPage();
  const local = (link: string) => { const u = new URL(link); return `${u.pathname}${u.search}`; };

  await test.step("the offer link lands on the offer section, marked", async () => {
    await vp.goto(local(offerLink), { waitUntil: "domcontentloaded" });
    expect(new URL(vp.url()).pathname).toBe(`/fr/${tutor.slug}`);
    expect(new URL(vp.url()).searchParams.get("offre")).toBe("mensuel");
    const offers = vp.locator("[data-e2e=offers]");
    // The mark lasts 2.6 s from hydration: look for it before waiting on the network.
    await expect(offers).toHaveClass(/is-flash/);
    await expect(offers).toBeVisible();
    await expect(offers.locator("[data-e2e=offer-card]")).toContainText("Suivi mensuel — 4 séances");
    await expect(offers).toBeInViewport();
  });

  await test.step("the promotion link: the code's banner, and the class at −20 %", async () => {
    await vp.goto(local(promoLink), { waitUntil: "networkidle" });
    expect(new URL(vp.url()).pathname).toBe(`/fr/${tutor.slug}`);
    await expect(vp.locator("[data-e2e=promo-banner]")).toContainText("ETE-20");
    const price = vp.locator(`a[href="/fr/class/${klass.id}"] [data-e2e=promo-price]`).first();
    await expect(price.locator("[data-e2e=price-was]")).toHaveText("40 TND");
    await expect(price.locator("[data-e2e=promo-badge]")).toHaveText("−20 %");
    await expect(price.locator(".pp-amount")).toContainText("32");
  });

  // Both arrivals were counted as clicks from their network (analytics only).
  await expect.poll(async () => (await sql<{ source: string; clicks: number }[]>`
    select source, clicks from vitrine_stats_daily where tutor_id = ${tutor.id} order by source`)
    .map((r) => `${r.source}:${r.clicks}`).join(","), { timeout: 15_000 }).toBe("facebook:1,whatsapp:1");
  await visitor.close();
});

test("« email already exists » through the tutor door, in Arabic: /ar/signup/prof → /ar/auth, prefilled, the notice in Derja", async ({ page }) => {
  const existing = await seedProfile({ role: "tutor", birthYear: 1988 });
  await page.goto("/ar/signup/prof", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(existing.email);
  await chooseBirthDate(page, { month: 3, year: 1988, locale: "ar" }); // live-fixes-2 · C: the shell's Select
  await page.locator("main form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());

  await page.waitForURL(/\/ar\/auth\?/, { timeout: 20_000 });
  expect(new URL(page.url()).searchParams.get("existing")).toBe("1");
  expect(page.url(), "the address never travels in the URL").not.toContain("tnajem.invalid");
  await expect(page.locator('[data-e2e="existing-account-notice"]')).toHaveText("عندك حساب قبل — ادخل.");
  await expect(page.locator('input[type="email"]')).toHaveValue(existing.email);
  const [codes] = await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${existing.email}`;
  expect(codes.n, "no code was sent for the wrong door").toBe(0);
});

test("« Suivre » on a CLASS page, signed out → sign in with the password → back on the class page, following; « Abonné » unfollows", async ({ page }) => {
  const { tutor } = await verifiedTutor("Hatem Classe");
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 100 });
  const student = await seedProfile({ role: "student", birthYear: 1994, fullName: "Rym Suiveuse" });
  await seedPassword(student.id, E2E_PASSWORD);
  const follows = async () =>
    (await sql<{ n: number }[]>`select count(*)::int n from tutor_follows where student_profile_id = ${student.id} and tutor_id = ${tutor.id}`)[0].n;

  await page.goto(`/fr/class/${klass.id}`, { waitUntil: "networkidle" });
  const btn = page.locator("[data-e2e=follow-button]").first();
  await expect(btn).toHaveAttribute("aria-busy", "false");
  await expect(btn).toHaveText("Suivre");
  await btn.click();
  await page.waitForURL(/\/fr\/auth\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/fr/class/${klass.id}?suivre=1`);

  await page.locator('input[type="email"]').fill(student.email);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-e2e="password"]').fill(E2E_PASSWORD);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());

  await page.waitForURL((u) => u.pathname === `/fr/class/${klass.id}`, { timeout: 20_000 });
  await expect(btn).toHaveAttribute("data-following", "true", { timeout: 15_000 });
  await expect(btn).toHaveText("Abonné");
  await expect.poll(() => new URL(page.url()).searchParams.get("suivre")).toBeNull();
  expect(await follows()).toBe(1);

  await btn.click();
  await expect(btn).toHaveAttribute("data-following", "false");
  await expect(btn).toHaveText("Suivre");
  expect(await follows()).toBe(0);
});
