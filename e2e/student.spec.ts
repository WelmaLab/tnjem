import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedConsent } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* The student journey, and the two guardrails on it that matter most:
   the seat is claimed atomically, and a minor without guardian consent cannot
   book no matter what the UI does. Both are enforced server-side today and must
   still be enforced server-side after they move to Fastify. */

/* reducedMotion is REQUIRED, not a nicety. The student dashboard's cards carry a
   continuous entrance animation, so Playwright's "visible, enabled and stable"
   check never settles and every click on them times out with the element clearly
   present in the log. globals.css has a prefers-reduced-motion backstop, so
   asking for it makes the card stop moving. (It cannot be set in config.use on
   Playwright 1.62 — it is a context option.) */
async function asStudent(browser: any, profileId: string) {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(profileId))]);
  return ctx;
}

test("an adult student books a seat, sees it, and cancels it", async ({ browser }) => {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });
  const student = await seedProfile({ role: "student", birthYear: 1990 });

  const ctx = await asStudent(browser, student.id);
  const page = await ctx.newPage();

  await page.goto(`/fr/checkout?class=${klass.id}`);
  await page.locator("button.ck-cta").click();

  // The seat is claimed in the database, not merely acknowledged in the UI.
  await expect.poll(async () => {
    const [b] = await sql<{ n: number }[]>`
      select count(*)::int n from bookings
      where class_id = ${klass.id} and student_id = ${student.id} and status <> 'cancelled'`;
    return b.n;
  }, { timeout: 15_000 }).toBe(1);

  const [after] = await sql<{ seats_taken: number }[]>`
    select seats_taken from classes where id = ${klass.id}`;
  expect(after.seats_taken).toBe(1);

  // It shows up on the student's own dashboard.
  await page.goto("/fr/student");
  await expect(page.locator("main")).toContainText(klass.title);

  /* ...and cancelling releases the seat.

     force:true is REQUIRED here, and the reason generalises to every future spec
     that clicks anything on the student dashboard: the page runs two
     setInterval(..., 1000) countdowns (student/page.tsx:99 and :235), so the card
     re-renders every second and Playwright's "stable" actionability check never
     settles -- the click waits out the full timeout with the button sitting right
     there in the log, visible and enabled. reducedMotion does not help; this is a
     live clock, not an animation.

     force:true is not enough either -- it skips hit-testing but still clicks a
     screen POSITION, and the card reflows between resolving the locator and the
     click. dispatchEvent fires the event on the element itself, so position stops
     mattering; React 18's delegated listener picks it up normally. */
  // student-space-v1 · B: « Annuler ma place » is behind the next class's « ⋯ » menu now.
  await page.locator("[data-e2e=seat-menu]").first().dispatchEvent("click");
  const cancelBtn = page.getByRole("button", { name: /Annuler ma place/i }).first();
  await expect(cancelBtn).toBeVisible();
  await cancelBtn.dispatchEvent("click");

  const confirmBtn = page.getByRole("button", { name: /Oui, annuler/i });
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.dispatchEvent("click");

  await expect.poll(async () => {
    const [c] = await sql<{ seats_taken: number }[]>`
      select seats_taken from classes where id = ${klass.id}`;
    return c.seats_taken;
  }, { timeout: 15_000 }).toBe(0);

  const [b] = await sql<{ status: string }[]>`
    select status from bookings where class_id = ${klass.id} and student_id = ${student.id}`;
  expect(b.status).toBe("cancelled");

  await ctx.close();
});

test("a minor with no guardian consent cannot take a seat", async ({ browser }) => {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });
  const minor = await seedProfile({ role: "student", birthYear: new Date().getFullYear() - 14 });

  const ctx = await asStudent(browser, minor.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/checkout?class=${klass.id}`);
  await page.locator("button.ck-cta").click();

  // Give the request time to land, then assert nothing happened.
  await page.waitForTimeout(2000);
  const [b] = await sql<{ n: number }[]>`
    select count(*)::int n from bookings where class_id = ${klass.id} and student_id = ${minor.id}`;
  expect(b.n, "a minor without consent must not hold a seat").toBe(0);

  const [c] = await sql<{ seats_taken: number }[]>`
    select seats_taken from classes where id = ${klass.id}`;
  expect(c.seats_taken, "and the seat counter must not move").toBe(0);

  await ctx.close();
});

test("the same minor CAN book once a guardian consent row exists", async ({ browser }) => {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });
  const minor = await seedProfile({ role: "student", birthYear: new Date().getFullYear() - 14 });
  await seedConsent(minor.id);

  const ctx = await asStudent(browser, minor.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/checkout?class=${klass.id}`);
  await page.locator("button.ck-cta").click();

  await expect.poll(async () => {
    const [b] = await sql<{ n: number }[]>`
      select count(*)::int n from bookings
      where class_id = ${klass.id} and student_id = ${minor.id} and status <> 'cancelled'`;
    return b.n;
  }, { timeout: 15_000 }).toBe(1);

  await ctx.close();
});

test("a booking is idempotent — booking twice never takes two seats", async ({ browser }) => {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });
  const student = await seedProfile({ role: "student", birthYear: 1990 });

  const ctx = await asStudent(browser, student.id);
  const page = await ctx.newPage();

  await page.goto(`/fr/checkout?class=${klass.id}`);
  await page.locator("button.ck-cta").click();
  await expect.poll(async () => {
    const [c] = await sql<{ seats_taken: number }[]>`
      select seats_taken from classes where id = ${klass.id}`;
    return c.seats_taken;
  }, { timeout: 15_000 }).toBe(1);

  await page.goto(`/fr/checkout?class=${klass.id}`);
  const cta = page.locator("button.ck-cta");
  if (await cta.count()) { await cta.click(); await page.waitForTimeout(1500); }

  const [c] = await sql<{ seats_taken: number }[]>`
    select seats_taken from classes where id = ${klass.id}`;
  expect(c.seats_taken, "the unique(class_id, student_id) index makes this idempotent").toBe(1);

  await ctx.close();
});
