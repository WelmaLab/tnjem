import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { objectStore } from "@tnajem/db";
import { MATERIAL_FILE_CSP } from "../src/routes/materials";
import { startApp, stopApp, seedTutor, seedProfile, login, sql, type App } from "./support/fx";

/* live-fixes-2 · D — the policy a material's bytes are served with.

   GET /materials/:id/file is the one API response a browser renders as a document
   (a student opens the PDF or the image in a tab). It keeps the API's baseline —
   default-src 'none', nothing may frame it — plus the inline styles Chrome's image
   viewer lays its page out with. The web route passes it through untouched
   (apps/web/next.config.mjs, pinned in apps/api/test/lf1-csp.test.ts);
   e2e/lf2-d-material-csp.spec.ts proves both ends in a browser. */

const PINNED = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

let app: App;
const keys: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  for (const k of keys) await objectStore().delete(k).catch(() => {});
  await stopApp(app); // the tutor rows cascade to their materials
});

async function seedFile(tutorId: string, visibility: "public" | "students"): Promise<string> {
  const id = randomUUID();
  const key = `materials/${tutorId}/lf2-d-${id}.png`;
  await objectStore().put(key, PNG);
  keys.push(key);
  await sql`insert into materials (id, tutor_id, kind, visibility, title, storage_path, file_name, mime, size_bytes)
            values (${id}, ${tutorId}, 'file', ${visibility}, 'LF2 D fiche', ${key}, 'fiche.png', 'image/png', ${PNG.length})`;
  return id;
}

describe("live-fixes-2 · D — a material file carries its own strict policy", () => {
  test("the pinned value: default-src 'none', inline styles for the viewer, never framed", () => {
    assert.equal(MATERIAL_FILE_CSP, PINNED);
    const directives = Object.fromEntries(MATERIAL_FILE_CSP.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(directives["default-src"], ["'none'"]);
    assert.equal(directives["script-src"], undefined, "no script, ever: default-src 'none' covers it");
    assert.equal(directives["sandbox"], undefined, "no sandbox: Chrome's PDF viewer must still open it");
  });

  test("GET /materials/:id/file serves the bytes inline with exactly that policy", async () => {
    const tutor = await seedTutor();
    const id = await seedFile(tutor.id, "public");
    const res = await app.inject({ method: "GET", url: `/materials/${id}/file` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-security-policy"], PINNED);
    assert.equal(res.headers["content-type"], "image/png");
    assert.match(String(res.headers["content-disposition"]), /^inline; filename="fiche\.png"$/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "DENY");
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(res.rawPayload.length, PNG.length);
  });

  test("a refusal is not a document: it keeps the API's baseline policy", async () => {
    const tutor = await seedTutor();
    const id = await seedFile(tutor.id, "students");
    const outsider = await seedProfile({ role: "student" });
    const res = await app.inject({ method: "GET", url: `/materials/${id}/file`, headers: { cookie: await login(outsider.id) } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
  });
});
