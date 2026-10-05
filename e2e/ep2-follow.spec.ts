import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { sql } from "./support/db";
import { seedClass, seedFollow, seedPassword, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { recoverOtp, resetRateLimits } from "./support/otp";
import { fillOtp } from "./support/otp-ui";
import { E2E_PASSWORD } from "./support/password-ui";
import { API, notificationTexts } from "./support/journey";
import { AUTH_SECRET, BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 4 — STUDENTS FOLLOW A TEACHER (growth).

   « Suivre » on the profile and on « Ce prof arrive bientôt »: signed out, it goes
   through /auth — the PASSWORD step, or « Recevoir un code à la place » — and
   comes back following; « Abonné ✓ » unfollows. The follower is counted in
   « Abonnés » and listed in Mes élèves; a tutor and the owner see no button. The
   nightly digest notifies a follower of a new class, and the e-mail's one-click
   unsubscribe link switches that kind of e-mail off (and only that).
   ADDED as its own spec; the API side is apps/api/test/ep2-follows.test.ts and
   ep2-unsubscribe.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

test.use({ contextOptions: { reducedMotion: "reduce" } });
test.setTimeout(120_000);

const HOST = new URL(BASE_URL).hostname;

test.beforeEach(async () => {
  // rate_limits outlives runs; the sign-ins below spend password and code attempts.
  await resetRateLimits();
});

async function tutorCtx(browser: Browser, profileId: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

async function tutorWithAccount(status: "verified" | "pending", fullName = "Nadia Suivie") {
  const profile = await seedProfile({ role: "tutor", birthYear: 1986, fullName });
  const tutor = await seedTutor({ profileId: profile.id, status, fullName });
  return { profile, tutor };
}

/* The e-mail footer's token (packages/shared/src/unsubscribe.ts), written out here
   rather than imported — like the session hash in support/session.ts — so a change
   to the scheme fails this suite loudly. HMAC-SHA256 under AUTH_SECRET. */
function unsubscribeToken(profileId: string, kind: "followers"): string {
  const sig = createHmac("sha256", AUTH_SECRET).update(`tnajem:unsubscribe:v1:${profileId}:${kind}`).digest("base64url").slice(0, 32);
  return `v1.${profileId}.${kind}.${sig}`;
}

const followButton = (page: Page) => page.locator("[data-e2e=follow-button]").first();

async function follows(studentId: string, tutorId: string): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`
    select count(*)::int n from tutor_follows where student_profile_id = ${studentId} and tutor_id = ${tutorId}`;
  return r.n === 1;
}

/** Signed out on a tutor's page → « Suivre » → /auth?next=…suivre=1, with the address typed. */
async function suivreToAuth(page: Page, slug: string, address: string): Promise<void> {
  await page.goto(`/fr/${slug}`, { waitUntil: "networkidle" });
  await expect(followButton(page)).toHaveAttribute("aria-busy", "false");
  await expect(followButton(page)).toHaveText("Suivre");
  await followButton(page).click();
  await page.waitForURL(/\/fr\/auth\?next=/);
  const next = new URL(page.url()).searchParams.get("next") ?? "";
  expect(next).toBe(`/fr/${slug}?suivre=1`);
  await page.locator('input[type="email"]').fill(address);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await expect(page.locator('[data-e2e="auth-step-password"]')).toBeVisible({ timeout: 20_000 });
}

/** Back on the page: the follow is applied, the flag gone from the address bar. */
async function backFollowing(page: Page, slug: string): Promise<void> {
  await page.waitForURL((u) => u.pathname === `/fr/${slug}`, { timeout: 20_000 });
  await expect(followButton(page)).toHaveAttribute("data-following", "true", { timeout: 15_000 });
  await expect(followButton(page)).toHaveText("Suivi ✓"); // student-space-v1 · D: « Suivi ✓ », never « Abonné »
  await expect(followButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("suivre")).toBeNull();
}

test("signed out: « Suivre » → /auth with the password → back on the page, following; « Abonné » unfollows", async ({ page, browser }) => {
  const { profile: owner, tutor } = await tutorWithAccount("verified");
  const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Élève" });
  await seedPassword(student.id, E2E_PASSWORD);

  await suivreToAuth(page, tutor.slug, student.email);
  await page.locator('[data-e2e="password"]').fill(E2E_PASSWORD);
  await page.locator("form").first().evaluate((f: HTMLFormElement) => f.requestSubmit());
  await backFollowing(page, tutor.slug);
  await expect(page.getByRole("status").filter({ hasText: "tu seras prévenu" })).toBeVisible();
  expect(await follows(student.id, tutor.id)).toBe(true);

  // The tutor sees one « Abonné » on Ma vitrine, and the follower in Mes élèves.
  const ctx = await tutorCtx(browser, owner.id);
  const tp = await ctx.newPage();
  await tp.goto("/fr/dashboard/storefront", { waitUntil: "networkidle" });
  await expect(tp.locator("[data-e2e=vitrine-followers]")).toHaveText("1");
  await tp.goto("/fr/dashboard/students", { waitUntil: "networkidle" });
  const row = tp.locator("[data-e2e=student-row]").filter({ hasText: "Amine" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Suit ta page");
  await expect(row.locator("[data-e2e=student-status]")).toHaveText("Pas de séance");
  await expect(row).not.toContainText("Élève"); // the first name only, never the rest

  // « Abonné » again: unfollowed, here and in the database.
  await followButton(page).click();
  await expect(followButton(page)).toHaveAttribute("data-following", "false");
  await expect(followButton(page)).toHaveText("Suivre");
  expect(await follows(student.id, tutor.id)).toBe(false);
  await tp.reload({ waitUntil: "networkidle" });
  await expect(tp.locator("[data-e2e=student-row]").filter({ hasText: "Amine" })).toHaveCount(0);
  // « Abonnés » back to a real 0, shown greyed (the truth rule: zeros are not hidden).
  await tp.goto("/fr/dashboard/storefront", { waitUntil: "networkidle" });
  await expect(tp.locator("[data-e2e=vitrine-followers]")).toHaveText("0");
  await expect(tp.locator("[data-e2e=vitrine-followers]")).toHaveClass(/is-zero/);
  await ctx.close();
});

test("signed out, through « Recevoir un code à la place »: back on the page, following", async ({ page }) => {
  const { tutor } = await tutorWithAccount("verified");
  const student = await seedProfile({ role: "student", birthYear: 1993 });
  await seedPassword(student.id, E2E_PASSWORD);

  await suivreToAuth(page, tutor.slug, student.email);
  await page.locator('[data-e2e="use-code"]').click();
  await expect(page.locator('[data-e2e="auth-step-code"]')).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await sql<{ n: number }[]>`select count(*)::int n from otp_codes where identifier = ${student.email}`)[0].n, { timeout: 20_000 }).toBe(1);
  await fillOtp(page, await recoverOtp(student.email));
  await backFollowing(page, tutor.slug);
  expect(await follows(student.id, tutor.id)).toBe(true);
});

test("« Ce prof arrive bientôt »: a signed-in student follows a tutor who is not online yet", async ({ browser }) => {
  const { profile: owner, tutor } = await tutorWithAccount("pending", "Karim Bientôt");
  const student = await seedProfile({ role: "student", birthYear: 1996, fullName: "Ines Lectrice" });
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(ctx, student.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
  const soon = page.locator("[data-e2e=coming-soon]");
  await expect(soon).toBeVisible();
  await expect(soon.locator("[data-e2e=follow-button]")).toHaveText("Suivre");
  await soon.locator("[data-e2e=follow-button]").click();
  await expect(soon.locator("[data-e2e=follow-button]")).toHaveAttribute("data-following", "true");
  expect(await follows(student.id, tutor.id)).toBe(true);

  // Arabic: the same button, in Arabic.
  await page.goto(`/ar/${tutor.slug}`, { waitUntil: "networkidle" });
  await expect(page.locator("[data-e2e=coming-soon] [data-e2e=follow-button]")).toHaveText("تتابع ✓"); // student-space-v1 · D
  await ctx.close();

  // The tutor already has a follower in Mes élèves.
  const tctx = await tutorCtx(browser, owner.id);
  const tp = await tctx.newPage();
  await tp.goto("/fr/dashboard/students", { waitUntil: "networkidle" });
  await expect(tp.locator("[data-e2e=student-row]").filter({ hasText: "Ines" })).toContainText("Suit ta page");
  await tctx.close();
});

test("no « Suivre » for a tutor, nor for the owner on their own page", async ({ browser }) => {
  const { profile: owner, tutor } = await tutorWithAccount("verified");
  const { profile: other } = await tutorWithAccount("verified", "Sami Collègue");
  for (const who of [owner.id, other.id]) {
    const ctx = await tutorCtx(browser, who);
    const page = await ctx.newPage();
    await page.goto(`/fr/${tutor.slug}`, { waitUntil: "networkidle" });
    await expect(page.locator("main h1").first()).toBeVisible();
    await expect(page.locator("[data-e2e=follow-button]")).toHaveCount(0, { timeout: 10_000 });
    await ctx.close();
  }
});

test("the nightly digest tells a follower about a new class; the e-mail's link switches that e-mail off, and only that", async ({ page }) => {
  const { tutor } = await tutorWithAccount("verified", "Leila Digest");
  const student = await seedProfile({ role: "student", birthYear: 1994 });
  await seedFollow(student.id, tutor.id);
  // A class published AFTER the follow: news.
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 120 });

  const res = await fetch(`${API}/cron/purge`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  expect(res.status).toBe(200);
  const rows = await sql<{ href: string }[]>`
    select href from notifications where profile_id = ${student.id} and kind = 'follow_digest'`;
  expect(rows).toHaveLength(1);
  const [text] = await notificationTexts(student.id, "follow_digest");
  expect(text.title).toBe("Leila D. a publié du nouveau");
  expect(text.body).toContain(`« ${klass.title} »`);
  expect(rows[0].href).toBe(`/class/${klass.id}`);
  // At most once a day: a second run sends nothing more.
  await fetch(`${API}/cron/purge`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  expect((await sql`select 1 from notifications where profile_id = ${student.id} and kind = 'follow_digest'`).length).toBe(1);

  // The footer link: GET changes nothing (a mail scanner prefetches links) …
  const link = `/api/email/unsubscribe?token=${encodeURIComponent(unsubscribeToken(student.id, "followers"))}`;
  const prefs = async () =>
    (await sql<{ followers: boolean; bookings: boolean; messages: boolean; reminders: boolean }[]>`
      select followers, bookings, messages, reminders from notification_prefs where profile_id = ${student.id}`)[0] ?? null;
  await page.goto(link, { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/fr\/email\/unsubscribe\?token=/);
  await expect(page.locator("main")).toContainText("Tu ne recevras plus d'e-mail pour les nouveautés des profs que tu suis.");
  expect(await prefs()).toBeNull();
  // … the button does it, for this kind only.
  await page.locator("[data-e2e=unsubscribe-confirm]").click();
  await expect(page.getByRole("status")).toHaveText("C'est fait : tu ne recevras plus ces e-mails.");
  expect(await prefs()).toEqual({ followers: false, bookings: true, messages: true, reminders: true });
  // Following is untouched; the in-app notifications keep coming.
  expect(await follows(student.id, tutor.id)).toBe(true);

  // A tampered token unsubscribes nobody.
  await page.goto(`${link.slice(0, -3)}xyz`, { waitUntil: "networkidle" });
  await expect(page.locator("main")).toContainText("Ce lien ne fonctionne pas");
});
