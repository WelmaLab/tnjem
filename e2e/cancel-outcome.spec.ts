import { test, expect, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { backdateBooking } from "./support/seed"; // live-fixes-3 · C
import { loginAs } from "./support/session";

/* phase-a lane L3 (A21) — the cancel messages state what was ACTUALLY retained.

   /student said "40 % est noté comme retenu" on every late cancel — in the confirm
   box before the student commits, and in the message after — including a FREE seat
   (40 % of nothing) and a class the tutor MOVED after the student booked (waived:
   nothing retained). Both now say that nothing is retained; a paid late seat states
   its real amount, as the ledger outcome while payments are off.

   ADDED, never edited into an existing spec. */

async function lateSeat(opts: { isFree?: boolean; movedAfterBooking?: boolean }) {
  const tutor = await seedTutor({ status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 40, hoursFromNow: opts.movedAfterBooking ? 96 : 5 });
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: opts.isFree ?? false });
  // live-fixes-3 · C: a seat booked an hour ago — outside the 15-minute grace after booking.
  await backdateBooking(booking.id);
  await sql`update classes set seats_taken = 1 where id = ${klass.id}`;
  if (opts.movedAfterBooking) {
    await sql`update classes set scheduled_at = now() + interval '5 hours', rescheduled_at = now() + interval '1 second'
              where id = ${klass.id}`;
  }
  return { klass, student };
}

/** Open the confirm box, read it, confirm, and read the message that follows. */
async function cancelFromDashboard(page: Page): Promise<{ warning: string; flash: string }> {
  await page.goto("/fr/student");
  const cancelBtn = page.getByRole("button", { name: /Annuler ma place/i }).first();
  await expect(cancelBtn).toBeVisible({ timeout: 15_000 });
  await cancelBtn.dispatchEvent("click");
  const box = page.getByText("Annuler cette réservation ?").locator("..");
  await expect(box).toBeVisible();
  const warning = await box.innerText();
  await page.getByRole("button", { name: /Oui, annuler/i }).dispatchEvent("click");
  const flash = page.getByText(/Réservation annulée/);
  await expect(flash).toBeVisible({ timeout: 15_000 });
  return { warning, flash: await flash.innerText() };
}

test("a FREE seat cancelled late: no 40 %, before or after — nothing is retained", async ({ browser }) => {
  const s = await lateSeat({ isFree: true });
  const ctx = await browser.newContext();
  await loginAs(ctx, s.student.id);
  const { warning, flash } = await cancelFromDashboard(await ctx.newPage());
  expect(warning).not.toContain("40 %");
  expect(warning).toContain("rien n'est retenu");
  expect(flash).not.toContain("40 %");
  expect(flash).toContain("Rien n'est retenu");
  await ctx.close();
});

test("a class MOVED after the booking, cancelled late: no 40 %, nothing retained", async ({ browser }) => {
  const s = await lateSeat({ movedAfterBooking: true });
  const ctx = await browser.newContext();
  await loginAs(ctx, s.student.id);
  const { warning, flash } = await cancelFromDashboard(await ctx.newPage());
  expect(warning).not.toContain("40 %");
  expect(flash).not.toContain("40 %");
  expect(flash).toContain("Rien n'est retenu");
  await ctx.close();
});

test("a PAID seat cancelled late: the real amount, as a ledger note — never as money taken", async ({ browser }) => {
  const s = await lateSeat({});
  const ctx = await browser.newContext();
  await loginAs(ctx, s.student.id);
  const { warning, flash } = await cancelFromDashboard(await ctx.newPage());
  expect(warning).toContain("16 TND");
  expect(flash).toContain("16 TND");
  expect(flash).toContain("Rien n'est prélevé pendant le pilote");
  await ctx.close();
});
