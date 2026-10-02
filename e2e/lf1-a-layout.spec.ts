import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedClass, seedOffer, seedProfile, seedPromotion, seedTutor } from "./support/seed";
import { loginAs, mintSession } from "./support/session";
import { api } from "./support/journey";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   live-fixes-1 · A — THE LAYOUT OF THE PROF SPACE (the founder's live review).

     A1  the sticky « Annuler / Publier » bar never sits on a field: on every form
         page, FR and AR, at 1440×674, 1440×900 and 390×844, every field scrolled
         to is the element under its own centre — not a bar, not the « + »;
         and at the end of the page the last field sits above whatever is pinned;
     A2  on a phone, form pages show the action bar only — no tab bar, no « + » —
         pinned to the bottom edge; normal pages keep both;
     A3  the « + » never covers interactive content (« Copier le lien », AR home, 390):
         it is the raised middle slot of the tab bar, not a button floating over the page;
     A4  the sidebar is the viewport's height and stays put; at 1440×674 the avatar
         card is on screen, and from ~640px tall the whole nav fits;
     A5  one width for the prof space, one for single-column forms: every page's
         title starts at the same place.
   ADDED as its own spec.
   ════════════════════════════════════════════════════════════════════════════ */

const HOST = new URL(BASE_URL).hostname;
const LOCALES = ["fr", "ar"] as const;
type Locale = (typeof LOCALES)[number];
const VIEWPORTS = [
  { width: 1440, height: 674 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
const PHONE = { width: 390, height: 844 };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function tutorCtx(browser: Browser, profileId: string, viewport: { width: number; height: number }): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce" });
  await loginAs(ctx, profileId);
  await ctx.addCookies([{ name: "tnajem_role", value: "tutor", domain: HOST, path: "/" }]);
  return ctx;
}

/** A verified tutor with what every form needs to render in full: a class (the
    promotion's target list), a monthly offer, a live promotion (the new-class hint). */
async function verifiedTutor() {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: profile.id, status: "verified", fullName: "Walid Tester" });
  await seedClass({ tutorId: tutor.id, hoursFromNow: 72, priceTnd: 40 });
  await seedOffer({ tutorId: tutor.id, title: "Suivi Bac — 4 séances" });
  await seedPromotion({ tutorId: tutor.id, percent: 10 });
  return { profile, tutor };
}

async function draftTutor() {
  const profile = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: profile.id, status: "draft", fullName: "Walid Tester" });
  return { profile, tutor };
}

/* ── the field sweep ─────────────────────────────────────────────────────────
   A « field » is any form control in <main>. When the control itself is visually
   hidden (the radio inside a chip, the file input inside a drop zone or a card),
   the field is the label the tutor actually taps. Fields are tagged in DOM order,
   then each is scrolled to the NEAREST edge (the least scrolling there is — what
   focus and Tab do, and exactly what put a field under the bar mid-scroll), and the
   element under its centre must be the field itself or inside it. */
const CONTROLS = "input:not([type=hidden]), textarea, select, [role=switch], [role=checkbox], [role=radio], [role=slider], [role=combobox], [role=spinbutton]";

async function tagFields(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    document.querySelectorAll("[data-lf1-field]").forEach((el) => el.removeAttribute("data-lf1-field"));
    const main = document.querySelector("main");
    if (!main) return 0;
    const boxes: Element[] = [];
    for (const el of Array.from(main.querySelectorAll(sel))) {
      if (el.closest(".aps-actionbar")) continue;
      const own = el.getBoundingClientRect();
      const box = own.width < 4 || own.height < 4 ? el.closest("label") : el;
      if (!box) continue;
      const r = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      if (r.width < 4 || r.height < 4 || cs.visibility === "hidden") continue;
      if (!boxes.includes(box)) boxes.push(box);
    }
    boxes.forEach((b, i) => b.setAttribute("data-lf1-field", String(i)));
    return boxes.length;
  }, CONTROLS);
}

