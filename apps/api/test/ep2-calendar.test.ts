import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, sql, type App } from "./support/fx";

/* espace prof v2 · pro (P7) — GET /bookings/:id/calendar.ics, "Ajouter au calendrier".

   Only the student who owns the booking (their entry) or the class's tutor (the
   class entry). Everyone else gets 404, never 403 — a booking id must not be
   confirmable. No session: 401. A cancelled booking downloads as METHOD:CANCEL. */

let app: App;
const profileIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (profileIds.length) await sql`delete from rate_limits where key in ${sql(profileIds.map((id) => `ics:${id}`))}`;
  await stopApp(app);
});

async function fixture() {
  const tutorProfile = await seedProfile({ role: "tutor", fullName: "Leila Haddad", birthYear: 1984 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "Leila Haddad" });
  const klass = await seedClass({ tutorId: tutor.id, at: new Date("2027-03-10T17:00:00.000Z"), durationMin: 60 });
  const student = await seedProfile({ role: "student", fullName: "Sami T" });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id });
  const stranger = await seedProfile({ role: "student" });
  profileIds.push(tutorProfile.id, student.id, stranger.id);
  return { tutorProfile, klass, student, booking, stranger };
}

const get = async (bookingId: string, cookie: string | null) => {
  const res = await app.inject({ method: "GET", url: `/bookings/${bookingId}/calendar.ics`, headers: cookie ? { cookie } : {} });
  return { status: res.statusCode, body: res.body, headers: res.headers };
};

describe("ep2 · GET /bookings/:id/calendar.ics", () => {
  test("the owner student gets their entry, as a download, never cached", async () => {
    const f = await fixture();
    const res = await get(f.booking.id, await login(f.student.id));
    assert.equal(res.status, 200, res.body);
    assert.equal(res.headers["content-type"], "text/calendar; charset=utf-8; method=PUBLISH");
    assert.equal(res.headers["content-disposition"], 'attachment; filename="tnajem-seance.ics"');
    assert.equal(res.headers["cache-control"], "private, no-store");
    assert.ok(res.body.includes(`UID:booking-${f.booking.id}@`));
    assert.ok(res.body.includes("DTSTART;TZID=Africa/Tunis:20270310T180000"), "18:00 in Tunis");
    assert.ok(res.body.includes("DTEND;TZID=Africa/Tunis:20270310T190000"));
    assert.ok(res.body.includes("Leila H."), "the tutor's public name");
    assert.equal(res.body.includes("Haddad"), false);
    assert.ok(res.body.includes(`/live/${f.klass.id}`), "the live page, not the room");
    assert.equal(/meet\.jit\.si/.test(res.body), false);
  });

  test("the class's tutor gets the class entry", async () => {
    const f = await fixture();
    const res = await get(f.booking.id, await login(f.tutorProfile.id));
    assert.equal(res.status, 200, res.body);
    assert.ok(res.body.includes(`UID:class-${f.klass.id}@`));
  });

  test("another student → 404; no session → 401; a malformed id → 404", async () => {
    const f = await fixture();
    assert.equal((await get(f.booking.id, await login(f.stranger.id))).status, 404);
    assert.equal((await get(f.booking.id, null)).status, 401);
    assert.equal((await get("not-a-uuid", await login(f.student.id))).status, 404);
    assert.equal((await get("00000000-0000-4000-8000-000000000000", await login(f.student.id))).status, 404);
  });

  test("a cancelled booking downloads as METHOD:CANCEL with the same UID", async () => {
    const f = await fixture();
    await sql`update bookings set status = 'cancelled' where id = ${f.booking.id}`;
    const res = await get(f.booking.id, await login(f.student.id));
    assert.equal(res.headers["content-type"], "text/calendar; charset=utf-8; method=CANCEL");
    assert.ok(res.body.includes("METHOD:CANCEL") && res.body.includes(`UID:booking-${f.booking.id}@`));
  });

  test("the viewer's language: an Arabic profile gets the Arabic entry", async () => {
    const f = await fixture();
    await sql`update profiles set locale = 'ar' where id = ${f.student.id}`;
    const res = await get(f.booking.id, await login(f.student.id));
    assert.ok(res.body.includes("مع Leila H."), res.body);
    assert.ok(res.body.includes("/ar/live/"));
  });
});
