import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { seedAdmin, seedBooking, seedClass, seedOffer, seedProfile, seedPromotion, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";
import { sql } from "./support/db";

/* live-fixes-3 · F — THE CHECKOUT PRICE FONT, AND EVERY OTHER PRICE.

   « 0 TND » on /checkout was still in Space Grotesk (--fd), whose figures come from
   Space Mono and read as a monospace font. The LIVE_FIXES_1 C1 rule — the figure face
   --fn (the brand's text face; the Arabic face in Arabic) with tabular figures — now
   sets it, and the app-wide grep found the same face on the class page's price
   (.cd-amount), the storefront's (.sf-amount), /tarifs' amounts and rates and
   /pour-les-profs' « later » amounts.

   1. The named prices, FR + AR: computed font-family is the brand face, never Space
      Grotesk or a monospace, and font-variant-numeric includes tabular-nums.
   2. A sweep, in FR (in Arabic --fd itself resolves to the Arabic face, so only FR can
      see it): on every page of PRICE_PAGES, every element that shows a price
      (« 20 TND », « 0 TND », « 15,5 TND ») is NOT in the display face or a monospace.
      Positive control: the sweep must find the checkout's « 0 TND » and dozens more.
   The static twin is guardrail 8 (tools/ui-audit/guardrails.mjs). ADDED as its own spec. */

const NOT_MONO = /Space Grotesk|monospace|Mono\b/i;

async function face(el: Locator): Promise<{ family: string; numeric: string }> {
  return el.evaluate((n) => {
    const cs = getComputedStyle(n);
    return { family: cs.fontFamily, numeric: cs.fontVariantNumeric };
  });
}

async function world() {
  const me = await seedProfile({ role: "tutor", birthYear: 1990, fullName: "Rania Prix" });
  const tutor = await seedTutor({ profileId: me.id, status: "verified", fullName: "Rania Prix", offersFreeFirstSession: true });
  const paid = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, priceTnd: 25, isFreeFirst: false });
  const free = await seedClass({ tutorId: tutor.id, hoursFromNow: 96, priceTnd: 20, isFreeFirst: true });
  const zero = await seedClass({ tutorId: tutor.id, hoursFromNow: 120, priceTnd: 0, isFreeFirst: false });
  const promoted = await seedClass({ tutorId: tutor.id, hoursFromNow: 144, priceTnd: 30, isFreeFirst: false });
  await seedPromotion({ tutorId: tutor.id, percent: 10, scope: "class", targetId: promoted.id });
  await seedOffer({ tutorId: tutor.id, priceTnd: 90 });
  await sql`insert into packs (id, tutor_id, title, description, price_tnd) values (${randomUUID()}, ${tutor.id}, 'Pack annales', '12 pages', '18')`;
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  await seedBooking({ classId: paid.id, studentId: student.id, isFree: false });
  const admin = await seedAdmin();
  return { me, tutor, paid, free, zero, promoted, student, admin };
}

type W = Awaited<ReturnType<typeof world>>;
type Who = "anon" | "tutor" | "student" | "admin";

/* The pages that show prices, each with the identity it serves. Extend freely. */
const PRICE_PAGES = (w: W): { path: string; who: Who }[] => [
  { path: "/", who: "anon" },
  { path: "/explore", who: "anon" },
  { path: `/${w.tutor.slug}`, who: "anon" },
  { path: `/class/${w.paid.id}`, who: "anon" },
  { path: `/class/${w.free.id}`, who: "anon" },
  { path: `/class/${w.zero.id}`, who: "anon" },
  { path: `/class/${w.promoted.id}`, who: "anon" },
  { path: "/tarifs", who: "anon" },
  { path: "/pour-les-profs", who: "anon" },
  { path: `/checkout?class=${w.free.id}`, who: "student" },
  { path: `/checkout?class=${w.zero.id}`, who: "student" },
  { path: `/checkout?class=${w.promoted.id}`, who: "student" },
  { path: "/student", who: "student" },
  { path: "/dashboard", who: "tutor" },
  { path: "/dashboard/classes", who: "tutor" },
  { path: "/dashboard/plan", who: "tutor" },
  { path: "/dashboard/materials", who: "tutor" },
  { path: "/dashboard/promotions", who: "tutor" },
  { path: "/dashboard/subscriptions", who: "tutor" },
  { path: "/dashboard/new-class", who: "tutor" },
  { path: "/dashboard/storefront/preview", who: "tutor" },
  { path: "/admin/plans", who: "admin" },
];

