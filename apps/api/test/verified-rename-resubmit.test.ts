import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { objectStore } from "@tnajem/db";
import { startApp, stopApp, seedProfile, seedTutor, login, call, sql, type App } from "./support/fx";
import { grantAdmin } from "./support/fx"; // VULN-006

/* phase-a lane L4 (A26) — verified tutors: rename and resubmit.

   1. A verified tutor could rename themselves with no review and keep the badge:
      POST /tutors wrote the new name straight onto the public storefront. A rename
      now goes back to review, and the tutor stays public under the OLD, approved
      name until an admin approves the new one.
   2. A verified tutor who resubmitted documents dropped back to "pending" and
      vanished from Explore. The new round is now reviewed while they stay verified.

   Names are compared by FIRST NAME only, on purpose: how a tutor's name is shown
   to the public (D1, first name + initial) is another lane's change, and this test
   must hold either way. */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAAASUVORK5CYII=",
  "base64",
);

let app: App;
let adminCookie: string;
const tutorIds: string[] = [];

before(async () => {
  app = await startApp();
  process.env.MAIL_HOST = ""; // never send mail from a test
  const admin = await seedProfile({ role: "tutor" });
  process.env.OTP_CHANNEL = "email";
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  adminCookie = await login(admin.id);
});
after(async () => {
  for (const id of tutorIds) {
    const docs = await sql<{ storage_path: string }[]>`select storage_path from verification_docs where tutor_id = ${id}`;
    for (const d of docs) await objectStore().delete(d.storage_path).catch(() => "missing");
    await objectStore().pruneEmpty(`verification/${id}`).catch(() => undefined);
    await sql`delete from verification_docs where tutor_id = ${id}`;
    // Audit rows stay: admin_actions is append-only since Phase A+ (0031).
    await sql`delete from rate_limits where key like ${`%${id}%`}`.catch(() => undefined);
  }
  await stopApp(app);
});

async function verifiedTutor(first: string) {
  const fullName = `${first} Ben ${randomBytes(3).toString("hex")}`;
  const profile = await seedProfile({ role: "tutor", fullName });
  const tutor = await seedTutor({ profileId: profile.id, fullName, status: "verified" });
  tutorIds.push(tutor.id);
  /* An approved first round, as the real flow leaves it: submitted, declared, decided. */
  const submitted = new Date(Date.now() - 10 * 86400_000);
  await sql`update tutors
               set submitted_at = ${submitted.toISOString()},
                   public_teacher_declared_at = ${submitted.toISOString()},
                   public_teacher_declaration_version = '2026-09-15',
                   reviewed_at = ${new Date(submitted.getTime() + 3600_000).toISOString()}
             where id = ${tutor.id}`;
  return { tutor, profile, fullName, cookie: await login(profile.id) };
}

async function storefrontName(slug: string): Promise<string | null> {
  const res = await call(app, "GET", `/tutors/${slug}/storefront`, null);
  return res.body?.tutor?.full_name ?? null;
}

async function inExplore(slug: string): Promise<{ full_name: string } | undefined> {
  // Phase A+ (P2): Explore search no longer reads the bio; the slug finds exactly this tutor.
  const res = await call(app, "GET", `/tutors/explore?q=${encodeURIComponent(slug)}`, null);
  return (res.body as { slug: string; full_name: string }[]).find((r) => r.slug === slug);
}

async function queueItem(tutorId: string) {
  const res = await call(app, "GET", "/admin/verifications", adminCookie);
  return (res.body.items as { tutorId: string }[]).find((i) => i.tutorId === tutorId) as Record<string, any> | undefined;
}

