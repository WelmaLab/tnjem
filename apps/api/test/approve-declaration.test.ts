import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App, grantAdmin } from "./support/fx";

/* phase-a lane L4 (A15) — approval did not enforce the Décret 2015-1619 declaration.

   POST /verification refuses an application without the declaration, but approve
   never looked: a dossier submitted before 0024, or one whose declaration belonged
   to an EARLIER round, could be approved with one click — only the UI reminded the
   admin. The server now refuses (4xx) unless the declaration exists for the
   tutor's CURRENT round, and nothing changes. */

let app: App;
let adminCookie: string;
const tutorIds: string[] = [];

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.OTP_CHANNEL = "email";
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  adminCookie = await login(admin.id);
});
after(async () => {
  // Audit rows stay: admin_actions is append-only since Phase A+ (0031).
  await stopApp(app);
});

async function pendingTutor(opts: { submittedAt: Date; declaredAt: Date | null }) {
  const tutor = await seedTutor({ status: "pending" });
  tutorIds.push(tutor.id);
  await sql`update tutors
               set submitted_at = ${opts.submittedAt.toISOString()},
                   public_teacher_declared_at = ${opts.declaredAt ? opts.declaredAt.toISOString() : null},
                   public_teacher_declaration_version = ${opts.declaredAt ? "2026-09-v1" : null}
             where id = ${tutor.id}`;
  return tutor;
}

async function state(tutorId: string, profileId: string) {
  const [t] = await sql<{ status: string; verified: boolean; reviewed: boolean }[]>`
    select status, verified, reviewed_at is not null as reviewed from tutors where id = ${tutorId}`;
  const [a] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where subject_id = ${tutorId}`;
  const [n] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${profileId}`;
  return { ...t, audits: a.n, notifications: n.n };
}

describe("POST /admin/verifications/approve — the declaration of the current round is required", () => {
  test("no declaration at all → 4xx, and nothing changes", async () => {
    const submitted = new Date(Date.now() - 3600_000);
    const tutor = await pendingTutor({ submittedAt: submitted, declaredAt: null });

    const res = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
      tutorId: tutor.id,
      submittedAt: submitted.toISOString(),
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}: ${res.raw}`);
    assert.equal(res.body.error, "declaration-missing", res.raw);
    assert.deepEqual(await state(tutor.id, tutor.profileId), {
      status: "pending", verified: false, reviewed: false, audits: 0, notifications: 0,
    });
  });

  test("a declaration from an EARLIER round does not cover the current one → 4xx, nothing changes", async () => {
    const submitted = new Date(Date.now() - 3600_000);
    const tutor = await pendingTutor({ submittedAt: submitted, declaredAt: new Date(submitted.getTime() - 30 * 86400_000) });

    const res = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
      tutorId: tutor.id,
      submittedAt: submitted.toISOString(),
    });
    assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}: ${res.raw}`);
    assert.equal(res.body.error, "declaration-missing", res.raw);
    assert.deepEqual(await state(tutor.id, tutor.profileId), {
      status: "pending", verified: false, reviewed: false, audits: 0, notifications: 0,
    });
  });

  test("with the current round's declaration the approval goes through (the gate is not a blanket refusal)", async () => {
    const submitted = new Date(Date.now() - 3600_000);
    const tutor = await pendingTutor({ submittedAt: submitted, declaredAt: submitted });

    const res = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
      tutorId: tutor.id,
      submittedAt: submitted.toISOString(),
    });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.ok, true, res.raw);
    const after = await state(tutor.id, tutor.profileId);
    assert.equal(after.status, "verified");
    assert.equal(after.audits, 1, "the approval is audited");
  });
});
