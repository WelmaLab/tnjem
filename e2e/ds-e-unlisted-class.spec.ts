import { test, expect, type Browser, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { shareUrl } from "@tnajem/shared";
import { sql } from "./support/db";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs, mintSession } from "./support/session";
import { api } from "./support/journey";
import { BASE_URL } from "./support/env";
import { fillWallTime } from "./support/datetime";

/* december-sprint · E (D18) — UNLISTED CLASSES, rendered.

   A tutor publishes a class with « Non listé » on. It is tagged on « Mes classes »,
   absent from the storefront (list and JSON-LD), from Explore's price and from the
   sitemap, carries robots noindex on its own page in both locales — and a student
   who opens its QR-code link books it exactly like any other class, and finds it on
   /student. The switch on « Mes classes » lists it again.

   ADDED, never edited into an existing spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const HOST = new URL(BASE_URL).hostname;
const robotsMeta = (html: string) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? null;

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

async function page200(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url, { maxRedirects: 0 });
  expect(res.status(), `${url} answers by link`).toBe(200);
  return res.text();
}

test("D18 · an unlisted class: published from the form, tagged, offered nowhere, booked from its QR link", async ({ browser, request }) => {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Sana Centre" });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName: "Sana Centre" });
  const listed = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 120 });
  const title = `Groupe du centre ${Date.now().toString(36)}`;

  const ctx = await tutorCtx(browser, profile.id);
  const page = await ctx.newPage();

  await test.step("the Arabic form names the switch", async () => {
    await page.goto("/ar/dashboard/new-class", { waitUntil: "networkidle" });
    await expect(page.locator("[data-e2e=unlisted-row]")).toContainText("بالرابط برك");
  });

  await test.step("the form: « Non listé » on, then publish", async () => {
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" });
    const row = page.locator("[data-e2e=unlisted-row]");
    await expect(row).toContainText("Non listé");
    await expect(row).toContainText("Seuls ceux qui ont le lien ou le QR code voient cette classe.");
    const sw = page.locator("[data-e2e=unlisted-box]");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    await page.locator("form input[type=text]").first().fill(title);
    const d = new Date(Date.now() + 2 * 86_400_000);
    await fillWallTime(page, `${d.toISOString().slice(0, 10)}T18:00`);
    await page.getByPlaceholder("15").fill("12"); // cheaper than the listed class: it must not set the public price
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator("[data-e2e=class-published]")).toContainText("Elle est non listée");
  });

  const [created] = await sql<{ id: string; unlisted: boolean }[]>`select id, unlisted from classes where tutor_id = ${tutor.id} and title = ${title}`;
  expect(created?.unlisted).toBe(true);
  const id = created.id;

  await test.step("« Mes classes » tags it, and only it", async () => {
    await page.goto("/fr/dashboard/classes", { waitUntil: "networkidle" });
    await expect(page.locator(`[data-e2e=class-row][data-class-id="${id}"] [data-e2e=class-unlisted]`)).toHaveText("Non listé");
    await expect(page.locator(`[data-e2e=class-row][data-class-id="${listed.id}"] [data-e2e=class-unlisted]`)).toHaveCount(0);
  });

  await test.step("absent from the storefront, its JSON-LD, Explore's price and the sitemap", async () => {
    for (const locale of ["fr", "ar"]) {
      const sf = await page200(request, `/${locale}/${tutor.slug}`);
      expect(sf).toContain(listed.title);
      expect(sf, `/${locale}/${tutor.slug} never names it`).not.toContain(title);
      expect(sf, "nor links it, nor puts it in the JSON-LD").not.toContain(id);
    }
    const explore = (await api(`/tutors/explore?q=${encodeURIComponent(tutor.slug)}`)) as unknown as { slug: string; price_from_tnd: number | null }[];
    expect(explore.find((t) => t.slug === tutor.slug)?.price_from_tnd).toBe(40);
    const sitemap = await (await request.get("/sitemap.xml")).text();

    expect(sitemap, "the sitemap lists no class page at all").not.toContain("/class/");
  });

  await test.step("its own page answers by link, noindex, in both locales", async () => {
    for (const locale of ["fr", "ar"]) {
      expect(robotsMeta(await page200(request, `/${locale}/class/${id}`)), `/${locale}/class/${id}`).toBe("noindex, nofollow");
    }
    expect(robotsMeta(await page200(request, `/fr/class/${listed.id}`)) ?? "", "a listed class stays indexable").not.toContain("noindex");
  });

  await test.step("a student opens the QR-code link and books it like any class", async () => {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const sctx = await browser.newContext({ reducedMotion: "reduce" });
    await loginAs(sctx, student.id);
    const sp = await sctx.newPage();
    const qr = shareUrl(BASE_URL, { kind: "class", slug: tutor.slug, classId: id }, "qr");
    expect(qr).toMatch(new RegExp(`/class/${id}\\?utm_source=qr$`));
    await sp.goto(qr);
    await sp.waitForURL(new RegExp(`/fr/class/${id}`));
    await expect(sp.locator("main")).toContainText(title);
    await sp.locator("a.cd-cta").first().click();
    await sp.waitForURL(/\/fr\/checkout\?class=/);
    await sp.locator("button.ck-cta").click();
    await expect.poll(async () => (await sql<{ n: number }[]>`
      select count(*)::int n from bookings where class_id = ${id} and student_id = ${student.id} and status <> 'cancelled'`)[0].n, { timeout: 15_000 }).toBe(1);
    await sp.goto("/fr/student");
    await expect(sp.locator("main")).toContainText(title, { timeout: 15_000 });
    await sctx.close();
  });

  await test.step("the switch on « Mes classes » lists it again", async () => {
    await page.goto("/fr/dashboard/classes", { waitUntil: "networkidle" });
    const row = page.locator(`[data-e2e=class-row][data-class-id="${id}"]`);
    await row.locator("[data-e2e=class-unlisted-toggle]").click();
    await expect(row.locator("[data-e2e=class-unlisted]")).toHaveCount(0, { timeout: 15_000 });
    const [after] = await sql<{ unlisted: boolean }[]>`select unlisted from classes where id = ${id}`;
    expect(after.unlisted).toBe(false);
    await expect.poll(async () => (await request.get(`/fr/${tutor.slug}`)).text(), { timeout: 15_000 }).toContain(title);
  });

  await ctx.close();
});

test("D18 · a test tutor's unlisted class: one robots noindex, still bookable by link", async ({ request }) => {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988 });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, hoursFromNow: 70 });
  await sql`update tutors set is_test = true where id = ${tutor.id}`;
  await sql`update classes set unlisted = true where id = ${klass.id}`;
  for (const locale of ["fr", "ar"]) {
    const html = await page200(request, `/${locale}/class/${klass.id}`);
    expect(html.match(/<meta name="robots"/g)?.length, `/${locale}: one robots tag`).toBe(1);
    expect(robotsMeta(html)).toBe("noindex, nofollow");
  }
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const booked = await api("/bookings", await mintSession(student.id), { classId: klass.id });
  expect(booked.ok).toBe(true);
});

test("D18 · a promotion on an unlisted class: the class page, its JSON-LD and checkout show 36 TND, the booking records 36", async ({ browser, request }) => {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988 });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: 80 });
  await sql`update classes set unlisted = true where id = ${klass.id}`;
  const [promo] = await sql<{ id: string }[]>`
    insert into promotions (tutor_id, percent, scope, target_id, ends_at)
    values (${tutor.id}, 10, 'class', ${klass.id}, now() + interval '5 days') returning id`;

  // Public reads never name it.
  expect(await (await request.get(`/fr/${tutor.slug}`)).text()).not.toContain(klass.id);

  // The JSON-LD of its own page quotes the promoted price.
  const html = await page200(request, `/fr/class/${klass.id}`);
  const offers = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]).join(" ");
  expect(offers).toMatch(/"price":"?36(\.0+)?"?/);

  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const sctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(sctx, student.id);
  const sp = await sctx.newPage();
  await sp.goto(`/fr/class/${klass.id}`, { waitUntil: "networkidle" });
  const price = sp.locator("[data-e2e=promo-price]").first();
  await expect(price.locator("[data-e2e=price-was]")).toHaveText("40 TND");
  await expect(price.locator("[data-e2e=promo-badge]")).toHaveText("−10 %");
  await expect(price.locator(".pp-amount")).toContainText("36");

  await sp.goto(`/fr/checkout?class=${klass.id}`, { waitUntil: "networkidle" });
  await expect(sp.locator(".ck-pay-detail")).toContainText(/Cette séance est à 36 TND au lieu de 40 TND \(−10 % jusqu'au \d{2}\/\d{2}\/\d{4}\)\./);
  await sp.locator("button.ck-cta").click();
  await expect.poll(async () => (await sql<{ price_tnd: string | null; promotion_id: string | null }[]>`
    select price_tnd, promotion_id from bookings where class_id = ${klass.id} and student_id = ${student.id} and status <> 'cancelled'`)[0] ?? null, { timeout: 15_000 })
    .toEqual({ price_tnd: "36.00", promotion_id: promo.id });
  await sctx.close();
});
