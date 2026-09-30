import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { email, seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { fillOtp } from "./support/otp-ui";
import { mintSession } from "./support/session";
import { api, browserSession } from "./support/journey";

/* ════════════════════════════════════════════════════════════════════════════
   THE STUDENT JOURNEY, against the real API and database, as a MINOR:

   sign up (14 years old) → the API refuses a booking without guardian consent →
   consent screen → explore → storefront → class page → checkout → /student →
   the live page lets them in (and a stranger out) → cancel under the 48h rule
   (free early, 40% late) → review a class they took → the rating moves.

   ADDED, never edited into an existing spec. */

test("student journey: minor signup → consent → explore → book → live gate → cancel (48h) → review → rating", async ({ browser }) => {
  test.setTimeout(240_000);
  await resetRateLimits();

  /* phase-a lane L2 (A23): students see "first name + initial", so the unique part
     lives in the FIRST name — the only part a student can search for or read. */
  /* Letters only (phase-a/integrate, A23): the public name keeps only the letters of
     the first name — "Nourb921" is shown as "Nourb" — so a hex tag would not match. */
  const tutorFirst = `Nour${[...randomBytes(4)].map((b) => String.fromCharCode(97 + (b % 26))).join("")}`;
  const tutorName = `${tutorFirst} Journey`;
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1984 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified", fullName: tutorName });
  const early = await seedClass({ tutorId: tutor.id, hoursFromNow: 96, priceTnd: 30, isFreeFirst: false });
  const soon = await seedClass({ tutorId: tutor.id, hoursFromNow: 5, priceTnd: 30, isFreeFirst: false });
  const taken = await seedClass({ tutorId: tutor.id, hoursFromNow: -26, priceTnd: 30, isFreeFirst: false });

  const address = email(`e2e-jstudent-${randomBytes(4).toString("hex")}`);
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  let studentId = "";

  await test.step("a 14-year-old signs up and is sent to guardian consent", async () => {
    await page.goto("/fr/signup/eleve");
    await page.locator('input[type="email"]').fill(address);
    // phase-a lane L2 (A24): month AND year. Minors are allowed here: playwright.config sets ALLOW_MINORS=1.
    await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
    await page.getByLabel("Année de naissance", { exact: true }).selectOption(String(new Date().getFullYear() - 14));
    await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${address}`)[0].n, { timeout: 20_000 }).toBe(1);
    const code = await recoverOtp(address);
    /* Auth Option B: the code step replaces step 1; six boxes, filled the way SMS
       autofill does (support/otp-ui.ts). onComplete verifies on the sixth digit; the
       requestSubmit stays as a harmless fallback (verifyWith's `loading` guard, and
       the server is race-safe — otp-race.spec.ts). */
    await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
    await fillOtp(page, code);
    await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
    await page.waitForURL(/\/fr\/auth\/consent/, { timeout: 20_000 });
    studentId = (await sql<{ id: string }[]>`select id from profiles where email = ${address}`)[0].id;
  });

  await test.step("without consent the API refuses the booking — not just the UI", async () => {
    const token = await browserSession(ctx);
    expect(await api("/bookings", token, { classId: early.id })).toMatchObject({ ok: false, error: "needs-consent" });
    const [b] = await sql<{ n: number }[]>`select count(*)::int n from bookings where student_id = ${studentId}`;
    expect(b.n).toBe(0);
  });

  await test.step("the guardian consents on the consent screen", async () => {
    await page.getByPlaceholder("…", { exact: true }).fill("Sami Parent");
    // phase-a lane L5 (A18.2): the guardian's phone is no longer asked for.
    await page.getByPlaceholder("parent@example.com").fill(email(`e2e-jguardian-${randomBytes(3).toString("hex")}`));
    // phase-a lane L5 (A18.1): no "je suis le parent" tick any more — the child fills this form.
    await page.getByRole("button", { name: "Activer le compte" }).click();
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from consents where minor_id = ${studentId}`)[0].n, { timeout: 15_000 }).toBe(1);
  });

  await test.step("explore → storefront → class page → checkout: the seat is claimed", async () => {
    await page.goto("/fr/explore");
    await page.locator('input[type="search"]').fill(tutorFirst);
    await page.locator(`a[href="/fr/${tutor.slug}"]`).first().click();
    await page.waitForURL(new RegExp(`/fr/${tutor.slug}$`));
    await expect(page.locator("main h1").first()).toContainText(`${tutorFirst} J.`); // phase-a lane L2 (A23)
    await page.locator(`a[href="/fr/class/${early.id}"]`).first().click();
    await page.waitForURL(new RegExp(`/fr/class/${early.id}`));
    await page.locator("a.cd-cta").first().click();
    await page.waitForURL(/\/fr\/checkout\?class=/);
    await page.locator("button.ck-cta").click();
    await expect.poll(async () => (await sql<{ n: number }[]>`
      select count(*)::int n from bookings where class_id = ${early.id} and student_id = ${studentId} and status <> 'cancelled'`)[0].n, { timeout: 15_000 }).toBe(1);
  });

  await test.step("the booking is on /student", async () => {
    await page.goto("/fr/student");
    await expect(page.locator("main")).toContainText(early.title, { timeout: 15_000 });
  });

  await test.step("the live page lets the booked student in, and a stranger not", async () => {
    await page.goto(`/fr/live/${early.id}`);
    const join = page.getByRole("button", { name: /Entrer dans la classe/ });
    await expect(join).toBeVisible({ timeout: 15_000 });
    await expect(join).toBeEnabled();

    const stranger = await seedProfile({ role: "student", birthYear: 1990 });
    const strangerCtx = await browser.newContext();
    const { sessionCookie } = await import("./support/session");
    await strangerCtx.addCookies([sessionCookie(await mintSession(stranger.id))]);
    const strangerPage = await strangerCtx.newPage();
    await strangerPage.goto(`/fr/live/${early.id}`);
    // The locked screen itself — its call to action points at the class page to book it.
    await expect(strangerPage.locator(`main a[href="/fr/class/${early.id}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(strangerPage.getByRole("button", { name: /Entrer dans la classe/ })).toHaveCount(0);
    await strangerCtx.close();
  });

  await test.step("cancel under the 48h rule: free 4 days out, 40% noted inside 48h", async () => {
    const token = await browserSession(ctx);
    expect(await api("/bookings", token, { classId: soon.id })).toMatchObject({ ok: true });
    const soonBooking = (await sql<{ id: string }[]>`select id from bookings where class_id = ${soon.id} and student_id = ${studentId}`)[0].id;
    expect(await api("/bookings/cancel", token, { bookingId: soonBooking })).toMatchObject({ ok: true, late: true });
    const [late] = await sql<{ late: boolean; retained_tnd: string }[]>`select late, retained_tnd from cancellations where booking_id = ${soonBooking}`;
    expect(late).toMatchObject({ late: true, retained_tnd: "12.00" });

    await page.goto("/fr/student");
    const cancelBtn = page.getByRole("button", { name: /Annuler ma place/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
    await cancelBtn.dispatchEvent("click");
    await page.getByRole("button", { name: /Oui, annuler/i }).dispatchEvent("click");
    await expect.poll(async () => (await sql<{ status: string }[]>`
      select status from bookings where class_id = ${early.id} and student_id = ${studentId}`)[0].status, { timeout: 15_000 }).toBe("cancelled");
    const [free] = await sql<{ late: boolean; retained_tnd: string }[]>`
      select c.late, c.retained_tnd from cancellations c join bookings b on b.id = c.booking_id
       where b.class_id = ${early.id} and b.student_id = ${studentId}`;
    expect(free).toMatchObject({ late: false, retained_tnd: "0.00" });
  });

  await test.step("review a class they took; the tutor's rating moves", async () => {
    await seedBooking({ classId: taken.id, studentId, isFree: false });
    await page.goto("/fr/student");
    await page.getByRole("button", { name: "Noter mon prof" }).first().dispatchEvent("click");
    await page.getByRole("button", { name: "4 étoiles" }).dispatchEvent("click");
    await page.getByLabel(/Un mot pour les autres élèves/).fill("Très clair, on a refait tous les exercices.");
    await page.getByRole("button", { name: "Envoyer mon avis" }).dispatchEvent("click");
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from reviews where class_id = ${taken.id} and student_id = ${studentId}`)[0].n, { timeout: 15_000 }).toBe(1);
    const [t] = await sql<{ rating: string }[]>`select rating from tutors where id = ${tutor.id}`;
    expect(Number(t.rating)).toBe(4);
    const reviews = (await api(`/tutors/${tutor.slug}/reviews`)) as { count: number; average: number };
    expect(reviews).toMatchObject({ count: 1, average: 4 });
  });

  await ctx.close();
});
