import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App } from "./support/fx";
import { grantAdmin } from "./support/fx"; // VULN-006

/* phase-a lane L4 (A10) — the verification card mixed submission rounds.

   The approve view listed every document the tutor had EVER uploaded, undated, so
   a tutor who resubmitted showed two "Identité (recto)" buttons and an admin could
   approve against last month's scan. The card now carries only the current round;
   earlier rounds travel separately, grouped and dated. */

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
  for (const id of tutorIds) await sql`delete from verification_docs where tutor_id = ${id}`;
  await stopApp(app);
});

async function seedDoc(tutorId: string, kind: string, at: Date) {
  await sql`insert into verification_docs (id, tutor_id, kind, file_name, storage_path, mime, size_bytes, created_at)
            values (${randomUUID()}, ${tutorId}, ${kind}, ${`${kind}.png`},
                    ${`verification/${tutorId}/${kind}-${at.getTime()}-0-${kind}.png`}, 'image/png', 68,
                    ${at.toISOString()})`;
}

describe("GET /admin/verifications — one round on the card", () => {
  test("a tutor with 2 rounds: the card shows exactly one 'Identité (recto)'; the old round is dated apart", async () => {
    const tutor = await seedTutor({ status: "pending" });
    tutorIds.push(tutor.id);
    const round1 = new Date(Date.now() - 20 * 86400_000);
    const round2 = new Date(Date.now() - 3600_000);
    await seedDoc(tutor.id, "id_front", round1);
    await seedDoc(tutor.id, "id_back", round1);
    await seedDoc(tutor.id, "id_front", round2);
    await seedDoc(tutor.id, "selfie", round2);
    await sql`update tutors set submitted_at = ${round2.toISOString()} where id = ${tutor.id}`;

    const res = await call(app, "GET", "/admin/verifications", adminCookie);
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body.admin, true, res.raw);
    const item = res.body.items.find((i: { tutorId: string }) => i.tutorId === tutor.id);
    assert.ok(item, `the pending tutor is in the queue: ${res.raw}`);

    const kinds = item.docs.map((d: { kind: string }) => d.kind).sort();
    assert.deepEqual(kinds, ["id_front", "selfie"], `only the current round on the card: ${JSON.stringify(item.docs)}`);
    assert.equal(item.docs.filter((d: { kind: string }) => d.kind === "id_front").length, 1);

    assert.ok(Array.isArray(item.previousRounds), "earlier rounds travel separately");
    assert.equal(item.previousRounds.length, 1);
    assert.equal(new Date(item.previousRounds[0].submittedAt).getTime(), round1.getTime(), "the old round is dated");
    assert.deepEqual(
      item.previousRounds[0].docs.map((d: { kind: string }) => d.kind).sort(),
      ["id_back", "id_front"],
    );
    assert.equal(new Date(item.docsSubmittedAt).getTime(), round2.getTime(), "the current round is dated");
  });
});
