import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_TARGETS, defaultShareMessage, normalizeUtmSource, sharePath, shareUrl, shareIntentUrl,
} from "@tnajem/shared";

/* Espace prof v2 · Phase 3 — the share links (packages/shared/src/share-links.ts).
   Pure: no database. */

const O = "https://tnajem.com";

describe("P3 · deep links", () => {
  test("profile, class, offer and promo links, each with utm_source={target}", () => {
    assert.equal(shareUrl(O, { kind: "profile", slug: "yassine-math" }, "whatsapp"), "https://tnajem.com/yassine-math?utm_source=whatsapp");
    assert.equal(
      shareUrl(O, { kind: "class", slug: "yassine-math", classId: "0b6f9a52-1d5e-4a3e-9d1e-3c2b1a0f9e8d" }, "telegram"),
      "https://tnajem.com/class/0b6f9a52-1d5e-4a3e-9d1e-3c2b1a0f9e8d?utm_source=telegram",
    );
    assert.equal(shareUrl(O, { kind: "offer", slug: "yassine-math" }, "qr"), "https://tnajem.com/yassine-math?offre=mensuel&utm_source=qr");
    assert.equal(shareUrl(`${O}/`, { kind: "promo", slug: "yassine-math", promoCode: "RENTREE" }, "x"), "https://tnajem.com/yassine-math?promo=RENTREE&utm_source=x");
  });

  test("a promotion without a code shares the plain profile (it already shows there)", () => {
    assert.equal(sharePath({ kind: "promo", slug: "leila-primaire" }), "/leila-primaire");
  });

  test("ids and codes are URL-encoded, never spliced raw", () => {
    assert.equal(sharePath({ kind: "promo", slug: "a-b-c", promoCode: "A&B=C" }), "/a-b-c?promo=A%26B%3DC");
  });
});

describe("P3 · utm_source is analytics only — a closed vocabulary", () => {
  test("every share target maps to itself", () => {
    for (const t of SHARE_TARGETS) assert.equal(normalizeUtmSource(t), t);
  });
  test("absent is 'direct', unknown is 'other', common spellings fold", () => {
    assert.equal(normalizeUtmSource(undefined), "direct");
    assert.equal(normalizeUtmSource(""), "direct");
    assert.equal(normalizeUtmSource("WhatsApp"), "whatsapp");
    assert.equal(normalizeUtmSource("twitter"), "x");
    assert.equal(normalizeUtmSource("fb"), "facebook");
    assert.equal(normalizeUtmSource("newsletter-octobre"), "other");
    assert.equal(normalizeUtmSource({ evil: true }), "other");
  });
});

describe("P3 · share intents", () => {
  const url = "https://tnajem.com/fr/yassine-math?utm_source=whatsapp";
  test("WhatsApp, X and Telegram carry the message; Facebook and LinkedIn the link only", () => {
    assert.equal(shareIntentUrl("whatsapp", url, "Salut"), `https://wa.me/?text=${encodeURIComponent(`Salut\n${url}`)}`);
    assert.ok(shareIntentUrl("x", url, "Hi")!.startsWith("https://x.com/intent/post?text=Hi&url="));
    assert.ok(shareIntentUrl("telegram", url, "Hi")!.includes(`url=${encodeURIComponent(url)}`));
    assert.equal(shareIntentUrl("facebook", url, "ignored"), `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
    assert.ok(shareIntentUrl("linkedin", url, "")!.startsWith("https://www.linkedin.com/sharing/share-offsite/?url="));
    assert.ok(shareIntentUrl("messenger", url, "")!.startsWith("fb-messenger://share/?link="));
  });
  test("copy, QR and native are handled by the sheet itself", () => {
    for (const t of ["copy", "qr", "native"] as const) assert.equal(shareIntentUrl(t, url, "x"), null);
  });
});

describe("P3 · pre-written messages (truth rule)", () => {
  test("FR and AR exist for every kind and target, and never claim a rating, a count or a payment", () => {
    for (const locale of ["fr", "ar"] as const) {
      for (const kind of ["profile", "class", "offer", "promo"] as const) {
        for (const target of SHARE_TARGETS) {
          const m = defaultShareMessage(kind, target, locale, {
            subject: "Maths", classTitle: "Révision", classDate: "12/10", classTime: "18:00",
            sessionsPerMonth: 4, priceTnd: 120, percent: 15, endsOn: "31/10", promoCode: "RENTREE",
          });
          assert.ok(m.length > 10, `${locale}/${kind}/${target}`);
          assert.doesNotMatch(m, /★|étoile|avis|élèves satisfaits|paiement|payer|خلاص/i, `${locale}/${kind}/${target}: ${m}`);
        }
      }
    }
  });
  test("the context is used when given and left out cleanly when not", () => {
    assert.match(defaultShareMessage("promo", "whatsapp", "fr", { percent: 15, endsOn: "31/10", promoCode: "RENTREE" }), /−15 % .*31\/10.*RENTREE/);
    assert.doesNotMatch(defaultShareMessage("profile", "whatsapp", "fr", {}), /undefined|null/);
  });
});
