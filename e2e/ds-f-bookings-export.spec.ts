import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { seedAdmin, seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs, mintSession, SESSION_COOKIE } from "./support/session";

/* december-sprint · F (D19) — the centre export, end to end.

   Seeded data only: two tutors of one "centre" and a third nobody asks for, their
   classes in June 2031, and students with an e-mail and a phone. The admin pastes the
   two slugs, previews the counts, and downloads the CSV through the web pass-through
   to the API. The globalSetup purge removes every e2e-% row. ADDED as its own spec. */

const tunis = (iso: string) => new Date(`${iso}:00+01:00`);

test("an admin downloads the bookings CSV for two seeded tutors", async ({ browser, page }) => {
  const a = await seedTutor({ fullName: "Amel Ben Salah" });
  const b = await seedTutor({ fullName: "Karim Jaziri" });
  const other = await seedTutor({ fullName: "Not Asked" });
  const s1 = await seedProfile({ role: "student", fullName: "Sami Trabelsi", phone: "+21698111222" });
  const s2 = await seedProfile({ role: "student", fullName: "Ines Ammar", phone: "+21698333444" });

  const ca = await seedClass({ tutorId: a.id, at: tunis("2031-06-10T18:00") });
  const cb = await seedClass({ tutorId: b.id, at: tunis("2031-06-20T09:30") });
  const co = await seedClass({ tutorId: other.id, at: tunis("2031-06-15T10:00") });
  const late = await seedClass({ tutorId: a.id, at: tunis("2031-07-01T00:00") }); // just outside
  await seedBooking({ classId: ca.id, studentId: s1.id });
  await seedBooking({ classId: ca.id, studentId: s2.id, status: "cancelled" });
  await seedBooking({ classId: cb.id, studentId: s1.id });
  await seedBooking({ classId: co.id, studentId: s1.id });
  await seedBooking({ classId: late.id, studentId: s2.id });

  const admin = await seedAdmin();
  const ctx = await browser.newContext({ reducedMotion: "reduce", acceptDownloads: true });
  await loginAs(ctx, admin.id);
  const ap = await ctx.newPage();
  await ap.goto("/fr/admin/exports");
  await expect(ap.locator("[data-e2e=admin-nav] a[aria-current=page]")).toHaveText("Exports");
  await expect(ap.locator("[data-e2e=exports-help]")).toHaveText("Le statut indique réservé ou annulé. La présence n'est pas enregistrée.");

  await ap.locator("[data-e2e=exports-tutors]").fill(`${a.slug}\n${b.slug}`);
  await ap.locator("[data-e2e=exports-from]").fill("2031-06-01");
  await ap.locator("[data-e2e=exports-to]").fill("2031-06-30");
  await ap.locator("[data-e2e=exports-preview]").click();
  await expect(ap.locator("[data-e2e=exports-total]")).toHaveText("3 réservations");
  await expect(ap.locator("[data-e2e=exports-by-status] [data-status=reserved]")).toHaveText("Réservé · 2");
  await expect(ap.locator("[data-e2e=exports-by-status] [data-status=cancelled]")).toHaveText("Annulé · 1");
  // Gate 4: nothing records payment or attendance, so no « Payé · 0 » / « Présent · 0 ».
  await expect(ap.locator("[data-e2e=exports-by-status] [data-status=paid], [data-e2e=exports-by-status] [data-status=attended]")).toHaveCount(0);
  await expect(ap.locator("[data-e2e=exports-row]")).toHaveCount(3);
  await expect(ap.locator("[data-e2e=exports-unknown]")).toHaveCount(0);

  const [download] = await Promise.all([ap.waitForEvent("download"), ap.locator("[data-e2e=exports-csv]").click()]);
  expect(download.suggestedFilename()).toBe("tnajem-reservations-2031-06-01_2031-06-30.csv");
  const body = await readFile((await download.path())!, "utf8");
  const lines = body.replace(/^﻿/, "").split("\r\n").filter(Boolean);
  expect(lines).toHaveLength(4);
  expect(lines[0]).toBe(
    '"class_date";"class_time";"tutor_name";"tutor_slug";"class_title";"class_level";"student_first_name";"booking_status";"booked_at";"cancelled_at";"price_tnd"',
  );
  expect(lines[1]).toContain(`"2031-06-10";"18:00";"Amel Ben Salah";"${a.slug}";"${ca.title}"`);
  expect(lines.filter((l) => l.includes(`"${a.slug}"`)).map((l) => l.split(";")[7])).toEqual(['"reserved"', '"cancelled"']);
  expect(lines[3]).toContain(`"2031-06-20";"09:30";"Karim Jaziri";"${b.slug}"`);
  expect(body).not.toContain(other.slug);
  expect(body).not.toContain(s1.email);
  expect(body).not.toContain("98111222");
  expect(body).not.toContain("Trabelsi");
  await ctx.close();

  // Anyone else gets the API's 403 from the same URL, and not a byte of it.
  const outsider = await seedProfile({ role: "student", birthYear: 1990 });
  const url = `/api/admin/bookings-export-csv?tutors=${a.slug}&from=2031-06-01&to=2031-06-30`;
  const denied = await page.request.get(url, { headers: { cookie: `${SESSION_COOKIE}=${await mintSession(outsider.id)}` } });
  expect(denied.status()).toBe(403);
  expect(await denied.text()).not.toContain("Sami");
  expect((await page.request.get(url, { headers: { cookie: "" } })).status()).toBe(403);

  // An unknown tutor is reported, and the download is not offered.
  const ctx2 = await browser.newContext({ reducedMotion: "reduce" });
  await loginAs(ctx2, admin.id);
  const ar = await ctx2.newPage();
  await ar.goto("/ar/admin/exports");
  await expect(ar.locator("[data-e2e=exports-help]")).toHaveText("الحالة تقول محجوز ولا ملغي. الحضور ما يتسجّلش.");
  await ar.locator("[data-e2e=exports-tutors]").fill(`${a.slug}, nobody-${Date.now()}`);
  await ar.locator("[data-e2e=exports-from]").fill("2031-06-01");
  await ar.locator("[data-e2e=exports-to]").fill("2031-06-30");
  await ar.locator("[data-e2e=exports-preview]").click();
  await expect(ar.locator("[data-e2e=exports-unknown]")).toContainText("nobody-");
  await expect(ar.locator("[data-e2e=exports-csv]")).toHaveCount(0);
  await ctx2.close();

});
