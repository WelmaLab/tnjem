import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  startApp, stopApp, seedProfile, seedTutor, seedClass, login, call, sql, type App,
} from "./support/fx";
import { runFollowDigest, type MailSender } from "../src/lib/follow-digest";
import { renderNotification } from "@tnajem/shared/notification-messages";
import { db } from "../src/db";

/* Espace prof v2 · Phase 4 — students follow a teacher.

   Suivre / Abonné ✓, the minors rule (the booking rule exactly), first names only
   for the teacher, a notification per new follower, and the followers digest: an
   in-app notification + an e-mail with one-click unsubscribe, at most once a day. */

let app: App;
before(async () => {
  app = await startApp();
});
after(async () => {
  // Follows, prefs, digests, notifications and consents all cascade from this file's profiles.
  await stopApp(app);
});

const follow = async (slug: string, cookie: string | null) => call(app, "POST", "/follows", cookie, { slug });

describe("P4 · follow / unfollow", () => {
  test("signed out: not-authenticated (the button sends the visitor to log in with next=)", async () => {
    const tutor = await seedTutor();
    assert.deepEqual((await follow(tutor.slug, null)).body, { ok: false, error: "not-authenticated" });
    assert.deepEqual((await call(app, "GET", `/follows/status?slug=${tutor.slug}`, null)).body, { signedIn: false, following: false, canFollow: true });
  });

  test("a student follows, the status says Abonné, the teacher is told ONCE, by first name only", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student", fullName: "Amine Karoui" });
    const cookie = await login(student.id);
    assert.deepEqual((await follow(tutor.slug, cookie)).body, { ok: true, following: true });
    assert.deepEqual((await follow(tutor.slug, cookie)).body, { ok: true, following: true, already: true }, "idempotent");
    assert.equal((await call(app, "GET", `/follows/status?slug=${tutor.slug}`, cookie)).body.following, true);

    const notes = await sql<{ kind: string; msg_key: string; msg_params: Record<string, unknown>; body: string | null; about_profile_id: string }[]>`
      select kind, msg_key, msg_params, body, about_profile_id from notifications where profile_id = ${tutor.profileId}`;
    assert.equal(notes.length, 1, "one notification for one new follower");
    assert.equal(notes[0].kind, "new_follower");
    assert.equal(notes[0].msg_key, "followNew");
    assert.equal(notes[0].body, null, "a key and parameters are stored, never rendered text");
    const shown = renderNotification({ key: notes[0].msg_key, params: notes[0].msg_params, title: null, body: null }, "fr");
    assert.match(shown.body, /^Amine /);
    assert.doesNotMatch(JSON.stringify(notes[0].msg_params), /Karoui/, "never the last name");
    assert.equal(notes[0].about_profile_id, student.id, "so an erasure can rewrite it");
  });

  test("unfollow deletes the row; following again does not re-notify while the first note is unread", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    await follow(tutor.slug, cookie);
    assert.deepEqual((await call(app, "POST", "/follows/unfollow", cookie, { slug: tutor.slug })).body, { ok: true, following: false });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from tutor_follows where student_profile_id = ${student.id}`;
    assert.equal(n, 0, "the row is gone, not flagged");
    await follow(tutor.slug, cookie);
    const [{ m }] = await sql<{ m: number }[]>`select count(*)::int m from notifications where profile_id = ${tutor.profileId} and kind = 'new_follower'`;
    assert.equal(m, 1);
  });

  test("never your own page; tutors and guardians cannot follow", async () => {
    const tutor = await seedTutor();
    assert.deepEqual((await follow(tutor.slug, await login(tutor.profileId))).body, { ok: false, error: "own-page" });
    const other = await seedTutor();
    assert.deepEqual((await follow(tutor.slug, await login(other.profileId))).body, { ok: false, error: "students-only" });
    const guardian = await seedProfile({ role: "guardian" });
    assert.deepEqual((await follow(tutor.slug, await login(guardian.id))).body, { ok: false, error: "students-only" });
  });

  test("a tutor who is not public yet can be followed (the 'arrive bientôt' page); a suspended one cannot", async () => {
    const coming = await seedTutor({ status: "pending" });
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    assert.equal((await follow(coming.slug, cookie)).body.ok, true);
    const suspended = await seedTutor();
    await sql`update tutors set suspended_at = now() where id = ${suspended.id}`;
    assert.deepEqual((await follow(suspended.slug, cookie)).body, { ok: false, error: "not-found" });
  });

  test("MINORS follow the booking rule: adults-only while ALLOW_MINORS is off; consent required when on", async () => {
    const tutor = await seedTutor();
    const minor = await seedProfile({ role: "student", birthYear: new Date().getFullYear() - 15 });
    const cookie = await login(minor.id);
    const before = process.env.ALLOW_MINORS;
    try {
      delete process.env.ALLOW_MINORS;
      assert.deepEqual((await follow(tutor.slug, cookie)).body, { ok: false, error: "adults-only" });
      process.env.ALLOW_MINORS = "1";
      assert.deepEqual((await follow(tutor.slug, cookie)).body, { ok: false, error: "needs-consent" });
      await sql`insert into consents (id, minor_id, guardian_name, consent_text, policy_version)
                values (${randomUUID()}, ${minor.id}, 'Parent FX', 'FX consent', 'fx')`;
      assert.deepEqual((await follow(tutor.slug, cookie)).body, { ok: true, following: true });
    } finally {
      if (before === undefined) delete process.env.ALLOW_MINORS;
      else process.env.ALLOW_MINORS = before;
    }
  });

  test("the teacher's follower list: count + first names, nothing else; the stats count 'Abonnés'", async () => {
    const tutor = await seedTutor();
    for (const name of ["Sarra Ben Ali", "Youssef Trabelsi"]) {
      const s = await seedProfile({ role: "student", fullName: name });
      await follow(tutor.slug, await login(s.id));
    }
    const res = await call(app, "GET", "/tutor/followers", await login(tutor.profileId));
    assert.equal(res.body.count, 2);
    assert.deepEqual(res.body.items.map((i: { firstName: string }) => i.firstName).sort(), ["Sarra", "Youssef"]);
    assert.doesNotMatch(res.raw, /Ben Ali|Trabelsi|@tnajem\.invalid|"id"/, "no last name, no address, no id");
    const stats = await call(app, "GET", "/vitrine/stats", await login(tutor.profileId));
    assert.equal(stats.body.followers, 2);
  });
});

describe("P4 · Mes élèves lists followers (GET /tutor/students)", () => {
  test("a follower who never booked is a row with no bookings; one who booked AND follows carries both relations", async () => {
    const tutor = await seedTutor();
    const klass = await seedClass({ tutorId: tutor.id });
    const onlyFollows = await seedProfile({ role: "student", fullName: "Rania Jaziri" });
    const both = await seedProfile({ role: "student", fullName: "Hedi Mansour" });
    await follow(tutor.slug, await login(onlyFollows.id));
    const bothCookie = await login(both.id);
    await call(app, "POST", "/bookings", bothCookie, { classId: klass.id });
    await follow(tutor.slug, bothCookie);

    const res = await call(app, "GET", "/tutor/students", await login(tutor.profileId));
    const rows = res.body as { name: string; relations: string[]; status: string; bookings: unknown[]; key: string }[];
    const rania = rows.find((r) => r.name === "Rania");
    const hedi = rows.find((r) => r.name === "Hedi");
    assert.deepEqual({ rel: rania?.relations, status: rania?.status, n: rania?.bookings.length }, { rel: ["follower"], status: "none", n: 0 });
    assert.deepEqual(hedi?.relations, ["booked", "follower"]);
    assert.doesNotMatch(res.raw, /Jaziri|Mansour|@tnajem\.invalid/, "first names only, no address");
    assert.ok(!res.raw.includes(onlyFollows.id), "never the profile id — the key is opaque");
  });
});

describe("P4 · the followers digest", () => {
  type Sent = { to: string; subject: string; text: string; headers?: Record<string, string> };
  const capture = () => {
    const sent: Sent[] = [];
    const send: MailSender = async (to, subject, text, extras) => {
      sent.push({ to, subject, text, headers: extras?.headers });
      return true;
    };
    return { sent, send };
  };

  test("a class published after the follow → one in-app note + one e-mail with one-click unsubscribe; at most once a day", async () => {
    const tutor = await seedTutor({ fullName: "Yassine Khelifi" });
    const old = await seedClass({ tutorId: tutor.id });
    await sql`update classes set created_at = now() - interval '2 days' where id = ${old.id}`;
    const student = await seedProfile({ role: "student", fullName: "Lina Haddad" });
    await follow(tutor.slug, await login(student.id));
    const fresh = await seedClass({ tutorId: tutor.id });

    const { sent, send } = capture();
    await runFollowDigest(db, { send });
    const notes = await sql<{ kind: string; msg_key: string; msg_params: unknown; href: string }[]>`
      select kind, msg_key, msg_params, href from notifications where profile_id = ${student.id} and kind = 'follow_digest'`;
    assert.equal(notes.length, 1);
    const shown = renderNotification({ key: notes[0].msg_key, params: notes[0].msg_params, title: null, body: null }, "fr");
    assert.match(shown.title, /^Yassine K\. a publié/);
    assert.match(shown.body, new RegExp(fresh.title));
    assert.doesNotMatch(shown.body, new RegExp(old.title), "a class from before the follow is not news");
    assert.equal(notes[0].href, `/class/${fresh.id}`);

    const mine = sent.filter((m) => m.to === student.email);
    assert.equal(mine.length, 1);
    assert.match(mine[0].text, /\/api\/email\/unsubscribe\?token=v1\./, "the footer link");
    assert.match(mine[0].headers?.["List-Unsubscribe"] ?? "", /^<https?:\/\/.+\/api\/email\/unsubscribe\?token=/);
    assert.equal(mine[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
    assert.doesNotMatch(mine[0].text, /Khelifi/, "the tutor's last name is never sent");

    // A second class and a second run the same day: nothing more today.
    await seedClass({ tutorId: tutor.id });
    const again = capture();
    const r = await runFollowDigest(db, { send: again.send });
    assert.equal(again.sent.filter((m) => m.to === student.email).length, 0);
    assert.ok(r.tooSoon >= 1);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${student.id} and kind = 'follow_digest'`;
    assert.equal(n, 1);
  });

  test("'followers' switched off: the in-app note still comes, the e-mail does not", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    const cookie = await login(student.id);
    await follow(tutor.slug, cookie);
    await call(app, "POST", "/me/notification-prefs", cookie, { followers: false });
    await seedClass({ tutorId: tutor.id });
    const { sent, send } = capture();
    await runFollowDigest(db, { send });
    assert.equal(sent.filter((m) => m.to === student.email).length, 0);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${student.id} and kind = 'follow_digest'`;
    assert.equal(n, 1);
  });

  test("a minor whose consent was withdrawn gets nothing, and the news is not saved up for later", async () => {
    const tutor = await seedTutor();
    const minor = await seedProfile({ role: "student", birthYear: new Date().getFullYear() - 15 });
    const consentId = randomUUID();
    await sql`insert into consents (id, minor_id, guardian_name, consent_text, policy_version)
              values (${consentId}, ${minor.id}, 'Parent FX', 'FX consent', 'fx')`;
    const before = process.env.ALLOW_MINORS;
    process.env.ALLOW_MINORS = "1";
    try {
      await follow(tutor.slug, await login(minor.id));
      await sql`update consents set withdrawn_at = now() where id = ${consentId}`;
      await seedClass({ tutorId: tutor.id });
      const { sent, send } = capture();
      await runFollowDigest(db, { send });
      assert.equal(sent.filter((m) => m.to === minor.email).length, 0);
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${minor.id} and kind = 'follow_digest'`;
      assert.equal(n, 0);
      const [f] = await sql<{ moved: boolean }[]>`select notified_through > created_at as moved from tutor_follows where student_profile_id = ${minor.id}`;
      assert.equal(f.moved, true, "the cursor moved");
    } finally {
      if (before === undefined) delete process.env.ALLOW_MINORS;
      else process.env.ALLOW_MINORS = before;
    }
  });

  test("dry-run counts and changes nothing", async () => {
    const tutor = await seedTutor();
    const student = await seedProfile({ role: "student" });
    await follow(tutor.slug, await login(student.id));
    await seedClass({ tutorId: tutor.id });
    const { sent, send } = capture();
    const r = await runFollowDigest(db, { dryRun: true, send });
    assert.ok(r.due >= 1);
    assert.equal(sent.length, 0);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where profile_id = ${student.id}`;
    assert.equal(n, 0);
  });
});
