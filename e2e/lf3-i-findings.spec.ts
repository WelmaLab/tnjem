import { test, expect, type Browser } from "@playwright/test";
import { seedClass, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* live-fixes-3 · I — what the gate's screenshots showed wrong on pages A–H touched,
   each fixed in I and pinned here (each test fails on 8a2725b):

     1. the live lobby: the avatar sat at the inline start of a centred stage —
        .avatar is a grid box, so the stage's text-align never moved it;
     2. the checkout: the date badge is solid blue with white text, but its month kept
        .thumb span's grey (--muted on --blue, 1.2:1) — the class page had already
        fixed the same badge (.cd-when);
     3. the « moins de 48 h » note (C): in the storefront's narrow aside a line began
        with « : », and the phone bar split « 15 / min » — no-break spaces now hold
        « 48 h », « 15 min », « 40 % » together and keep « : » on its line.
   ADDED as its own spec. */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const HOST = new URL(BASE_URL).hostname;
const NB = String.fromCharCode(0xa0); // U+00A0 NO-BREAK SPACE

async function world() {
  const tp = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "walid tester" });
  const tutor = await seedTutor({ profileId: tp.id, status: "verified", fullName: "walid tester" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 10, hoursFromNow: 30, seats: 8 });
  const student = await seedProfile({ role: "student", birthYear: 1996 });
  return { tp, tutor, klass, student };
}

async function pageAs(browser: Browser, profileId: string, role: "tutor" | "student", viewport: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: role, domain: HOST, path: "/" }]);
  return ctx.newPage();
}

for (const loc of ["fr", "ar"] as const) {
  test(`I · ${loc}: the lobby's avatar is centred in the stage, at 1440 and 390`, async ({ browser }) => {
    const w = await world();
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await pageAs(browser, w.tp.id, "tutor", vp);
      await page.goto(`/${loc}/live/${w.klass.id}`);
      const avatar = page.locator("main .avatar").first();
      const title = page.locator("main h1").first();
      await expect(avatar).toBeVisible({ timeout: 20_000 });
      const [a, t] = await Promise.all([avatar.boundingBox(), title.boundingBox()]);
      expect(Math.abs(a!.x + a!.width / 2 - (t!.x + t!.width / 2)), `${vp.width}: the avatar's centre is the stage's`).toBeLessThanOrEqual(1);
      await page.context().close();
    }
  });

  test(`I · ${loc}: the checkout's date badge — the month in the badge's white, not grey on blue`, async ({ browser }) => {
    const w = await world();
    const page = await pageAs(browser, w.student.id, "student", { width: 1440, height: 900 });
    await page.goto(`/${loc}/checkout?class=${w.klass.id}`);
    const badge = page.locator(".ck-class .thumb");
    await expect(badge).toBeVisible({ timeout: 20_000 });
    const [badgeColor, monthColor, dayColor] = await Promise.all([
      badge.evaluate((el) => getComputedStyle(el).color),
      badge.locator("span").evaluate((el) => getComputedStyle(el).color),
      badge.locator("b").evaluate((el) => getComputedStyle(el).color),
    ]);
    expect(badgeColor).toBe("rgb(255, 255, 255)");
    expect(monthColor, "the month").toBe(badgeColor);
    expect(dayColor, "the day").toBe(badgeColor);
    await page.context().close();
  });

  test(`I · ${loc}: the < 48 h note keeps « 48 h », « 15 min », « 40 % » and « : » on one line`, async ({ browser }) => {
    const w = await world();
    const page = await pageAs(browser, w.student.id, "student", { width: 1440, height: 900 });
    await page.goto(`/${loc}/checkout?class=${w.klass.id}`);
    const note = page.locator("[data-e2e=late-cancel-note]");
    await expect(note).toBeVisible({ timeout: 20_000 });
    const raw = (await note.textContent()) ?? "";
    if (loc === "fr") {
      expect(raw).toContain(`48${NB}h${NB}: après 15${NB}min`);
      expect(raw).toContain(`40${NB}%`);
    } else {
      expect(raw).toContain(`48${NB}ساعة${NB}: بعد 15${NB}دقيقة`);
      expect(raw).toContain(`40${NB}%`);
    }
    // And where it broke: the storefront's aside — no rendered line starts with « : ».
    await page.goto(`/${loc}/${w.tutor.slug}`);
    const aside = page.locator("[data-sf-aside=true] [data-e2e=late-cancel-note] p");
    await expect(aside).toBeVisible({ timeout: 20_000 });
    const lineStarts = await aside.evaluate((p) => {
      const text = p.firstChild as Text;
      const starts: string[] = [];
      let lastTop = -1;
      for (let i = 0; i < text.length; i++) {
        const r = document.createRange();
        r.setStart(text, i);
        r.setEnd(text, i + 1);
        const box = r.getClientRects()[0];
        if (!box) continue;
        if (Math.round(box.top) > lastTop + 2) {
          starts.push(text.data[i]);
          lastTop = Math.round(box.top);
        }
      }
      return starts;
    });
    expect(lineStarts.length, "the note wraps in the aside").toBeGreaterThan(1);
    expect(lineStarts.filter((ch) => ch === ":"), "no line begins with « : »").toEqual([]);
    await page.context().close();
  });
}
