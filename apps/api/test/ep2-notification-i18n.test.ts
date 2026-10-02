import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { eraseAccount, notify } from "@tnajem/db";
import {
  NOTIFICATION_MESSAGES, NOTIFICATION_KIND_OF, digestLine, renderMessage, renderNotification,
  type DigestItem, type NotificationKey, type NotificationParams,
} from "@tnajem/shared/notification-messages";
import { startApp, stopApp, seedProfile, login, call, sql, type App } from "./support/fx";
import { db } from "../src/db";

/* NOTIFICATIONS IN THE READER'S LANGUAGE (0040): a row is a message key + JSON
   parameters, rendered when it is read — the bell in the page's language, e-mails
   and SMS in the recipient's. Rows from before 0040 keep their French text. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app); // notifications cascade from this file's profiles
});

const AT = "2026-10-08T17:00:00.000Z"; // 18:00 in Tunis
const UNTIL = "2026-11-08T17:00:00.000Z";
const CLASS: DigestItem = { type: "class", title: "Intégrales", at: AT };
const SAMPLE: { [K in NotificationKey]: NotificationParams[K] } = {
  bookingConfirmed: { classTitle: "Intégrales", at: AT, who: "Mohamed B." },
  bookingNew: { classTitle: "Intégrales", at: AT, who: "Amine" },
  bookingCancelledByStudent: { classTitle: "Intégrales", at: AT, who: "Amine", late: true, lateHours: 24 },
  classCancelledByTutor: { classTitle: "Intégrales", at: AT },
  classCancelledByPlatform: { classTitle: "Intégrales", at: AT },
  classMoved: { classTitle: "Intégrales", at: AT },
  seatFreed: { classTitle: "Intégrales" },
  messageNew: { classTitle: "Intégrales" },
  verificationApproved: { slug: "mohamed-maths" },
  verificationChangeApprovedName: {},
  verificationChangeApprovedDocs: {},
  verificationChangeRejected: { note: "photo floue" },
  verificationRejected: { note: "photo floue" },
  followNew: { who: "Amine" },
  followDigest: { who: "Mohamed B.", items: [CLASS, { type: "pack", title: "Fiche Bac" }], more: 2 },
  subscriptionRequested: { who: "Amine", offerTitle: "Suivi Bac", priceTnd: 120 },
  subscriptionConfirmed: { who: "Mohamed B.", offerTitle: "Suivi Bac", until: UNTIL },
  subscriptionRenewed: { who: "Mohamed B.", offerTitle: "Suivi Bac", until: UNTIL },
  subscriptionPaused: { who: "Mohamed B.", offerTitle: "Suivi Bac" },
  subscriptionResumed: { who: "Mohamed B.", offerTitle: "Suivi Bac" },
  subscriptionCancelledByStudent: { who: "Amine", offerTitle: "Suivi Bac" },
  subscriptionCancelledByTutor: { who: "Mohamed B.", offerTitle: "Suivi Bac" },
  subscriptionEndingStudent: { who: "Mohamed B.", offerTitle: "Suivi Bac", until: UNTIL },
  subscriptionEndingTutor: { who: "Amine", offerTitle: "Suivi Bac", until: UNTIL },
  subscriptionExpiredStudent: { who: "Mohamed B.", offerTitle: "Suivi Bac" },
  subscriptionExpiredTutor: { who: "Amine", offerTitle: "Suivi Bac" },
};
const KEYS = Object.keys(SAMPLE) as NotificationKey[];
const ARABIC = /[؀-ۿ]/;
const FRENCH_WORDS = /(^|\s)(avec|ton|ta|tes|est|pour|une|le|la|les|a|au)(\s|$)/i;
const plain = (s: string) => s.replace(/[⁨⁩]/g, ""); // drop the Arabic isolates

describe("ep2 · notification catalog: FR and AR, the same messages", () => {
  test("FR and AR have exactly the same keys, every key files under a kind, and the sample covers them all", () => {
    const fr = Object.keys(NOTIFICATION_MESSAGES.fr).sort();
    assert.deepEqual(Object.keys(NOTIFICATION_MESSAGES.ar).sort(), fr);
    assert.deepEqual(Object.keys(NOTIFICATION_KIND_OF).sort(), fr);
    assert.deepEqual([...KEYS].sort(), fr);
  });

  test("every message renders a title and a body in both languages — Arabic in Arabic, French in French", () => {
    for (const key of KEYS) {
      const fr = renderMessage(key, SAMPLE[key] as never, "fr");
      const ar = renderMessage(key, SAMPLE[key] as never, "ar");
      for (const t of [fr, ar]) assert.ok(t.title.trim() && t.body.trim(), `${key}: empty text`);
      assert.doesNotMatch(fr.title + fr.body, ARABIC, `${key}: Arabic in the French text`);
      assert.match(ar.title, ARABIC, `${key}: Arabic title`);
      assert.match(ar.body, ARABIC, `${key}: Arabic body`);
      assert.doesNotMatch(plain(ar.title + " " + ar.body), FRENCH_WORDS, `${key}: French words in the Arabic text: ${ar.body}`);
    }
  });

  test("dates are DD/MM/YYYY and 24 h, in Tunis time, in both languages", () => {
    assert.match(renderMessage("classMoved", SAMPLE.classMoved, "fr").body, /08\/10\/2026 à 18:00/);
    assert.match(plain(renderMessage("classMoved", SAMPLE.classMoved, "ar").body), /08\/10\/2026 على 18:00/);
    assert.match(renderMessage("subscriptionConfirmed", SAMPLE.subscriptionConfirmed, "fr").body, /jusqu'au 08\/11\/2026\./);
  });

  test("Arabic isolates every outside value (title, name, date); French needs none", () => {
    const ar = renderMessage("bookingNew", SAMPLE.bookingNew, "ar").body;
    assert.ok(ar.includes("⁨Intégrales⁩") && ar.includes("⁨Amine⁩"), ar);
    assert.ok(!/[⁨⁩]/.test(renderMessage("bookingNew", SAMPLE.bookingNew, "fr").body));
  });

  test("no name falls back to « Un élève » / « تلميذ »; an erased name reads « Un compte supprimé » / « حساب محذوف »", () => {
    assert.match(renderMessage("bookingNew", { ...SAMPLE.bookingNew, who: null }, "fr").body, /^Un élève a réservé/);
    assert.match(renderMessage("bookingNew", { ...SAMPLE.bookingNew, who: null }, "ar").body, /^تلميذ /);
    const erased = { ...SAMPLE.followNew, who: undefined, whoErased: true };
    assert.match(renderMessage("followNew", erased, "fr").body, /^Un compte supprimé te suit/);
    assert.match(renderMessage("followNew", erased, "ar").body, /^حساب محذوف /);
  });

  test("the messages the app texts have an SMS form in both languages", () => {
    for (const key of ["bookingConfirmed", "verificationApproved", "verificationRejected"] as const) {
      const fr = renderMessage(key, SAMPLE[key] as never, "fr").sms;
      const ar = renderMessage(key, SAMPLE[key] as never, "ar").sms;
      assert.ok(fr && fr.startsWith("Tnajem : "), `${key} fr sms`);
      assert.ok(ar && ARABIC.test(ar), `${key} ar sms`);
    }
  });

  test("the digest's line is the same in the bell and in the e-mail", () => {
    for (const locale of ["fr", "ar"] as const) {
      assert.ok(renderMessage("followDigest", SAMPLE.followDigest, locale).body.includes(digestLine(CLASS, locale)));
    }
  });

  test("renderNotification: a pre-0040 row (text only) or an unknown key comes back as its stored French, marked lang fr", () => {
    const legacy = { key: null, params: null, title: "Place réservée ✅", body: "Algèbre — 08 oct., 18:00." };
    assert.deepEqual(renderNotification(legacy, "ar"), { title: legacy.title, body: legacy.body, lang: "fr" });
    assert.deepEqual(renderNotification({ ...legacy, key: "notAKeyYet" }, "ar"), { title: legacy.title, body: legacy.body, lang: "fr" });
    assert.deepEqual(renderNotification({ key: null, params: null, title: null, body: null }, "ar"), { title: "إشعار", body: "", lang: "ar" });
    const keyed = renderNotification({ key: "messageNew", params: { classTitle: "Algèbre" }, title: null, body: null }, "ar");
    assert.equal(keyed.lang, "ar");
    assert.match(keyed.body, ARABIC);
  });
});

describe("ep2 · notifications are stored as a key + parameters and rendered for the reader", () => {
  test("notify() stores the key and the parameters, never rendered text", async () => {
    const p = await seedProfile({ role: "student" });
    assert.deepEqual(await notify(db, p.id, { key: "messageNew", params: { classTitle: "Algèbre" }, href: "/messages/x" }), { ok: true });
    const [row] = await sql<{ kind: string; msg_key: string; msg_params: unknown; title: string | null; body: string | null }[]>`
      select kind, msg_key, msg_params, title, body from notifications where profile_id = ${p.id}`;
    assert.deepEqual({ ...row }, { kind: "message", msg_key: "messageNew", msg_params: { classTitle: "Algèbre" }, title: null, body: null });
  });

  test("GET /notifications renders in the page's language (?locale), else the account's — and says which", async () => {
    const p = await seedProfile({ role: "tutor" });
    await notify(db, p.id, { key: "followNew", params: { who: "Amine" }, aboutProfileId: null });
    const cookie = await login(p.id);
    const ar = await call(app, "GET", "/notifications?locale=ar", cookie);
    assert.equal(ar.status, 200, ar.raw);
    assert.equal(ar.body[0].lang, "ar");
    assert.match(ar.body[0].title, ARABIC);
    assert.match(ar.body[0].body, /Amine/);
    const fr = await call(app, "GET", "/notifications?locale=fr", cookie);
    assert.deepEqual([fr.body[0].lang, fr.body[0].title], ["fr", "Nouvel abonné"]);
    assert.match(fr.body[0].body, /^Amine te suit/);
    // No locale: the account's language.
    await sql`update profiles set locale = 'ar' where id = ${p.id}`;
    assert.equal((await call(app, "GET", "/notifications", cookie)).body[0].lang, "ar");
    assert.equal((await call(app, "GET", "/notifications?locale=en", cookie)).status, 400, "only fr or ar");
  });

  test("a row stored before 0040 shows its French text in both languages, marked lang fr", async () => {
    const p = await seedProfile({ role: "tutor" });
    await sql`insert into notifications (profile_id, kind, title, body) values (${p.id}, 'new_booking', 'Nouvelle réservation 🎉', 'Amine a réservé « Algèbre » (08 oct., 18:00).')`;
    const cookie = await login(p.id);
    const [n] = (await call(app, "GET", "/notifications?locale=ar", cookie)).body;
    assert.deepEqual([n.title, n.body, n.lang], ["Nouvelle réservation 🎉", "Amine a réservé « Algèbre » (08 oct., 18:00).", "fr"]);
  });

  test("the database refuses a row with neither a key nor text, and parameters that are not an object", async () => {
    const p = await seedProfile({ role: "student" });
    await assert.rejects(sql`insert into notifications (profile_id, kind) values (${p.id}, 'message')`, /notifications_key_or_text/);
    await assert.rejects(
      sql`insert into notifications (profile_id, kind, msg_key, msg_params) values (${p.id}, 'message', 'messageNew', '[1]'::jsonb)`,
      /notifications_params_object/,
    );
  });
});

describe("ep2 · migration 0040 on rows written before it", () => {
  /** The backfill statements of 0040 (its UPDATEs), re-run on rows this test inserts. */
  async function backfill(): Promise<void> {
    const file = await readFile(new URL("../../../packages/db/sql/0040_notification_i18n.sql", import.meta.url), "utf8");
    const updates = file
      .split(/;\s*\n/)
      .map((chunk) => chunk.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
      .filter((s) => /^UPDATE notifications/i.test(s));
    assert.equal(updates.length, 8, "eight backfills in 0040");
    for (const u of updates) await sql.unsafe(u);
  }

  test("fixed and single-value texts get their key (text kept as the fallback); a dated text stays text-only", async () => {
    const p = await seedProfile({ role: "tutor" });
    const legacy = [
      ["message", "Nouveau message", "Tu as un nouveau message à propos de « Algèbre — Bac ».", "messageNew", { classTitle: "Algèbre — Bac" }],
      ["new_follower", "Nouvel abonné", "Amine te suit : il sera prévenu de tes nouvelles séances et fiches.", "followNew", { who: "Amine" }],
      ["new_follower", "Nouvel abonné", "Un élève te suit : il sera prévenu de tes nouvelles séances et fiches.", "followNew", {}],
      ["new_follower", "Nouvel abonné", "Un compte supprimé te suit : il sera prévenu de tes nouvelles séances et fiches.", "followNew", { whoErased: true }],
      ["verification_approved", "Profil vérifié ✅", "Ton profil est validé. Ta page est en ligne et visible dans Explorer.", "verificationApproved", {}],
      ["verification_rejected", "Dossier à compléter", "Ton dossier n'a pas été validé : photo floue. Tu peux corriger et renvoyer.", "verificationRejected", { note: "photo floue" }],
      ["booking_cancelled", "Place libérée", "Une place s'est libérée pour « Algèbre ». Elle est de nouveau disponible.", "seatFreed", { classTitle: "Algèbre" }],
      ["new_booking", "Nouvelle réservation 🎉", "Amine a réservé « Algèbre » (08 oct., 18:00).", null, null],
    ] as const;
    for (const [kind, title, body] of legacy) {
      await sql`insert into notifications (profile_id, kind, title, body) values (${p.id}, ${kind}, ${title}, ${body})`;
    }
    await backfill();
    await backfill(); // idempotent: only rows still without a key are touched

    const rows = await sql<{ body: string; title: string; msg_key: string | null; msg_params: unknown }[]>`
      select body, title, msg_key, msg_params from notifications where profile_id = ${p.id}`;
    for (const [, title, body, key, params] of legacy) {
      const row = rows.find((r) => r.body === body);
      assert.ok(row, `kept: ${body}`);
      assert.equal(row.title, title, "the French text stays, as the fallback");
      assert.equal(row.msg_key, key, body);
      assert.deepEqual(row.msg_params, params, body);
    }
    // The migrated message row now reads in Arabic; the dated one stays French.
    const cookie = await login(p.id);
    const shown = (await call(app, "GET", "/notifications?locale=ar", cookie)).body as { body: string; lang: string }[];
    assert.ok(shown.some((n) => n.lang === "ar" && n.body.includes("Algèbre — Bac") && ARABIC.test(n.body)));
    assert.ok(shown.some((n) => n.lang === "fr" && n.body === "Amine a réservé « Algèbre » (08 oct., 18:00)."));
  });
});

describe("ep2 · erasure takes the name out of the parameters", () => {
  test("erasing the person a row names: `who` leaves, every language says the account was deleted", async () => {
    const tutor = await seedProfile({ role: "tutor" });
    const student = await seedProfile({ role: "student", fullName: "Amine Karoui" });
    await notify(db, tutor.id, { key: "followNew", params: { who: "Amine" }, aboutProfileId: student.id });
    const res = await eraseAccount(db, student.id, { reason: "requested" });
    assert.equal(res.outcome, "erased");

    const [row] = await sql<{ msg_params: Record<string, unknown>; about_profile_id: string | null }[]>`
      select msg_params, about_profile_id from notifications where profile_id = ${tutor.id}`;
    assert.deepEqual(row.msg_params, { whoErased: true });
    assert.equal(row.about_profile_id, null);
    const fr = renderNotification({ key: "followNew", params: row.msg_params, title: null, body: null }, "fr");
    const ar = renderNotification({ key: "followNew", params: row.msg_params, title: null, body: null }, "ar");
    assert.match(fr.body, /^Un compte supprimé te suit/);
    assert.match(ar.body, /^حساب محذوف /);
    assert.doesNotMatch(fr.body + ar.body, /Amine/);
  });
});
