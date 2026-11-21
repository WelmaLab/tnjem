import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App, grantAdmin } from "./support/fx";

/* Phase A+ · P3 (D13) — the admin audit log is tamper-proof, and required.

   1. admin_actions was append-only "by convention": the app role could UPDATE or
      DELETE any row. 0031 refuses both (and TRUNCATE) in the database. The only
      UPDATE allowed is the FK's own ON DELETE SET NULL when an admin's profile is
      deleted — the row stays, the actor becomes unknown.
   2. auditAdmin swallowed a failed write, so an approval could land with no record.
      Now the row is written in the action's transaction: if it fails, the action
      fails and nothing changes.

   This file leaves its audit rows in place — it cannot delete them, which is the
   point. */

let app: App;
let adminCookie: string;
let adminId: string;

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  adminId = admin.id;
  process.env.OTP_CHANNEL = "email";
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  adminCookie = await login(admin.id);
});
after(async () => {
  await stopApp(app);
});

async function auditRow(actor: string | null = adminId): Promise<string> {
  const id = randomUUID();
  await sql`insert into admin_actions (id, admin_profile_id, action, subject_kind, subject_id, note)
            values (${id}, ${actor}, 'test.p3', 'test', ${id}, 'P3 fixture')`;
  return id;
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    return String((e as Error).message);
  }
  return "";
}

describe("P3 — admin_actions is append-only in the database", () => {
  test("UPDATE is refused", async () => {
    const id = await auditRow();
    const msg = await refusal(() => sql`update admin_actions set note = 'rewritten' where id = ${id}`);
    assert.match(msg, /append-only/, "an UPDATE must throw");
    const [row] = await sql<{ note: string }[]>`select note from admin_actions where id = ${id}`;
    assert.equal(row.note, "P3 fixture");
  });

  test("DELETE is refused", async () => {
    const id = await auditRow();
    const msg = await refusal(() => sql`delete from admin_actions where id = ${id}`);
    assert.match(msg, /append-only/, "a DELETE must throw");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where id = ${id}`;
    assert.equal(n, 1);
  });

  test("TRUNCATE is refused (tried inside a transaction that is always rolled back)", async () => {
    const ROLLBACK = "p3-rollback";
    const msg = await refusal(() =>
      sql.begin(async (tx) => {
        await tx`truncate admin_actions`;
        throw new Error(ROLLBACK); // if the trigger were missing, this undoes the truncate
      }),
    );
    assert.match(msg, /append-only/, `TRUNCATE must throw (got: ${msg})`);
  });

  test("the FK carve-out: deleting an admin's PROFILE keeps their rows, actor nulled", async () => {
    const gone = await seedProfile({ role: "tutor" });
    const id = await auditRow(gone.id);
    await sql`delete from sessions where profile_id = ${gone.id}`;
    await sql`delete from profiles where id = ${gone.id}`;
    const [row] = await sql<{ admin_profile_id: string | null; action: string }[]>`
      select admin_profile_id, action from admin_actions where id = ${id}`;
    assert.deepEqual(row, { admin_profile_id: null, action: "test.p3" });
  });

  test("…but a hand-written UPDATE nulling a LIVE admin's actor is refused", async () => {
    const id = await auditRow();
    const msg = await refusal(() => sql`update admin_actions set admin_profile_id = null where id = ${id}`);
    assert.match(msg, /append-only/);
  });
});

describe("P3 — no audit row, no action", () => {
  test("a failed audit insert on approve: the request fails and the tutor stays pending", async () => {
    const submitted = new Date(Date.now() - 3600_000);
    const tutor = await seedTutor({ status: "pending" });
    await sql`update tutors set submitted_at = ${submitted.toISOString()},
                               public_teacher_declared_at = ${submitted.toISOString()},
                               public_teacher_declaration_version = '2026-09-v1'
              where id = ${tutor.id}`;

    /* Force THIS tutor's audit insert to fail — a trigger scoped to its id, so the
       other test files writing audit rows in parallel are untouched. */
    const fn = `p3_fail_${randomBytes(4).toString("hex")}`;
    await sql.unsafe(`create function ${fn}() returns trigger language plpgsql as $$
      begin raise exception 'p3: audit write refused'; end $$`);
    await sql.unsafe(`create trigger ${fn} before insert on admin_actions for each row
      when (new.subject_id = '${tutor.id}') execute function ${fn}()`);
    try {
      const res = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
        tutorId: tutor.id,
        submittedAt: submitted.toISOString(),
      });
      assert.ok(res.status >= 500 || res.body?.ok === false, `the approve must fail: ${res.status} ${res.raw}`);
    } finally {
      await sql.unsafe(`drop trigger if exists ${fn} on admin_actions`);
      await sql.unsafe(`drop function if exists ${fn}()`);
    }

    const [t] = await sql<{ status: string; verified: boolean; reviewed: boolean }[]>`
      select status, verified, reviewed_at is not null as reviewed from tutors where id = ${tutor.id}`;
    assert.deepEqual(t, { status: "pending", verified: false, reviewed: false }, "nothing changed");
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${tutor.profileId}`;
    assert.equal(n, 0, "and nobody was told they were approved");
  });
});
