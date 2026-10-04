import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_GRACE_REASON, CANCEL_FREE_WINDOW_MS, CANCEL_GRACE_MINUTES, CANCEL_GRACE_MIN_LEAD_MINUTES,
  FREE_FIRST_SPENT_REASON, bookingGraceEndsAt, cancelSpendsFreeFirst, cancellationOutcome,
  freeCancellationUntil, withinBookingGrace,
} from "@tnajem/shared";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App } from "./support/fx";

/* live-fixes-3 · C — a cancellation within 15 minutes of booking is free.

   Live case (4 Oct 2026): a student booked a class 30 h away, cancelled 30 seconds
   later, and 40 % (4 TND) was recorded as retained for the tutor while every page
   says « Sans engagement ». The rule now: free within CANCEL_GRACE_MINUTES of the
   booking (bookings.created_at, server time), whatever the time to the class —
   unless the class starts in less than CANCEL_GRACE_MIN_LEAD_MINUTES. Otherwise the
   48 h / 40 % rule, unchanged. Both boundaries inclusive. */

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const START = Date.parse("2026-10-10T17:00:00.000Z");

/** Cancel at START − startsIn, for a seat booked `bookedAgo` before that. */
function at(bookedAgo: number, startsIn: number, extra: { amountTnd?: number; waived?: boolean } = {}) {
  const now = START - startsIn;
  return cancellationOutcome({ scheduledAt: START, amountTnd: extra.amountTnd ?? 40, now, bookedAt: now - bookedAgo, waived: extra.waived });
}

describe("C · the grace, as a pure rule (@tnajem/shared/cancellation)", () => {
  test("the values are the founder's: 15 min after booking, not inside the last 15 min", () => {
    assert.equal(CANCEL_GRACE_MINUTES, 15);
    assert.equal(CANCEL_GRACE_MIN_LEAD_MINUTES, 15);
  });

  test("the live case — booked, cancelled 30 s later, class 30 h away: nothing retained", () => {
    const o = at(30 * S, 30 * H);
    assert.equal(o.late, true, "still reported truthfully: it was inside 48 h");
    assert.equal(o.grace, true);
    assert.equal(o.retainedPct, 0);
    assert.equal(o.retainedTnd, 0);
    assert.equal(o.releasedTnd, 40);
  });

  test("15:00 after the booking is still free; 15:00.001 and 15:01 are late", () => {
    assert.equal(at(15 * MIN, 30 * H).retainedTnd, 0, "inclusive, like the 48 h boundary");
    assert.equal(at(15 * MIN, 30 * H).grace, true);
    assert.equal(at(15 * MIN + 1, 30 * H).grace, false);
    assert.equal(at(15 * MIN + 1, 30 * H).retainedTnd, 16);
    assert.equal(at(15 * MIN + S * 60, 30 * H).retainedTnd, 16, "15:01");
  });

  test("the class starts in less than 15 min: no grace, even one minute after booking", () => {
    const o = at(1 * MIN, 15 * MIN - S); // 14:59 before the start
    assert.equal(o.grace, false);
    assert.equal(o.retainedTnd, 16);
    assert.equal(at(1 * MIN, 5 * MIN).retainedTnd, 16);
  });

  test("exactly 15 min before the start still gets the grace (inclusive)", () => {
    const o = at(1 * MIN, 15 * MIN);
    assert.equal(o.grace, true);
    assert.equal(o.retainedTnd, 0);
  });

  test("the grace never reaches into the last 15 min: booked 20 min before, free only until 15 min before", () => {
    const booked = START - 20 * MIN;
    assert.equal(bookingGraceEndsAt({ bookedAt: booked, scheduledAt: START }), START - 15 * MIN);
    assert.equal(withinBookingGrace({ bookedAt: booked, scheduledAt: START, now: START - 15 * MIN }), true);
    assert.equal(withinBookingGrace({ bookedAt: booked, scheduledAt: START, now: START - 15 * MIN + 1 }), false);
  });

  test("outside the 48 h window the grace changes nothing (free anyway) and is not reported", () => {
    const o = at(30 * S, 72 * H);
    assert.equal(o.late, false);
    assert.equal(o.grace, false);
    assert.equal(o.retainedTnd, 0);
  });

  test("no bookedAt → the rule as it was; an unparseable one never means free", () => {
    const now = START - 30 * H;
    assert.equal(cancellationOutcome({ scheduledAt: START, amountTnd: 40, now }).retainedTnd, 16);
    const bad = cancellationOutcome({ scheduledAt: START, amountTnd: 40, now, bookedAt: "not a date" });
    assert.equal(bad.grace, false);
    assert.equal(bad.retainedTnd, 16);
  });

  test("waived AND inside the grace: nothing retained either way", () => {
    const o = at(30 * S, 5 * H, { waived: true });
    assert.equal(o.retainedTnd, 0);
    assert.equal(o.retainedPct, 0);
  });

  test("freeCancellationUntil: the later of « 48 h before » and the end of the grace", () => {
    const booked = START - 30 * H;
    assert.equal(freeCancellationUntil({ bookedAt: booked, scheduledAt: START }), booked + 15 * MIN);
    const early = START - 72 * H;
    assert.equal(freeCancellationUntil({ bookedAt: early, scheduledAt: START }), START - CANCEL_FREE_WINDOW_MS);
  });

  test("a free seat cancelled inside the grace does not spend the free first session", () => {
    assert.equal(cancelSpendsFreeFirst({ actor: "student", wasFree: true, late: true, waived: false, grace: true }), false);
    assert.equal(cancelSpendsFreeFirst({ actor: "student", wasFree: true, late: true, waived: false, grace: false }), true);
  });
});

