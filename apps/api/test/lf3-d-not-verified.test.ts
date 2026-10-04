import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, stopApp, seedTutor, login, call, sql, type App } from "./support/fx";

/* live-fixes-3 · D2 — the page no longer offers « Publier » to an unverified prof
   (it reads « Enregistrer le brouillon » and keeps a local draft). That is a UI
   courtesy; THE GATE IS HERE. A crafted POST by a draft, pending or rejected tutor —
   a class or a fiche — still gets `not-verified` and writes nothing. Nothing covered
   this route-level refusal before (e2e/tutor.spec.ts only checks that the UI does
   not end up with a row). */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

const inFiveDays = () => new Date(Date.now() + 5 * 24 * 3600_000).toISOString();

const classBody = () => ({
  title: "Bac — dérivées", description: "Une séance de révision.", scheduledAt: inFiveDays(),
  durationMin: 90, priceTnd: 40, seats: 10, isFreeFirst: false,
});

describe("D2 · an unverified prof cannot publish, whatever the page sends", () => {
  for (const status of ["draft", "pending", "rejected"] as const) {
    test(`${status}: POST /classes → not-verified, no class written`, async () => {
      const tutor = await seedTutor({ status });
      const cookie = await login(tutor.profileId);
      const res = await call(app, "POST", "/classes", cookie, classBody());
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual({ ok: res.body.ok, error: res.body.error }, { ok: false, error: "not-verified" });
      const [n] = await sql<{ n: number }[]>`select count(*)::int n from classes where tutor_id = ${tutor.id}`;
      assert.equal(n.n, 0);
    });

    test(`${status}: POST /packs → not-verified, no fiche written`, async () => {
      const tutor = await seedTutor({ status });
      const cookie = await login(tutor.profileId);
      const res = await call(app, "POST", "/packs", cookie, { title: "Pack révision", meta: "42 pages", priceTnd: 8 });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual({ ok: res.body.ok, error: res.body.error }, { ok: false, error: "not-verified" });
      const [n] = await sql<{ n: number }[]>`select count(*)::int n from packs where tutor_id = ${tutor.id}`;
      assert.equal(n.n, 0);
    });
  }

  test("the same request by a VERIFIED prof is published (the refusal is the status, not the body)", async () => {
    const tutor = await seedTutor({ status: "verified" });
    const cookie = await login(tutor.profileId);
    const res = await call(app, "POST", "/classes", cookie, classBody());
    assert.equal(res.body.ok, true, res.raw);
    const [n] = await sql<{ n: number }[]>`select count(*)::int n from classes where tutor_id = ${tutor.id}`;
    assert.equal(n.n, 1);
  });
});
