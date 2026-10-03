import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { sql } from "./support/db";
import { seedClass, seedOffer, seedProfile, seedTutor } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-2 · F — THE KEYBOARD PASS ON THE PROF SHELL (FR + AR, 1440 and 390).

   « Tab order is logical. Focus is visible. The share sheet, calendar and dialogs
   trap focus and close with Esc. » Every stop below is reached with the real Tab key
   (so :focus-visible really matches) and checked the way a person checks it: a ring
   is painted, the control is on screen, and no bar covers it.

     THE FRAME   skip link → sidebar (1440) → top bar → main → action bar → tab bar (390),
                 never back; the skip link lands in main.
     MODAL       the share sheet, the calendar, the ConfirmDialogs, the edit dialog on
                 Mes fiches, the phone « Profil » sheet: focus moves in, Tab and Shift+Tab
                 stay in, Esc closes, focus returns to the control that opened it — and
                 when a confirmed action removed that control (« Retirer », « Oui,
                 annuler »), to its neighbour, never to <body>.
     DISCLOSURE  the « + » menu, the bell, the avatar menu, the « ? »: the next Tab goes
                 INTO what opened, Esc closes it and focus is back on its button, and
                 tabbing away closes it (an open panel left behind covers the page).
   tools/ui-audit/keyboard.mjs walks every route of the shell the same way
   (UI_AUDIT_VIEWPORTS=1440x900,390x844 UI_AUDIT_ROUTES=…).
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const DESK = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const LOCALES = ["fr", "ar"] as const;
const SCREENS = [
  { tag: "1440", vp: DESK },
  { tag: "390", vp: PHONE },
] as const;
const ORDER = ["skip", "sidebar", "topbar", "main", "actionbar", "tabbar"];

type Stop = {
  e2e: string | null; tag: string; text: string; key: number; region: string;
  ring: boolean; onScreen: boolean; covered: boolean;
};

/** A verified tutor with something behind every overlay: a class (share, move, cancel),
    two fiches (edit, remove), an unread notification (the bell), an offer and a request. */
async function world() {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName: "Walid Tester" });
  const klass = await seedClass({ tutorId: tutor.id, isFreeFirst: false, priceTnd: 30, hoursFromNow: 96, seats: 6 });
  for (const title of ["Fiches de révision : Analyse", "Annales corrigées : Probabilités"]) {
    await sql`insert into packs (id, tutor_id, title, description, price_tnd)
              values (${randomUUID()}, ${tutor.id}, ${title}, '36 pages · méthodes', '12')`;
  }
  await sql`insert into notifications (id, profile_id, kind, title, body, href)
            values (${randomUUID()}, ${profile.id}, 'new_booking', 'Nouvelle réservation', 'Yosra a réservé « Intégrales ».', '/dashboard/students')`;
  // An offer with a request: Abonnements has controls after its « ? », as a tutor's page does.
  const offer = await seedOffer({ tutorId: tutor.id, title: "Suivi Bac" });
  const student = await seedProfile({ role: "student", birthYear: 1999, fullName: "Yosra Trabelsi" });
  await sql`insert into student_subscriptions (offer_id, tutor_id, student_profile_id, status, sessions_per_month, price_tnd)
            values (${offer.id}, ${tutor.id}, ${student.id}, 'requested', 4, 120)`;
  return { profile, tutor, klass };
}

async function open(browser: Browser, profileId: string, vp: { width: number; height: number }, path: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  // The share sheet's networks stay on this machine.
  await ctx.addInitScript(() => {
    window.open = (() => null) as typeof window.open;
  });
  const page = await ctx.newPage();
  await page.goto(path, { waitUntil: "networkidle" });
  return { ctx, page };
}

/** Where focus is, and whether a person can see it: a ring (on the control, or on the
    box that rings for it), on screen, and not entirely under a bar. */