/* ── through the real routes ─────────────────────────────────────────────── */

let app: App;
const classIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (classIds.length) await sql`delete from cancellations where class_id in ${sql(classIds)}`;
  await stopApp(app);
});

type Cancelled = { ok: boolean; late: boolean; grace: boolean; retainedTnd: number; retainedPct: number; paymentsEnabled: boolean };
type LedgerRow = { late: boolean; amount_tnd: string; retained_tnd: string; released_tnd: string; retained_pct: string; reason: string | null; payments_enabled: boolean };

async function setup(opts: { minutesFromNow: number; freeFirst?: boolean }) {
  const tutor = await seedTutor({ offersFreeFirstSession: opts.freeFirst ?? false });
  const klass = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() + opts.minutesFromNow * MIN), isFreeFirst: opts.freeFirst ?? false });
  classIds.push(klass.id);
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  return { tutor, klass, student, cookie: await login(student.id) };
}

/** Books through POST /bookings, then sets how long ago that was (server-side). */
async function book(cookie: string, classId: string, studentId: string, secondsAgo = 0): Promise<string> {
  const res = await call(app, "POST", "/bookings", cookie, { classId });
  assert.equal(res.body?.ok, true, res.raw);
  const [row] = await sql<{ id: string }[]>`select id from bookings where class_id = ${classId} and student_id = ${studentId}`;
  if (secondsAgo) await sql`update bookings set created_at = now() - ${secondsAgo} * interval '1 second' where id = ${row.id}`;
  return row.id;
}

async function cancel(cookie: string, bookingId: string): Promise<Cancelled> {
  const res = await call(app, "POST", "/bookings/cancel", cookie, { bookingId });
  assert.equal(res.status, 200, res.raw);
  assert.equal(res.body.ok, true, res.raw);
  return res.body as Cancelled;
}

async function ledger(bookingId: string): Promise<LedgerRow[]> {
  return sql<LedgerRow[]>`
    select late, amount_tnd, retained_tnd, released_tnd, retained_pct, reason, payments_enabled
      from cancellations where booking_id = ${bookingId} order by cancelled_at`;
}

