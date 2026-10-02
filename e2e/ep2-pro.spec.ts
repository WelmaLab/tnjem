import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedAdmin, seedBooking, seedClass, seedOffer, seedProfile, seedPromotion, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { auditActions } from "./support/journey";

/* espace prof v2 · pro (P7) — stage B: what the pages show.

     • JSON-LD: Person (no rating without reviews) + an offer at the price quoted
       today on the profile; Course + CourseInstance on the class page; nothing for a
       cancelled class; the « arrive bientôt » page is noindex, has no Person markup
       and is not in the sitemap.
     • « Aide » in the prof shell's navigation.
     • The admin's read-only offers + subscriptions, audited on the click.
     • « Ajouter au calendrier » on the student's upcoming class.
     • Mes fiches: removing asks first, then a toast.
     • Arabic percentages are bidi-isolated (« −20 % » never reads « % 20− »).

   ADDED, never edited into an existing spec. */

async function tutorWithProfile(opts: { status?: "draft" | "pending" | "verified"; fullName?: string } = {}) {
  const profile = await seedProfile({ role: "tutor", fullName: opts.fullName ?? "Nadia Ben Amor", birthYear: 1986 });
  const tutor = await seedTutor({ profileId: profile.id, status: opts.status ?? "verified", fullName: opts.fullName ?? "Nadia Ben Amor" });
  return { profile, tutor };
}

async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.flatMap((b) => {
    const v = JSON.parse(b) as unknown;
    return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
  });
}

