import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reviewEligibility } from "@tnajem/shared";

/* espace prof v2 · pro (P7) — the one review rule. POST /reviews and the
   review-prompt cron both call it, so the prompt never invites a refusal. */

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const MIN = 60_000;
const at = (m: number) => new Date(NOW + m * MIN);

describe("ep2 · reviewEligibility", () => {
  test("a live booking on a class that ended → ok", () => {
    assert.deepEqual(reviewEligibility({ bookingStatus: "reserved", scheduledAt: at(-200), durationMin: 90 }, NOW), { ok: true });
    assert.deepEqual(reviewEligibility({ bookingStatus: "attended", scheduledAt: at(-200), durationMin: 90 }, NOW), { ok: true });
  });

  test("no booking, or a cancelled one → not-booked", () => {
    assert.deepEqual(reviewEligibility({ bookingStatus: null, scheduledAt: at(-200) }, NOW), { ok: false, error: "not-booked" });
    assert.deepEqual(reviewEligibility({ bookingStatus: "cancelled", scheduledAt: at(-200) }, NOW), { ok: false, error: "not-booked" });
  });

  test("a class that was called off → not-booked, whatever the booking row says", () => {
    assert.deepEqual(
      reviewEligibility({ bookingStatus: "reserved", classStatus: "cancelled", scheduledAt: at(-200) }, NOW),
      { ok: false, error: "not-booked" },
    );
  });

  test("not started → class-not-started; in progress → class-not-ended", () => {
    assert.deepEqual(reviewEligibility({ bookingStatus: "reserved", scheduledAt: at(30), durationMin: 60 }, NOW), { ok: false, error: "class-not-started" });
    assert.deepEqual(reviewEligibility({ bookingStatus: "reserved", scheduledAt: at(-30), durationMin: 60 }, NOW), { ok: false, error: "class-not-ended" });
  });

  test("a missing duration counts as 90 minutes, not zero", () => {
    assert.deepEqual(reviewEligibility({ bookingStatus: "reserved", scheduledAt: at(-60), durationMin: null }, NOW), { ok: false, error: "class-not-ended" });
    assert.deepEqual(reviewEligibility({ bookingStatus: "reserved", scheduledAt: at(-91), durationMin: 0 }, NOW), { ok: true });
  });
});
