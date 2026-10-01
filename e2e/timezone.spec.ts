import { test, expect, type Browser } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { fillWallTime, wallTimeOf } from "./support/datetime"; // espace prof v2 · shell

/* ════════════════════════════════════════════════════════════════════════════
   timezone: every class time is Tunis time — for a browser in São Paulo and a
   server in whatever zone E2E_SERVER_TZ gives it.

   Before 15 Sept the API formatted class times in its own process timezone and
   the reschedule form converted in the tutor's browser, so the same class read
   "18:00" on a Tunis laptop, "17:00" from a UTC server and moved by an hour when
   a tutor abroad rescheduled it.

   The expected values are computed here INDEPENDENTLY of packages/shared/src/
   time.ts (Tunisia is UTC+1 all year, no DST since 2009), so a bug in the module
   cannot also be a bug in the oracle.

   Run under two server zones for the gate:
     E2E_SERVER_TZ=UTC           npx playwright test --grep timezone
     E2E_SERVER_TZ=Africa/Tunis  npx playwright test --grep timezone

   ADDED, never edited into an existing spec. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:4000";
const BROWSER_TZ = "America/Sao_Paulo"; // UTC-3: a wrong conversion is off by 4 hours, not 1
const MONTHS = ["JANV", "FÉVR", "MARS", "AVR", "MAI", "JUIN", "JUIL", "AOÛT", "SEPT", "OCT", "NOV", "DÉC"];
const MONTHS_AR = ["جانفي", "فيفري", "مارس", "أفريل", "ماي", "جوان", "جويل", "أوت", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The Tunis wall clock for an instant: UTC+1. */
function tunis(at: Date) {
  const t = new Date(at.getTime() + 3_600_000);
  return {
    day: String(t.getUTCDate()),
    month: MONTHS[t.getUTCMonth()],
    monthAr: MONTHS_AR[t.getUTCMonth()],
    clock: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
    wallInput: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
}

/** A UTC instant `days` from today at hh:mm UTC. */
function utcAt(days: number, hh: number, mm: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hh, mm, 0, 0));
}