describe("C · POST /bookings/cancel applies the grace", () => {
  test("the live case: book → cancel 30 s later, class 30 h away → nothing retained, and the ledger says why", async () => {
    const s = await setup({ minutesFromNow: 30 * 60 });
    const id = await book(s.cookie, s.klass.id, s.student.id, 30);
    const out = await cancel(s.cookie, id);
    assert.equal(out.late, true);
    assert.equal(out.grace, true);
    assert.equal(out.retainedTnd, 0);
    assert.equal(out.retainedPct, 0);
    assert.equal(out.paymentsEnabled, false, "payments are off: nothing is ever charged");

    const [row] = await ledger(id);
    assert.ok(row, "a ledger row is written even when nothing is retained");
    assert.equal(row.late, true, "the facts are kept: inside 48 h");
    assert.equal(Number(row.amount_tnd), 40);
    assert.equal(Number(row.retained_tnd), 0);
    assert.equal(Number(row.released_tnd), 40);
    assert.equal(Number(row.retained_pct), 0);
    assert.equal(row.reason, BOOKING_GRACE_REASON);
    assert.equal(row.payments_enabled, false);
  });

  test("the boundary through the route: 14:55 after booking is free, 15:05 is 40 %", async () => {
    const a = await setup({ minutesFromNow: 30 * 60 });
    const inside = await book(a.cookie, a.klass.id, a.student.id, 14 * 60 + 55);
    const one = await cancel(a.cookie, inside);
    assert.equal(one.grace, true);
    assert.equal(one.retainedTnd, 0);

    const b = await setup({ minutesFromNow: 30 * 60 });
    const outside = await book(b.cookie, b.klass.id, b.student.id, 15 * 60 + 5);
    const two = await cancel(b.cookie, outside);
    assert.equal(two.late, true);
    assert.equal(two.grace, false);
    assert.equal(two.retainedTnd, 16, "40 % of 40");
    assert.equal(two.retainedPct, 0.4);
    const [row] = await ledger(outside);
    assert.equal(row.reason, null);
    assert.equal(Number(row.retained_tnd), 16);
  });

  test("the class starts in less than 15 min: cancelling right after booking still counts 40 %", async () => {
    const s = await setup({ minutesFromNow: 10 });
    const id = await book(s.cookie, s.klass.id, s.student.id);
    const out = await cancel(s.cookie, id);
    assert.equal(out.late, true);
    assert.equal(out.grace, false);
    assert.equal(out.retainedTnd, 16);
  });

  test("20 min before the start, right after booking: still free (the start is ≥ 15 min away)", async () => {
    const s = await setup({ minutesFromNow: 20 });
    const id = await book(s.cookie, s.klass.id, s.student.id);
    const out = await cancel(s.cookie, id);
    assert.equal(out.grace, true);
    assert.equal(out.retainedTnd, 0);
  });

  test("a free first seat cancelled inside the grace is NOT spent: the next free-first class is free again", async () => {
    const s = await setup({ minutesFromNow: 30 * 60, freeFirst: true });
    const id = await book(s.cookie, s.klass.id, s.student.id, 30);
    const [bk] = await sql<{ is_free: boolean }[]>`select is_free from bookings where id = ${id}`;
    assert.equal(bk.is_free, true);
    await cancel(s.cookie, id);
    const [row] = await ledger(id);
    assert.equal(row.reason, BOOKING_GRACE_REASON);
    assert.notEqual(row.reason, FREE_FIRST_SPENT_REASON);

    const next = await seedClass({ tutorId: s.tutor.id, hoursFromNow: 72, isFreeFirst: true });
    classIds.push(next.id);
    await book(s.cookie, next.id, s.student.id);
    const [again] = await sql<{ is_free: boolean }[]>`
      select is_free from bookings where class_id = ${next.id} and student_id = ${s.student.id}`;
    assert.equal(again.is_free, true, "the free first session came back");
  });

  test("the tutor is not told « annulation tardive » for a cancellation inside the grace", async () => {
    const s = await setup({ minutesFromNow: 30 * 60 });
    const id = await book(s.cookie, s.klass.id, s.student.id, 30);
    await cancel(s.cookie, id);
    const rows = await sql<{ msg_params: { late?: boolean } | null }[]>`
      select msg_params from notifications
       where profile_id = ${s.tutor.profileId} and msg_key = 'bookingCancelledByStudent'`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].msg_params?.late, false);
    await sql`delete from notifications where profile_id = ${s.tutor.profileId}`;
  });

  test("the student dashboard carries when the seat was booked (the confirm box states the grace from it)", async () => {
    const s = await setup({ minutesFromNow: 30 * 60 });
    const id = await book(s.cookie, s.klass.id, s.student.id, 60);
    const res = await call(app, "GET", "/student/dashboard", s.cookie);
    const item = res.body.upcoming.find((i: { bookingId: string }) => i.bookingId === id) as { bookedAt?: number };
    assert.ok(item, res.raw);
    assert.equal(typeof item.bookedAt, "number");
    const [row] = await sql<{ ms: string }[]>`select (extract(epoch from created_at) * 1000)::bigint::text ms from bookings where id = ${id}`;
    assert.ok(Math.abs((item.bookedAt ?? 0) - Number(row.ms)) <= 1, `${item.bookedAt} vs ${row.ms}`);
  });
});