describe("A26 — a verified tutor's rename goes to review; the old name stays public until approved", () => {
  test("rename → still public under the OLD name; the admin approves → the new name is public", async () => {
    const { tutor, profile, cookie } = await verifiedTutor("Sami");
    const newName = `Karim Trabelsi ${randomBytes(2).toString("hex")}`;

    const res = await call(app, "POST", "/tutors", cookie, {
      name: newName, subject: "Mathématiques", bio: "Seeded by an API test.", slug: tutor.slug,
    });
    assert.equal(res.body.ok, true, res.raw);

    const [row] = await sql<{ full_name: string; status: string }[]>`select full_name, status from tutors where id = ${tutor.id}`;
    assert.ok(row.full_name.startsWith("Sami "), `the approved name stays on the tutor until review: ${row.full_name}`);
    assert.equal(row.status, "verified", "the tutor stays verified");
    const sfName = await storefrontName(tutor.slug);
    assert.ok(sfName && sfName.startsWith("Sami") && !sfName.includes("Karim"), `storefront shows the old name: ${sfName}`);
    const card = await inExplore(tutor.slug);
    assert.ok(card, "still listed in Explore");
    assert.ok(card.full_name.startsWith("Sami") && !card.full_name.includes("Karim"), `Explore shows the old name: ${card.full_name}`);
    const [p] = await sql<{ full_name: string }[]>`select full_name from profiles where id = ${profile.id}`;
    assert.ok(p.full_name.startsWith("Sami "), "no counterparty surface picks the new name up from the profile either");

    const item = await queueItem(tutor.id);
    assert.ok(item, "the rename is in the review queue");
    assert.equal(item.pendingName, newName);
    assert.equal(item.reReview, true);

    const ok = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
      tutorId: tutor.id, submittedAt: item.submittedAt, pendingName: item.pendingName,
    });
    assert.equal(ok.body.ok, true, ok.raw);
    const [after] = await sql<{ full_name: string; status: string; pending_full_name: string | null }[]>`
      select full_name, status, pending_full_name from tutors where id = ${tutor.id}`;
    assert.deepEqual(after, { full_name: newName, status: "verified", pending_full_name: null });
    const [p2] = await sql<{ full_name: string }[]>`select full_name from profiles where id = ${profile.id}`;
    assert.equal(p2.full_name, newName);
    const sfAfter = await storefrontName(tutor.slug);
    assert.ok(sfAfter && sfAfter.startsWith("Karim"), `the approved new name is public: ${sfAfter}`);
    const [a] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where subject_id = ${tutor.id} and action = 'verification.approve'`;
    assert.equal(a.n, 1, "the approval is audited");
  });

  test("a rename the admin refuses: the tutor keeps the old name and stays verified", async () => {
    const { tutor, cookie } = await verifiedTutor("Hela");
    const res = await call(app, "POST", "/tutors", cookie, {
      name: `Nadia Refus ${randomBytes(2).toString("hex")}`, subject: "Mathématiques", bio: "Seeded by an API test.", slug: tutor.slug,
    });
    assert.equal(res.body.ok, true, res.raw);
    const no = await call(app, "POST", "/admin/verifications/reject", adminCookie, { tutorId: tutor.id, note: "Nom non conforme à la pièce" });
    assert.equal(no.body.ok, true, no.raw);
    const [row] = await sql<{ full_name: string; status: string; pending_full_name: string | null }[]>`
      select full_name, status, pending_full_name from tutors where id = ${tutor.id}`;
    assert.ok(row.full_name.startsWith("Hela "), row.full_name);
    assert.equal(row.status, "verified");
    assert.equal(row.pending_full_name, null);
    assert.equal(await queueItem(tutor.id), undefined, "decided: out of the queue");
  });
});

describe("A26 — a verified tutor who resubmits documents stays verified and in Explore", () => {
  test("resubmit → still verified, still in Explore; the new round is in the queue and approvable", async () => {
    const { tutor, cookie } = await verifiedTutor("Walid");

    const form = new FormData();
    form.append("idFront", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "cin-recto.png");
    form.append("notPublicTeacher", "yes");
    const req = new Request("http://local/verification", { method: "POST", body: form });
    const res = await app.inject({
      method: "POST",
      url: "/verification",
      headers: { cookie, "content-type": req.headers.get("content-type") ?? "" },
      payload: Buffer.from(await req.arrayBuffer()),
    });
    assert.equal(JSON.parse(res.body).ok, true, res.body);

    const [row] = await sql<{ status: string; verified: boolean }[]>`select status, verified from tutors where id = ${tutor.id}`;
    assert.deepEqual(row, { status: "verified", verified: true }, "resubmitting does not un-verify the tutor");
    assert.ok(await inExplore(tutor.slug), "still listed in Explore while the new round is reviewed");
    assert.ok(await storefrontName(tutor.slug), "the storefront stays up");

    const item = await queueItem(tutor.id);
    assert.ok(item, "the new round is in the review queue");
    assert.equal(item.reReview, true);
    assert.deepEqual(item.docs.map((d: { kind: string }) => d.kind), ["id_front"]);

    const ok = await call(app, "POST", "/admin/verifications/approve", adminCookie, {
      tutorId: tutor.id, submittedAt: item.submittedAt, pendingName: item.pendingName,
    });
    assert.equal(ok.body.ok, true, ok.raw);
    const [after] = await sql<{ status: string }[]>`select status from tutors where id = ${tutor.id}`;
    assert.equal(after.status, "verified");
    assert.equal(await queueItem(tutor.id), undefined, "decided: out of the queue");
  });

  test("the 90-day purge never takes a round that is still under review (the tutor is 'verified' now, not 'pending')", async () => {
    /* Before A26 a resubmission set status=pending, and the purge skips pending
       tutors. The tutor now stays verified with a decision 100 days old: without a
       guard, the purge would delete the scans the admin has not looked at yet. */
    const { tutor } = await verifiedTutor("Amel");
    const decided = new Date(Date.now() - 100 * 86400_000);
    await sql`update tutors set reviewed_at = ${decided.toISOString()},
                                submitted_at = now(), public_teacher_declared_at = now()
               where id = ${tutor.id}`;
    const [doc] = await sql<{ id: string }[]>`
      insert into verification_docs (tutor_id, kind, file_name, storage_path, mime, size_bytes)
      values (${tutor.id}, 'id_front', 'new.png', ${`verification/${tutor.id}/id_front-new.png`}, 'image/png', 68)
      returning id`;
    const { purgeExpiredVerificationDocs } = await import("@tnajem/db");
    const { db } = await import("../src/db");
    const run = await purgeExpiredVerificationDocs(db, { dryRun: true, baseDir: process.env.STORAGE_DIR });
    assert.ok(!run.removed.some((r) => r.docId === doc.id), "a round under review is not expired");
  });
});
