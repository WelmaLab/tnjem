import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderMessage } from "@tnajem/shared/notification-messages";
import {
  APP_TIME_ZONE,
  classWhen,
  parseScheduleInput,
  toWallInput,
  wallTimeToInstant,
  tunisWallTimeFromNow,
  formatShortDateTime,
  formatLongDate,
  formatNumericDate,
  monthLabel,
  vFutureDate,
} from "@tnajem/shared";

/* Every class time is Tunis time, whatever timezone the process runs in.

   These must pass with TZ=UTC, TZ=America/Sao_Paulo or TZ=Pacific/Kiritimati —
   the gate runs them under more than one. Before 15 Sept a UTC server showed a
   Tunis 18:00 class as "17:00", and a Tunis 00:30 class on the previous day. */

const processZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe(`Tunis time (this process runs in ${processZone})`, () => {
  test("the app zone is Africa/Tunis", () => {
    assert.equal(APP_TIME_ZONE, "Africa/Tunis");
  });

  test("17:00Z is 18:00 in Tunis, same day", () => {
    assert.deepEqual(classWhen("2026-09-20T17:00:00.000Z"), {
      starts_at: "2026-09-20T17:00:00.000Z",
      day: "20",
      month: "SEPT",
      time: "18:00",
    });
  });

  test("23:30Z rolls over to 00:30 the NEXT day in Tunis — and the next month", () => {
    const w = classWhen("2026-09-30T23:30:00.000Z");
    assert.equal(w.day, "1");
    assert.equal(w.month, "OCT");
    assert.equal(w.time, "00:30");
  });

  test("a datetime-local value is a Tunis wall time", () => {
    assert.equal(parseScheduleInput("2026-09-20T18:00")?.toISOString(), "2026-09-20T17:00:00.000Z");
    assert.equal(parseScheduleInput("2026-09-20T18:00:30")?.toISOString(), "2026-09-20T17:00:30.000Z");
    assert.equal(parseScheduleInput("2026-12-31T00:15")?.toISOString(), "2026-12-30T23:15:00.000Z");
  });

  test("an explicit instant or offset is taken as written", () => {
    assert.equal(parseScheduleInput("2026-09-20T17:00:00.000Z")?.toISOString(), "2026-09-20T17:00:00.000Z");
    assert.equal(parseScheduleInput("2026-09-20T20:00+03:00")?.toISOString(), "2026-09-20T17:00:00.000Z");
  });

  test("nonsense and impossible dates are refused, not rolled forward", () => {
    assert.equal(parseScheduleInput("2026-02-30T18:00"), null, "30 February");
    assert.equal(parseScheduleInput("2026-09-20T24:30"), null, "hour 24");
    assert.equal(parseScheduleInput("2026-09-20"), null, "a bare date names no time");
    assert.equal(parseScheduleInput("tomorrow"), null);
    assert.equal(parseScheduleInput(""), null);
  });

  test("a wall time skipped by Tunisia's last DST change (30 Mar 2008, 02:00→03:00) does not exist", () => {
    assert.equal(wallTimeToInstant({ year: 2008, month: 3, day: 30, hour: 2, minute: 30 }), null);
    assert.equal(wallTimeToInstant({ year: 2008, month: 3, day: 30, hour: 3, minute: 30 })?.toISOString(), "2008-03-30T01:30:00.000Z");
  });

  test("prefilling an input round-trips", () => {
    assert.equal(toWallInput("2026-09-20T17:00:00.000Z"), "2026-09-20T18:00");
    for (const iso of ["2026-01-01T00:00:00.000Z", "2026-09-30T23:30:00.000Z", "2027-06-15T11:05:00.000Z"]) {
      assert.equal(parseScheduleInput(toWallInput(iso))?.toISOString(), iso);
    }
  });

  test("vFutureDate reads a wall time in Tunis", () => {
    const future = toWallInput(Date.now() + 3 * 86_400_000);
    const v = vFutureDate(future, { field: "date" });
    assert.ok(v.ok);
    assert.equal(toWallInput(v.value), future);
    assert.deepEqual(vFutureDate("2026-02-30T18:00", { field: "date" }), { ok: false, error: "invalid-date" });
    assert.deepEqual(vFutureDate(toWallInput(Date.now() - 3_600_000), { field: "date" }), { ok: false, error: "date-in-past" });
  });

  test("the seed's '+2 days at 18:00' is 18:00 in Tunis, counted in Tunis days", () => {
    // 23:30Z on the 15th is already 00:30 on the 16th in Tunis, so +2 days is the 18th.
    assert.equal(tunisWallTimeFromNow(2, 18, 0, new Date("2026-09-15T23:30:00Z")).toISOString(), "2026-09-18T17:00:00.000Z");
  });

  test("notification and page dates are Tunis dates", () => {
    // A notification stores the instant and renders it in Tunis, in the reader's language (0040).
    const at = "2026-09-20T17:00:00.000Z";
    assert.match(renderMessage("classMoved", { classTitle: "X", at }, "fr").body, /20\/09\/2026 à 18:00/);
    assert.match(renderMessage("classMoved", { classTitle: "X", at }, "ar").body, /20\/09\/2026.*على.*18:00/);
    assert.match(formatLongDate("2026-09-30T23:30:00.000Z", "fr"), /^01 octobre 2026$/);
    assert.equal(formatNumericDate("2026-09-30T23:30:00.000Z"), "01/10/2026");
  });

  // espace prof v2 · phase 8: the message threads showed « 06:00 م » in Arabic.
  test("short date-times are 24 h in both languages (ar-TN defaults to 12 h)", () => {
    for (const locale of ["fr", "ar"] as const) {
      const s = formatShortDateTime("2026-09-20T17:00:00.000Z", locale);
      assert.match(s, /18:00/, `${locale}: ${s}`);
      assert.doesNotMatch(s, /[صم]$|AM|PM|06:00/, `${locale}: ${s}`);
    }
  });

  test("month keys have Arabic labels, and French passes through", () => {
    assert.equal(monthLabel("JUIN", "ar"), "جوان");
    assert.equal(monthLabel("SEPT", "ar"), "سبتمبر");
    assert.equal(monthLabel("SEPT", "fr"), "SEPT");
    assert.equal(monthLabel("???", "ar"), "???");
  });
});
