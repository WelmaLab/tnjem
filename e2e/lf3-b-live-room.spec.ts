import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-3 · B — the video room, as the live lobby opens it.

     B1  « Entrer dans la classe » opens an ABSOLUTE https:// room — live it opened
         the bare token as a relative link (tnajem.com/fr/live/<token>).
     B2  the room is titled with the class and fills in the viewer's own public name
         (#config.subject / #userInfo.displayName, one fragment).
     B3  the tutor — only the tutor — reads the meet.jit.si moderator sign-in line.
     B4  one button for one room: no « Rejoindre la vidéo » tile for the default room;
         the whiteboard and quiz tiles stay.
     B5  a class more than 24 h away: « Démarre le 5 oct · 18:00 », never a dangling
         « Démarre le » (FR and AR).
   The URL itself is unit-tested in apps/api/test/lf3-b-room-url.test.ts.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const NOTE_FR =
  "Pour ouvrir la salle, connecte-toi une fois avec Google (ou Microsoft/Facebook) quand Jitsi le demande. Tes élèves entrent ensuite directement.";
const NOTE_AR = "باش تحلّ القاعة، ادخل مرّة وحدة بـ Google (ولا Microsoft/Facebook) كي Jitsi يطلب منك. التلامذة متاعك يدخلو مباشرة من بعد.";

async function ctxAs(browser: Browser, profileId: string, role: "tutor" | "student", viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  // The room opens in a new tab: record what « Entrer » asked for instead.
  await ctx.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  return ctx;
}

async function enter(page: Page, label: RegExp): Promise<string> {
  await page.getByRole("button", { name: label }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length)).toBe(1);
  return page.evaluate(() => (window as unknown as { __opened: string[] }).__opened[0]);
}

function setting(url: string, key: string): unknown {
  const fragment = url.slice(url.indexOf("#") + 1);
  const pair = fragment.split("&").find((p) => p.split("=")[0] === key);
  return pair === undefined ? undefined : JSON.parse(decodeURIComponent(pair.slice(key.length + 1)));
}

async function world() {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "walid tester" });
  const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified", fullName: "walid tester" });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 2 });
  await sql`update classes set title = ${"Intégrales — révision express"}, whiteboard_url = 'https://bitpaper.io/go/e2e',
                              quiz_url = 'https://www.wooclap.com/E2E' where id = ${klass.id}`;
  const student = await seedProfile({ role: "student", birthYear: 1996, fullName: "mehdi jaziri" });
  await seedBooking({ classId: klass.id, studentId: student.id });
  const [{ room_token: token }] = await sql<{ room_token: string }[]>`select room_token from classes where id = ${klass.id}`;
  return { tutorProfile, tutor, klass, student, token };
}

test.describe("the tutor's lobby", () => {
  for (const loc of ["fr", "ar"] as const) {
    test(`${loc}: Entrer opens the absolute, titled, named Jitsi room; the moderator line; one video button`, async ({ browser }) => {
      const w = await world();
      const ctx = await ctxAs(browser, w.tutorProfile.id, "tutor");
      const page = await ctx.newPage();
      await page.goto(`/${loc}/live/${w.klass.id}`);

      const note = page.locator("[data-e2e=live-moderator-note]");
      await expect(note).toHaveText(loc === "fr" ? NOTE_FR : NOTE_AR);
      // One line ABOVE the button.
      const join = page.getByRole("button", { name: loc === "fr" ? /Entrer dans la classe/ : /ادخل للحصة/ });
      expect((await note.boundingBox())!.y).toBeLessThan((await join.boundingBox())!.y);

      // B4: the whiteboard and the quiz stay; the duplicate video tile is gone.
      await expect(page.getByRole("button", { name: loc === "fr" ? "Rejoindre la vidéo" : "ادخل للفيديو" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: loc === "fr" ? "Tableau blanc" : "السبورة" })).toBeVisible();
      await expect(page.getByRole("button", { name: loc === "fr" ? "Lancer le quiz" : "ابدا الكويز" })).toBeVisible();

      const url = await enter(page, loc === "fr" ? /Entrer dans la classe/ : /ادخل للحصة/);
      expect(url.startsWith(`https://meet.jit.si/tnajem-${w.token}#`), url).toBe(true);
      expect(setting(url, "config.subject")).toBe("Intégrales — révision express");
      expect(setting(url, "userInfo.displayName"), "the tutor as students see them").toBe("Walid T.");
      await ctx.close();
    });
  }
});

test.describe("the student's lobby", () => {
  test("no moderator line for a student; Entrer opens the same room under their first name; no video tile", async ({ browser }) => {
    const w = await world();
    const ctx = await ctxAs(browser, w.student.id, "student", { width: 390, height: 844 });
    const page = await ctx.newPage();
    await page.goto(`/fr/live/${w.klass.id}`);
    await expect(page.getByRole("button", { name: /Entrer dans la classe/ })).toBeVisible();
    await expect(page.locator("[data-e2e=live-moderator-note]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText("connecte-toi une fois avec Google");
    await expect(page.getByRole("button", { name: "Rejoindre la vidéo" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Tableau blanc" })).toBeVisible();

    const url = await enter(page, /Entrer dans la classe/);
    expect(url.startsWith(`https://meet.jit.si/tnajem-${w.token}#`), url).toBe(true);
    expect(setting(url, "userInfo.displayName")).toBe("Mehdi");
    expect(setting(url, "config.subject")).toBe("Intégrales — révision express");

    await page.goto(`/ar/live/${w.klass.id}`);
    await expect(page.getByRole("button", { name: /ادخل للحصة/ })).toBeVisible();
    await expect(page.locator("[data-e2e=live-moderator-note]")).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("a tutor's own video link", () => {
  test("untouched, no meet.jit.si line, and its tile stays (it is not the default room)", async ({ browser }) => {
    const w = await world();
    await sql`update classes set meet_url = 'https://zoom.us/j/987654321' where id = ${w.klass.id}`;
    const ctx = await ctxAs(browser, w.tutorProfile.id, "tutor");
    const page = await ctx.newPage();
    await page.goto(`/fr/live/${w.klass.id}`);
    await expect(page.getByRole("button", { name: /Entrer dans la classe/ })).toBeVisible();
    await expect(page.locator("[data-e2e=live-moderator-note]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rejoindre la vidéo" })).toBeVisible();
    expect(await enter(page, /Entrer dans la classe/)).toBe("https://zoom.us/j/987654321");
    await ctx.close();
  });
});

test.describe("B5 · the status tag of a class more than 24 h away", () => {
  for (const [loc, expected, dangling] of [
    ["fr", "Démarre le 5 oct · 18:00", "Démarre le"],
    ["ar", "تبدا يوم 5 أكتوبر · 18:00", "تبدا يوم"],
  ] as const) {
    test(`${loc}: « ${expected} »`, async ({ browser }) => {
      const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1988 });
      const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
      // 5 Oct 2027, 18:00 in Tunis (UTC+1, no DST) — far enough ahead to never be within a day.
      const klass = await seedClass({ tutorId: tutor.id, at: new Date("2027-10-05T17:00:00.000Z") });
      const ctx = await ctxAs(browser, tutorProfile.id, "tutor");
      const page = await ctx.newPage();
      await page.goto(`/${loc}/live/${klass.id}`);
      const tag = page.locator(".tag.tag-neutral").first();
      await expect(tag).toHaveText(expected);
      expect((await tag.textContent())?.trim()).not.toBe(dangling);
      await ctx.close();
    });
  }
});
