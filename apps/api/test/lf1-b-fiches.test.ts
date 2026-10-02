import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeFiches, type FicheMaterialRow, type FichePackRow } from "@tnajem/shared";
import { startApp, stopApp, seedTutor, seedClass, seedProfile, login, call, sql, type App } from "./support/fx";

/* live-fixes-1 · B — « Mes fiches ».

   A pack and its file are ONE fiche (packs.material_id, 0041): POST /packs ties them
   (the caller's own live material, not another fiche's), GET /fiches/mine lists them
   merged, and a fiche is edited and removed through routes that check the role, the
   OWNERSHIP of the row (another tutor's id is not-found) and the same validators and
   contact rule as on creation. Removing a listed fiche removes its file too (soft). */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

async function seedMaterial(tutorId: string, title: string, opts: { classId?: string | null; kind?: "file" | "youtube"; createdAt?: Date } = {}): Promise<string> {
  const kind = opts.kind ?? "youtube";
  const [row] = await sql<{ id: string }[]>`
    insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id, storage_path, file_name, mime, size_bytes, created_at)
    values (${tutorId}, ${opts.classId ?? null}, ${kind}, 'students', ${title},
            ${kind === "youtube" ? "dQw4w9WgXcQ" : null},
            ${kind === "file" ? `materials/${tutorId}/lf1-${title}.pdf` : null},
            ${kind === "file" ? "fiche.pdf" : null}, ${kind === "file" ? "application/pdf" : null},
            ${kind === "file" ? 1234 : null}, ${(opts.createdAt ?? new Date()).toISOString()})
    returning id`;
  return row.id;
}

