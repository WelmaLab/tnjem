import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, stopApp, seedTutor, login, call, type App } from "./support/fx";

/* Phase A · A18.16 (lane L5). The new-class form and POST /classes disagreed:
   title 80 vs 120, duration 240 vs 480, seats 200 vs 500 — so the server accepted
   what the form said was impossible, and the form refused what the server allowed.
   ONE zod schema in @tnajem/shared/class-input now holds the limits, imported by
   both. FOUNDER defaults: title 120, duration 240 min, seats 200. */

let app: App;
let cookie = "";
before(async () => {
  app = await startApp();
  const tutor = await seedTutor();
  cookie = await login(tutor.profileId);
});
after(async () => {
  await stopApp(app);
});

const inThreeDays = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
const post = (over: Record<string, unknown>) =>
  call(app, "POST", "/classes", cookie, {
    title: "Limites L5", scheduledAt: inThreeDays(), durationMin: 90, priceTnd: 20, seats: 10, isFreeFirst: false,
    ...over,
  });

describe("A18.16 — one set of limits, on both sides", () => {
  test("title: 120 accepted, 121 refused", async () => {
    assert.equal((await post({ title: "T".repeat(120) })).body.ok, true);
    const r = await post({ title: "T".repeat(121) });
    assert.equal(r.body.ok, false, r.raw);
    assert.equal(r.body.error, "title-too-long");
  });

  test("duration: 240 min accepted, 241 refused", async () => {
    assert.equal((await post({ durationMin: 240 })).body.ok, true);
    const r = await post({ durationMin: 241 });
    assert.equal(r.body.ok, false, r.raw);
    assert.equal(r.body.error, "invalid-duration");
  });

  test("seats: 200 accepted, 201 refused", async () => {
    assert.equal((await post({ seats: 200 })).body.ok, true);
    const r = await post({ seats: 201 });
    assert.equal(r.body.ok, false, r.raw);
    assert.equal(r.body.error, "invalid-seats");
  });

  test("the limits live in ONE schema, and the form imports it", async () => {
    const here = dirname(fileURLToPath(import.meta.url));

    const mod = (await import("@tnajem/shared/class-input").catch(() => ({}))) as Record<string, unknown>;
    assert.deepEqual(
      mod.CLASS_LIMITS && {
        titleMax: (mod.CLASS_LIMITS as Record<string, number>).titleMax,
        durationMax: (mod.CLASS_LIMITS as Record<string, number>).durationMax,
        seatsMax: (mod.CLASS_LIMITS as Record<string, number>).seatsMax,
      },
      { titleMax: 120, durationMax: 240, seatsMax: 200 },
      "FOUNDER defaults",
    );
    // espace prof v2 · phase 6: the form moved out of the page into its own component.
    const form = readFileSync(resolve(here, "../../web/components/dashboard/new-class/NewClassForm.tsx"), "utf8");
    assert.match(form, /from "@tnajem\/shared\/class-input"/, "the form imports the shared schema");
    const route = readFileSync(resolve(here, "../src/routes/classes.ts"), "utf8");
    assert.match(route, /from "@tnajem\/shared\/class-input"/, "POST /classes imports the shared schema");
  });
});
