import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { classLimitLabel, classLimitRule } from "@tnajem/shared";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App } from "./support/fx";
import { grantAdmin } from "./support/fx"; // VULN-006

/* phase-a lane L3 (A25) — plan limits: the copy says "séances", and a pilot grant
   can never take capability away.

   During the pilot every tutor is on `pilot`: unlimited open sessions, nothing
   billed. Granting "Gratuit" (1) or "Essentiel" (5) to such a tutor used to be
   accepted and dropped them to that limit — an admin action that reduced what a
   tutor can do while /tarifs promises nothing is billed yet. It is now refused
   with a reason, and the tutor's effective limits do not move.
   D3: the limit COUNTS SESSIONS (each dated class). The counting is unchanged; the
   words now say so. */

let app: App;
let adminCookie: string;
let adminId: string;
const tutorIds: string[] = [];
const saved = { ADMIN_EMAILS: process.env.ADMIN_EMAILS, OTP_CHANNEL: process.env.OTP_CHANNEL, PAYMENTS_ENABLED: process.env.PAYMENTS_ENABLED };

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  adminId = admin.id;
  // Read per request by requireAdmin / paymentsEnabled (lazy), so this is enough.
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  process.env.OTP_CHANNEL = "email";
  delete process.env.PAYMENTS_ENABLED; // the pilot
  adminCookie = await login(admin.id);
});
after(async () => {
  if (tutorIds.length) await sql`delete from subscriptions where tutor_id in ${sql(tutorIds)}`;
  // Audit rows stay: admin_actions is append-only since Phase A+ (0031).
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await stopApp(app);
});

async function pilotTutor() {
  const t = await seedTutor();
  tutorIds.push(t.id);
  return t;
}

async function effective(tutorId: string) {
  const res = await call(app, "GET", "/admin/plans", adminCookie);
  assert.equal(res.body.ok, true, res.raw);
  const row = res.body.items.find((i: { tutorId: string }) => i.tutorId === tutorId);
  assert.ok(row, "the tutor is listed");
  return row as { planCode: string; maxClasses: number | null; exploreBoost: number; granted: boolean };
}

const grant = (tutorId: string, planCode: string) =>
  call(app, "POST", "/admin/subscriptions", adminCookie, { tutorId, planCode });

describe("A25 · a pilot grant never lowers a tutor's limits", () => {
  test('granting "gratuit" to a pilot tutor is refused with a reason; the limits do not move', async () => {
    const t = await pilotTutor();
    const before = await effective(t.id);
    assert.equal(before.maxClasses, null, "pilot: unlimited");

    const res = await grant(t.id, "gratuit");
    assert.equal(res.body.ok, false, `a pilot tutor was dropped to 1 session: ${res.raw}`);
    assert.equal(res.body.error, "lowers-pilot-limits", res.raw);
    assert.equal(typeof res.body.reason, "string", "the refusal says why");

    const after = await effective(t.id);
    assert.equal(after.maxClasses, null);
    assert.equal(after.granted, false);
  });

  test('"essentiel" (5) is refused too during the pilot', async () => {
    const t = await pilotTutor();
    const res = await grant(t.id, "essentiel");
    assert.equal(res.body.error, "lowers-pilot-limits", res.raw);
    assert.equal((await effective(t.id)).maxClasses, null);
  });

  test('"pro" gives MORE (unlimited + Explore boost) and is still granted', async () => {
    const t = await pilotTutor();
    const res = await grant(t.id, "pro");
    assert.equal(res.body.ok, true, res.raw);
    const after = await effective(t.id);
    assert.equal(after.planCode, "pro");
    assert.equal(after.maxClasses, null);
    assert.equal(after.exploreBoost, 1);
  });
});

describe("A25 · plan copy counts séances (D3), never cours", () => {
  test("the limit bullet, both locales", () => {
    assert.equal(classLimitLabel(1, "fr"), "1 séance publiée à la fois");
    assert.equal(classLimitLabel(5, "fr"), "Jusqu'à 5 séances publiées à la fois");
    assert.equal(classLimitLabel(null, "fr"), "Séances illimitées");
    for (const n of [1, 5, null]) {
      assert.doesNotMatch(classLimitLabel(n, "fr"), /cours/i);
      assert.doesNotMatch(classLimitLabel(n, "ar"), /درس|دروس/);
    }
  });
  test("the rule sentence", () => {
    assert.doesNotMatch(classLimitRule("fr"), /cours/i);
    assert.match(classLimitRule("fr"), /séances/);
    assert.doesNotMatch(classLimitRule("ar"), /درس|دروس/);
  });
});
