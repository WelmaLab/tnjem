import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { sql } from "./support/db";
import { email, seedAdmin, seedProfile } from "./support/seed";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { fillOtp } from "./support/otp-ui";
import { completePasswordStep } from "./support/password-ui"; // espace prof v2 · auth
import { mintSession } from "./support/session";
import { e2eStore } from "./support/store";
import { openForE2E } from "./support/doc-crypto";
import { api, contextAs, specimenIdPng, notificationBodies } from "./support/journey";
import { fillWallTime, wallTimeOf } from "./support/datetime"; // espace prof v2 · shell

/* ════════════════════════════════════════════════════════════════════════════
   THE TUTOR JOURNEY, in one browser session, against the real API and database:

   sign up with an email code → create the storefront → upload an ID → an admin
   approves → publish a class → a student books it → the tutor sees the booking →
   reschedule → cancel → everyone is notified.

   Every step is a screen a real tutor uses; only the admin and the student are
   separate actors. No step writes a row the product would not write itself.

   ADDED, never edited into an existing spec. */

test("tutor journey: signup → storefront → ID → approved → class → booked → moved → cancelled", async ({ browser }) => {
  test.setTimeout(240_000);
  await resetRateLimits();
  const address = email(`e2e-jtutor-${randomBytes(4).toString("hex")}`);
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  let profileId = "";
  let tutorId = "";
  let slug = "";
  let classId = "";
  /* e2e- prefix: the slug is derived from this name, and teardown deletes tutors by
     slug LIKE e2e-%. A plain name left an orphan storefront behind after every run. */
  const tutorName = `E2E Rim ${randomBytes(3).toString("hex")}`;

  await test.step("sign up with a real email code", async () => {
    await page.goto("/fr/signup/prof");
    await page.locator('input[type="email"]').fill(address);
    // phase-a lane L2 (A14): /signup/prof asks for a birth month + year (18+).
    await page.getByLabel("Mois de naissance", { exact: true }).selectOption("3");
    await page.getByLabel("Année de naissance", { exact: true }).selectOption("1988");
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
    await completePasswordStep(page); // espace prof v2 · auth: « Crée ton mot de passe » (support/password-ui.ts)
    await page.waitForURL((u) => !u.pathname.includes("/signup/"), { timeout: 20_000 });
    const [p] = await sql<{ id: string; role: string }[]>`select id, role from profiles where email = ${address}`;
    expect(p.role).toBe("tutor");
    profileId = p.id;
  });

  await test.step("create the storefront", async () => {
    await page.goto("/fr/onboarding", { waitUntil: "networkidle" }); // hydrated: a fill before hydration is wiped by React
    await page.getByPlaceholder("ex. Yassine Khelifi").fill(tutorName);
    await page.getByPlaceholder(/ex\. Maths/).fill("Physique — Bac");
    await page.getByPlaceholder(/On révise les maths/).fill("Physique-chimie, méthode et annales.");
    await page.getByRole("button", { name: /Publier ma page/i }).dispatchEvent("click");
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from tutors where profile_id = ${profileId}`)[0].n, { timeout: 20_000 }).toBe(1);
    const [t] = await sql<{ id: string; slug: string; status: string }[]>`select id, slug, status from tutors where profile_id = ${profileId}`;
    expect(t.status, "a new storefront is a draft").toBe("draft");
    tutorId = t.id;
    slug = t.slug;
    expect(slug, "teardown can find it").toMatch(/^e2e-/);
  });

  await test.step("upload an ID document from the verification screen", async () => {
    const png = await specimenIdPng(browser, tutorName.toUpperCase());
    await page.goto("/fr/onboarding/verify", { waitUntil: "networkidle" }); // hydrated: a fill before hydration is wiped by React
    await page.locator('input[name="idFront"]').setInputFiles({ name: "cin-recto.png", mimeType: "image/png", buffer: png });
    // The Décret 2015-1619 declaration is required before the application can go.
    await page.getByLabel("Je déclare ne pas exercer comme enseignant·e dans un établissement d'enseignement public.").check();
    await page.getByRole("button", { name: "Envoyer pour vérification" }).click();
    await expect(page.getByText("Vérification envoyée").first()).toBeVisible({ timeout: 30_000 });

    const [t] = await sql<{ status: string }[]>`select status from tutors where id = ${tutorId}`;
    expect(t.status).toBe("pending");
    const [doc] = await sql<{ mime: string; storage_path: string }[]>`select mime, storage_path from verification_docs where tutor_id = ${tutorId}`;
    expect(doc.mime, "the stored type is the sniffed one").toBe("image/png");
    const stored = await e2eStore().get(doc.storage_path);
    if (!stored) throw new Error("nothing stored for the uploaded ID");
    /* ENCRYPTED AT REST: the object is sealed, holds no run of the scan, and opens
       back to exactly what was uploaded — with the key, and only with it. */
    expect(stored.subarray(0, 5).toString("ascii"), "the stored object is sealed").toBe("TNJE1");
    expect(stored.indexOf(png.subarray(0, 32)), "no plaintext of the scan in storage").toBe(-1);
    expect(openForE2E(doc.storage_path, stored).equals(png), "it opens to exactly the uploaded bytes").toBe(true);
  });

  await test.step("an admin approves; the tutor is told", async () => {
    const admin = await seedAdmin();
    const adminCtx = await contextAs(browser, admin.id);
    const adminPage = await adminCtx.newPage();
    await adminPage.goto("/fr/admin/verifications");
    const card = adminPage.locator("article.av-card").filter({ hasText: slug });
    await card.getByRole("button", { name: /Approuver/ }).click();
    await expect.poll(async () => (await sql<{ status: string }[]>`select status from tutors where id = ${tutorId}`)[0].status, { timeout: 15_000 }).toBe("verified");
    await adminCtx.close();
    expect(await notificationBodies(profileId, "verification_approved")).toHaveLength(1);
    await expect.poll(async () => (await page.request.get(`/fr/${slug}`)).status(), { timeout: 15_000 }).toBe(200);
  });

  await test.step("publish a class", async () => {
    await page.goto("/fr/dashboard/new-class", { waitUntil: "networkidle" }); // hydrated: a fill before hydration is wiped by React
    await page.locator("form input[type=text]").first().fill("Ondes — révision express");
    const d = new Date(Date.now() + 6 * 86_400_000);
    await fillWallTime(page, `${d.toISOString().slice(0, 10)}T18:00`); // espace prof v2: DD/MM/YYYY + 24 h
    await page.getByPlaceholder("15").fill("25");
    await page.locator('form button[type="submit"]').click();
    await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from classes where tutor_id = ${tutorId}`)[0].n, { timeout: 15_000 }).toBe(1);
    classId = (await sql<{ id: string }[]>`select id from classes where tutor_id = ${tutorId}`)[0].id;
  });

  const student = await seedProfile({ role: "student", birthYear: 1997, fullName: "Yosra Élève" });

  await test.step("a student books it; the tutor sees the booking and is notified", async () => {
    expect(await api("/bookings", await mintSession(student.id), { classId })).toMatchObject({ ok: true });
    expect(await notificationBodies(profileId, "new_booking")).toHaveLength(1);
    await page.goto("/fr/dashboard");
    await expect(page.locator("main")).toContainText("Ondes — révision express", { timeout: 15_000 });
    // espace prof v2 · shell: who booked is on « Mes élèves »; the class actions on « Mes classes ».
    await page.goto("/fr/dashboard/students");
    await expect(page.locator("main")).toContainText("Yosra", { timeout: 15_000 });
  });

  await test.step("move the class; the student is told and may cancel free", async () => {
    await page.goto("/fr/dashboard/classes");
    await page.getByRole("button", { name: "Modifier la date" }).click();
    const dialog = page.locator("dialog[open]");
    const current = await wallTimeOf(dialog);
    expect(current, "the form opens on the class's own time").toMatch(/T18:00$/);
    await fillWallTime(dialog, current.replace("T18:00", "T19:30"));
    await dialog.getByRole("button", { name: "Déplacer la séance" }).click();
    await expect.poll(async () => {
      const [c] = await sql<{ rescheduled_at: Date | null }[]>`select rescheduled_at from classes where id = ${classId}`;
      return Boolean(c.rescheduled_at);
    }, { timeout: 15_000 }).toBe(true);
    const moved = await notificationBodies(student.id, "class_reminder");
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain("19:30");
  });

  await test.step("cancel the class; the student is released in full and told", async () => {
    await page.goto("/fr/dashboard/classes");
    await page.locator("[data-e2e=class-cancel]").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Oui, annuler" }).click();
    await expect.poll(async () => (await sql<{ status: string }[]>`select status from classes where id = ${classId}`)[0].status, { timeout: 15_000 }).toBe("cancelled");
    const [b] = await sql<{ status: string }[]>`select status from bookings where class_id = ${classId} and student_id = ${student.id}`;
    expect(b.status).toBe("cancelled");
    const [ledger] = await sql<{ actor: string; retained_tnd: string }[]>`select actor, retained_tnd from cancellations where class_id = ${classId}`;
    expect(ledger).toMatchObject({ actor: "tutor", retained_tnd: "0.00" });
    const told = await notificationBodies(student.id, "booking_cancelled");
    expect(told).toHaveLength(1);
    expect(told[0]).toContain("Tu ne dois rien");
  });

  await ctx.close();
});
