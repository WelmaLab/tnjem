import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as shared from "@tnajem/shared";
import { adminNotifyEmails } from "@tnajem/shared";

/* VULN-006: admin is profiles.admin_granted_at (apps/api/src/lib/admin.ts), proven
   end to end in sec-006-admin-phone.test.ts. The env allow-list parser this file
   used to cover (adminAuthIdentities / isAllowlistedAdmin, ADMIN_EMAILS under
   e-mail and ADMIN_PHONES under sms) authorised on a field the user types, and is
   gone. ADMIN_EMAILS survives only as the list of addresses to NOTIFY. */

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe("no env allow-list decides admin any more", () => {
  test("the allow-list parser is not exported", () => {
    const m = shared as Record<string, unknown>;
    assert.equal(m.adminAuthIdentities, undefined);
    assert.equal(m.isAllowlistedAdmin, undefined);
  });
});

describe("adminNotifyEmails — always ADMIN_EMAILS, never phones", () => {
  test("ignores ADMIN_PHONES entirely", () => {
    assert.deepEqual(
      adminNotifyEmails(env({ ADMIN_PHONES: "+21620000000", ADMIN_EMAILS: "a@b.com" })),
      ["a@b.com"],
    );
  });
  test("applies the trim/drop-empty/validate discipline", () => {
    assert.deepEqual(
      adminNotifyEmails(env({ ADMIN_EMAILS: " A@B.COM ,,notanemail," })),
      ["a@b.com"],
    );
  });
  test("empty entries never normalise into an address", () => {
    assert.deepEqual(adminNotifyEmails(env({ ADMIN_EMAILS: "," })), []);
    assert.deepEqual(adminNotifyEmails(env({ ADMIN_EMAILS: ",," })), []);
  });
  test("unset -> [] (the caller warns; nobody is mailed)", () => {
    assert.deepEqual(adminNotifyEmails(env({})), []);
  });
});
