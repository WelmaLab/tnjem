import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startApp, stopApp, seedProfile, login, call, sql, fxEmail, grantAdmin, type App } from "./support/fx";

/* Phase A · A18.14 (lane L5). The moderation queue labelled every report without
   a typed-in e-mail "Signalement anonyme" — including reports filed by a SIGNED-IN
   student, tutor or parent, whose account is on the row. The queue now receives
   the reporter's role and account e-mail (admins only), and says "anonyme" only
   when nobody was signed in. */

let app: App;
// Not fx-tagged (a fixed address this file chose), so this file deletes it itself.
const adminEmail = fxEmail(`l5-mod-admin-${randomBytes(6).toString("hex")}`);
const reportIds: string[] = [];

before(async () => {
  // POST /reports is limited per IP (10/h); tests re-run often from the same box.
  await sql`delete from rate_limits where key like 'report:%'`;
  app = await startApp();
});
after(async () => {
  if (reportIds.length) await sql`delete from reports where id in ${sql(reportIds)}`;
  await sql`delete from sessions where profile_id in (select id from profiles where email = ${adminEmail})`;
  await sql`delete from profiles where email = ${adminEmail}`;
  await stopApp(app);
});

describe("A18.14 — a signed-in report is not 'anonyme'", () => {
  test("the queue carries the reporter's role and account; only a signed-out report is anonymous", async () => {
    const admin = await seedProfile({ role: "tutor", email: adminEmail });
    await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
    const student = await seedProfile({ role: "student" });

    const signedIn = await call(app, "POST", "/reports", await login(student.id), {
      subjectKind: "other", reason: "Signalement L5 : un élève connecté signale ceci.",
    });
    assert.equal(signedIn.body.ok, true, signedIn.raw);
    reportIds.push(signedIn.body.id);

    const anonymous = await call(app, "POST", "/reports", null, {
      subjectKind: "other", reason: "Signalement L5 : quelqu'un sans compte signale ceci.",
    });
    assert.equal(anonymous.body.ok, true, anonymous.raw);
    reportIds.push(anonymous.body.id);

    const queue = await call(app, "GET", "/admin/reports", await login(admin.id));
    const byId = (id: string) => queue.body.find((r: { id: string }) => r.id === id);

    const a = byId(signedIn.body.id);
    assert.ok(a, queue.raw);
    assert.equal(a.reporterRole, "student");
    assert.equal(a.reporterAccountEmail, student.email);

    const b = byId(anonymous.body.id);
    assert.ok(b, queue.raw);
    assert.equal(b.reporterRole, null);
    assert.equal(b.reporterAccountEmail, null);
  });
});