test.describe("ep2 · JSON-LD and indexing", () => {
  test("profile: Person without a rating (no reviews), the offer at today's promoted price, the public name", async ({ page }) => {
    const { tutor } = await tutorWithProfile();
    await seedClass({ tutorId: tutor.id, priceTnd: 40, isFreeFirst: false, hoursFromNow: 96 });
    await seedPromotion({ tutorId: tutor.id, percent: 20 });
    await page.goto(`/fr/${tutor.slug}`);
    const ld = await jsonLd(page);
    const person = ld.find((o) => o["@type"] === "Person");
    expect(person?.name).toBe("Nadia B.");
    expect(JSON.stringify(ld)).not.toContain("Ben Amor");
    expect(JSON.stringify(ld)).not.toContain("AggregateRating");
    const service = ld.find((o) => o["@type"] === "Service") as { offers?: { lowPrice: string } } | undefined;
    expect(service?.offers?.lowPrice, "40 TND − 20 % = 32 TND, as the page shows it").toBe("32");
  });

  test("class page: Course + CourseInstance, server-rendered; a cancelled class has none", async ({ page, request }) => {
    const { tutor } = await tutorWithProfile();
    const klass = await seedClass({ tutorId: tutor.id, priceTnd: 30, isFreeFirst: false, hoursFromNow: 72 });
    const html = await (await request.get(`/fr/class/${klass.id}`)).text();
    expect(html, "in the first HTML, for crawlers").toContain('"@type":"Course"');
    await page.goto(`/fr/class/${klass.id}`);
    const course = (await jsonLd(page)).find((o) => o["@type"] === "Course") as Record<string, any>;
    expect(course.hasCourseInstance["@type"]).toBe("CourseInstance");
    expect(course.hasCourseInstance.courseMode).toBe("online");
    expect(course.hasCourseInstance.instructor.name).toBe("Nadia B.");
    expect(course.offers.price).toBe("30");

    const gone = await seedClass({ tutorId: tutor.id, hoursFromNow: 80 });
    await sql`update classes set status = 'cancelled' where id = ${gone.id}`;
    const goneHtml = await (await request.get(`/fr/class/${gone.id}`)).text();
    expect(goneHtml).not.toContain('"@type":"Course"');
  });

  test("« Ce prof arrive bientôt » is noindex, carries no Person markup and stays out of the sitemap", async ({ request }) => {
    const { tutor } = await tutorWithProfile({ status: "pending" });
    const res = await request.get(`/fr/${tutor.slug}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    expect(html).not.toContain('"@type":"Person"');
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).not.toContain(`/${tutor.slug}<`);
  });
});

test("the prof shell's navigation has « Aide », and it opens /aide", async ({ browser }) => {
  const { profile } = await tutorWithProfile();
  const ctx = await browser.newContext();
  await loginAs(ctx, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard");
  const link = page.locator('nav a[href="/fr/aide"]').first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toContainText("Aide");
  await link.click();
  await expect(page).toHaveURL(/\/fr\/aide$/);
  await expect(page.locator("main h1")).toHaveText("Aide pour les profs");
  await ctx.close();
});

test("admin: a tutor's offers and subscriptions, read-only, logged on the click", async ({ browser }) => {
  const { profile, tutor } = await tutorWithProfile();
  const offer = await seedOffer({ tutorId: tutor.id, title: "Suivi Bac", sessionsPerMonth: 4, priceTnd: 120 });
  const student = await seedProfile({ role: "student", fullName: "Ines Ben Salah" });
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end, confirmed_at)
            values (${offer.id}, ${tutor.id}, ${student.id}, 'active', 4, '120', now() - interval '1 day', now() + interval '29 days', now() - interval '1 day')`;

  const admin = await seedAdmin();
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(ctx, admin.id);
  const page = await ctx.newPage();
  await page.goto("/fr/admin/accounts", { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(profile.email);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  const box = page.locator("[data-e2e=admin-offers]");
  await expect(box).toBeVisible({ timeout: 15_000 });
  expect(await auditActions(tutor.id)).not.toContain("offers.read");
  await box.getByRole("button", { name: "Voir ses offres et abonnements" }).click();
  await expect(page.locator("[data-e2e=admin-offer-row]")).toHaveCount(1);
  await expect(page.locator("[data-e2e=admin-offer-row]")).toContainText("Suivi Bac");
  const sub = page.locator("[data-e2e=admin-sub-row]");
  await expect(sub).toHaveCount(1);
  await expect(sub).toContainText("Ines");
  await expect(sub).not.toContainText("Ben Salah");
  await expect(sub).toHaveAttribute("data-status", "active");
  await expect(page.locator("[data-e2e=admin-offers] button")).toHaveCount(0); // nothing to change there
  expect(await auditActions(tutor.id)).toContain("offers.read");
  await ctx.close();
});

test("the student's upcoming class offers « Ajouter au calendrier » (the .ics of that booking)", async ({ browser }) => {
  const { tutor } = await tutorWithProfile();
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, isFreeFirst: false });
  const student = await seedProfile({ role: "student", fullName: "Sami T" });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: false });
  const ctx = await browser.newContext();
  await loginAs(ctx, student.id);
  const page = await ctx.newPage();
  await page.goto("/fr/student");
  const link = page.locator("[data-e2e=add-to-calendar]").first();
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).toHaveAttribute("href", `/api/calendar/${booking.id}?l=fr`);
  const res = await ctx.request.get(`/api/calendar/${booking.id}?l=fr`);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  await ctx.close();
});

test("Mes fiches: removing asks first; keeping changes nothing, confirming removes it with a toast", async ({ browser }) => {
  const { profile, tutor } = await tutorWithProfile();
  const [m] = await sql<{ id: string }[]>`
    insert into materials (tutor_id, title, kind, youtube_id, visibility)
    values (${tutor.id}, 'Fiche intégrales', 'youtube', 'dQw4w9WgXcQ', 'students') returning id`;
  const ctx = await browser.newContext();
  await loginAs(ctx, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/materials");
  const remove = page.locator("[data-e2e=material-remove]");
  await expect(remove).toHaveCount(1, { timeout: 15_000 });

  await remove.click();
  const dialog = page.locator("[data-e2e=confirm-dialog][open]");
  await expect(dialog).toContainText("Retirer « Fiche intégrales » ?");
  await dialog.getByRole("button", { name: "Garder" }).click();
  await expect(dialog).toHaveCount(0);
  const [kept] = await sql<{ removed_at: Date | null }[]>`select removed_at from materials where id = ${m.id}`;
  expect(kept.removed_at).toBeNull();

  await remove.click();
  await page.locator("[data-e2e=confirm-dialog][open]").getByRole("button", { name: "Retirer", exact: true }).click();
  await expect(page.locator(".toast")).toHaveText("Retiré de ta bibliothèque.");
  await expect(page.locator("[data-e2e=shell-empty]")).toBeVisible();
  const [gone] = await sql<{ removed_at: Date | null }[]>`select removed_at from materials where id = ${m.id}`;
  expect(gone.removed_at).not.toBeNull();
  await ctx.close();
});

test("Réglages › Sécurité: « Déconnecter partout » asks first; keeping changes nothing", async ({ browser }) => {
  const { profile } = await tutorWithProfile();
  const ctx = await browser.newContext();
  await loginAs(ctx, profile.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/settings?tab=securite");
  await page.getByRole("button", { name: "Déconnecter partout" }).click();
  const dialog = page.locator("[data-e2e=confirm-dialog][open]");
  await expect(dialog).toContainText("Te déconnecter de tous tes appareils ?");
  await dialog.getByRole("button", { name: "Annuler" }).click();
  await expect(dialog).toHaveCount(0);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from sessions where profile_id = ${profile.id}`;
  expect(n, "nothing was signed out").toBe(1);

  await page.getByRole("button", { name: "Déconnecter partout" }).click();
  await page.locator("[data-e2e=confirm-dialog][open]").getByRole("button", { name: "Déconnecter partout" }).click();
  await expect(page).toHaveURL(/\/fr\/?$/);
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from sessions where profile_id = ${profile.id}`)[0].n).toBe(0);
  await ctx.close();
});