async function api(path: string, token?: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { cookie: `tnajem_session=${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

async function contextAs(browser: Browser, profileId?: string) {
  const ctx = await browser.newContext({ timezoneId: BROWSER_TZ, locale: "fr-FR" });
  if (profileId) await ctx.addCookies([sessionCookie(await mintSession(profileId))]);
  return ctx;
}

async function scheduledAt(classId: string): Promise<string> {
  const [row] = await sql<{ scheduled_at: Date }[]>`select scheduled_at from classes where id = ${classId}`;
  return new Date(row.scheduled_at).toISOString();
}

test.describe("timezone: class times are Tunis time", () => {
  test("the API reports Africa/Tunis as the app zone, and the zone it runs in", async () => {
    const health = (await api("/health")) as { tz?: { app: string; process: string } };
    expect(health.tz?.app).toBe("Africa/Tunis");
    if (process.env.E2E_SERVER_TZ) {
      expect(health.tz?.process, "the gate really ran the API in E2E_SERVER_TZ").toBe(process.env.E2E_SERVER_TZ);
    }
  });

  test("a class at 17:00Z reads 18:00 on every page, in the notification, and for a browser in São Paulo", async ({ browser }) => {
    const at = utcAt(3, 17, 0);
    const want = tunis(at);
    expect(want.clock).toBe("18:00");
    const iso = at.toISOString();

    const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1984 });
    const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, at });
    const student = await seedProfile({ role: "student", birthYear: 1990 });

    const anon = await contextAs(browser);
    const page = await anon.newPage();
    await page.goto(`/fr/${tutor.slug}`);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), "the browser really is in São Paulo").toBe(BROWSER_TZ);
    const row = page.locator(".sf-classes .sf-row").first();
    await expect(row).toContainText(want.clock);
    await expect(row).toContainText(`${want.day}`);
    await expect(row).toContainText(want.month);
    await expect(row).not.toContainText("17:00");
    await expect(row).not.toContainText("14:00");

    await page.goto(`/ar/${tutor.slug}`);
    const rowAr = page.locator(".sf-classes .sf-row").first();
    await expect(rowAr).toContainText(want.clock);
    await expect(rowAr).toContainText(want.monthAr);
    await expect(rowAr).not.toContainText(want.month);

    await page.goto(`/fr/class/${klass.id}`);
    await expect(page.locator(`time[datetime="${iso}"]`).last()).toContainText(want.clock);
    await anon.close();

    const studentCtx = await contextAs(browser, student.id);
    const sPage = await studentCtx.newPage();
    await sPage.goto(`/fr/checkout?class=${klass.id}`);
    await expect(sPage.locator(`time[datetime="${iso}"]`).filter({ hasText: want.clock }).first()).toBeVisible();

    // Book through the API, so the API writes the notifications with its own formatting.
    const token = await mintSession(student.id);
    const booked = await api("/bookings", token, { classId: klass.id });
    expect(booked.ok, JSON.stringify(booked)).toBe(true);

    await sPage.goto("/fr/student");
    await expect(sPage.locator(`time[datetime="${iso}"]`).first()).toContainText(want.clock, { timeout: 15_000 });
    await sPage.goto("/ar/student");
    await expect(sPage.locator(`time[datetime="${iso}"]`).first()).toContainText(want.monthAr, { timeout: 15_000 });
    await studentCtx.close();

    const tutorCtx = await contextAs(browser, tutorProfile.id);
    const dash = await tutorCtx.newPage();
    await dash.goto("/fr/dashboard");
    await expect(dash.locator(`time[datetime="${iso}"]`).first()).toContainText(want.clock, { timeout: 15_000 });
    await tutorCtx.close();

    const bodies = await sql<{ kind: string; body: string }[]>`
      select kind, body from notifications
       where profile_id in (${student.id}, ${tutorProfile.id}) and kind in ('booking_confirmed', 'new_booking')`;
    expect(bodies.map((b) => b.kind).sort()).toEqual(["booking_confirmed", "new_booking"]);
    for (const b of bodies) {
      expect(b.body, `${b.kind} says the Tunis time`).toContain(want.clock);
      expect(b.body, `${b.kind} does not say the UTC time`).not.toContain("17:00");
    }
  });

  test("a class at 23:30Z is on the NEXT day in Tunis, at 00:30", async ({ browser }) => {
    const at = utcAt(3, 23, 30);
    const want = tunis(at);
    expect(want.clock).toBe("00:30");
    expect(want.day).not.toBe(String(at.getUTCDate()));

    const tutor = await seedTutor({ status: "verified" });
    await seedClass({ tutorId: tutor.id, at });
    const ctx = await contextAs(browser);
    const page = await ctx.newPage();
    await page.goto(`/fr/${tutor.slug}`);
    const thumb = page.locator(`.sf-classes time.thumb[datetime="${at.toISOString()}"]`);
    await expect(thumb).toContainText(want.day);
    await expect(thumb).toContainText(want.month);
    await expect(page.locator(".sf-classes .sf-row").first()).toContainText("00:30");
    await ctx.close();
  });

  test("a tutor in São Paulo typing 18:00 creates a class at 18:00 Tunis time (17:00Z)", async ({ browser }) => {
    const target = utcAt(5, 17, 0);
    const want = tunis(target);
    const me = await seedProfile({ role: "tutor", birthYear: 1985 });
    const tutor = await seedTutor({ profileId: me.id, status: "verified" });

    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/new-class");
    // espace prof v2 · shell: the DD/MM/YYYY + 24 h picker, still read as Tunis time.
    await expect(page.getByText("Heure de Tunisie, sur 24 h.")).toBeVisible();
    await page.locator("form input[type=text]").first().fill("Révision fuseau horaire");
    await fillWallTime(page, want.wallInput);
    await page.getByPlaceholder("15").fill("20");
    await page.locator('form button[type="submit"]').click();

    await expect
      .poll(async () => {
        const rows = await sql<{ scheduled_at: Date }[]>`select scheduled_at from classes where tutor_id = ${tutor.id}`;
        return rows.map((r) => new Date(r.scheduled_at).toISOString());
      }, { timeout: 15_000 })
      .toEqual([target.toISOString()]);
    await ctx.close();
  });

  test("rescheduling round-trips: the form opens on the Tunis time, and 19:30 means 19:30 in Tunis", async ({ browser }) => {
    const at = utcAt(4, 17, 0);
    const moved = utcAt(4, 18, 30);
    const want = tunis(at);
    const wantMoved = tunis(moved);
    const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1983 });
    const tutor = await seedTutor({ profileId: tutorProfile.id, status: "verified" });
    const klass = await seedClass({ tutorId: tutor.id, at });
    const student = await seedProfile({ role: "student", birthYear: 1992 });
    expect((await api("/bookings", await mintSession(student.id), { classId: klass.id })).ok).toBe(true);

    const ctx = await contextAs(browser, tutorProfile.id);
    const page = await ctx.newPage();
    // espace prof v2 · shell: moving a class is « Modifier la date » on « Mes classes ».
    await page.goto("/fr/dashboard/classes");
    await page.getByRole("button", { name: "Modifier la date" }).click({ timeout: 15_000 });
    const dialog = page.locator("dialog[open]");
    await expect.poll(() => wallTimeOf(dialog), { message: "prefilled with the class's own time, in Tunis" }).toBe(want.wallInput);
    await expect(dialog.getByText("Heure de Tunisie, sur 24 h.")).toBeVisible();
    await fillWallTime(dialog, wantMoved.wallInput);
    await dialog.getByRole("button", { name: "Déplacer la séance" }).click();

    await expect.poll(() => scheduledAt(klass.id), { timeout: 15_000 }).toBe(moved.toISOString());
    await expect(page.locator(`time[datetime="${moved.toISOString()}"]`).first()).toContainText("19:30", { timeout: 15_000 });
    await ctx.close();

    const [note] = await sql<{ body: string }[]>`
      select body from notifications where profile_id = ${student.id} and kind = 'class_reminder'`;
    expect(note?.body).toContain("19:30");
  });
});