async function sweep(page: Page, label: string): Promise<number> {
  const n = await tagFields(page);
  const misses: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate((i) => {
      const el = document.querySelector(`[data-lf1-field="${i}"]`)!;
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const say = (e: Element | null) =>
        e ? `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ""}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/).slice(0, 2).join(".")}` : ""}` : "nothing";
      const name = el.getAttribute("name") ?? el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? (el.textContent ?? "").trim().slice(0, 24);
      return { ok: !!hit && (hit === el || el.contains(hit)), what: `${say(el)} « ${name} »`, hit: say(hit), y: Math.round(b.top + b.height / 2), vh: innerHeight };
    }, i);
    if (!r.ok) misses.push(`${r.what} (centre y=${r.y} of ${r.vh}) is under ${r.hit}`);
  }
  expect(misses, `${label}: a field scrolled to is covered`).toEqual([]);

  /* The end of the page: scrolled all the way down, the lowest field ends above
     everything pinned to the bottom of the screen (bar, tab bar, « + »). */
  if (n > 0) {
    const end = await page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      const fields = Array.from(document.querySelectorAll("[data-lf1-field]")).map((e) => e.getBoundingClientRect());
      const last = fields.reduce((a, b) => (b.bottom > a.bottom ? b : a));
      const pinned = Array.from(document.querySelectorAll(".aps-actionbar, .aps-tabs"))
        .filter((e) => getComputedStyle(e).display !== "none" && getComputedStyle(e).position === "fixed")
        .map((e) => e.getBoundingClientRect())
        .filter((p) => p.width > 0 && p.height > 0 && p.left < last.right && p.right > last.left);
      return { lastBottom: Math.round(last.bottom), pinnedTop: pinned.length ? Math.round(Math.min(...pinned.map((p) => p.top))) : null };
    });
    if (end.pinnedTop !== null) expect(end.lastBottom, `${label}: the last field ends above the pinned bars`).toBeLessThanOrEqual(end.pinnedTop);
  }
  return n;
}

/** Open every folded section of the page (« Outils de la séance », « Mes liens »…). */
async function unfold(page: Page) {
  await page.locator("main details:not([open]) > summary").evaluateAll((els) => els.forEach((e) => (e as HTMLElement).click()));
}

type FormPage = {
  name: string;
  path: string;
  who: "verified" | "draft";
  run: (page: Page, label: string) => Promise<number>;
};

const FORM_PAGES: FormPage[] = [
  {
    name: "new-class",
    path: "/dashboard/new-class",
    who: "verified",
    run: async (page, label) => {
      await expect(page.locator("main form .aps-actionbar")).toBeVisible();
      await unfold(page);
      // A price, so the promotion line (« −10 % … ») is on the page too.
      const price = page.locator('main input[placeholder="15"]');
      if (await price.count()) await price.fill("40");
      return sweep(page, label);
    },
  },
  {
    name: "new-pack",
    path: "/dashboard/new-pack",
    who: "verified",
    run: async (page, label) => {
      await expect(page.locator("main form .aps-actionbar")).toBeVisible();
      await unfold(page);
      return sweep(page, label);
    },
  },
  {
    name: "verify",
    path: "/onboarding/verify",
    who: "draft",
    run: async (page, label) => {
      await expect(page.locator("[data-e2e=verify-step-1]")).toBeVisible();
      let n = await sweep(page, `${label} · step 1`);
      await page.locator("[data-e2e=verify-card-idFront] input[type=file]").setInputFiles({ name: "cin.png", mimeType: "image/png", buffer: PNG });
      await page.locator("[data-e2e=verify-next]").click();
      await expect(page.locator("[data-e2e=verify-step-2]")).toBeVisible();
      await unfold(page);
      n += await sweep(page, `${label} · step 2`);
      await page.locator("[data-e2e=verify-next]").click();
      await expect(page.locator("[data-e2e=verify-step-3]")).toBeVisible();
      n += await sweep(page, `${label} · step 3`);
      return n;
    },
  },
  {
    name: "settings",
    path: "/dashboard/settings",
    who: "verified",
    run: async (page, label) => {
      let n = 0;
      for (const tab of ["compte", "vitrine", "notifications", "securite"]) {
        await page.locator(`[data-e2e=settings-tab-${tab}]`).click();
        await expect(page.locator(`[data-e2e=settings-panel-${tab}]`)).toBeVisible();
        await expect(page.locator("[data-e2e=shell-skeleton]")).toHaveCount(0);
        await expect(page.locator("main .sec-skel")).toHaveCount(0);
        n += await sweep(page, `${label} · ${tab}`);
      }
      return n;
    },
  },
  {
    name: "promotions",
    path: "/dashboard/promotions",
    who: "verified",
    run: async (page, label) => {
      await expect(page.locator("[data-e2e=promo-form]")).toBeVisible();
      await expect(page.locator("[data-e2e=promo-row]").first()).toBeVisible();
      // « Une séance »: the target picker joins the form.
      await page.locator("[data-e2e=promo-scope-class]").click();
      return sweep(page, label);
    },
  },
  {
    name: "subscriptions",
    path: "/dashboard/subscriptions",
    who: "verified",
    run: async (page, label) => {
      await page.locator("[data-e2e=offer-new]").click();
      await expect(page.locator("[data-e2e=offer-form]")).toBeVisible();
      return sweep(page, label);
    },
  },
];

test.describe("A1 — no field ever sits under the action bar, the tab bar or the « + »", () => {
  for (const fp of FORM_PAGES) {
    for (const locale of LOCALES) {
      for (const vp of VIEWPORTS) {
        const label = `/${locale}${fp.path} @${vp.width}×${vp.height}`;
        test(label, async ({ browser }) => {
          const { profile } = fp.who === "verified" ? await verifiedTutor() : await draftTutor();
          const ctx = await tutorCtx(browser, profile.id, vp);
          const page = await ctx.newPage();
          await page.goto(`/${locale}${fp.path}`);
          await expect(page.locator("[data-e2e=app-shell]")).toBeVisible();
          const n = await fp.run(page, label);
          expect(n, `${label}: the sweep found the form's fields`).toBeGreaterThan(2);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "nothing scrolls sideways").toBe(true);
          await ctx.close();
        });
      }
    }
  }
});

