import { test, expect, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* live-fixes-1 · C — typography and how values display.

   C1  Prices and figures in the brand's text face with tabular figures — never Space
       Grotesk (--fd), whose « 0 TND » read as a monospace font (globals.css --fn).
   C2  The subject's label, never its code (« math » → « Maths » / « رياضيات »); names
       capitalised for display (« walid T. » → « Walid T. »); a phone grouped
       « +216 56 561 226 ». The stored values do not change. */

async function face(el: Locator): Promise<{ family: string; numeric: string }> {
  return el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric };
  });
}

async function walid() {
  const me = await seedProfile({ role: "tutor", birthYear: 1990, fullName: "walid tester", phone: `+2165${String(Date.now()).slice(-7)}` });
  const tutor = await seedTutor({ profileId: me.id, status: "verified", fullName: "walid tester" });
  await sql`update tutors set subject = 'math' where id = ${tutor.id}`;
  await seedClass({ tutorId: tutor.id, hoursFromNow: 72, priceTnd: 25 });
  await sql`insert into packs (id, tutor_id, title, description, price_tnd) values (${randomUUID()}, ${tutor.id}, 'Pack Bac', '12 pages', '18')`;
  return { me, tutor };
}

test.describe("C1 · figures in the brand face, tabular", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`plan, new-class preview, TND suffix, home counters, Mes fiches (${loc})`, async ({ browser }) => {
      const { me } = await walid();
      const ctx = await contextAs(browser, me.id);
      const page = await ctx.newPage();
      const brand = loc === "ar" ? /IBM Plex Sans Arabic/ : /Plus Jakarta Sans/;
      const check = async (el: Locator, what: string) => {
        await expect(el, what).toBeVisible();
        const f = await face(el);
        expect(f.family, `${what}: ${f.family}`).not.toMatch(/Space Grotesk|monospace/);
        expect(f.family, what).toMatch(brand);
        expect(f.numeric, what).toContain("tabular-nums");
      };

      await page.goto(`/${loc}/dashboard/plan`, { waitUntil: "networkidle" });
      await check(page.locator(".ofr-price").first(), "Mon offre « 0 TND »");
      await check(page.locator(".ofr-price-sm").first(), "the plan prices");

      await page.goto(`/${loc}/dashboard/new-class`, { waitUntil: "networkidle" });
      await check(page.locator(".nc-preview-price").first(), "the preview's « — TND »");
      await check(page.locator("main .inp .pre").first(), "the « TND » suffix");

      await page.goto(`/${loc}/dashboard`, { waitUntil: "networkidle" });
      await check(page.locator(".hp-kpi-v").first(), "a home counter");

      await page.goto(`/${loc}/dashboard/materials`, { waitUntil: "networkidle" });
      await check(page.locator("[data-e2e=fiche-price]").first(), "a fiche's price");

      await page.goto(`/${loc}/dashboard/promotions`, { waitUntil: "networkidle" });
      await check(page.locator("[data-e2e=promo-percent-value]"), "the promotion's « −10 % »");
      await ctx.close();
    });
  }
});

test.describe("C2 · values as people read them", () => {
  test("the subject's label, not its code — owner preview and public page, FR + AR", async ({ browser }) => {
    const { me, tutor } = await walid();
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    for (const [loc, label] of [["fr", "Maths"], ["ar", "رياضيات"]] as const) {
      await page.goto(`/${loc}/dashboard/storefront/preview`, { waitUntil: "networkidle" });
      await expect(page.locator(".sf-subject").first()).toHaveText(label);
      await page.goto(`/${loc}/${tutor.slug}`, { waitUntil: "networkidle" });
      await expect(page.locator(".sf-subject").first()).toHaveText(label);
      await expect(page.locator(".sf-name-txt").first()).toHaveText("Walid T.");
      await expect(page).toHaveTitle(new RegExp(`Walid T\\. — ${label}`));
    }
    const [row] = await sql<{ subject: string; full_name: string }[]>`select subject, full_name from tutors where id = ${tutor.id}`;
    expect(row).toEqual({ subject: "math", full_name: "walid tester" }); // stored as typed
    await ctx.close();
  });

  test("Réglages › Compte and the sidebar: « Walid Tester », « +216 56 … »", async ({ browser }) => {
    const { me } = await walid();
    const [{ phone }] = await sql<{ phone: string }[]>`select phone from profiles where id = ${me.id}`;
    const d = phone.slice(4);
    const grouped = `+216 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const loc of ["fr", "ar"] as const) {
      await page.goto(`/${loc}/dashboard/settings?tab=compte`, { waitUntil: "networkidle" });
      await expect(page.locator(".st-id-name")).toHaveText("Walid Tester");
      await expect(page.locator(".st-id-contact")).toContainText(grouped);
      await expect(page.locator(".aps-me-name").first()).toHaveText("Walid");
    }
    await ctx.close();
  });
});

test.describe("C2 · the subject in /onboarding's editor", () => {
  test("a code shows as its label (FR + AR); saved untouched it stays the code; a new subject is stored as typed", async ({ browser }) => {
    const { me, tutor } = await walid();
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    const subjectRow = async () =>
      (await sql<{ subject: string; bio: string }[]>`select subject, bio from tutors where id = ${tutor.id}`)[0];

    await page.goto("/ar/onboarding", { waitUntil: "networkidle" });
    await expect(page.getByLabel("مادتك والمستوى")).toHaveValue("رياضيات");

    await page.goto("/fr/onboarding", { waitUntil: "networkidle" });
    const subject = page.getByLabel("Ta matière & niveau");
    await expect(subject).toHaveValue("Maths");
    // Another field changes; the subject, untouched, goes back as the code.
    const bio = `Bac maths, méthode et annales ${Date.now().toString(36)}`;
    await page.getByLabel("Une phrase sur toi (en darija, c'est parfait)").fill(bio);
    await page.getByRole("button", { name: "Publier ma page" }).click();
    await expect.poll(async () => (await subjectRow()).bio, { timeout: 15_000 }).toBe(bio);
    expect((await subjectRow()).subject).toBe("math");

    // A new subject is stored exactly as typed.
    await page.goto("/fr/onboarding", { waitUntil: "networkidle" });
    await page.getByLabel("Ta matière & niveau").fill("Physique · Bac");
    await page.getByRole("button", { name: "Publier ma page" }).click();
    await expect.poll(async () => (await subjectRow()).subject, { timeout: 15_000 }).toBe("Physique · Bac");
    await ctx.close();
  });
});
