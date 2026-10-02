import { test, expect } from "@playwright/test";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { loginAs } from "./support/session";

/* espace prof v2 · pro (P7) — "Ajouter au calendrier" through the web app.

   /api/calendar/<bookingId> is a pass-through to GET /bookings/:id/calendar.ics:
   the API decides (owner student or the class's tutor; 404 for anyone else), the
   web adds one thing — an email link opened without a session goes to /auth and
   then to « Mes cours », instead of a raw 401.

   ADDED, never edited into an existing spec. */

async function booked() {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Leila Haddad", birthYear: 1984 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "Leila Haddad" });
  const klass = await seedClass({ tutorId: tutor.id, at: new Date("2027-03-10T17:00:00.000Z"), isFreeFirst: false });
  const student = await seedProfile({ role: "student", fullName: "Sami T" });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id, isFree: false });
  return { tutorProfile, klass, student, booking };
}

test("the student downloads their .ics: Tunis time, the live page, the tutor's public name", async ({ browser }) => {
  const f = await booked();
  const ctx = await browser.newContext();
  await loginAs(ctx, f.student.id);
  const res = await ctx.request.get(`/api/calendar/${f.booking.id}?l=fr`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/calendar; charset=utf-8; method=PUBLISH");
  expect(res.headers()["content-disposition"]).toContain("tnajem-seance.ics");
  const ics = await res.text();
  expect(ics).toContain(`UID:booking-${f.booking.id}@`);
  expect(ics).toContain("DTSTART;TZID=Africa/Tunis:20270310T180000");
  expect(ics).toContain(`/live/${f.klass.id}`);
  expect(ics).toContain("Leila H.");
  expect(ics).not.toContain("Haddad");
  expect(ics).not.toMatch(/meet\.jit\.si/);
  await ctx.close();
});

test("the class's tutor gets the class entry; another student gets 404", async ({ browser }) => {
  const f = await booked();
  const tutorCtx = await browser.newContext();
  await loginAs(tutorCtx, f.tutorProfile.id);
  const mine = await tutorCtx.request.get(`/api/calendar/${f.booking.id}`);
  expect(mine.status()).toBe(200);
  expect(await mine.text()).toContain(`UID:class-${f.klass.id}@`);
  await tutorCtx.close();

  const stranger = await seedProfile({ role: "student" });
  const ctx = await browser.newContext();
  await loginAs(ctx, stranger.id);
  expect((await ctx.request.get(`/api/calendar/${f.booking.id}`)).status()).toBe(404);
  await ctx.close();
});

test("without a session the link goes to /auth, then « Mes cours », in the email's language", async ({ request }) => {
  const f = await booked();
  const fr = await request.get(`/api/calendar/${f.booking.id}?l=fr`, { maxRedirects: 0 });
  expect(fr.status()).toBe(303);
  const frTo = new URL(fr.headers()["location"]);
  expect(frTo.pathname).toBe("/fr/auth");
  expect(frTo.searchParams.get("next")).toBe("/fr/student");

  const ar = await request.get(`/api/calendar/${f.booking.id}?l=ar`, { maxRedirects: 0 });
  expect(new URL(ar.headers()["location"]).pathname).toBe("/ar/auth");
});