/* ── A2 ── */
const tabsOf = (page: Page) => page.locator("[data-e2e=shell-tabs]");
const fabOf = (page: Page) => page.locator("[data-e2e=shell-fab]");

async function expectPinnedBar(page: Page) {
  const bar = page.locator("main .aps-actionbar");
  await expect(bar).toBeVisible();
  const r = await bar.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: b.left, right: b.right, bottom: b.bottom, vw: document.documentElement.clientWidth, vh: innerHeight, pos: getComputedStyle(el).position };
  });
  expect(r.pos, "the action bar is pinned, not in the flow").toBe("fixed");
  expect(Math.abs(r.bottom - r.vh), "pinned to the bottom edge").toBeLessThanOrEqual(1);
  expect(r.left, "edge to edge").toBeLessThanOrEqual(1);
  expect(Math.abs(r.right - r.vw), "edge to edge").toBeLessThanOrEqual(1);
}

test.describe("A2 — a phone shows ONE bar on a form page: the action bar, pinned; normal pages keep the tab bar and « + »", () => {
  for (const locale of LOCALES) {
    test(`/${locale} at 390×844`, async ({ browser }) => {
      const { profile } = await verifiedTutor();
      const ctx = await tutorCtx(browser, profile.id, PHONE);
      const page = await ctx.newPage();

      // Normal pages: the tab bar and the « + ».
      for (const path of ["/dashboard", "/dashboard/classes", "/dashboard/storefront"]) {
        await page.goto(`/${locale}${path}`);
        await expect(tabsOf(page), path).toBeVisible();
        await expect(fabOf(page), path).toBeVisible();
      }

      // Form pages with an action bar: that bar only.
      for (const path of ["/dashboard/new-class", "/dashboard/new-pack"]) {
        await page.goto(`/${locale}${path}`);
        await expect(page.locator("main form")).toBeVisible();
        await expect(tabsOf(page), path).toBeHidden();
        await expect(fabOf(page), path).toBeHidden();
        await expectPinnedBar(page);
      }

      // The promotions form: no tab bar, no « + » either.
      await page.goto(`/${locale}/dashboard/promotions`);
      await expect(page.locator("[data-e2e=promo-form]")).toBeVisible();
      await expect(tabsOf(page)).toBeHidden();
      await expect(fabOf(page)).toBeHidden();

      // The offer form: the page is a normal one until the form opens, and again once it closes.
      await page.goto(`/${locale}/dashboard/subscriptions`);
      await expect(page.locator("[data-e2e=offer-new]")).toBeVisible();
      await expect(tabsOf(page)).toBeVisible();
      await page.locator("[data-e2e=offer-new]").click();
      await expect(page.locator("[data-e2e=offer-form]")).toBeVisible();
      await expect(tabsOf(page)).toBeHidden();
      await expect(fabOf(page)).toBeHidden();
      await page.locator("[data-e2e=offer-form] button[type=button]").first().click(); // Annuler
      await expect(page.locator("[data-e2e=offer-form]")).toHaveCount(0);
      await expect(tabsOf(page)).toBeVisible();
      await expect(fabOf(page)).toBeVisible();
      await ctx.close();
    });

    test(`/${locale}/onboarding/verify at 390×844 (a draft tutor)`, async ({ browser }) => {
      const { profile } = await draftTutor();
      const ctx = await tutorCtx(browser, profile.id, PHONE);
      const page = await ctx.newPage();
      await page.goto(`/${locale}/onboarding/verify`);
      await expect(page.locator("[data-e2e=verify-step-1]")).toBeVisible();
      await expect(tabsOf(page)).toBeHidden();
      await expect(fabOf(page)).toBeHidden();
      await expectPinnedBar(page);
      await ctx.close();
    });
  }

  test("at 1440 the bar is pinned to the bottom of the content column, beside the sidebar", async ({ browser }) => {
    const { profile } = await verifiedTutor();
    for (const locale of LOCALES) {
      const ctx = await tutorCtx(browser, profile.id, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      await page.goto(`/${locale}/dashboard/new-class`);
      const bar = page.locator("main .aps-actionbar");
      await expect(bar).toBeVisible();
      const r = await page.evaluate(() => {
        const b = document.querySelector("main .aps-actionbar")!.getBoundingClientRect();
        const s = document.querySelector("[data-e2e=shell-sidebar]")!.getBoundingClientRect();
        return { b: { left: b.left, right: b.right, bottom: b.bottom }, s: { left: s.left, right: s.right }, vh: innerHeight, vw: document.documentElement.clientWidth };
      });
      expect(Math.abs(r.b.bottom - r.vh)).toBeLessThanOrEqual(1);
      if (locale === "fr") {
        expect(Math.abs(r.b.left - r.s.right), "starts where the sidebar ends").toBeLessThanOrEqual(1);
        expect(Math.abs(r.b.right - r.vw)).toBeLessThanOrEqual(1);
      } else {
        expect(Math.abs(r.b.right - r.s.left), "ends where the sidebar starts (RTL)").toBeLessThanOrEqual(1);
        expect(r.b.left).toBeLessThanOrEqual(1);
      }
      await ctx.close();
    }
  });
});

/* ── A3 ──
   The « + » is docked in the tab bar (its raised middle slot), so it cannot cover the page:
   on the pages the founder walked through, from the top of the page to its end, the « + »
   lies inside the tab bar and overlaps no interactive element that is visible on screen —
   what has scrolled under the (opaque) tab bar is not visible there. */
const INTERACTIVE = "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [tabindex]:not([tabindex='-1'])";
const A3_PAGES = [
  { path: "/dashboard", who: "draft" as const },
  { path: "/dashboard", who: "verified" as const },
  { path: "/dashboard/storefront", who: "verified" as const },
  { path: "/dashboard/classes", who: "verified" as const },
];

test.describe("A3 — the « + » never covers interactive content: it is docked in the tab bar", () => {
  for (const p of A3_PAGES) {
    for (const locale of LOCALES) {
      test(`/${locale}${p.path} at 390×844, a ${p.who} tutor`, async ({ browser }) => {
        const { profile } = p.who === "verified" ? await verifiedTutor() : await draftTutor();
        const ctx = await tutorCtx(browser, profile.id, PHONE);
        const page = await ctx.newPage();
        await page.goto(`/${locale}${p.path}`);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("[data-e2e=shell-skeleton]")).toHaveCount(0);
        if (p.path === "/dashboard") await expect(page.locator("[data-e2e=storefront-card] [data-e2e=copy-link]")).toBeVisible();
        await expect(fabOf(page)).toBeVisible();

        // The « + »: third slot of the bar (Accueil · Classes · + · Élèves · Vitrine · Profil), mirrored in Arabic.
        const order = await page.locator("[data-e2e=shell-tabs] > *").evaluateAll((els) =>
          els.map((e) => ({ k: e.getAttribute("data-e2e") ?? (e.querySelector("[data-e2e=shell-fab]") ? "fab" : "?"), x: e.getBoundingClientRect().left })));
        expect(order.map((o) => o.k)).toEqual(["tab-home", "tab-classes", "fab", "tab-students", "tab-storefront", "tab-profile"]);
        const xs = order.map((o) => o.x);
        expect(xs, "the bar reads from the inline start").toEqual([...xs].sort((a, b) => (locale === "ar" ? b - a : a - b)));

        const samples = await page.evaluate((sel) => {
          const fabEl = document.querySelector("[data-e2e=shell-fab]")!;
          const tabs = document.querySelector("[data-e2e=shell-tabs]")!;
          const top = document.querySelector("[data-e2e=shell-topbar]")!;
          const say = (e: Element) => `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? `.${e.className.trim().split(/\s+/)[0]}` : ""} « ${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 24)} »`;
          const max = document.documentElement.scrollHeight - innerHeight;
          const out: { y: number; inside: boolean; hitOk: boolean; covered: string[] }[] = [];
          const STEPS = 10;
          for (let s = 0; s <= STEPS; s++) {
            const y = Math.round((max * s) / STEPS);
            window.scrollTo({ top: y, behavior: "instant" });
            const f = fabEl.getBoundingClientRect();
            const t = tabs.getBoundingClientRect();
            const screenTop = top.getBoundingClientRect().bottom;
            const inside = f.top >= t.top - 0.5 && f.bottom <= t.bottom + 0.5 && f.left >= t.left - 0.5 && f.right <= t.right + 0.5;
            const at = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
            const covered: string[] = [];
            for (const el of Array.from(document.querySelectorAll(sel))) {
              if (tabs.contains(el)) continue; // the tab bar, and the « + » itself
              const cs = getComputedStyle(el);
              if (cs.visibility === "hidden" || cs.display === "none") continue;
              const r = el.getBoundingClientRect();
              if (r.width < 2 || r.height < 2) continue;
              // Only the part of it that is on screen: between the top bar and the tab bar.
              const vTop = Math.max(r.top, screenTop);
              const vBottom = Math.min(r.bottom, t.top);
              if (vBottom <= vTop) continue;
              if (r.left < f.right && r.right > f.left && vTop < f.bottom && vBottom > f.top) covered.push(say(el));
            }
            out.push({ y, inside, hitOk: !!at && fabEl.contains(at), covered });
          }
          return out;
        }, INTERACTIVE);
        expect(samples.length).toBeGreaterThan(1);
        for (const s of samples) {
          expect(s.inside, `scrollY ${s.y}: the « + » stays inside the tab bar`).toBe(true);
          expect(s.hitOk, `scrollY ${s.y}: a tap on the « + » reaches it`).toBe(true);
          expect(s.covered, `scrollY ${s.y}: the « + » covers`).toEqual([]);
        }

        /* Shell pages keep room at the end for the tab bar: at the bottom of the page,
           the content ends 16px above it. */
        const gap = await page.evaluate(() => {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
          const tabs = document.querySelector("[data-e2e=shell-tabs]")!.getBoundingClientRect();
          const content = document.querySelector("main .aps-page")!.getBoundingClientRect();
          return tabs.top - content.bottom;
        });
        expect(gap, "the content ends 16px above the tab bar").toBeGreaterThanOrEqual(15.5);

        // The menu still opens from it: above the bar, inside the screen; Escape closes it.
        await fabOf(page).click();
        const menu = page.locator("[data-e2e=shell-fab-menu]");
        await expect(menu.locator("a")).toHaveCount(2);
        const m = await menu.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { l: r.left, r: r.right, b: r.bottom, vw: document.documentElement.clientWidth, tabsTop: document.querySelector("[data-e2e=shell-tabs]")!.getBoundingClientRect().top };
        });
        expect(m.l).toBeGreaterThanOrEqual(0);
        expect(m.r).toBeLessThanOrEqual(m.vw);
        expect(m.b).toBeLessThanOrEqual(m.tabsTop);
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(fabOf(page)).toBeFocused();
        await ctx.close();
      });
    }
  }
});

