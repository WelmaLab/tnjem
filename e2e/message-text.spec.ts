import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { api } from "./support/journey";

/* phase-a A20 — ESCAPE, DON'T STRIP, seen from the reader's screen.

   The sanitiser deleted everything after a lone "<", so "si x < 5 alors" reached
   the student as "si x". The row is now stored escaped and the API returns the
   text as typed; this proves the last step — the thread page shows the
   inequality itself, not "&lt;" and not a truncated sentence.

   ADDED as its own spec (lane L1). Written for the orchestrator's run after merge. */

test("a maths message reaches the student's thread page intact", async ({ browser }) => {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 10, hoursFromNow: 96 });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id });

  const studentToken = await mintSession(student.id);
  const tutorToken = await mintSession(tutorProfile.id);
  const opened = await api("/threads", studentToken, { bookingId: booking.id });
  expect(opened.ok, JSON.stringify(opened)).toBe(true);
  const threadId = opened.threadId as string;

  for (const body of ["si x < 5 alors", "si x < 5 alors y > 2"]) {
    const sent = await api(`/threads/${threadId}/messages`, tutorToken, { body });
    expect(sent.ok, JSON.stringify(sent)).toBe(true);
  }

  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(studentToken)]);
  const page = await ctx.newPage();
  await page.goto(`/fr/messages/${threadId}`);

  // student-space-v1 · G: the conversation pane (the list beside it previews the last message too).
  const main = page.locator("main [data-e2e=conv]");
  await expect(main.getByText("si x < 5 alors y > 2", { exact: true })).toBeVisible();
  await expect(main.getByText("si x < 5 alors", { exact: true })).toBeVisible();
  // Neither double-escaped nor shown as an entity.
  await expect(page.locator("main")).not.toContainText("&lt;");
  await expect(page.locator("main")).not.toContainText("&gt;");

  await ctx.close();
  await sql`delete from messages where thread_id = ${threadId}`;
  await sql`delete from message_threads where id = ${threadId}`;
});