/** Every element on the page that SHOWS a price: a short text (a price, not a
    paragraph) holding a figure and a currency, with a figure in its own text. */
async function priceFaces(page: Page): Promise<{ text: string; family: string; cls: string }[]> {
  return page.evaluate(() => {
    const PRICE = /\d[\d\s.,  ]*(TND|د\.ت|دينار)/;
    const out: { text: string; family: string; cls: string }[] = [];
    for (const el of document.querySelectorAll("main *, [role=main] *")) {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join("");
      if (!/\d/.test(own)) continue;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length > 48 || !PRICE.test(text)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      out.push({ text, family: cs.fontFamily, cls: (el as HTMLElement).className?.toString?.() ?? "" });
    }
    return out;
  });
}

async function contextFor(browser: Browser, w: W, who: Who): Promise<BrowserContext> {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
  const id = who === "tutor" ? w.me.id : who === "student" ? w.student.id : who === "admin" ? w.admin.id : null;
  if (id) await ctx.addCookies([sessionCookie(await mintSession(id))]);
  return ctx;
}

for (const loc of ["fr", "ar"] as const) {
  test(`F · the named prices are in the brand face with tabular figures (${loc})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const w = await world();
    const brand = loc === "ar" ? /IBM Plex Sans Arabic/ : /Plus Jakarta Sans/;
    const check = async (el: Locator, what: string) => {
      await expect(el, what).toBeVisible({ timeout: 20_000 });
      const f = await face(el);
      expect(f.family, `${what}: ${f.family}`).not.toMatch(NOT_MONO);
      expect(f.family, `${what}: ${f.family}`).toMatch(brand);
      expect(f.numeric, `${what}: ${f.numeric}`).toContain("tabular-nums");
    };
    const student = await contextFor(browser, w, "student");
    const anon = await contextFor(browser, w, "anon");
    try {
      const page = await student.newPage();
      // THE reported one: « 0 TND » at the top of the checkout.
      await page.goto(`/${loc}/checkout?class=${w.free.id}`);
      const amount = page.locator(".ck-pay-amount");
      await expect(amount).toHaveText(loc === "ar" ? "0 د.ت" : "0 TND", { timeout: 20_000 });
      await check(amount, "checkout « 0 TND »");

      const a = await anon.newPage();
      await a.goto(`/${loc}/class/${w.zero.id}`);
      await check(a.locator(".cd-amount").first(), "class page « 0 TND »");
      await a.goto(`/${loc}/${w.tutor.slug}`);
      await check(a.locator(".sf-amount").first(), "storefront price block");
      await a.goto(`/${loc}/tarifs`);
      await check(a.locator(".tf-ex-row b").first(), "/tarifs example amount");
      await check(a.locator(".tf-cmp-rate").first(), "/tarifs rate");
      await check(a.locator(".tf-price").first(), "/tarifs plan price");
      await a.goto(`/${loc}/pour-les-profs`);
      await check(a.locator("[data-e2e=lpp-later-net]"), "/pour-les-profs « later » amount");
      await check(a.locator(".lpp-amount").first(), "/pour-les-profs amount");
    } finally {
      await student.close();
      await anon.close();
    }
  });
}

test("F · no price on any price page is in the display face or a monospace (fr)", async ({ browser }) => {
  test.setTimeout(300_000);
  const w = await world();
  const contexts = new Map<Who, BrowserContext>();
  const offenders: string[] = [];
  let seen = 0;
  let sawCheckout = false;
  try {
    for (const v of PRICE_PAGES(w)) {
      if (!contexts.has(v.who)) contexts.set(v.who, await contextFor(browser, w, v.who));
      const page = await contexts.get(v.who)!.newPage();
      await page.goto(`/fr${v.path === "/" ? "" : v.path}`);
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
      if (v.path.startsWith("/checkout")) await expect(page.locator(".ck-pay-amount")).toBeVisible({ timeout: 20_000 });
      for (const p of await priceFaces(page)) {
        seen++;
        if (p.cls.includes("ck-pay-amount")) sawCheckout = true;
        if (NOT_MONO.test(p.family)) offenders.push(`${v.path}: « ${p.text} » (.${p.cls.split(/\s+/).join(".")}) in ${p.family}`);
      }
      await page.close();
    }
  } finally {
    for (const ctx of contexts.values()) await ctx.close();
  }
  expect(sawCheckout, "the sweep found the checkout's « 0 TND »").toBe(true);
  expect(seen, "prices found across the price pages").toBeGreaterThan(20);
  expect(offenders, "prices in the display face (Space Grotesk) or a monospace").toEqual([]);
});
