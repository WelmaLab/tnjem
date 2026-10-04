import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { mintSession } from "./support/session";

/* ════════════════════════════════════════════════════════════════════════════
   A live room reaches the owning tutor and booked students — and nobody else,
   not even someone who reads the public storefront.

   Two leaks closed on 15 Sept:
     1. A class without its own link got https://meet.jit.si/tnajem-<class id>,
        and the class id is in every storefront's HTML — so anyone could walk into
        the room without the API. Rooms are now named after classes.room_token.
     2. The ANONYMOUS storefront payload carried each class's own meet, whiteboard,
        quiz and replay URLs.

   Residual risk (reported, not fixable here): a meet.jit.si room has no
   authentication, so a booked student can forward the link.

   ADDED, never edited into an existing spec. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";

async function get(path: string, token?: string) {
  const res = await fetch(`${API}${path}`, { headers: token ? { cookie: `tnajem_session=${token}` } : {} });
  return (await res.json()) as Record<string, unknown> | null;
}

async function roomToken(classId: string): Promise<string> {
  const [row] = await sql<{ room_token: string }[]>`select room_token from classes where id = ${classId}`;
  return row.room_token;
}

async function scenario() {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
  const derived = await seedClass({ tutorId: tutor.id, hoursFromNow: 50 });
  const own = await seedClass({ tutorId: tutor.id, hoursFromNow: 70 });
  const OWN_ROOM = `https://meet.example.org/private-${own.id.slice(0, 8)}`;
  await sql`update classes set meet_url = ${OWN_ROOM}, whiteboard_url = 'https://board.example.org/x',
                              quiz_url = 'https://quiz.example.org/x' where id = ${own.id}`;
  const booked = await seedProfile({ role: "student", birthYear: 1994 });
  await seedBooking({ classId: derived.id, studentId: booked.id });
  await seedBooking({ classId: own.id, studentId: booked.id });
  const stranger = await seedProfile({ role: "student", birthYear: 1993 });
  return {
    tutor, derived, own, OWN_ROOM,
    tutorToken: await mintSession(tutorProfile.id),
    bookedToken: await mintSession(booked.id),
    strangerToken: await mintSession(stranger.id),
  };
}

test.describe("live rooms", () => {
  test("every class has its own private, random room token", async () => {
    const s = await scenario();
    const [a, b] = [await roomToken(s.derived.id), await roomToken(s.own.id)];
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
    expect(a).not.toBe(s.derived.id);
  });

  test("the public storefront — JSON and HTML — carries no room link of any kind", async ({ request }) => {
    const s = await scenario();
    const token = await roomToken(s.derived.id);

    const json = await get(`/tutors/${s.tutor.slug}/storefront`);
    const classes = (json?.classes ?? []) as Record<string, unknown>[];
    expect(classes.length).toBe(2);
    for (const c of classes) {
      for (const key of ["meet_url", "whiteboard_url", "quiz_url", "replay_url"]) {
        expect(c[key], `storefront class ${c.id} must not carry ${key}`).toBeUndefined();
      }
    }

    const html = await (await request.get(`/fr/${s.tutor.slug}`)).text();
    expect(html).not.toContain(s.OWN_ROOM);
    expect(html).not.toContain(token);
    expect(html, "the class id is public — and no longer names a room").toContain(s.derived.id);
  });

  test("GET /classes/:id gives the room only to the tutor and a booked student", async () => {
    const s = await scenario();
    const token = await roomToken(s.derived.id);

    for (const [who, t] of [["anonymous", undefined], ["a stranger", s.strangerToken]] as const) {
      const c = await get(`/classes/${s.derived.id}`, t);
      expect(c?.title, `${who} still sees the class`).toBeTruthy();
      expect(c?.meet_url, `${who} gets no room`).toBeUndefined();
      const o = await get(`/classes/${s.own.id}`, t);
      expect(o?.meet_url).toBeUndefined();
      expect(o?.whiteboard_url).toBeUndefined();
    }

    for (const t of [s.bookedToken, s.tutorToken]) {
      const c = await get(`/classes/${s.derived.id}`, t);
      expect(c?.meet_url, "the fallback room is named by the token").toBe(`https://meet.jit.si/tnajem-${token}`);
      expect(String(c?.meet_url)).not.toContain(s.derived.id);
      const o = await get(`/classes/${s.own.id}`, t);
      expect(o?.meet_url, "a tutor's own room wins").toBe(s.OWN_ROOM);
    }
  });

  test("the join gate and the student dashboard hand out the token room, and only to the entitled", async () => {
    const s = await scenario();
    const token = await roomToken(s.derived.id);

    expect(await get(`/classes/${s.derived.id}/join`, s.strangerToken)).toEqual({ canJoin: false, reason: "not-booked" });
    const join = await get(`/classes/${s.derived.id}/join`, s.bookedToken);
    expect(join).toMatchObject({ canJoin: true, role: "student" });
    // live-fixes-3 · B2: the same token room, now with Jitsi's title/name settings in the fragment.
    expect(String(join?.meetUrl).split("#")[0]).toBe(`https://meet.jit.si/tnajem-${token}`);
    expect(String(join?.meetUrl)).toContain("#config.subject=");

    const dash = (await get("/student/dashboard", s.bookedToken)) as { upcoming: { classId: string; meetUrl: string }[] };
    const mine = dash.upcoming.find((u) => u.classId === s.derived.id);
    expect(mine?.meetUrl).toBe(`https://meet.jit.si/tnajem-${token}`);
  });
});
