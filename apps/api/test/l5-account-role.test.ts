import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { startApp, stopApp, seedProfile, login, call, sql, fxEmail, grantAdmin, type App } from "./support/fx";

/* Phase A · A18.13 (lane L5). /account read "Rôle : Je suis prof" — the sign-up
   BUTTON text reused as a role name — and a parent or an admin was shown "Je suis
   élève / parent". The page now has dedicated strings (Élève · Prof · Parent ·
   Admin, FR and Derija), and GET /me says whether the caller is an admin so the
   page can name it. accountRole() is the one rule. */

let app: App;
// Not fx-tagged (a fixed address this file chose), so this file deletes it itself.
const adminEmail = fxEmail(`l5-admin-${randomBytes(6).toString("hex")}`);
before(async () => {
  app = await startApp();
});
after(async () => {
  await sql`delete from sessions where profile_id in (select id from profiles where email = ${adminEmail})`;
  await sql`delete from profiles where email = ${adminEmail}`;
  await stopApp(app);
});

describe("A18.13 — the account page names the role", () => {
  test("GET /me says whether the caller is an admin", async () => {
    const admin = await seedProfile({ role: "tutor", email: adminEmail });
    await grantAdmin(admin.id); // VULN-006: admin is profiles.admin_granted_at
    const tutor = await seedProfile({ role: "tutor" });
    const a = await call(app, "GET", "/me", await login(admin.id));
    assert.equal(a.body.isAdmin, true, a.raw);
    const t = await call(app, "GET", "/me", await login(tutor.id));
    assert.equal(t.body.isAdmin, false, t.raw);
  });

  test("accountRole(): admin wins, then the stored role; anything unknown reads as a student", async () => {
    const m = (await import("@tnajem/shared")) as Record<string, unknown>;
    assert.equal(typeof m.accountRole, "function", "accountRole is exported");
    const role = m.accountRole as (me: { role: string; isAdmin?: boolean }) => string;
    assert.equal(role({ role: "tutor", isAdmin: true }), "admin");
    assert.equal(role({ role: "tutor" }), "tutor");
    assert.equal(role({ role: "guardian" }), "guardian");
    assert.equal(role({ role: "student" }), "student");
    assert.equal(role({ role: "???" }), "student");
  });
});