async function seedPack(tutorId: string, title: string, opts: { materialId?: string | null; price?: number; createdAt?: Date } = {}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into packs (tutor_id, title, description, price_tnd, material_id, created_at)
    values (${tutorId}, ${title}, '12 pages', ${String(opts.price ?? 18)}, ${opts.materialId ?? null}, ${(opts.createdAt ?? new Date()).toISOString()})
    returning id`;
  return row.id;
}

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe("mergeFiches — one row per fiche", () => {
  const mat = (id: string, over: Partial<FicheMaterialRow> = {}): FicheMaterialRow => ({
    id, kind: "file", visibility: "students", title: `m-${id}`, description: null, classId: null,
    fileName: "f.pdf", mime: "application/pdf", sizeBytes: 10, youtubeId: null, createdAt: iso(1000), ...over,
  });
  const pack = (id: string, materialId: string | null, over: Partial<FichePackRow> = {}): FichePackRow => ({
    id, title: `p-${id}`, description: "42 pages", priceTnd: 18, materialId, createdAt: iso(500), ...over,
  });

  test("a pack and its material are one fiche; an unpaired material is a library item with no price", () => {
    const out = mergeFiches([pack("p1", "m1")], [mat("m1", { classId: "k1" }), mat("m2", { kind: "youtube", fileName: null, youtubeId: "abcdefghijk", createdAt: iso(100) })]);
    assert.equal(out.length, 2);
    const [lib, listed] = out; // newest first
    assert.equal(lib.key, "material:m2");
    assert.equal(lib.priceTnd, null);
    assert.equal(lib.source, "youtube");
    assert.equal(listed.key, "pack:p1");
    assert.equal(listed.materialId, "m1");
    assert.equal(listed.priceTnd, 18);
    assert.equal(listed.source, "file");
    assert.equal(listed.classId, "k1", "the file's class is the fiche's class");
    assert.equal(listed.title, "p-p1", "the pack's title wins");
  });

  test("a pack whose material is gone (removed) shows with no file; a pack with no material too", () => {
    const out = mergeFiches([pack("p1", "gone"), pack("p2", null, { createdAt: iso(10) })], []);
    assert.deepEqual(out.map((f) => [f.key, f.source, f.materialId]), [["pack:p2", null, null], ["pack:p1", null, null]]);
  });

  test("a blank detail reads as none", () => {
    const [f] = mergeFiches([pack("p1", null, { description: "  " })], []);
    assert.equal(f.detail, null);
  });
});

describe("GET /fiches/mine", () => {
  test("the tutor's own fiches, merged, with their classes (cancelled flagged); nobody else's", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const k1 = await seedClass({ tutorId: tutor.id, hoursFromNow: 48 });
    const k2 = await seedClass({ tutorId: tutor.id, hoursFromNow: 72 });
    await sql`update classes set status = 'cancelled' where id = ${k2.id}`;
    const m1 = await seedMaterial(tutor.id, "LF1 fiche fichier", { kind: "file", classId: k1.id });
    const p1 = await seedPack(tutor.id, "LF1 fiche fichier", { materialId: m1 });
    const lib = await seedMaterial(tutor.id, "LF1 corrigé vidéo");
    await seedPack(other.id, "LF1 not mine");

    const res = await call(app, "GET", "/fiches/mine", await login(tutor.profileId));
    assert.equal(res.body.ok, true, res.raw);
    const keys = res.body.fiches.map((f: { key: string }) => f.key).sort();
    assert.deepEqual(keys, [`material:${lib}`, `pack:${p1}`].sort());
    const listed = res.body.fiches.find((f: { key: string }) => f.key === `pack:${p1}`);
    assert.equal(listed.materialId, m1);
    assert.equal(listed.classId, k1.id);
    assert.equal(listed.fileName, "fiche.pdf");
    assert.equal(res.body.verified, true);
    const cancelled = res.body.classes.find((k: { id: string }) => k.id === k2.id);
    assert.equal(cancelled.cancelled, true);
    assert.equal(res.body.classes.find((k: { id: string }) => k.id === k1.id).cancelled, false);
  });

  test("a student and a guest get nothing", async () => {
    const student = await seedProfile({ role: "student" });
    assert.equal((await call(app, "GET", "/fiches/mine", await login(student.id))).body, null);
    assert.equal((await call(app, "GET", "/fiches/mine", null)).body, null);
  });
});

describe("POST /packs — tied to its file", () => {
  test("the caller's own live material is linked; another tutor's, a removed one or an already-linked one is refused", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const cookie = await login(tutor.profileId);
    const mine = await seedMaterial(tutor.id, "LF1 pack file", { kind: "file" });
    const ok = await call(app, "POST", "/packs", cookie, { title: "LF1 pack file", meta: "", priceTnd: 12, materialId: mine });
    assert.equal(ok.body.ok, true, ok.raw);
    const [row] = await sql<{ material_id: string | null }[]>`select material_id from packs where id = ${ok.body.id}`;
    assert.equal(row.material_id, mine);

    const again = await call(app, "POST", "/packs", cookie, { title: "LF1 second", priceTnd: 1, materialId: mine });
    assert.deepEqual(again.body, { ok: false, error: "material-already-linked" });

    const theirs = await seedMaterial(other.id, "LF1 theirs", { kind: "file" });
    assert.deepEqual((await call(app, "POST", "/packs", cookie, { title: "LF1 steal", priceTnd: 1, materialId: theirs })).body, { ok: false, error: "not-found" });

    const removed = await seedMaterial(tutor.id, "LF1 removed", { kind: "file" });
    await sql`update materials set removed_at = now() where id = ${removed}`;
    assert.deepEqual((await call(app, "POST", "/packs", cookie, { title: "LF1 removed", priceTnd: 1, materialId: removed })).body, { ok: false, error: "not-found" });
    assert.deepEqual((await call(app, "POST", "/packs", cookie, { title: "LF1 junk", priceTnd: 1, materialId: "nope" })).body, { ok: false, error: "not-found" });
  });

  test("without a materialId nothing changes: a pack with no file", async () => {
    const tutor = await seedTutor();
    const res = await call(app, "POST", "/packs", await login(tutor.profileId), { title: "LF1 bare pack", priceTnd: 0 });
    assert.equal(res.body.ok, true, res.raw);
    const [row] = await sql<{ material_id: string | null }[]>`select material_id from packs where id = ${res.body.id}`;
    assert.equal(row.material_id, null);
  });
});

describe("POST /packs/:id/update", () => {
  test("the owner edits title, detail, price; the file follows the title and takes the class", async () => {
    const tutor = await seedTutor();
    const k = await seedClass({ tutorId: tutor.id });
    const m = await seedMaterial(tutor.id, "LF1 old", { kind: "file" });
    const p = await seedPack(tutor.id, "LF1 old", { materialId: m });
    const res = await call(app, "POST", `/packs/${p}/update`, await login(tutor.profileId), {
      title: "LF1 new title", meta: "30 pages", priceTnd: 25.5, classId: k.id,
    });
    assert.equal(res.body.ok, true, res.raw);
    assert.deepEqual(res.body.revalidate, { tutors: [tutor.slug] }, "the public page drops its cache");
    const [pk] = await sql<{ title: string; description: string; price_tnd: string }[]>`select title, description, price_tnd from packs where id = ${p}`;
    assert.deepEqual([pk.title, pk.description, Number(pk.price_tnd)], ["LF1 new title", "30 pages", 25.5]);
    const [mt] = await sql<{ title: string; class_id: string | null }[]>`select title, class_id from materials where id = ${m}`;
    assert.deepEqual([mt.title, mt.class_id], ["LF1 new title", k.id]);
  });

  test("the creation rules apply: title ≥ 3, price ≤ 5000, no contact info", async () => {
    const tutor = await seedTutor();
    const cookie = await login(tutor.profileId);
    const p = await seedPack(tutor.id, "LF1 rules");
    assert.equal((await call(app, "POST", `/packs/${p}/update`, cookie, { title: "ab", priceTnd: 1 })).body.error, "invalid-title");
    assert.equal((await call(app, "POST", `/packs/${p}/update`, cookie, { title: "LF1 ok", priceTnd: 6000 })).body.error, "price-too-high");
    assert.equal((await call(app, "POST", `/packs/${p}/update`, cookie, { title: "LF1 ok", priceTnd: -1 })).body.error, "negative-price");
    assert.equal(
      (await call(app, "POST", `/packs/${p}/update`, cookie, { title: "WhatsApp 22123456", priceTnd: 1 })).body.error,
      "contact-info-not-allowed",
    );
    assert.equal((await call(app, "POST", `/packs/${p}/update`, cookie, { title: 3, priceTnd: 1 })).status, 400);
    const [pk] = await sql<{ title: string }[]>`select title from packs where id = ${p}`;
    assert.equal(pk.title, "LF1 rules", "nothing was written");
  });

  test("another tutor's pack, another tutor's class, a student, a guest: refused", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const theirs = await seedPack(other.id, "LF1 theirs");
    const mine = await seedPack(tutor.id, "LF1 mine", { materialId: await seedMaterial(tutor.id, "LF1 mine") });
    const theirClass = await seedClass({ tutorId: other.id });
    const cookie = await login(tutor.profileId);
    assert.deepEqual((await call(app, "POST", `/packs/${theirs}/update`, cookie, { title: "LF1 hijack", priceTnd: 1 })).body, { ok: false, error: "not-found" });
    assert.deepEqual((await call(app, "POST", `/packs/${mine}/update`, cookie, { title: "LF1 mine", priceTnd: 1, classId: theirClass.id })).body, { ok: false, error: "not-found" });
    const student = await seedProfile({ role: "student" });
    assert.deepEqual((await call(app, "POST", `/packs/${mine}/update`, await login(student.id), { title: "LF1 x", priceTnd: 1 })).body, { ok: false, error: "not-a-tutor" });
    assert.deepEqual((await call(app, "POST", `/packs/${mine}/update`, null, { title: "LF1 x", priceTnd: 1 })).body, { ok: false, error: "not-authenticated" });
    const [pk] = await sql<{ title: string }[]>`select title from packs where id = ${theirs}`;
    assert.equal(pk.title, "LF1 theirs");
  });
});

describe("POST /packs/:id/delete", () => {
  test("the fiche leaves the page and its file is removed (soft); another tutor cannot", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const m = await seedMaterial(tutor.id, "LF1 bye", { kind: "file" });
    const p = await seedPack(tutor.id, "LF1 bye", { materialId: m });
    assert.deepEqual((await call(app, "POST", `/packs/${p}/delete`, await login(other.profileId))).body, { ok: false, error: "not-found" });
    assert.equal((await sql`select 1 from packs where id = ${p}`).length, 1, "still there");

    const res = await call(app, "POST", `/packs/${p}/delete`, await login(tutor.profileId));
    assert.equal(res.body.ok, true, res.raw);
    assert.equal((await sql`select 1 from packs where id = ${p}`).length, 0);
    const [mt] = await sql<{ removed_at: Date | null; removed_reason: string | null }[]>`select removed_at, removed_reason from materials where id = ${m}`;
    assert.ok(mt.removed_at, "the file is removed with its fiche");
    assert.equal(mt.removed_reason, "removed-by-tutor");
  });
});

describe("POST /materials/:id/update", () => {
  test("the owner edits a library item: title, description, who may open it, class", async () => {
    const tutor = await seedTutor();
    const k = await seedClass({ tutorId: tutor.id });
    const m = await seedMaterial(tutor.id, "LF1 lib");
    const cookie = await login(tutor.profileId);
    const res = await call(app, "POST", `/materials/${m}/update`, cookie, { title: "LF1 lib v2", description: "corrigé", visibility: "private", classId: k.id });
    assert.equal(res.body.ok, true, res.raw);
    const [mt] = await sql<{ title: string; description: string; visibility: string; class_id: string }[]>`
      select title, description, visibility, class_id from materials where id = ${m}`;
    assert.deepEqual([mt.title, mt.description, mt.visibility, mt.class_id], ["LF1 lib v2", "corrigé", "private", k.id]);

    // null detaches the class
    await call(app, "POST", `/materials/${m}/update`, cookie, { title: "LF1 lib v2", visibility: "students", classId: null });
    const [mt2] = await sql<{ class_id: string | null }[]>`select class_id from materials where id = ${m}`;
    assert.equal(mt2.class_id, null);
  });

  test("a bad visibility is a 400; another tutor's or a removed item is not-found", async () => {
    const tutor = await seedTutor();
    const other = await seedTutor();
    const cookie = await login(tutor.profileId);
    const m = await seedMaterial(tutor.id, "LF1 lib2");
    assert.equal((await call(app, "POST", `/materials/${m}/update`, cookie, { title: "LF1 lib2", visibility: "everyone" })).status, 400);
    const theirs = await seedMaterial(other.id, "LF1 theirs2");
    assert.deepEqual((await call(app, "POST", `/materials/${theirs}/update`, cookie, { title: "LF1 x y", visibility: "public" })).body, { ok: false, error: "not-found" });
    await sql`update materials set removed_at = now() where id = ${m}`;
    assert.deepEqual((await call(app, "POST", `/materials/${m}/update`, cookie, { title: "LF1 x y", visibility: "public" })).body, { ok: false, error: "not-found" });
  });
});

describe("0041 — the backfill ties a pack to the file uploaded with it, only when unambiguous", () => {
  test("one same-title file a moment before → linked; two candidates → left alone; idempotent", async () => {
    const tutor = await seedTutor();
    const t0 = Date.now();
    const m = await seedMaterial(tutor.id, "LF1 backfill one", { kind: "file", createdAt: new Date(t0 - 5_000) });
    const p = await seedPack(tutor.id, "LF1 backfill one", { createdAt: new Date(t0) });
    await seedMaterial(tutor.id, "LF1 backfill two", { kind: "file", createdAt: new Date(t0 - 4_000) });
    await seedMaterial(tutor.id, "LF1 backfill two", { kind: "file", createdAt: new Date(t0 - 3_000) });
    const p2 = await seedPack(tutor.id, "LF1 backfill two", { createdAt: new Date(t0) });
    const late = await seedMaterial(tutor.id, "LF1 backfill late", { kind: "file", createdAt: new Date(t0 + 60_000) });
    const p3 = await seedPack(tutor.id, "LF1 backfill late", { createdAt: new Date(t0) });

    const file = fileURLToPath(new URL("../../../packages/db/sql/0041_pack_material.sql", import.meta.url));
    const migration = readFileSync(file, "utf8");
    await sql.unsafe(migration);
    await sql.unsafe(migration); // twice: idempotent

    const rows = await sql<{ id: string; material_id: string | null }[]>`select id, material_id from packs where id in ${sql([p, p2, p3])}`;
    const by = new Map(rows.map((r) => [r.id, r.material_id]));
    assert.equal(by.get(p), m);
    assert.equal(by.get(p2), null, "two candidates: ambiguous, left as it was");
    assert.equal(by.get(p3), null, "a file uploaded AFTER the pack is not its file");
    assert.ok(late);
  });
});
