import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, icsEscapeText, icsFold, icsSequence, icsUtc, icsTunisLocal, icsContentType } from "@tnajem/shared";

/* espace prof v2 · pro (P7) — the .ics file every booking email attaches.

   RFC 5545 is strict in the places calendar clients are strict: CRLF, 75-octet
   folding, TEXT escaping, a VTIMEZONE for every TZID, and a stable UID with a
   SEQUENCE that only grows. Each of those is asserted here on the real output. */

const base = {
  uid: "booking-11111111-1111-4111-8111-111111111111@tnajem.com",
  sequence: 42,
  start: "2026-10-02T17:00:00.000Z", // 18:00 in Tunis (UTC+1)
  durationMin: 90,
  summary: "Maths Bac — avec Mohamed B.",
  description: "Séance en direct sur Tnajem.\nPour rejoindre : https://tnajem.com/fr/live/abc",
  url: "https://tnajem.com/fr/live/abc",
  location: "En ligne · Tnajem",
  organizer: { name: "Tnajem", email: "support@tnajem.com" },
  stamp: "2026-10-01T08:00:00.000Z",
};

/** Undo RFC 5545 folding: CRLF followed by one space joins two lines. */
const unfold = (s: string) => s.replace(/\r\n /g, "");
/** A property of the VEVENT (METHOD lives on the VCALENDAR; the VTIMEZONE has its own DTSTART). */
const prop = (ics: string, name: string) => {
  const all = unfold(ics).split("\r\n");
  const from = name === "METHOD" ? 0 : all.indexOf("BEGIN:VEVENT");
  return all.slice(from).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
};

describe("ep2 · ics — structure", () => {
  test("CRLF line endings only, and the file ends with CRLF", () => {
    const ics = buildIcs(base, "PUBLISH");
    assert.ok(ics.endsWith("\r\n"));
    assert.equal(/[^\r]\n/.test(ics), false, "a bare LF");
    assert.equal(/\r(?!\n)/.test(ics), false, "a bare CR");
    assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
    assert.ok(ics.includes("END:VEVENT\r\nEND:VCALENDAR\r\n"));
  });

  test("UID, DTSTAMP (UTC), SEQUENCE, METHOD and STATUS are present", () => {
    const ics = buildIcs(base, "PUBLISH");
    assert.equal(prop(ics, "UID"), `UID:${base.uid}`);
    assert.equal(prop(ics, "DTSTAMP"), "DTSTAMP:20261001T080000Z");
    assert.equal(prop(ics, "SEQUENCE"), "SEQUENCE:42");
    assert.equal(prop(ics, "METHOD"), "METHOD:PUBLISH");
    assert.equal(prop(ics, "STATUS"), "STATUS:CONFIRMED");
  });

  test("a cancellation is METHOD:CANCEL + STATUS:CANCELLED with the SAME UID", () => {
    const ics = buildIcs({ ...base, sequence: 43 }, "CANCEL");
    assert.equal(prop(ics, "METHOD"), "METHOD:CANCEL");
    assert.equal(prop(ics, "STATUS"), "STATUS:CANCELLED");
    assert.equal(prop(ics, "UID"), `UID:${base.uid}`);
    assert.equal(icsContentType("CANCEL"), "text/calendar; charset=utf-8; method=CANCEL");
  });
});

describe("ep2 · ics — Africa/Tunis", () => {
  test("times are Tunis wall clock with TZID, and the VTIMEZONE says +0100", () => {
    const ics = buildIcs(base, "PUBLISH");
    assert.equal(prop(ics, "DTSTART"), "DTSTART;TZID=Africa/Tunis:20261002T180000");
    assert.equal(prop(ics, "DTEND"), "DTEND;TZID=Africa/Tunis:20261002T193000"); // + 90 min
    assert.ok(ics.includes("BEGIN:VTIMEZONE\r\nTZID:Africa/Tunis\r\n"));
    assert.ok(ics.includes("TZOFFSETFROM:+0100\r\nTZOFFSETTO:+0100\r\n"));
  });

  test("a class at 00:30 Tunis lands on the Tunis day, not the UTC one", () => {
    const ics = buildIcs({ ...base, start: "2026-10-02T23:30:00.000Z", durationMin: 60 }, "PUBLISH");
    assert.equal(prop(ics, "DTSTART"), "DTSTART;TZID=Africa/Tunis:20261003T003000");
    assert.equal(prop(ics, "DTEND"), "DTEND;TZID=Africa/Tunis:20261003T013000");
  });

  test("a summer date is still UTC+1 (no DST in Tunisia since 2009)", () => {
    assert.equal(icsTunisLocal("2027-07-15T12:00:00.000Z"), "20270715T130000");
    assert.equal(icsUtc("2027-07-15T12:00:00.000Z"), "20270715T120000Z");
  });

  test("a missing duration falls back rather than producing a zero-length event", () => {
    const ics = buildIcs({ ...base, durationMin: 0 }, "PUBLISH");
    assert.notEqual(prop(ics, "DTEND"), "DTEND;TZID=Africa/Tunis:20261002T180000");
  });
});

describe("ep2 · ics — text and folding", () => {
  test("TEXT escaping: backslash, semicolon, comma, newline", () => {
    assert.equal(icsEscapeText("a;b,c\\d\ne"), "a\\;b\\,c\\\\d\\ne");
    assert.equal(icsEscapeText("x\r\ny"), "x\\ny");
  });

  test("control characters from user input are dropped (a tab becomes a space)", () => {
    assert.equal(icsEscapeText("A\u0000B\u0007C\tD\u007f"), "ABC D");
  });

  test("every physical line is at most 75 octets, and unfolding gives back the value", () => {
    const title = "مراجعة الرياضيات للباكالوريا — الدوال، الاشتقاق، التكامل، والأعداد المركبة مع تمارين محلولة";
    const ics = buildIcs({ ...base, summary: title }, "PUBLISH");
    for (const line of ics.split("\r\n")) {
      assert.ok(Buffer.byteLength(line, "utf8") <= 75, `${Buffer.byteLength(line, "utf8")} octets: ${line}`);
    }
    assert.equal(prop(ics, "SUMMARY"), `SUMMARY:${icsEscapeText(title)}`);
  });

  test("folding never cuts a multi-byte character", () => {
    const folded = icsFold("SUMMARY:" + "ع".repeat(80));
    for (const part of folded.split("\r\n")) {
      assert.equal(Buffer.from(part, "utf8").toString("utf8"), part);
      assert.ok(!part.includes("�"));
    }
    assert.equal(folded.replace(/\r\n /g, ""), "SUMMARY:" + "ع".repeat(80));
  });

  test("a short line is left alone", () => {
    assert.equal(icsFold("UID:x"), "UID:x");
  });

  test("the organizer's name is a quoted parameter", () => {
    const ics = buildIcs({ ...base, organizer: { name: 'Tnajem "x"', email: "support@tnajem.com" } }, "PUBLISH");
    assert.equal(prop(ics, "ORGANIZER"), 'ORGANIZER;CN="Tnajem x":mailto:support@tnajem.com');
  });
});

describe("ep2 · ics — SEQUENCE", () => {
  test("grows with the revision instant, never negative", () => {
    const a = icsSequence("2026-10-01T10:00:00.000Z");
    const b = icsSequence("2026-10-01T10:00:01.000Z");
    assert.ok(b > a);
    assert.equal(icsSequence("2020-01-01T00:00:00.000Z"), 0);
    assert.equal(icsSequence("not a date"), 0);
    assert.ok(icsSequence("2090-01-01T00:00:00.000Z") < 2 ** 31);
  });
});
