import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MEET_BASE, isDefaultRoom, isJitsiRoom, isPublicJitsi, isValidMeetBase, jitsiJoinUrl, liveRoomUrl, meetBase,
} from "@tnajem/shared/live";
import { startApp, stopApp, seedProfile, seedTutor, seedClass, seedBooking, login, call, sql, type App } from "./support/fx";

/* live-fixes-3 · B — the video room URL.

   Live, 4 Oct: production's .env had `NEXT_PUBLIC_DEFAULT_MEET_BASE=` (the deploy
   workflow wrote it empty), live.ts read it with `??`, and the join link became the
   bare room token — opened as a relative link, tnajem.com/fr/live/<token>, « Aucun
   prof trouvé ». Then Jitsi titled the room with its name and asked everyone to type
   theirs. Covered here:

     B1  an empty, blank, relative or non-https base gives the default (logged once);
         db:check --production refuses a set-but-invalid base;
     B2  a Jitsi room carries #config.subject / #userInfo.displayName — the viewer's
         own public name — and a Zoom / Meet link is untouched. */

const KEY = "NEXT_PUBLIC_DEFAULT_MEET_BASE";
const ORIGINAL = process.env[KEY];
const TOKEN = "0b6f8f9e-3a43-4c55-9d1e-2f6a7c1d0e11";
const restore = () => {
  if (ORIGINAL === undefined) delete process.env[KEY];
  else process.env[KEY] = ORIGINAL;
};

/** Read one fragment setting back the way Jitsi does: URL-decoded, then JSON. */
function setting(url: string, key: string): unknown {
  const fragment = url.slice(url.indexOf("#") + 1);
  const pair = fragment.split("&").find((p) => p.split("=")[0] === key);
  return pair === undefined ? undefined : JSON.parse(decodeURIComponent(pair.slice(key.length + 1)));
}

describe("B1 · liveRoomUrl — always an absolute https:// room", () => {
  after(restore);

  test("unset, empty, whitespace, relative and non-https bases all give the default", () => {
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => void warnings.push(a.join(" "));
    try {
      for (const bad of [undefined, "", "   ", "\t\n", "/fr/live/", "tnajem-", "meet.jit.si/tnajem-", "http://meet.jit.si/tnajem-",
        "https://meet.jit.si", "javascript:alert(1)//", "https://meet.jit.si/tnajem-#x", "ftp://meet.jit.si/x"]) {
        if (bad === undefined) delete process.env[KEY];
        else process.env[KEY] = bad;
        assert.equal(meetBase(), DEFAULT_MEET_BASE, `base ${JSON.stringify(bad)}`);
        assert.equal(liveRoomUrl(TOKEN), `https://meet.jit.si/tnajem-${TOKEN}`, `room for ${JSON.stringify(bad)}`);
      }
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1, `refused bases are logged ONCE per process: ${warnings.join(" | ")}`);
    assert.doesNotMatch(warnings[0], /http:\/\/meet|\/fr\/live/, "the refused value itself is never logged");
  });

  test("a valid https:// base is used as-is (trimmed)", () => {
    process.env[KEY] = "  https://jitsi.example.tn/cours-  ";
    assert.equal(liveRoomUrl(TOKEN), `https://jitsi.example.tn/cours-${TOKEN}`);
    process.env[KEY] = "https://meet.jit.si/";
    assert.equal(liveRoomUrl(TOKEN), `https://meet.jit.si/${TOKEN}`);
    restore();
  });

  test("isValidMeetBase: scheme, host, then a path — https only", () => {
    for (const ok of ["https://meet.jit.si/tnajem-", "https://meet.jit.si/", "https://8x8.vc/vpaas-magic/tnajem-"]) assert.equal(isValidMeetBase(ok), true, ok);
    for (const no of ["", " https://meet.jit.si/x", "https://meet.jit.si", "http://meet.jit.si/x", "//meet.jit.si/x", "https:///x", "https://meet jit.si/x"]) {
      assert.equal(isValidMeetBase(no), false, JSON.stringify(no));
    }
  });
});

describe("B2 · jitsiJoinUrl — the class title and the viewer's name, Jitsi rooms only", () => {
  test("the token room gets ONE fragment: config.subject & userInfo.displayName, JSON-valued and URL-encoded", () => {
    const room = `https://meet.jit.si/tnajem-${TOKEN}`;
    const url = jitsiJoinUrl(room, { subject: "Intégrales — « révision » & co", displayName: "Walid T." });
    assert.ok(url.startsWith(`${room}#config.subject=%22`), url);
    assert.equal(url.split("#").length, 2, "one fragment");
    assert.match(url, /&userInfo\.displayName=%22/);
    assert.equal(setting(url, "config.subject"), "Intégrales — « révision » & co");
    assert.equal(setting(url, "userInfo.displayName"), "Walid T.");
    assert.doesNotMatch(url.split("#")[1], /[ "«»&]{2}/, "nothing raw that would split the fragment");
  });

  test("no name → the subject alone; nothing to add → the URL unchanged", () => {
    const room = `https://meet.jit.si/tnajem-${TOKEN}`;
    assert.equal(jitsiJoinUrl(room, { subject: "Bac", displayName: null }), `${room}#config.subject=%22Bac%22`);
    assert.equal(jitsiJoinUrl(room, { subject: " ", displayName: "" }), room);
  });

  test("a tutor's own Zoom / Google Meet link is untouched; their own meet.jit.si room is a Jitsi room", () => {
    for (const own of ["https://zoom.us/j/123456789", "https://meet.google.com/abc-defg-hij", "http://meet.jit.si/insecure"]) {
      assert.equal(jitsiJoinUrl(own, { subject: "Bac", displayName: "Walid T." }), own);
    }
    const mine = "https://meet.jit.si/MaClasseDeMaths";
    assert.equal(isJitsiRoom(mine), true);
    assert.equal(setting(jitsiJoinUrl(mine, { subject: "Bac", displayName: "Walid T." }), "config.subject"), "Bac");
  });

  test("settings already in the tutor's link are kept, the rest joined with « & »", () => {
    const mine = "https://meet.jit.si/MaClasse#config.subject=%22Le%20mien%22";
    const url = jitsiJoinUrl(mine, { subject: "Bac", displayName: "Walid T." });
    assert.equal(url, `${mine}&userInfo.displayName=%22Walid%20T.%22`);
  });

  test("isDefaultRoom (the ClassTools video tile) and isPublicJitsi (the moderator note)", () => {
    assert.equal(isDefaultRoom(`https://meet.jit.si/tnajem-${TOKEN}`), true);
    assert.equal(isDefaultRoom("https://meet.jit.si/MaClasse"), false);
    assert.equal(isDefaultRoom("https://zoom.us/j/1"), false);
    assert.equal(isDefaultRoom(undefined), false);
    assert.equal(isPublicJitsi(`https://meet.jit.si/tnajem-${TOKEN}`), true);
    assert.equal(isPublicJitsi("https://jitsi.example.tn/x"), false);
    assert.equal(isPublicJitsi("https://zoom.us/j/1"), false);
    assert.equal(isPublicJitsi(undefined), false);
  });
});

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  await stopApp(app);
});

