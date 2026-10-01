import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../src/server";
// Prefs rows cascade from this file's fx profiles, which stopApp() cleans up.
import { startApp, stopApp, seedProfile, login, call, fxClientIp, type App } from "./support/fx";
import {
  listUnsubscribeHeaders, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken,
} from "@tnajem/shared/unsubscribe";
import { sendMail } from "@tnajem/shared/mail";
import { wantsEmail } from "@tnajem/db";
import { db } from "../src/db";

/* Espace prof v2 · Phase 4 · contract C5 — e-mail preferences and one-click
   unsubscribe: an HMAC-signed token (no table), GET that changes nothing (a mail
   scanner prefetching the link must not unsubscribe anyone), POST that does, the
   RFC 8058 headers, the backward-compatible sendMail 4th parameter, and a token
   that never reaches a log line. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

const ID = "0b6f9a52-1d5e-4a3e-9d1e-3c2b1a0f9e8d";

describe("C5 · the token", () => {
  test("round-trips, and is refused when tampered with, re-targeted or malformed", () => {
    const t = unsubscribeToken(ID, "followers");
    assert.match(t, /^v1\.[0-9a-f-]{36}\.followers\.[A-Za-z0-9_-]{32}$/);
    assert.deepEqual(verifyUnsubscribeToken(t), { profileId: ID, kind: "followers" });
    assert.equal(verifyUnsubscribeToken(t.replace("followers", "bookings")), null, "a kind it was not signed for");
    assert.equal(verifyUnsubscribeToken(t.replace(ID, "11111111-2222-3333-4444-555555555555")), null, "another profile");
    assert.equal(verifyUnsubscribeToken(`${t.slice(0, -1)}${t.endsWith("A") ? "B" : "A"}`), null, "a forged signature");
    for (const bad of ["", "v1", "v2.x.y.z", null, 42, "x".repeat(500)]) assert.equal(verifyUnsubscribeToken(bad), null);
  });

  test("the URL points at the web's one public origin, and the RFC 8058 headers name it", () => {
    const url = unsubscribeUrl(ID, "reminders");
    assert.match(url, /^https?:\/\/[^/]+\/api\/email\/unsubscribe\?token=v1\./);
    const h = listUnsubscribeHeaders(ID, "reminders");
    assert.equal(h["List-Unsubscribe"], `<${url}>`);
    assert.equal(h["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  });
});

describe("C5 · preferences", () => {
  test("no row = everything on; a partial save changes only what it names", async () => {
    const p = await seedProfile();
    const cookie = await login(p.id);
    assert.deepEqual((await call(app, "GET", "/me/notification-prefs", cookie)).body, {
      ok: true, prefs: { followers: true, bookings: true, messages: true, reminders: true },
    });
    const res = await call(app, "PUT", "/me/notification-prefs", cookie, { messages: false });
    assert.deepEqual(res.body.prefs, { followers: true, bookings: true, messages: false, reminders: true });
    const res2 = await call(app, "POST", "/me/notification-prefs", cookie, { reminders: false });
    assert.deepEqual(res2.body.prefs, { followers: true, bookings: true, messages: false, reminders: false });
    assert.equal(await wantsEmail(db, p.id, "messages"), false);
    assert.equal(await wantsEmail(db, p.id, "bookings"), true);
  });

  test("zod: unknown keys and non-booleans are a 400; signed out is refused", async () => {
    const cookie = await login((await seedProfile()).id);
    assert.equal((await call(app, "POST", "/me/notification-prefs", cookie, { followers: "no" })).status, 400);
    assert.equal((await call(app, "POST", "/me/notification-prefs", cookie, { marketing: true })).status, 400);
    assert.deepEqual((await call(app, "GET", "/me/notification-prefs", null)).body, { ok: false, error: "not-authenticated" });
  });
});

describe("C5 · /email/unsubscribe", () => {
  const inject = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as Record<string, unknown> | undefined, remoteAddress: fxClientIp() })
      .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

  test("GET says what it would do and changes NOTHING; POST switches the kind off; GET then says 'already'", async () => {
    const p = await seedProfile();
    const token = unsubscribeToken(p.id, "followers");
    const q = `/email/unsubscribe?token=${encodeURIComponent(token)}`;
    assert.deepEqual((await inject("GET", q)).body, { ok: true, kind: "followers", locale: "fr", already: false });
    assert.equal(await wantsEmail(db, p.id, "followers"), true, "a scanner's GET must not unsubscribe");
    assert.deepEqual((await inject("POST", q)).body, { ok: true, kind: "followers", locale: "fr" });
    assert.equal(await wantsEmail(db, p.id, "followers"), false);
    assert.equal(await wantsEmail(db, p.id, "bookings"), true, "only the one kind");
    assert.equal((await inject("GET", q)).body.already, true);
  });

  test("the token in the body works too (the web forwards the RFC 8058 POST that way)", async () => {
    const p = await seedProfile();
    const r = await inject("POST", "/email/unsubscribe", { token: unsubscribeToken(p.id, "reminders") });
    assert.equal(r.body.ok, true);
    assert.equal(await wantsEmail(db, p.id, "reminders"), false);
  });

  test("a forged or unknown token is refused, and an erased profile cannot be addressed", async () => {
    assert.deepEqual((await inject("POST", "/email/unsubscribe?token=v1.nope")).body, { ok: false, error: "invalid-token" });
    assert.deepEqual((await inject("GET", `/email/unsubscribe?token=${unsubscribeToken(ID, "followers")}`)).body, { ok: false, error: "invalid-token" });
  });

  test("the token never reaches a log line", async () => {
    const lines: string[] = [];
    const logged = await buildServer({ logStream: { write: (l) => void lines.push(l) } });
    await logged.ready();
    try {
      const p = await seedProfile();
      const token = unsubscribeToken(p.id, "messages");
      await logged.inject({ method: "POST", url: `/email/unsubscribe?token=${encodeURIComponent(token)}`, remoteAddress: fxClientIp() });
      await logged.inject({ method: "POST", url: "/email/unsubscribe", payload: { token }, remoteAddress: fxClientIp() });
      const all = lines.join("\n");
      assert.ok(all.length > 0, "something was logged");
      assert.ok(!all.includes(token), "the token is not in the log");
      assert.ok(!all.includes(token.split(".")[3]), "nor its signature");
    } finally {
      await logged.close();
    }
  });
});

describe("C5 · sendMail's optional 4th parameter", () => {
  test("three arguments still work; the options are accepted; with no provider it answers false and never throws", async () => {
    for (const k of ["MAIL_HOST", "MAIL_USER", "MAIL_PASS", "MAIL_FROM_ADDRESS"]) process.env[k] = "";
    assert.equal(await sendMail("a@tnajem.invalid", "s", "t"), false);
    assert.equal(
      await sendMail("a@tnajem.invalid", "s", "t", {
        headers: listUnsubscribeHeaders(ID, "bookings"),
        attachments: [{ filename: "seance.ics", content: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", contentType: "text/calendar" }],
        html: "<p>t</p>",
      }),
      false,
    );
  });
});