async function focused(page: Page): Promise<Stop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return null;
    const ringed = (n: Element) => {
      const s = getComputedStyle(n);
      return s.outlineStyle !== "none" && (parseFloat(s.outlineWidth) || 0) >= 2;
    };
    /* The box a person sees ringed: the control, or — for a visually hidden one (a radio
       inside its chip, 1×1 px) or a borderless input inside .inp — the box around it. */
    const big = (n: Element) => { const r = n.getBoundingClientRect(); return r.width >= 2 && r.height >= 2; };
    let box: Element = el;
    if (!(ringed(el) && big(el))) {
      for (let n = el.parentElement, h = 0; n && h < 2; n = n.parentElement, h++) {
        if (n.matches(":focus-within") && ringed(n)) { box = n; break; }
      }
    }
    const fv = el.matches(":focus-visible");
    const ring = ringed(box) || (fv && getComputedStyle(el).boxShadow !== "none");
    const b = box.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const onScreen = b.width >= 2 && b.height >= 2 && b.right > 0 && b.bottom > 0 && b.left < vw && b.top < vh;
    const ix = Math.min(4, b.width / 4);
    const iy = Math.min(4, b.height / 4);
    const pts = [
      [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
      [b.left + ix, b.top + iy], [b.right - ix, b.top + iy], [b.left + ix, b.bottom - iy], [b.right - ix, b.bottom - iy],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < vw && y < vh);
    const foreign = pts
      .map(([x, y]) => document.elementFromPoint(x, y))
      .filter((h) => h && h !== box && !box.contains(h) && !h.contains(box) && !el.contains(h));
    const region = el.matches(".skip-link") ? "skip"
      : el.closest("dialog") ? "dialog"
      : el.closest(".aps-side") ? "sidebar"
      : el.closest(".aps-top") ? "topbar"
      : el.closest(".aps-actionbar") ? "actionbar"
      : el.closest("main") ? "main"
      : el.closest(".aps-tabs") ? "tabbar"
      : "other";
    return {
      e2e: el.getAttribute("data-e2e"),
      tag: el.tagName.toLowerCase(),
      text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
      key: [...document.querySelectorAll("*")].indexOf(el),
      region,
      ring,
      onScreen,
      covered: pts.length > 0 && foreign.length === pts.length,
    };
  });
}

function expectSeen(s: Stop, where: string) {
  const what = `${where}: <${s.tag}> « ${s.text} »${s.e2e ? ` [${s.e2e}]` : ""}`;
  expect(s.ring, `${what} shows a focus ring`).toBe(true);
  expect(s.onScreen, `${what} is on screen`).toBe(true);
  expect(s.covered, `${what} is not hidden under a bar`).toBe(false);
}

/** The whole Tab cycle of the page, from the top, once. */
async function walk(page: Page, max = 160): Promise<Stop[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  const stops: Stop[] = [];
  const keys = new Set<number>();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await focused(page);
    if (!s) {
      if (stops.length) break; // past the last control: the browser's own UI
      continue;
    }
    if (keys.has(s.key)) break;
    keys.add(s.key);
    stops.push(s);
  }
  return stops;
}

/** Tab (forward) until `target` has focus — the way a keyboard user gets there. */
async function tabTo(page: Page, target: Locator, max = 160) {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`could not Tab to ${target}`);
}

const inside = (box: Locator) => box.evaluate((el) => el.contains(document.activeElement));

/** Esc on the open native <dialog>, and wait until its `close` event has run. The browser
    closes the dialog and gives focus back at once, but QUEUES `close` — the event in which
    the page clears the state that opened it. A key sent in the same millisecond (as a test
    can, as a person cannot) would land before it: a re-open would set the same state, then
    `close` would clear it. */
async function escapeDialog(page: Page) {
  // Listen first (awaited, so it is in place before the key), then press, then wait.
  await page.evaluate(() => {
    const w = window as unknown as { __kbClosed?: Promise<void> };
    w.__kbClosed = new Promise<void>((resolve) => {
      const d = document.querySelector("dialog[open]");
      if (!d) return resolve();
      d.addEventListener("close", () => setTimeout(resolve, 0), { once: true });
    });
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => (window as unknown as { __kbClosed?: Promise<void> }).__kbClosed);
}

/** Tab and Shift+Tab well past the number of controls: focus never reaches the page
    behind `box`, and every stop in it is visible.

    `native`: a modal <dialog> (showModal). Chrome makes the page behind inert and, past
    the last control, passes focus through ITS OWN toolbar (the address bar; nothing of
    the page — document.activeElement is the body) before the first control again. That
    one step is the browser's, so it is allowed — once, never twice in a row. The
    calendar is not a native dialog: it wraps by itself, with no such step. */
async function expectTrapped(page: Page, box: Locator, where: string, presses = 14, native = true) {
  const seen = new Set<number>();
  for (const key of ["Tab", "Shift+Tab"]) {
    let away = 0;
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(key);
      const s = await focused(page);
      if (!s && native) {
        away++;
        expect(away, `${where}: ${key} ×${i + 1} — focus comes straight back from the browser's toolbar`).toBe(1);
        continue;
      }
      away = 0;
      expect(s, `${where}: ${key} ×${i + 1} keeps focus on a control`).not.toBeNull();
      expect(await inside(box), `${where}: ${key} ×${i + 1} stays inside (now on « ${s!.text} »)`).toBe(true);
      expectSeen(s!, `${where} ${key} ×${i + 1}`);
      seen.add(s!.key);
    }
  }
  expect(seen.size, `${where}: Tab moves between the controls inside`).toBeGreaterThan(1);
}

