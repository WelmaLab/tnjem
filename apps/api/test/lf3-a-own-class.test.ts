import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startState, START_WINDOW_MIN } from "@tnajem/shared/live";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, type App } from "./support/fx";

/* live-fixes-3 · A — the tutor's way into their own class.

   Live, 4 Oct: nothing in the prof space linked to /live/<id>, the tutor's own class
   page offered them « Réserver cette séance », and the checkout answered the refusal
   (`own-class`) with « Réessaie ». Two server-side pieces carry the fix:

     • startState() — when « Démarrer la séance » shows, and when it is THE action;
     • GET /classes/:id → viewer_is_owner, true for the signed-in owner ONLY, which the
       class page (owner panel instead of the CTA) and /checkout (redirect to
       /live/<id>) read. */

const MIN = 60_000;
const at = (startMs: number, durationMin = 90, status = "scheduled") => ({
  starts_at: new Date(startMs).toISOString(),
  duration_min: durationMin,
  status,
});

describe("startState — « Démarrer la séance »: soon, open, over", () => {
  const start = Date.parse("2026-10-05T17:00:00.000Z");

  test("more than 30 min before the start: offered, but not yet the main action", () => {
    assert.equal(START_WINDOW_MIN, 30);
    assert.equal(startState(at(start), start - 3 * 24 * 60 * MIN), "soon");
    assert.equal(startState(at(start), start - 31 * MIN), "soon");
  });

  test("from 30 min before the start until the real end: open", () => {
    assert.equal(startState(at(start), start - 30 * MIN), "open", "the boundary is inclusive");
    assert.equal(startState(at(start), start), "open");
    assert.equal(startState(at(start, 45), start + 44 * MIN), "open", "the class's own duration, not 90");
  });

  test("ended, cancelled or done: no button", () => {
    assert.equal(startState(at(start, 45), start + 45 * MIN), "over");
    assert.equal(startState(at(start), start + 90 * MIN), "over");
    assert.equal(startState(at(start, 90, "cancelled"), start - 60 * MIN), "over");
    assert.equal(startState(at(start, 90, "done"), start - 60 * MIN), "over");
    assert.equal(startState({ starts_at: "not a date" }, start), "over");
  });

  test("a missing duration is the column default (90 min), never zero", () => {
    const cls = { starts_at: new Date(start).toISOString(), duration_min: null };
    assert.equal(startState(cls, start + 89 * MIN), "open");
    assert.equal(startState(cls, start + 90 * MIN), "over");
  });
});

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

describe("GET /classes/:id — viewer_is_owner", () => {
  test("true for the owning tutor; false for a guest, a stranger and a booked student", async () => {
    const owner = await seedProfile({ role: "tutor", fullName: "Walid Tester" });
    const tutor = await seedTutor({ profileId: owner.id, fullName: "Walid Tester" });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    const booked = await seedProfile({ role: "student" });
    await seedBooking({ classId: klass.id, studentId: booked.id });
    const stranger = await seedProfile({ role: "student" });
    const otherTutor = await seedTutor({});

    const asOwner = await call(app, "GET", `/classes/${klass.id}`, await login(owner.id));
    assert.equal(asOwner.status, 200, asOwner.raw);
    assert.equal(asOwner.body.viewer_is_owner, true, asOwner.raw);

    for (const [who, cookie] of [
      ["a guest", null],
      ["a stranger", await login(stranger.id)],
      ["a booked student", await login(booked.id)],
      ["another tutor", await login(otherTutor.profileId)],
    ] as const) {
      const res = await call(app, "GET", `/classes/${klass.id}`, cookie);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.viewer_is_owner, false, `${who}: ${res.raw}`);
    }
  });

  test("the owner booking their own class is refused as `own-class` — the code the checkout now names", async () => {
    const owner = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: owner.id });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    const res = await call(app, "POST", "/bookings", await login(owner.id), { classId: klass.id });
    assert.deepEqual(res.body, { ok: false, error: "own-class" }, res.raw);
  });
});
