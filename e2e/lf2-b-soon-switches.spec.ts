import { test, expect, type Locator, type Page } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";
import { sql } from "./support/db";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-2 · B — Réglages › Notifications: a « Bientôt » switch is drawn OFF.

   Messages and Abonnés send a tutor no e-mail today (live-fixes-1 · F1), so their
   switch is disabled with a « Bientôt » tag. It used to be drawn in the stored state
   — on by default — i.e. the blue « on » track, dimmed, which read as « on but
   broken ». Now: aria-checked="false", the OFF track (the --muted token, compared
   against the token's resolved value, not a hex) and the knob at the inline start,
   with the tag kept. What is STORED for those two is untouched, and Réservations /
   Rappels are still working switches that show their stored state.
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const SOON = ["messages", "followers"] as const;

/** The resolved colour of a token, read in the panel (so any scoped override applies). */
async function token(page: Page, name: string): Promise<string> {
  return page.locator("[data-e2e=settings-notifications]").evaluate((panel, n) => {
    const probe = document.createElement("span");
    probe.style.background = `var(${n})`;
    panel.appendChild(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  }, name);
}

/** The track's colour and how far the knob sits from the track's inline START. */
async function drawn(sw: Locator) {
  return sw.evaluate((el) => {
    const track = el.querySelector(".aps-switch-track")!;
    const thumb = el.querySelector(".aps-switch-thumb")!.getBoundingClientRect();
    const tr = track.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === "rtl";
    return { track: getComputedStyle(track).backgroundColor, knobFromStart: Math.round(rtl ? tr.right - thumb.right : thumb.left - tr.left) };
  });
}

test.describe("B · « Bientôt » switches are drawn off", () => {
  for (const [loc, soonTag] of [["fr", "Bientôt"], ["ar", "قريب"]] as const) {
    test(`Messages and Abonnés: off, disabled, tagged; the stored choice untouched (${loc})`, async ({ browser }) => {
      const me = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Sonia Gharbi" });
      await seedTutor({ profileId: me.id, status: "verified", fullName: "Sonia Gharbi" });
      // Stored ON for the two coming-soon e-mails (the default) — and one working switch off.
      await sql`insert into notification_prefs (profile_id, followers, bookings, messages, reminders)
                values (${me.id}, true, false, true, true)`;

      const ctx = await contextAs(browser, me.id);
      const page = await ctx.newPage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/${loc}/dashboard/settings?tab=notifications`, { waitUntil: "networkidle" });
      await expect(page.locator("[data-e2e=settings-notifications]")).toBeVisible();
      const off = await token(page, "--muted");
      const on = await token(page, "--blue");
      expect(off, "the two tokens resolve to different colours").not.toBe(on);

      for (const k of SOON) {
        const row = page.locator(`[data-e2e=pref-${k}]`);
        const sw = row.getByRole("switch");
        await expect(row.locator(".tag-soon"), `${k}: the tag is kept`).toHaveText(soonTag);
        await expect(sw, `${k}: not switchable`).toBeDisabled();
        await expect(sw, `${k}: announced off`).toHaveAttribute("aria-checked", "false");
        const d = await drawn(sw);
        expect(d.track, `${k}: the OFF track (--muted)`).toBe(off);
        expect(d.knobFromStart, `${k}: the knob at the inline start (off)`).toBeLessThanOrEqual(4);
      }

      // The working switches are unchanged: they show what is stored and they switch.
      const bookings = page.locator("[data-e2e=pref-bookings]").getByRole("switch");
      const reminders = page.locator("[data-e2e=pref-reminders]").getByRole("switch");
      await expect(bookings).toBeEnabled();
      await expect(bookings).toHaveAttribute("aria-checked", "false");
      expect((await drawn(bookings)).track).toBe(off);
      await expect(reminders).toBeEnabled();
      await expect(reminders).toHaveAttribute("aria-checked", "true");
      const r = await drawn(reminders);
      expect(r.track, "a working switch that is on is blue").toBe(on);
      expect(r.knobFromStart, "…with its knob at the inline end").toBeGreaterThan(10);

      await bookings.click();
      await expect(bookings).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => (await sql<{ bookings: boolean }[]>`
        select bookings from notification_prefs where profile_id = ${me.id}`)[0].bookings).toBe(true);

      // Drawn off, stored on: nothing about the two coming-soon e-mails was written.
      const [row] = await sql<{ messages: boolean; followers: boolean }[]>`
        select messages, followers from notification_prefs where profile_id = ${me.id}`;
      expect(row).toEqual({ messages: true, followers: true });
      await ctx.close();
    });
  }

  test("a tutor with no stored preferences: the « Bientôt » switches are off, the working ones on", async ({ browser }) => {
    const me = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Karim Ayari" });
    await seedTutor({ profileId: me.id, status: "verified", fullName: "Karim Ayari" });
    const ctx = await contextAs(browser, me.id);
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard/settings?tab=notifications", { waitUntil: "networkidle" });
    for (const k of SOON) await expect(page.locator(`[data-e2e=pref-${k}]`).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    for (const k of ["bookings", "reminders"]) await expect(page.locator(`[data-e2e=pref-${k}]`).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    const rows = await sql`select 1 from notification_prefs where profile_id = ${me.id}`;
    expect(rows.length, "opening the tab writes nothing").toBe(0);
    await ctx.close();
  });
});