/* ── THE FRAME ─────────────────────────────────────────────────────────────── */

test.describe("F · the frame: skip link → sidebar → top bar → main → action bar → tab bar", () => {
  for (const loc of LOCALES) {
    for (const { tag, vp } of SCREENS) {
      test(`${loc} · ${tag}: Accueil and Nouvelle classe — the order, a ring on every stop, nothing off screen or under a bar`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard`);

        for (const path of ["/dashboard", "/dashboard/new-class"]) {
          if (path !== "/dashboard") await page.goto(`/${loc}${path}`, { waitUntil: "networkidle" });
          const stops = await walk(page);
          const where = `${loc} ${tag} ${path}`;
          expect(stops[0]?.region, `${where}: the first Tab is the skip link`).toBe("skip");

          let at = -1;
          for (const s of stops) {
            expectSeen(s, where);
            const i = ORDER.indexOf(s.region);
            expect(i, `${where}: « ${s.text} » sits in the frame (${s.region})`).toBeGreaterThanOrEqual(0);
            expect(i, `${where}: « ${s.text} » (${s.region}) never comes back after the ${ORDER[at]}`).toBeGreaterThanOrEqual(at);
            at = i;
          }
          const regions = new Set(stops.map((s) => s.region));
          if (vp === DESK) {
            for (const r of ["sidebar", "topbar", "main"]) expect(regions.has(r), `${where}: reaches the ${r}`).toBe(true);
            expect(regions.has("tabbar"), `${where}: no phone tab bar on a computer`).toBe(false);
            // The avatar card closes the sidebar; the bell closes the top bar.
            const side = stops.filter((s) => s.region === "sidebar");
            const top = stops.filter((s) => s.region === "topbar");
            expect(side.at(-1)?.e2e).toBe("shell-me");
            expect(top.at(-1)?.e2e).toBe("shell-bell");
          } else {
            expect(regions.has("sidebar"), `${where}: no sidebar on a phone`).toBe(false);
            for (const r of ["topbar", "main"]) expect(regions.has(r), `${where}: reaches the ${r}`).toBe(true);
            // A form page shows ONE bar on a phone — its action bar; any other page has the tab bar.
            if (path === "/dashboard") expect(stops.at(-1)?.region, `${where}: ends in the tab bar`).toBe("tabbar");
            else expect(regions.has("tabbar"), `${where}: a phone form has no tab bar`).toBe(false);
          }
          if (path === "/dashboard/new-class") expect(stops.at(-1)?.region, `${where}: ends in the action bar`).toBe("actionbar");
        }
        await ctx.close();
      });
    }
  }

  test("the check itself: a control under the tab bar, or off screen, is caught; the same control in view passes", async ({ browser }) => {
    const { profile } = await world();
    const { ctx, page } = await open(browser, profile.id, PHONE, "/fr/dashboard");
    const place = (top: number) =>
      page.evaluate((t) => {
        let b = document.querySelector<HTMLButtonElement>("[data-e2e=kb-probe]");
        if (!b) {
          b = document.createElement("button");
          b.type = "button";
          b.textContent = "probe";
          b.dataset.e2e = "kb-probe";
          document.querySelector("main")!.append(b);
        }
        const tabs = document.querySelector(".aps-tabs")!.getBoundingClientRect();
        // Below the fixed tab bar's layer, at the height asked (or on the bar itself).
        b.style.cssText = `position:fixed;inset-inline-start:24px;top:${t === -1 ? tabs.top + 6 : t}px;width:80px;height:28px;z-index:1`;
        b.focus();
      }, top);
    await place(-1);
    const under = (await focused(page))!;
    expect(under.e2e).toBe("kb-probe");
    expect(under.covered, "a control under the tab bar is caught").toBe(true);
    await place(-200);
    expect((await focused(page))!.onScreen, "a control above the screen is caught").toBe(false);
    await place(300);
    const fine = (await focused(page))!;
    expect(fine.covered).toBe(false);
    expect(fine.onScreen).toBe(true);
    await ctx.close();
  });

  test("the skip link is seen, and lands in main: the next Tab is the page's first control", async ({ browser }) => {
    const { profile } = await world();
    for (const loc of LOCALES) {
      for (const { vp } of SCREENS) {
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/materials`);
        await page.keyboard.press("Tab");
        const skip = await focused(page);
        expect(skip?.region).toBe("skip");
        expectSeen(skip!, `${loc} ${vp.width} skip link`);
        await page.keyboard.press("Enter");
        await expect(page.locator("main#main")).toBeFocused();
        await page.keyboard.press("Tab");
        expect((await focused(page))?.region, `${loc} ${vp.width}: after the skip link`).toBe("main");
        await ctx.close();
      }
    }
  });
});