test("Réglages › Notifications says which switches already e-mail a tutor — in Arabic too", async ({ browser }) => {
  const { profile } = await tutorWithProfile();
  const ctx = await browser.newContext();
  await loginAs(ctx, profile.id);
  const page = await ctx.newPage();
  await page.goto("/ar/dashboard/settings?tab=notifications");
  const note = page.locator("[data-e2e=prefs-not-yet]");
  await expect(note).toContainText("« الحجوزات » و« التذكيرات » يبعثولك إيمايلات من توّا", { timeout: 15_000 });
  await expect(page.locator("[data-e2e=pref-reminders]")).toContainText("24 ساعة");
  await ctx.close();
});

test.describe("ep2 · Arabic percentages are bidi-isolated", () => {
  test("the promo-code banner on the Arabic profile", async ({ page }) => {
    const { tutor } = await tutorWithProfile();
    await seedClass({ tutorId: tutor.id, priceTnd: 40, isFreeFirst: false, hoursFromNow: 96 });
    await seedPromotion({ tutorId: tutor.id, percent: 20, code: "RENTREE" });
    await page.goto(`/ar/${tutor.slug}?promo=RENTREE`);
    const banner = page.locator("[data-e2e=promo-banner]");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    const text = await banner.textContent();
    expect(text).toContain("⁦−20 %⁩");
    /* What the reader sees: in the drawn line the minus is LEFT of "20" and the "%"
       is RIGHT of it (LTR inside the RTL sentence). Without the isolate the browser
       draws "% 20−" — measured, not assumed. */
    const x = await banner.locator("p").evaluate((p) => {
      const node = [...p.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").includes("%")) as Text;
      const t = node.textContent ?? "";
      const at = (ch: string) => {
        const i = t.indexOf(ch);
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        return r.getBoundingClientRect().left;
      };
      return { minus: at("−"), two: at("2"), pct: at("%") };
    });
    expect(x.minus, "the minus sign is drawn before the number").toBeLessThan(x.two);
    expect(x.pct, "the percent sign is drawn after the number").toBeGreaterThan(x.two);
    // The badge next to the price isolates itself with dir="ltr".
    await expect(page.locator("[data-e2e=promo-badge]").first()).toHaveAttribute("dir", "ltr");
  });

  test("the Arabic Promotions page note and /aide", async ({ browser }) => {
    const { profile } = await tutorWithProfile();
    const ctx = await browser.newContext();
    await loginAs(ctx, profile.id);
    const page = await ctx.newPage();
    await page.goto("/ar/dashboard/promotions");
    // live-fixes-1 · E: the rule moved from a second note into the « ? » beside « Réduction ».
    await page.locator("[data-e2e=promo-info]").click({ timeout: 15_000 });
    await expect(page.locator("[data-e2e=promo-info-text]")).toContainText("⁦20 %⁩");
    await page.goto("/ar/aide");
    await expect(page.locator("#promotions")).toContainText("⁦20 %⁩");
    await ctx.close();
  });
});
