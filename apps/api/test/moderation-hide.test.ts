import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App,
} from "./support/fx";
import { grantAdmin } from "./support/fx"; // VULN-006

/* phase-a lane L4 (A28) — admins could not remove reported content.

   /terms says "Nous pouvons retirer un contenu"; the moderation queue could only
   close a report. An admin can now HIDE a message or a review: a soft delete — the
   text stays in the table as evidence and admins still read it; everyone else,
   the author included, sees the placeholder. The action needs a reason and is
   audited. */

const FR = "Contenu retiré par la modération";
const AR = "المحتوى هذا تنحّى من طرف المراقبة";

let app: App;
let adminCookie: string;
const threadIds: string[] = [];
const reviewIds: string[] = [];
const reportIds: string[] = [];
const subjectIds: string[] = [];

before(async () => {
  app = await startApp();
  const admin = await seedProfile({ role: "tutor" });
  process.env.OTP_CHANNEL = "email";
  await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
  adminCookie = await login(admin.id);
});
after(async () => {
  // Audit rows stay: admin_actions is append-only since Phase A+ (0031).
  for (const id of reportIds) await sql`delete from reports where id = ${id}`;
  for (const id of reviewIds) await sql`delete from reviews where id = ${id}`;
  for (const id of threadIds) await sql`delete from message_threads where id = ${id}`; // messages cascade
  await stopApp(app);
});

async function conversation() {
  const tutorProfile = await seedProfile({ role: "tutor" });
  const tutor = await seedTutor({ profileId: tutorProfile.id });
  const klass = await seedClass({ tutorId: tutor.id });
  const student = await seedProfile({ role: "student" });
  const booking = await seedBooking({ classId: klass.id, studentId: student.id });
  const threadId = randomUUID();
  await sql`insert into message_threads (id, booking_id, class_id, tutor_profile_id, student_profile_id)
            values (${threadId}, ${booking.id}, ${klass.id}, ${tutorProfile.id}, ${student.id})`;
  threadIds.push(threadId);
  const messageId = randomUUID();
  await sql`insert into messages (id, thread_id, sender_profile_id, body)
            values (${messageId}, ${threadId}, ${student.id}, 'Un message insultant, signalé.')`;
  const reportId = randomUUID();
  await sql`insert into reports (id, subject_kind, subject_id, reason)
            values (${reportId}, 'message', ${messageId}, 'Ce message est insultant envers le prof.')`;
  reportIds.push(reportId);
  subjectIds.push(messageId, reportId);
  return { tutor, tutorProfile, student, threadId, messageId, reportId };
}

describe("A28 — hiding a reported MESSAGE", () => {
  test("hide → the other party sees the placeholder, the audit row exists, admins still see the text", async () => {
    const { tutorProfile, student, threadId, messageId } = await conversation();

    const res = await call(app, "POST", "/admin/moderation/hide", adminCookie, {
      kind: "message", id: messageId, reason: "Insultes envers le prof",
    });
    assert.equal(res.status, 200, res.raw);
    assert.equal(res.body?.ok, true, res.raw);

    const asTutor = await call(app, "GET", `/threads/${threadId}`, await login(tutorProfile.id));
    const seen = asTutor.body.messages.find((m: { id: string }) => m.id === messageId);
    assert.equal(seen.body, FR, "the other party sees the placeholder");
    assert.ok(!asTutor.raw.includes("insultant"), "the hidden text reaches no one but admins");

    await sql`update profiles set locale = 'ar' where id = ${student.id}`;
    const asAuthor = await call(app, "GET", `/threads/${threadId}`, await login(student.id));
    assert.equal(asAuthor.body.messages.find((m: { id: string }) => m.id === messageId).body, AR, "in Derija for an Arabic reader");

    const [audit] = await sql<{ action: string; admin_profile_id: string | null }[]>`
      select action, admin_profile_id from admin_actions where subject_id = ${messageId}`;
    assert.equal(audit?.action, "message.hide", "the hide is audited");
    assert.ok(audit.admin_profile_id, "and attributed");

    const [row] = await sql<{ body: string; hidden_reason: string; hidden: boolean }[]>`
      select body, hidden_reason, hidden_at is not null as hidden from messages where id = ${messageId}`;
    assert.deepEqual(row, { body: "Un message insultant, signalé.", hidden_reason: "Insultes envers le prof", hidden: true },
      "a soft delete: the evidence is kept");

    const reports = await call(app, "GET", "/admin/reports", adminCookie);
    const item = reports.body.find((r: { subjectId: string }) => r.subjectId === messageId);
    assert.ok(item.subject.label.includes("insultant"), "admins still read the text");
    assert.equal(item.subject.hidden, true, "and see that it is hidden");
  });

  test("no reason → refused and nothing changes; a non-admin → refused", async () => {
    const { messageId, tutorProfile } = await conversation();
    const noReason = await call(app, "POST", "/admin/moderation/hide", adminCookie, { kind: "message", id: messageId, reason: " " });
    assert.equal(noReason.body?.ok, false, noReason.raw);
    assert.equal(noReason.body?.error, "reason-required", noReason.raw);
    const notAdmin = await call(app, "POST", "/admin/moderation/hide", await login(tutorProfile.id), {
      kind: "message", id: messageId, reason: "Je veux le cacher",
    });
    assert.equal(notAdmin.body?.error, "forbidden", notAdmin.raw);
    const [row] = await sql<{ hidden: boolean }[]>`select hidden_at is not null as hidden from messages where id = ${messageId}`;
    assert.equal(row.hidden, false);
    const [a] = await sql<{ n: number }[]>`select count(*)::int n from admin_actions where subject_id = ${messageId}`;
    assert.equal(a.n, 0);
  });
});

describe("A28 — hiding a REVIEW", () => {
  test("hide → the public storefront feed shows the placeholder, and the hide is audited", async () => {
    const tutor = await seedTutor();
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: -48 });
    const student = await seedProfile({ role: "student" });
    const reviewId = randomUUID();
    await sql`insert into reviews (id, tutor_id, student_id, class_id, rating, text)
              values (${reviewId}, ${tutor.id}, ${student.id}, ${klass.id}, 1, 'Un avis diffamatoire, signalé.')`;
    reviewIds.push(reviewId);
    subjectIds.push(reviewId);

    const res = await call(app, "POST", "/admin/moderation/hide", adminCookie, {
      kind: "review", id: reviewId, reason: "Propos diffamatoires",
    });
    assert.equal(res.body?.ok, true, res.raw);

    const feed = await call(app, "GET", `/tutors/${tutor.slug}/reviews`, null);
    const item = feed.body.items.find((r: { id: string }) => r.id === reviewId);
    assert.ok(item, feed.raw);
    assert.ok(String(item.text).includes(FR), `the public sees the placeholder: ${item.text}`);
    assert.ok(!feed.raw.includes("diffamatoire"), "the hidden text is not in the public payload");

    const [audit] = await sql<{ action: string }[]>`select action from admin_actions where subject_id = ${reviewId}`;
    assert.equal(audit?.action, "review.hide");
    const [row] = await sql<{ text: string }[]>`select text from reviews where id = ${reviewId}`;
    assert.equal(row.text, "Un avis diffamatoire, signalé.", "kept as evidence");
  });
});