/* ── MODAL: trapped, Esc closes, focus returns ──────────────────────────────── */

test.describe("F · modal overlays trap focus, close with Esc and give focus back", () => {
  for (const loc of LOCALES) {
    for (const { tag, vp } of SCREENS) {
      test(`${loc} · ${tag}: the share sheet (Ma vitrine)`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/storefront`);
        const trigger = page.locator("[data-e2e=share-open-profile]").first();
        await tabTo(page, trigger);
        await page.keyboard.press("Enter");
        const sheet = page.locator("[data-e2e=share-sheet]");
        await expect(sheet).toBeVisible();
        expect(await inside(sheet), "focus moved into the sheet").toBe(true);
        await expectTrapped(page, sheet, `${loc} ${tag} share sheet`, 20);
        await escapeDialog(page);
        await expect(sheet).toBeHidden();
        await expect(trigger).toBeFocused();
        await ctx.close();
      });

      test(`${loc} · ${tag}: the calendar (Nouvelle classe) — Tab cycles inside it, Esc closes from any of its buttons`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/new-class`);
        const toggle = page.locator("[data-e2e=date-open]");
        const cal = page.locator("[data-e2e=date-calendar]");
        await tabTo(page, toggle);
        await page.keyboard.press("Enter");
        await expect(cal).toBeVisible();
        expect(await inside(cal), "focus moved onto a day").toBe(true);
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-date"))).toBe(true);
        await expectTrapped(page, cal, `${loc} ${tag} calendar`, 6, false);

        // Esc from the day grid…
        await page.keyboard.press("Escape");
        await expect(cal).toHaveCount(0);
        await expect(toggle).toBeFocused();
        // …and from the month buttons (prev/next): the same.
        await page.keyboard.press("Enter");
        await expect(cal).toBeVisible();
        await page.keyboard.press("Shift+Tab"); // the next-month button
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-date"))).toBe(false);
        expect(await inside(cal)).toBe(true);
        await page.keyboard.press("Escape");
        await expect(cal).toHaveCount(0);
        await expect(toggle).toBeFocused();
        await ctx.close();
      });

      test(`${loc} · ${tag}: Mes classes — « Annuler » and « Modifier » (a ConfirmDialog, with a calendar inside)`, async ({ browser }) => {
        const { profile, klass } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/classes`);
        const dialog = page.locator("dialog[open][data-e2e=confirm-dialog]");

        const cancel = page.locator("[data-e2e=class-cancel]").first();
        await tabTo(page, cancel);
        await page.keyboard.press("Enter");
        await expect(dialog).toBeVisible();
        expect(await inside(dialog)).toBe(true);
        await expectTrapped(page, dialog, `${loc} ${tag} cancel dialog`, 5);
        await escapeDialog(page);
        await expect(dialog).toHaveCount(0);
        await expect(cancel).toBeFocused();

        const move = page.locator("[data-e2e=class-edit]").first();
        await tabTo(page, move);
        await page.keyboard.press("Enter");
        await expect(dialog).toBeVisible();
        await expectTrapped(page, dialog, `${loc} ${tag} move dialog`, 8);
        // The calendar inside the dialog: Esc closes the calendar, not the dialog.
        const toggle = dialog.locator("[data-e2e=date-open]");
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(dialog.locator("[data-e2e=date-calendar]")).toBeVisible();
        await page.keyboard.press("Shift+Tab"); // a month button, not the grid
        await page.keyboard.press("Escape");
        await expect(dialog.locator("[data-e2e=date-calendar]")).toHaveCount(0);
        await expect(dialog, "Esc in the calendar leaves the dialog open").toBeVisible();
        await expect(toggle).toBeFocused();
        await escapeDialog(page);
        await expect(dialog).toHaveCount(0);
        await expect(move).toBeFocused();

        // Confirmed, « Annuler » is gone: the class moves to « Passées », and focus goes with it
        // (the first control after the place it held) — not to <body>.
        const row = page.locator(`[data-e2e=class-row][data-class-id="${klass.id}"]`);
        await tabTo(page, cancel);
        await page.keyboard.press("Enter");
        await expect(dialog.locator("button").first()).toBeFocused();
        await page.keyboard.press("Tab"); // « Oui, annuler »
        await page.keyboard.press("Enter");
        await expect(row.locator("[data-e2e=class-cancel]")).toHaveCount(0);
        await expect.poll(async () => (await focused(page))?.region, { message: "focus did not fall to the page" }).toBe("main");
        expect(await row.evaluate((el) => el.contains(document.activeElement)), "focus is on the same row").toBe(true);
        expectSeen((await focused(page))!, `${loc} ${tag} after « Oui, annuler »`);
        await ctx.close();
      });

      test(`${loc} · ${tag}: Mes fiches — the edit dialog and « Retirer »`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/materials`);

        const pencil = page.locator("[data-e2e=fiche-edit]").first();
        const edit = page.locator("dialog[open][data-e2e=fiche-edit-dialog]");
        await tabTo(page, pencil);
        await page.keyboard.press("Enter");
        await expect(edit).toBeVisible();
        await expect(page.locator("[data-e2e=fiche-edit-title]")).toBeFocused();
        await expectTrapped(page, edit, `${loc} ${tag} edit dialog`, 10);
        await escapeDialog(page);
        await expect(edit).toHaveCount(0);
        await expect(pencil).toBeFocused();

        const remove = page.locator("[data-e2e=pack-remove]").first();
        const confirm = page.locator("dialog[open][data-e2e=confirm-dialog]");
        await tabTo(page, remove);
        await page.keyboard.press("Enter");
        await expect(confirm).toBeVisible();
        expect(await inside(confirm)).toBe(true);
        await expectTrapped(page, confirm, `${loc} ${tag} remove dialog`, 5);
        await escapeDialog(page);
        await expect(confirm).toHaveCount(0);
        await expect(remove).toBeFocused();

        // Confirmed, the row is gone: focus goes to the next row, not to <body>.
        await page.keyboard.press("Enter");
        await expect(confirm.locator("button").first()).toBeFocused();
        await page.keyboard.press("Tab"); // « Retirer » in the dialog
        await page.keyboard.press("Enter");
        await expect(page.locator("[data-e2e=fiche-row]")).toHaveCount(1);
        await expect.poll(async () => (await focused(page))?.region, { message: "focus did not fall to the page" }).toBe("main");
        expect(await page.locator("[data-e2e=fiche-list]").evaluate((el) => el.contains(document.activeElement))).toBe(true);
        expectSeen((await focused(page))!, `${loc} ${tag} after « Retirer »`);
        await ctx.close();
      });
    }

    test(`${loc} · 390: the « Profil » sheet`, async ({ browser }) => {
      const { profile } = await world();
      const { ctx, page } = await open(browser, profile.id, PHONE, `/${loc}/dashboard`);
      const tab = page.locator("[data-e2e=tab-profile]");
      const sheet = page.locator("dialog[open][data-e2e=shell-sheet]");
      await tabTo(page, tab);
      await page.keyboard.press("Enter");
      await expect(sheet).toBeVisible();
      expect(await inside(sheet)).toBe(true);
      await expectTrapped(page, sheet, `${loc} 390 profile sheet`, 18);
      await escapeDialog(page);
      await expect(sheet).toHaveCount(0);
      await expect(tab).toBeFocused();
      await ctx.close();
    });
  }
});

