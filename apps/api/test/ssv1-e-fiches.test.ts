import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startApp, stopApp, seedTutor, seedClass, seedProfile, seedBooking, login, call, sql, type App,
} from "./support/fx";
import { canRead, canReadWith, materialAccessContext } from "../src/lib/material-access";
import { renderNotification } from "@tnajem/shared/notification-messages";

/* student-space-v1 · E — Mes fiches.

   C6: ONE access rule (lib/material-access.ts) — the file endpoint and the list can
   never disagree: every material the list shows, GET /materials/:id/file serves to
   that student; every one it hides, the endpoint refuses. « Nouveau » follows
   profiles.last_seen_fiches_at (0042; POST /student/fiches/seen), the badge is
   GET /student/fiches/new-count (C4), and a prof adding a material to a class the
   student booked puts a bell item (key + params, FR/AR) in the student's bell. */

let app: App;
const materialIds: string[] = [];
before(async () => {
  app = await startApp();
});
after(async () => {
  if (materialIds.length) await sql`delete from materials where id in ${sql(materialIds)}`;
  await stopApp(app);
});

async function mk(o: { tutorId: string; classId?: string | null; visibility?: string; title?: string; kind?: "youtube" | "file"; agoHours?: number; removed?: boolean }): Promise<string> {
  const kind = o.kind ?? "youtube";
  const [m] = await sql<{ id: string }[]>`
    insert into materials (tutor_id, class_id, kind, visibility, title, youtube_id, mime, file_name, storage_path, removed_at, created_at)
    values (${o.tutorId}, ${o.classId ?? null}, ${kind}, ${o.visibility ?? "students"}, ${o.title ?? "FX fiche"},
            ${kind === "youtube" ? "dQw4w9WgXcQ" : null}, ${kind === "file" ? "application/pdf" : null}, ${kind === "file" ? "f.pdf" : null},
            ${kind === "file" ? `materials/${o.tutorId}/missing.pdf` : null}, ${o.removed ? new Date().toISOString() : null},
            ${new Date(Date.now() - (o.agoHours ?? 0) * 3_600_000).toISOString()})
    returning id`;
  materialIds.push(m.id);
  return m.id;
}

describe("E · who may ask", () => {
  test("signed out / a tutor are refused on all three; the badge still says { count: 0 }", async () => {
    const tutor = await seedTutor();
    for (const cookie of [null, await login(tutor.profileId)]) {
      const err = cookie ? "not-a-student" : "not-authenticated";
      assert.deepEqual((await call(app, "GET", "/student/fiches", cookie)).body, { ok: false, error: err });
      assert.deepEqual((await call(app, "POST", "/student/fiches/seen", cookie, {})).body, { ok: false, error: err });
      assert.deepEqual((await call(app, "GET", "/student/fiches/new-count", cookie)).body, { ok: false, error: err, count: 0 });
    }
  });
});

