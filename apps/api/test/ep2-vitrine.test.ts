import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, fxClientIp, type App,
} from "./support/fx";
import { runGrowthJobs } from "../src/lib/growth-cron";
import { db } from "../src/db";

/* Espace prof v2 · Phase 3 — vitrine statistics.

   "Vues · Clics · Abonnés", privacy-safe: an aggregate per (tutor, day, source),
   no IP and no user agent stored anywhere, utm_source analytics-only, the owner's
   own visits not counted, one address counted once per window. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

async function hit(body: Record<string, unknown>, ip: string, cookie?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/vitrine/hit",
    payload: body,
    remoteAddress: ip,
    headers: { "user-agent": "Mozilla/5.0 (Linux; Android 13) ep2-test", ...(cookie ? { cookie } : {}) },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

async function rows(tutorId: string) {
  // Spread: postgres.js returns a Result (an Array subclass) that deepEqual will not match to [].
  return [...(await sql<{ source: string; views: number; clicks: number }[]>`
    select source, views, clicks from vitrine_stats_daily where tutor_id = ${tutorId} order by source`)];
}

describe("P3 · POST /vitrine/hit", () => {
  test("a profile view via a shared WhatsApp link counts one view and one click under 'whatsapp'", async () => {
    const tutor = await seedTutor();
    const r = await hit({ slug: tutor.slug, source: "whatsapp" }, fxClientIp());
    assert.deepEqual(r.body, { ok: true });
    assert.deepEqual(await rows(tutor.id), [{ source: "whatsapp", views: 1, clicks: 1 }]);
  });

  test("a plain visit is a view under 'direct', not a click", async () => {
    const tutor = await seedTutor();
    await hit({ slug: tutor.slug }, fxClientIp());
    assert.deepEqual(await rows(tutor.id), [{ source: "direct", views: 1, clicks: 0 }]);
  });

  test("the same address counts once per window; another address counts again", async () => {
    const tutor = await seedTutor();
    const ip = fxClientIp();
    await hit({ slug: tutor.slug, source: "qr" }, ip);
    await hit({ slug: tutor.slug, source: "qr" }, ip);
    await hit({ slug: tutor.slug, source: "qr" }, ip);
    assert.deepEqual(await rows(tutor.id), [{ source: "qr", views: 1, clicks: 1 }]);
    await hit({ slug: tutor.slug, source: "qr" }, fxClientIp());
    assert.deepEqual(await rows(tutor.id), [{ source: "qr", views: 2, clicks: 2 }]);
  });

  test("a class page reached through a shared link is a click (not a profile view); a direct class visit is nothing", async () => {
    const tutor = await seedTutor();
    const klass = await seedClass({ tutorId: tutor.id });
    await hit({ slug: tutor.slug, classId: klass.id, source: "telegram" }, fxClientIp());
    await hit({ slug: tutor.slug, classId: klass.id }, fxClientIp());
    assert.deepEqual(await rows(tutor.id), [{ source: "telegram", views: 0, clicks: 1 }]);
  });

  test("a class of ANOTHER tutor is refused silently (a crafted pair)", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const klass = await seedClass({ tutorId: other.id });
    await hit({ slug: tutor.slug, classId: klass.id, source: "x" }, fxClientIp());
    assert.deepEqual(await rows(tutor.id), []);
    assert.deepEqual(await rows(other.id), []);
  });

  test("utm_source is a closed vocabulary: anything unknown is stored as 'other', never as typed", async () => {
    const tutor = await seedTutor();
    await hit({ slug: tutor.slug, source: "<script>alert(1)</script>" }, fxClientIp());
    await hit({ slug: tutor.slug, source: "amine@example.com" }, fxClientIp());
    assert.deepEqual(await rows(tutor.id), [{ source: "other", views: 2, clicks: 2 }]);
  });

  test("an unverified tutor's page is not online — nothing is counted", async () => {
    const tutor = await seedTutor({ status: "pending" });
    const r = await hit({ slug: tutor.slug, source: "whatsapp" }, fxClientIp());
    assert.deepEqual(r.body, { ok: true }, "the answer never says why");
    assert.deepEqual(await rows(tutor.id), []);
  });

  test("the owner looking at their own page is not counted", async () => {
    const tutor = await seedTutor();
    await hit({ slug: tutor.slug, source: "whatsapp" }, fxClientIp(), await login(tutor.profileId));
    assert.deepEqual(await rows(tutor.id), []);
  });

  test("a malformed body is a 400; a bad slug is a quiet no-op", async () => {
    const res = await app.inject({ method: "POST", url: "/vitrine/hit", payload: { slug: 42 }, remoteAddress: fxClientIp() });
    assert.equal(res.statusCode, 400);
    const r = await hit({ slug: "Not A Slug!" }, fxClientIp());
    assert.deepEqual(r.body, { ok: true });
  });

  test("NO IP AND NO USER AGENT ARE STORED: the table has no column for them, and no row or limiter key holds the address", async () => {
    const cols = await sql<{ c: string }[]>`
      select column_name as c from information_schema.columns
       where table_schema = 'public' and table_name = 'vitrine_stats_daily' order by ordinal_position`;
    assert.deepEqual(cols.map((r) => r.c), ["tutor_id", "day", "source", "views", "clicks"]);

    const tutor = await seedTutor();
    const ip = fxClientIp();
    await hit({ slug: tutor.slug, source: "linkedin" }, ip);
    const [dump] = await sql<{ j: string }[]>`
      select coalesce(json_agg(v)::text, '') as j from vitrine_stats_daily v where tutor_id = ${tutor.id}`;
    assert.ok(!dump.j.includes(ip), "the stats row does not contain the address");
    assert.ok(!dump.j.includes("ep2-test"), "nor the user agent");
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from rate_limits where key like 'vitrine:%' and key like ${`%${ip}%`}`;
    assert.equal(n, 0, "the limiter keys are keyed HMACs, never the address in clear");
  });
});

describe("P3 · GET /vitrine/stats", () => {
  test("the owner reads totals, per-source and per-day for the last 30 days", async () => {
    const tutor = await seedTutor();
    await hit({ slug: tutor.slug, source: "whatsapp" }, fxClientIp());
    await hit({ slug: tutor.slug, source: "whatsapp" }, fxClientIp());
    await hit({ slug: tutor.slug }, fxClientIp());
    // A row older than the window must not count.
    await sql`insert into vitrine_stats_daily (tutor_id, day, source, views, clicks)
              values (${tutor.id}, (now() at time zone 'Africa/Tunis')::date - 45, 'facebook', 9, 9)`;

    const res = await call(app, "GET", "/vitrine/stats", await login(tutor.profileId));
    assert.equal(res.body.ok, true, res.raw);
    assert.equal(res.body.days, 30);
    assert.deepEqual(res.body.totals, { views: 3, clicks: 2 });
    assert.deepEqual(res.body.bySource, [
      { source: "whatsapp", views: 2, clicks: 2 },
      { source: "direct", views: 1, clicks: 0 },
    ]);
    assert.equal(res.body.daily.length, 1);
    assert.match(res.body.since, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("zero is an honest zero", async () => {
    const tutor = await seedTutor();
    const res = await call(app, "GET", "/vitrine/stats?days=7", await login(tutor.profileId));
    assert.equal(res.body.days, 7);
    assert.deepEqual(res.body.totals, { views: 0, clicks: 0 });
    assert.deepEqual(res.body.bySource, []);
  });

  test("signed out, a student, or a tutor with no page get a refusal — never someone else's numbers", async () => {
    assert.deepEqual((await call(app, "GET", "/vitrine/stats", null)).body, { ok: false, error: "not-authenticated" });
    const student = await seedProfile({ role: "student" });
    assert.deepEqual((await call(app, "GET", "/vitrine/stats", await login(student.id))).body, { ok: false, error: "not-a-tutor" });
    const lone = await seedProfile({ role: "tutor" });
    assert.deepEqual((await call(app, "GET", "/vitrine/stats", await login(lone.id))).body, { ok: false, error: "no-storefront" });
  });
});

describe("P3 · nightly housekeeping", () => {
  test("rows older than the keep window are pruned; recent ones stay", async () => {
    const tutor = await seedTutor();
    await sql`insert into vitrine_stats_daily (tutor_id, day, source, views, clicks) values
      (${tutor.id}, (now() at time zone 'Africa/Tunis')::date - 500, 'direct', 1, 0),
      (${tutor.id}, (now() at time zone 'Africa/Tunis')::date - 2, 'direct', 1, 0)`;
    const run = await runGrowthJobs(db);
    assert.deepEqual(run.failedJobs, []);
    const left = await sql<{ n: number }[]>`select count(*)::int n from vitrine_stats_daily where tutor_id = ${tutor.id}`;
    assert.equal(left[0].n, 1);
  });
});