/* ── DISCLOSURE: the next Tab goes in, Esc gives focus back, leaving closes ──── */

/** Opened with Enter on `trigger`: Tab goes into `panel` and through it; Esc closes it
    with focus back on `trigger`; tabbing past its last control closes it. */
async function expectDisclosure(page: Page, trigger: Locator, panel: Locator, where: string, items: number) {
  await tabTo(page, trigger);
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  // The bell's list arrives after the click: wait for its controls, not just the panel.
  await expect(panel.locator("a[href], button")).toHaveCount(items);
  for (let i = 0; i < items; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(panel), `${where}: Tab ×${i + 1} is inside what opened`).toBe(true);
    expectSeen((await focused(page))!, `${where} Tab ×${i + 1}`);
  }
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  // Leaving it closes it: nothing stays open over the page.
  await page.keyboard.press("Enter");
  await expect(panel).toBeVisible();
  await expect(panel.locator("a[href], button")).toHaveCount(items);
  for (let i = 0; i <= items; i++) await page.keyboard.press("Tab");
  await expect(panel, `${where}: tabbing away closes it`).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  const next = await focused(page);
  expect(next, `${where}: focus went on to the next control`).not.toBeNull();
  expectSeen(next!, `${where} after leaving`);
}

test.describe("F · menus and « ? »: Tab goes in, Esc gives focus back, leaving closes", () => {
  for (const loc of LOCALES) {
    test(`${loc} · 390: the « + » menu`, async ({ browser }) => {
      const { profile } = await world();
      const { ctx, page } = await open(browser, profile.id, PHONE, `/${loc}/dashboard`);
      await expectDisclosure(page, page.locator("[data-e2e=shell-fab]"), page.locator("[data-e2e=shell-fab-menu]"), `${loc} « + »`, 2);
      await ctx.close();
    });

    test(`${loc} · 1440: the avatar menu`, async ({ browser }) => {
      const { profile } = await world();
      const { ctx, page } = await open(browser, profile.id, DESK, `/${loc}/dashboard`);
      await expectDisclosure(page, page.locator("[data-e2e=shell-me]"), page.locator("[data-e2e=shell-me-menu]"), `${loc} avatar`, 3);
      await ctx.close();
    });

    for (const { tag, vp } of SCREENS) {
      test(`${loc} · ${tag}: the bell`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard`);
        const panel = page.locator("#aps-bell-panel");
        await expectDisclosure(page, page.locator("[data-e2e=shell-bell]"), panel, `${loc} ${tag} bell`, 1);
        await ctx.close();
      });

      test(`${loc} · ${tag}: the « ? » on Promotions and Abonnements`, async ({ browser }) => {
        const { profile } = await world();
        const { ctx, page } = await open(browser, profile.id, vp, `/${loc}/dashboard/promotions`);
        for (const [path, e2e] of [["/dashboard/promotions", "promo-info"], ["/dashboard/subscriptions", "subs-info"]] as const) {
          if (!page.url().endsWith(path)) await page.goto(`/${loc}${path}`, { waitUntil: "networkidle" });
          const btn = page.locator(`[data-e2e=${e2e}]`);
          const bubble = page.locator(`[data-e2e=${e2e}-text]`);
          const where = `${loc} ${tag} ${e2e}`;

          // Enter opens it; Esc closes it; focus never left the « ? ».
          await tabTo(page, btn);
          expectSeen((await focused(page))!, where);
          await page.keyboard.press("Enter");
          await expect(bubble).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(bubble).toBeHidden();
          await expect(btn).toBeFocused();
          await expect(btn).toHaveAttribute("aria-expanded", "false");

          // Tabbing away from an open « ? » closes it, so it never sits over the next field.
          await page.keyboard.press("Enter");
          await expect(bubble).toBeVisible();
          await page.keyboard.press("Tab");
          await expect(bubble, `${where}: tabbing away closes it`).toBeHidden();
          expectSeen((await focused(page))!, `${where} next control`);

          // Shown by the mouse alone, Esc dismisses it too (WCAG 1.4.13), the mouse still on it.
          if (vp === DESK) {
            await btn.hover();
            await expect(bubble).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(bubble, `${where}: Esc dismisses the hover bubble`).toBeHidden();
            await page.mouse.move(0, 0);
          }
        }
        await ctx.close();
      });
    }
  }
});