describe("E · the ONE rule (C6): the list and the file endpoint agree", () => {
  test("every material of my profs: listed ⇔ canRead; the file endpoint never serves a hidden one", async () => {
    const tutor = await seedTutor();
    const followed = await seedTutor();
    const stranger = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const mine = await seedClass({ tutorId: tutor.id, hoursFromNow: -30 });
    const other = await seedClass({ tutorId: tutor.id, hoursFromNow: 40 });
    const cancelled = await seedClass({ tutorId: tutor.id, hoursFromNow: 60 });
    await seedBooking({ classId: mine.id, studentId: student.id });
    await seedBooking({ classId: cancelled.id, studentId: student.id, status: "cancelled" });
    await sql`insert into tutor_follows (student_profile_id, tutor_id) values (${student.id}, ${followed.id})`;

    const ids = {
      myClass: await mk({ tutorId: tutor.id, classId: mine.id, title: "Énoncé — intégrales" }),
      otherClass: await mk({ tutorId: tutor.id, classId: other.id }),
      cancelledClass: await mk({ tutorId: tutor.id, classId: cancelled.id }),
      library: await mk({ tutorId: tutor.id }),
      privateOne: await mk({ tutorId: tutor.id, visibility: "private" }),
      removed: await mk({ tutorId: tutor.id, classId: mine.id, removed: true }),
      publicFollowed: await mk({ tutorId: followed.id, visibility: "public", title: "Vidéo — limites" }),
      studentsFollowed: await mk({ tutorId: followed.id }),
      strangerPublic: await mk({ tutorId: stranger.id, visibility: "public" }),
      myClassFile: await mk({ tutorId: tutor.id, classId: mine.id, kind: "file", title: "Corrigé — série 3" }),
      privateFile: await mk({ tutorId: tutor.id, classId: mine.id, kind: "file", visibility: "private" }),
    };
    const cookie = await login(student.id);
    const res = await call(app, "GET", "/student/fiches", cookie);
    assert.equal(res.body.ok, true);
    const listed = new Set((res.body.fiches as { id: string }[]).map((f) => f.id));
    assert.deepEqual(
      [...listed].sort(),
      [ids.myClass, ids.library, ids.publicFollowed, ids.myClassFile].sort(),
      "my class's fiches, my prof's « tous mes élèves », a followed prof's public one — nothing else",
    );

    // THE agreement: for every material of these profs, listed ⇔ the access rule says yes.
    const ctx = await materialAccessContext(student.id);
    for (const [name, id] of Object.entries(ids)) {
      const [m] = await sql<{ tutor_id: string; visibility: string; class_id: string | null; removed_at: Date | null }[]>`
        select tutor_id, visibility, class_id, removed_at from materials where id = ${id}`;
      const row = { tutorId: m.tutor_id, visibility: m.visibility, classId: m.class_id, removedAt: m.removed_at };
      const ok = await canRead(row, student.id);
      assert.equal(canReadWith(row, ctx), ok, `${name}: the one-material and the list paths agree`);
      if (name !== "strangerPublic") assert.equal(listed.has(id), ok, `${name}: listed ⇔ readable`);
    }
    assert.ok(!listed.has(ids.strangerPublic), "a public fiche of a prof who is not mine is not « Mes fiches »");

    // The file endpoint: a hidden file is refused (403), a listed one passes the rule (404 = no bytes in this test store).
    assert.equal((await call(app, "GET", `/materials/${ids.privateFile}/file`, cookie)).status, 403);
    assert.notEqual((await call(app, "GET", `/materials/${ids.myClassFile}/file`, cookie)).status, 403);

    // Origins: the class's title and date, or « sa page ».
    const byId = new Map((res.body.fiches as { id: string; origin: { kind: string; classId?: string }; type: string }[]).map((f) => [f.id, f]));
    assert.equal(byId.get(ids.myClass)?.origin.kind, "class");
    assert.equal(byId.get(ids.myClass)?.origin.classId, mine.id);
    assert.equal(byId.get(ids.library)?.origin.kind, "page");
    assert.equal(byId.get(ids.myClassFile)?.type, "pdf");
    assert.equal(byId.get(ids.publicFollowed)?.type, "youtube");
  });
});

describe("E · « Nouveau », the seen mark and the badge (C4, C5)", () => {
  test("never opened → every fiche is new; POST seen → 0; a fiche added after → 1", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 20 });
    await seedBooking({ classId: k.id, studentId: student.id });
    await mk({ tutorId: tutor.id, classId: k.id, agoHours: 5 });
    await mk({ tutorId: tutor.id, agoHours: 3 });
    const cookie = await login(student.id);

    let list = await call(app, "GET", "/student/fiches", cookie);
    assert.equal(list.body.lastSeenAt, null);
    assert.ok(list.body.fiches.every((f: { isNew: boolean }) => f.isNew), "never opened: none of it was seen");
    assert.deepEqual((await call(app, "GET", "/student/fiches/new-count", cookie)).body, { ok: true, count: 2 });

    assert.deepEqual((await call(app, "POST", "/student/fiches/seen", cookie, {})).body, { ok: true });
    const [p] = await sql<{ at: Date | null }[]>`select last_seen_fiches_at at from profiles where id = ${student.id}`;
    assert.ok(p.at, "0042: the instant is stored");
    assert.deepEqual((await call(app, "GET", "/student/fiches/new-count", cookie)).body, { ok: true, count: 0 });
    list = await call(app, "GET", "/student/fiches", cookie);
    assert.ok(list.body.fiches.every((f: { isNew: boolean }) => !f.isNew));

    await new Promise((r) => setTimeout(r, 20));
    await mk({ tutorId: tutor.id, classId: k.id, title: "Corrigé tout frais" });
    assert.deepEqual((await call(app, "GET", "/student/fiches/new-count", cookie)).body, { ok: true, count: 1 });
    list = await call(app, "GET", "/student/fiches", cookie);
    assert.deepEqual(list.body.fiches.filter((f: { isNew: boolean }) => f.isNew).map((f: { title: string }) => f.title), ["Corrigé tout frais"]);
  });
});

