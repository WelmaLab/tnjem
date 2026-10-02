import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedTutor, login, call, sql, type App } from "./support/fx";

/* espace prof v2 · shell (phase 6) — « Partager juste après la publication »: POST
   /classes answers the new class's `id` (added in P3), and the P6 form shares that
   class's link on the spot. The id is the row it just inserted, owned by the
   caller; a refused publish carries none. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

describe("POST /classes answers the new class's id", () => {
  test("the id is the inserted row, the caller's own", async () => {
    const t = await seedTutor();
    const cookie = await login(t.profileId);
    const title = `P6 classId ${Date.now().toString(36)}`;
    const res = await call(app, "POST", "/classes", cookie, {
      title, scheduledAt: inThreeDays(), durationMin: 60, priceTnd: 15, seats: 6, isFreeFirst: false,
    });
    assert.equal(res.body.ok, true, res.raw);
    assert.match(String(res.body.id), /^[0-9a-f-]{36}$/);
    const [row] = await sql<{ title: string; tutor_id: string; seats: number; duration_min: number }[]>`
      select title, tutor_id, seats, duration_min from classes where id = ${res.body.id}`;
    assert.equal(row.title, title);
    assert.equal(row.tutor_id, t.id);
    assert.equal(row.seats, 6);
    assert.equal(row.duration_min, 60);
  });

  test("a refused publish carries no id", async () => {
    const t = await seedTutor();
    const cookie = await login(t.profileId);
    const res = await call(app, "POST", "/classes", cookie, {
      title: "P6 refusé", scheduledAt: inThreeDays(), durationMin: 90, priceTnd: 15, seats: 201, isFreeFirst: false,
    });
    assert.equal(res.body.ok, false, res.raw);
    assert.equal(res.body.id, undefined);
  });
});