/* ── A4 ── */
test.describe("A4 — the sidebar: the viewport's height, sticky, the avatar card always on screen", () => {
  for (const locale of LOCALES) {
    test(`/${locale} at 1440×674 and 1440×640, on a long page`, async ({ browser }) => {
      const { profile } = await verifiedTutor();
      for (const height of [674, 640]) {
        const ctx = await tutorCtx(browser, profile.id, { width: 1440, height });
        const page = await ctx.newPage();
        await page.goto(`/${locale}/dashboard/new-class`);
        await expect(page.locator("main form")).toBeVisible();
        for (const where of ["top", "bottom"] as const) {
          const r = await page.evaluate((where) => {
            if (where === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
            const side = document.querySelector("[data-e2e=shell-sidebar]") as HTMLElement;
            const nav = side.querySelector(".aps-nav") as HTMLElement;
            const me = document.querySelector("[data-e2e=shell-me]")!;
            const s = side.getBoundingClientRect();
            const m = me.getBoundingClientRect();
            const hit = document.elementFromPoint(m.left + m.width / 2, m.top + m.height / 2);
            return {
              scrolled: window.scrollY > 0,
              sideTop: s.top, sideH: s.height, vh: innerHeight,
              meTop: m.top, meBottom: m.bottom, meHit: !!hit && me.contains(hit),
              sideScrolls: side.scrollHeight > side.clientHeight + 1,
              navOverflow: nav.scrollHeight - nav.clientHeight,
              pos: getComputedStyle(side).position,
            };
          }, where);
          const at = `${height}px tall, ${where}`;
          expect(r.pos, at).toBe("sticky");
          expect(Math.abs(r.sideTop), `${at}: the sidebar starts at the top of the screen`).toBeLessThanOrEqual(1);
          expect(Math.abs(r.sideH - r.vh), `${at}: the sidebar is the screen's height`).toBeLessThanOrEqual(1);
          expect(r.meTop, `${at}: the avatar card is on screen`).toBeGreaterThanOrEqual(0);
          expect(r.meBottom, `${at}: the avatar card is on screen`).toBeLessThanOrEqual(r.vh);
          expect(r.meHit, `${at}: nothing covers the avatar card`).toBe(true);
          expect(r.sideScrolls, `${at}: only the nav list may scroll, never the column`).toBe(false);
          expect(r.navOverflow, `${at}: everything fits`).toBeLessThanOrEqual(1);
          if (where === "bottom") expect(r.scrolled, "the page itself is longer than the screen").toBe(true);
        }
        await ctx.close();
      }
    });
  }

  test("shorter than that, the nav list scrolls on its own and the avatar card stays", async ({ browser }) => {
    const { profile } = await verifiedTutor();
    const ctx = await tutorCtx(browser, profile.id, { width: 1440, height: 520 });
    const page = await ctx.newPage();
    await page.goto("/fr/dashboard");
    const r = await page.evaluate(() => {
      const side = document.querySelector("[data-e2e=shell-sidebar]") as HTMLElement;
      const nav = side.querySelector(".aps-nav") as HTMLElement;
      const m = document.querySelector("[data-e2e=shell-me]")!.getBoundingClientRect();
      return { navScrolls: nav.scrollHeight > nav.clientHeight, overflowY: getComputedStyle(nav).overflowY, sideScrolls: side.scrollHeight > side.clientHeight + 1, meBottom: m.bottom, vh: innerHeight };
    });
    expect(r.navScrolls).toBe(true);
    expect(r.overflowY).toBe("auto");
    expect(r.sideScrolls).toBe(false);
    expect(r.meBottom).toBeLessThanOrEqual(r.vh);
    await ctx.close();
  });
});

/* ── A5 ── */
test.describe("A5 — one width for the prof space, one for single-column forms", () => {
  const PAGES = [
    "/dashboard", "/dashboard/classes", "/dashboard/materials", "/dashboard/students", "/dashboard/subscriptions",
    "/dashboard/storefront", "/dashboard/promotions", "/dashboard/plan", "/dashboard/settings",
    "/dashboard/new-class", "/dashboard/new-pack", "/messages", "/onboarding", "THREAD",
  ];
  // Single-column forms (and the one reading column, a conversation): 760. Everything else: 1080.
  const NARROW = ["/dashboard/settings", "/onboarding/verify", "THREAD"];
  for (const locale of LOCALES as readonly Locale[]) {
    test(`/${locale} at 1440×900: every title starts at the same place; pages are 1080 wide, forms 760`, async ({ browser }) => {
      const { profile, tutor } = await verifiedTutor();
      // A conversation (a legacy <SiteShell> page inside the shell), opened by a student who booked.
      const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
      const student = await seedProfile({ role: "student", birthYear: 1996, fullName: "Yosra Ammar" });
      const token = await mintSession(student.id);
      expect((await api("/bookings", token, { classId: klass.id })).ok).toBe(true);
      const [{ id: bookingId }] = await sql<{ id: string }[]>`select id from bookings where class_id = ${klass.id} and student_id = ${student.id}`;
      const threadPath = `/messages/${String((await api("/threads", token, { bookingId })).threadId)}`;

      const draft = await draftTutor();
      const ctx = await tutorCtx(browser, profile.id, { width: 1440, height: 900 });
      const dctx = await tutorCtx(browser, draft.profile.id, { width: 1440, height: 900 });
      const page = await ctx.newPage();
      const dpage = await dctx.newPage();
      /* The frame: an <AppPage>, or the container of a page that brings its own. Its column is
         its content box — a single-column form keeps the rest of the frame as padding. */
      const measure = (p: Page) =>
        p.evaluate(() => {
          const h1 = document.querySelector("main h1")!.getBoundingClientRect();
          const frame = document.querySelector("main .aps-page, main > .web-section > .container")!;
          const f = frame.getBoundingClientRect();
          const cs = getComputedStyle(frame);
          return {
            start: document.dir === "rtl" ? Math.round(h1.right) : Math.round(h1.left),
            frame: Math.round(f.width),
            column: Math.round(f.width - parseFloat(cs.paddingInlineStart) - parseFloat(cs.paddingInlineEnd)),
          };
        });

      const starts = new Map<string, number>();
      for (const key of PAGES) {
        const path = key === "THREAD" ? threadPath : key;
        await page.goto(`/${locale}${path}`);
        await expect(page.locator("main h1")).toBeVisible();
        const m = await measure(page);
        starts.set(key, m.start);
        expect(m.frame, `${key}: the prof-space width`).toBe(1080);
        expect(m.column, `${key}: its column`).toBe(NARROW.includes(key) ? 760 : 1080);
      }
      await dpage.goto(`/${locale}/onboarding/verify`);
      await expect(dpage.locator("[data-e2e=verify-step-1]")).toBeVisible();
      const v = await measure(dpage);
      starts.set("/onboarding/verify", v.start);
      expect(v.frame).toBe(1080);
      expect(v.column, "/onboarding/verify: a single-column form").toBe(760);

      expect(new Set(starts.values()).size, `the titles start at ${JSON.stringify(Object.fromEntries(starts))}`).toBe(1);
      await ctx.close();
      await dctx.close();
    });
  }
});