describe("E · the bell when a prof adds a material to a booked class", () => {
  async function postMaterial(cookie: string, fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const req = new Request("http://fx.invalid/materials", { method: "POST", body: form });
    const res = await app.inject({
      method: "POST",
      url: "/materials",
      payload: Buffer.from(await req.arrayBuffer()),
      headers: { cookie, "content-type": req.headers.get("content-type") ?? "" },
    });
    return JSON.parse(res.body) as { ok: boolean; id?: string; error?: string };
  }

  test("each live seat of THAT class gets a bell item (key + params, FR/AR); a cancelled seat, another class or a private file: nothing", async () => {
    const tutor = await seedTutor({ fullName: "Walid Trabelsi" });
    const booked = await seedProfile({ role: "student" });
    const gone = await seedProfile({ role: "student" });
    const elsewhere = await seedProfile({ role: "student" });
    const k = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    const k2 = await seedClass({ tutorId: tutor.id, hoursFromNow: 40 });
    await seedBooking({ classId: k.id, studentId: booked.id });
    await seedBooking({ classId: k.id, studentId: gone.id, status: "cancelled" });
    await seedBooking({ classId: k2.id, studentId: elsewhere.id });
    const tcookie = await login(tutor.profileId);

    const up = await postMaterial(tcookie, { title: "Corrigé — série 3", classId: k.id, youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    assert.equal(up.ok, true, JSON.stringify(up));
    materialIds.push(up.id!);
    const priv = await postMaterial(tcookie, { title: "Notes privées du prof", classId: k.id, visibility: "private", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    assert.equal(priv.ok, true);
    materialIds.push(priv.id!);

    const rows = await sql<{ profile_id: string; kind: string; msg_key: string; msg_params: unknown; href: string; body: string | null }[]>`
      select profile_id, kind, msg_key, msg_params, href, body from notifications
       where profile_id in ${sql([booked.id, gone.id, elsewhere.id])} and kind = 'material_added'`;
    assert.deepEqual(rows.map((r) => r.profile_id), [booked.id], "only the live seat of that class, once (not for the private file)");
    const n = rows[0];
    assert.equal(n.msg_key, "materialAdded");
    assert.equal(n.body, null, "a key and parameters, never rendered text");
    assert.equal(n.href, `/student/fiches?class=${k.id}`);
    const fr = renderNotification({ key: n.msg_key, params: n.msg_params, title: null, body: null }, "fr");
    const ar = renderNotification({ key: n.msg_key, params: n.msg_params, title: null, body: null }, "ar");
    assert.equal(fr.title, "Nouvelle vidéo pour ta séance");
    assert.match(fr.body, /Walid T\. a ajouté « Corrigé — série 3 » à la séance/);
    assert.match(ar.title, /[؀-ۿ]/);
    assert.doesNotMatch(JSON.stringify(n.msg_params), /Trabelsi/, "the prof as « Walid T. »");

    // The student sees it in their bell, in the page's language.
    const bell = await call(app, "GET", "/notifications?locale=ar", await login(booked.id));
    assert.ok((bell.body as { kind: string; lang: string }[]).some((x) => x.kind === "material_added" && x.lang === "ar"));
  });
});