describe("B2 · GET /classes/:id/join — the room the lobby opens", () => {
  test("the tutor's link names them « Walid T. », the booked student's by first name; both titled; nobody else gets a room", async () => {
    const tutorProfile = await seedProfile({ role: "tutor", fullName: "walid tester" });
    const tutor = await seedTutor({ profileId: tutorProfile.id, fullName: "walid tester" });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    await sql`update classes set title = ${"Intégrales — révision express"} where id = ${klass.id}`;
    const student = await seedProfile({ role: "student", fullName: "mehdi jaziri" });
    await seedBooking({ classId: klass.id, studentId: student.id });
    const stranger = await seedProfile({ role: "student" });
    const [{ room_token: token }] = await sql<{ room_token: string }[]>`select room_token from classes where id = ${klass.id}`;

    const asTutor = await call(app, "GET", `/classes/${klass.id}/join`, await login(tutorProfile.id));
    assert.equal(asTutor.body.role, "tutor", asTutor.raw);
    const tUrl = String(asTutor.body.meetUrl);
    assert.ok(tUrl.startsWith(`${DEFAULT_MEET_BASE}${token}#`), tUrl);
    assert.equal(setting(tUrl, "config.subject"), "Intégrales — révision express");
    assert.equal(setting(tUrl, "userInfo.displayName"), "Walid T.", "a tutor as students see them, capitalised");

    const asStudent = await call(app, "GET", `/classes/${klass.id}/join`, await login(student.id));
    assert.equal(asStudent.body.role, "student", asStudent.raw);
    const sUrl = String(asStudent.body.meetUrl);
    assert.ok(sUrl.startsWith(`${DEFAULT_MEET_BASE}${token}#`), sUrl);
    assert.equal(setting(sUrl, "userInfo.displayName"), "Mehdi", "a student: first name only");
    assert.equal(setting(sUrl, "config.subject"), "Intégrales — révision express");

    const asStranger = await call(app, "GET", `/classes/${klass.id}/join`, await login(stranger.id));
    assert.deepEqual(asStranger.body, { canJoin: false, reason: "not-booked" });
    const anon = await call(app, "GET", `/classes/${klass.id}`, null);
    assert.equal(anon.raw.includes(token), false, "the token never reaches a public payload");
  });

  test("a tutor's own Zoom link comes back exactly as they set it", async () => {
    const tutor = await seedTutor({});
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 30 });
    await sql`update classes set meet_url = 'https://zoom.us/j/987654321?pwd=abc' where id = ${klass.id}`;
    const res = await call(app, "GET", `/classes/${klass.id}/join`, await login(tutor.profileId));
    assert.equal(res.body.meetUrl, "https://zoom.us/j/987654321?pwd=abc", res.raw);
  });
});

describe("B1 · db:check -- --production refuses a set but invalid base", () => {
  const CHECK = fileURLToPath(new URL("../../../packages/db/bin/check.ts", import.meta.url));
  function meetLine(value: string): string {
    const r = spawnSync(process.execPath, ["--import", "tsx", CHECK, "--production"], {
      encoding: "utf8",
      env: { ...process.env, [KEY]: value, NODE_ENV: "production" },
      timeout: 90_000,
    });
    const line = r.stdout.split(/\r?\n/).find((l) => l.includes(KEY));
    assert.ok(line, `no ${KEY} line: ${r.stdout.slice(-400)} ${r.stderr.slice(-400)}`);
    return line;
  }

  test("set to http:// or a relative path: ✗ (and the value is never printed)", () => {
    for (const bad of ["http://meet.jit.si/tnajem-", "/fr/live/"]) {
      const line = meetLine(bad);
      assert.match(line, /✗ NEXT_PUBLIC_DEFAULT_MEET_BASE — set, but not an absolute https:\/\//, line);
      assert.equal(line.includes(bad), false, line);
    }
  });

  test("empty means the default, a valid https:// base is accepted: ✓", () => {
    assert.match(meetLine(""), /✓ NEXT_PUBLIC_DEFAULT_MEET_BASE — empty — the default room base/);
    assert.match(meetLine("https://meet.jit.si/tnajem-"), /✓ NEXT_PUBLIC_DEFAULT_MEET_BASE — set, an absolute https:\/\/ base/);
  });
});
