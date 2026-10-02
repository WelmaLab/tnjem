import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App } from "./support/fx";

/* espace prof v2 · pro (P7) — GET /admin/tutors/:tutorId/offers: the admin's
   READ-ONLY view of a tutor's monthly offers and subscriptions. Refused to anyone
   not on the allow-list, audited ("offers.read") before the data leaves, students
   by first name only. */

let app: App;
let adminCookie: string;
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL };

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.ADMIN_EMAILS = admin.email;
  process.env.OTP_CHANNEL = "email";
  adminCookie = await login(admin.id);
});
after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await stopApp(app); // offers and subscriptions cascade from this file's tutors; audit rows stay (0031)
});

async function tutorWithSubscriber() {
  const tutor = await seedTutor();
  const student = await seedProfile({ role: "student", fullName: "Ines Ben Salah" });
  const [offer] = await sql<{ id: string }[]>`
    insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month)
    values (${tutor.id}, 'FX 4 séances', 4, '120') returning id`;
  await sql`insert into tutor_offers (tutor_id, title, sessions_per_month, price_tnd_per_month, archived_at, active)
            values (${tutor.id}, 'FX ancienne', 2, '60', now(), false)`;
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd, period_start, period_end, confirmed_at)
            values (${offer.id}, ${tutor.id}, ${student.id}, 'active', 4, '120', now() - interval '2 days', now() + interval '28 days', now() - interval '2 days')`;
  return { tutor, student };
}

describe("ep2 · admin read-only offers + subscriptions", () => {
  test("refused to a non-admin (the tutor themselves included)", async () => {
    const { tutor } = await tutorWithSubscriber();
    const res = await call(app, "GET", `/admin/tutors/${tutor.id}/offers`, await login(tutor.profileId));
    assert.deepEqual(res.body, { ok: false, error: "forbidden" });
    const anon = await call(app, "GET", `/admin/tutors/${tutor.id}/offers`, null);
    assert.deepEqual(anon.body, { ok: false, error: "forbidden" });
  });

  test("an admin sees every offer (archived too) and every subscription; the read is audited", async () => {
    const { tutor } = await tutorWithSubscriber();
    const res = await call(app, "GET", `/admin/tutors/${tutor.id}/offers`, adminCookie);
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.offers.length, 2);
    assert.deepEqual(res.body.offers.map((o: { archived: boolean }) => o.archived).sort(), [false, true]);
    assert.equal(res.body.subscriptions.length, 1);
    const s = res.body.subscriptions[0];
    assert.equal(s.studentFirstName, "Ines", "first name only");
    assert.equal(res.raw.includes("Ben Salah"), false, "never the last name");
    assert.equal(res.raw.includes("@"), false, "never an address");
    assert.equal(s.status, "active");
    assert.equal(s.priceTnd, 120);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from admin_actions where action = 'offers.read' and subject_kind = 'tutor' and subject_id = ${tutor.id}`;
    assert.equal(n, 1);
  });

  test("a malformed or unknown tutor id → not-found, and nothing is logged", async () => {
    assert.deepEqual((await call(app, "GET", "/admin/tutors/nope/offers", adminCookie)).body, { ok: false, error: "not-found" });
    const ghost = "00000000-0000-4000-8000-0000000000ab";
    assert.deepEqual((await call(app, "GET", `/admin/tutors/${ghost}/offers`, adminCookie)).body, { ok: false, error: "not-found" });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where action = 'offers.read' and subject_id = ${ghost}`;
    assert.equal(n, 0);
  });
});
