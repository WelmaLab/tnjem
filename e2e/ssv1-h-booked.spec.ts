import { test, expect, type Browser, type Page } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking, backdateBooking } from "./support/seed";
import { loginAs } from "./support/session";
import { BASE_URL } from "./support/env";

/* ════════════════════════════════════════════════════════════════════════════
   student-space-v1 · H — bugs from the live test (5 Oct 2026).

   H1  A student who had booked opened the prof's page (/<slug>) and the class page
       (/class/<id>) and was offered « Réserver la séance » again. Now, after
       hydration and from the session (both pages stay ISR — isr.spec.ts,
       static-render.spec.ts), they see « ✓ Tu es inscrit à cette séance »,
       « Rejoindre (dans 9 h) » — « Rejoindre » once it is on — and « Annuler », the
       student space's own cancel flow (confirmation, late-cancellation note).
       A guest, a non-booked student and the class owner see exactly what they saw.

   H2  Classes never became "done". What shows in the UI: a booked class that has
       ENDED (start + its own duration) is over everywhere — no booked panel, the
       class page closed — and the prof's Mes classes calls it « Terminée » while a
       longer class that started earlier is still « En direct ». (The API half — every
       read path, the cron sweep — is apps/api/test/ssv1-h-*.test.ts.)

   FR + AR, at 1440×900 and 390×844: the panel lives in the desktop aside, the phone
   gets it in the sticky bar where « Réserver » was. A fresh tutor per test: the
   storefront is cached for 60 s.
   ════════════════════════════════════════════════════════════════════════════ */

test.use({ contextOptions: { reducedMotion: "reduce" } });

const HOST = new URL(BASE_URL).hostname;
const MIN = 60_000;

const L = {
  fr: {
    booked: "Tu es inscrit à cette séance",
    joinIn: /^\s*Rejoindre \(dans \d+ h\)$/,
    join: /^\s*Rejoindre$/,
    cancel: "Annuler",
    sure: "Annuler cette réservation ?",
    yes: "Oui, annuler",
    late: "moins de 48h",
    cancelled: /Réservation annulée/,
    tag: "Inscrit",
    liveNow: "En direct maintenant",
    closed: "Cette séance n'est plus ouverte à la réservation",
    ended: "Terminée",
    onNow: "En direct",
  },
  ar: {
    booked: "إنت مسجّل في الحصة هاذي",
    joinIn: /^\s*ادخل \(بعد .+\)$/,
    join: /^\s*ادخل$/,
    cancel: "ألغي",
    sure: "تحب تلغي هذا الحجز ؟",
    yes: "إيه، ألغي",
    late: "أقل من 48 ساعة",
    cancelled: /الحجز تلغى/,
    tag: "مسجّل",
    liveNow: "الدايركت بدا توّا",
    closed: "الحصة هاذي ما عادش تتحجز",
    ended: "وفات",
    onNow: "دايركت",
  },
} as const;

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;

type Locale = keyof typeof L;
type Size = keyof typeof VIEWPORTS;

/** A verified prof with one class in 9 h (« Prochaine séance ») and one in 3 days. */
async function world() {
  const owner = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Walid Tester" });
  const tutor = await seedTutor({ profileId: owner.id, status: "verified", fullName: "Walid Tester" });
  const next = await seedClass({ tutorId: tutor.id, hoursFromNow: 9, seats: 6, isFreeFirst: false, priceTnd: 20 });
  const later = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, seats: 6, isFreeFirst: false, priceTnd: 20 });
  return { owner, tutor, next, later };
}

async function studentWithSeat(classId: string) {
  const student = await seedProfile({ role: "student", birthYear: 1990 });
  const booking = await seedBooking({ classId, studentId: student.id, isFree: false });
  await sql`update classes set seats_taken = seats_taken + 1 where id = ${classId}`;
  await backdateBooking(booking.id, 60); // booked an hour ago: outside the 15-minute grace
  return { student, booking };
}

async function open(browser: Browser, size: Size, who: { id: string; role: "student" | "tutor" } | null): Promise<Page> {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[size], reducedMotion: "reduce" });
  if (who) {
    await loginAs(ctx, who.id);
    await ctx.addCookies([{ name: "tnajem_role", value: who.role, domain: HOST, path: "/" }]);
  }
  return ctx.newPage();
}

/** Loaded AND hydrated, with the session reads (the storefront's « am I booked? ») settled. */
async function visit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

const visible = (page: Page, selector: string) => page.locator(selector).filter({ visible: true });

async function expectBookingCta(page: Page, classId: string) {
  await expect(visible(page, `a[href*="/checkout?class=${classId}"]`).first(), "the booking CTA, as today").toBeVisible();
  await expect(page.locator("[data-e2e=booked-panel]")).toHaveCount(0);
  await expect(page.locator("[data-e2e=booked-tag]")).toHaveCount(0);
}

async function expectBooked(page: Page, locale: Locale, classId: string, phase: "upcoming" | "live") {
  const u = L[locale];
  const panel = visible(page, "[data-e2e=booked-panel]");
  await expect(panel, "one booked panel on screen (aside on a computer, sticky bar on a phone)").toHaveCount(1);
  await expect(panel).toHaveAttribute("data-phase", phase);
  await expect(panel.locator("[data-e2e=booked-badge]")).toContainText(u.booked);
  const join = panel.locator("[data-e2e=booked-join]");
  await expect(join).toHaveText(phase === "live" ? u.join : u.joinIn);
  await expect(join).toHaveAttribute("href", `/${locale}/live/${classId}`);
  expect(await join.evaluate((el) => el.tagName), "one link, never a control inside another").toBe("A");
  if (phase === "live") {
    await expect(panel.locator("[data-e2e=booked-badge]")).toContainText(u.liveNow);
    await expect(panel.locator("[data-e2e=booked-cancel]"), "the online cancel is closed once it has started").toHaveCount(0);
  } else {
    await expect(panel.locator("[data-e2e=booked-cancel]")).toHaveText(u.cancel);
  }
  await expect(visible(page, `a[href*="/checkout?class=${classId}"]`), "never « Réserver » for a seat already held").toHaveCount(0);
  // 44px targets.
  for (const b of [join, panel.locator("[data-e2e=booked-cancel]")]) {
    if (await b.count()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal scroll").toBe(true);
}

for (const locale of ["fr", "ar"] as const) {
  for (const size of ["desktop", "phone"] as const) {
    test.describe(`H1 · ${locale} · ${size}`, () => {
      test("a guest sees the booking CTA, as today — class page and storefront", async ({ browser }) => {
        const w = await world();
        const page = await open(browser, size, null);
        await visit(page, `/${locale}/class/${w.next.id}`);
        await expectBookingCta(page, w.next.id);
        await visit(page, `/${locale}/${w.tutor.slug}`);
        await expectBookingCta(page, w.next.id);
        await page.context().close();
      });

      test("a student with no seat sees the booking CTA, as today", async ({ browser }) => {
        const w = await world();
        const student = await seedProfile({ role: "student", birthYear: 1990 });
        const page = await open(browser, size, { id: student.id, role: "student" });
        await visit(page, `/${locale}/class/${w.next.id}`);
        await expectBookingCta(page, w.next.id);
        await visit(page, `/${locale}/${w.tutor.slug}`);
        await expectBookingCta(page, w.next.id);
        await page.context().close();
      });

      test("the booked student, before the start: « Tu es inscrit », « Rejoindre (dans … h) », « Annuler »", async ({ browser }) => {
        const w = await world();
        const { student } = await studentWithSeat(w.next.id);
        const page = await open(browser, size, { id: student.id, role: "student" });

        await visit(page, `/${locale}/class/${w.next.id}`);
        await expectBooked(page, locale, w.next.id, "upcoming");

        await visit(page, `/${locale}/${w.tutor.slug}`);
        await expectBooked(page, locale, w.next.id, "upcoming");
        // The row of the class they hold says so; the other class's row does not.
        await expect(visible(page, "[data-e2e=booked-tag]")).toHaveCount(1);
        await expect(visible(page, "[data-e2e=booked-tag]")).toHaveText(L[locale].tag);
        const row = page.locator(`a.sf-row[href="/${locale}/class/${w.next.id}"]`);
        await expect(row.locator("[data-e2e=booked-tag]")).toBeVisible();
        await expect(page.locator(`a.sf-row[href="/${locale}/class/${w.later.id}"] [data-e2e=booked-tag]`)).toHaveCount(0);
        await page.context().close();
      });

      test("the booked student while it is on: « Rejoindre » → /live/<id>, no « Annuler »", async ({ browser }) => {
        const w = await world();
        const onNow = await seedClass({ tutorId: w.tutor.id, at: new Date(Date.now() - 10 * MIN), seats: 6, isFreeFirst: false });
        const { student } = await studentWithSeat(onNow.id);
        const page = await open(browser, size, { id: student.id, role: "student" });

        await visit(page, `/${locale}/class/${onNow.id}`);
        await expectBooked(page, locale, onNow.id, "live");
        await expect(page.getByText(L[locale].closed).filter({ visible: true }), "not « plus ouverte » to its own student").toHaveCount(0);

        // The storefront no longer lists a class once it has started: the panel is the way in.
        await visit(page, `/${locale}/${w.tutor.slug}`);
        await expectBooked(page, locale, onNow.id, "live");
        await page.context().close();
      });

      test("the class owner sees their own panel, as today — never the booked state", async ({ browser }) => {
        const w = await world();
        const page = await open(browser, size, { id: w.owner.id, role: "tutor" });
        await visit(page, `/${locale}/class/${w.next.id}`);
        await expect(visible(page, "[data-e2e=owner-panel]")).toHaveCount(1);
        await expect(page.locator("[data-e2e=booked-panel]")).toHaveCount(0);
        await expect(page.locator(`a[href*="/checkout?class=${w.next.id}"]`)).toHaveCount(0);
        await visit(page, `/${locale}/${w.tutor.slug}`);
        await expect(page.locator("[data-e2e=booked-panel]")).toHaveCount(0);
        await page.context().close();
      });
    });
  }
}

test.describe("H1 · « Annuler » — the student space's cancel flow, from the booked panel", () => {
  for (const [locale, size, where] of [
    ["fr", "desktop", "class"],
    ["ar", "phone", "class"],
    ["fr", "phone", "storefront"],
    ["ar", "desktop", "storefront"],
  ] as const) {
    test(`${locale} · ${size} · ${where}: confirm with the late note, then « Réserver » again`, async ({ browser }) => {
      const u = L[locale];
      const w = await world();
      const { student, booking } = await studentWithSeat(w.next.id);
      const page = await open(browser, size, { id: student.id, role: "student" });
      await visit(page, where === "class" ? `/${locale}/class/${w.next.id}` : `/${locale}/${w.tutor.slug}`);

      const panel = visible(page, "[data-e2e=booked-panel]");
      await panel.locator("[data-e2e=booked-cancel]").click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toContainText(u.sure);
      await expect(dialog.locator("[data-e2e=booked-cancel-rule]"), "the late-cancellation note, BEFORE committing").toContainText(u.late);

      // « Garder ma place » first: nothing happens.
      await dialog.locator("button").first().click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      expect((await sql<{ status: string }[]>`select status from bookings where id = ${booking.id}`)[0].status).toBe("reserved");

      await panel.locator("[data-e2e=booked-cancel]").click();
      await page.locator("dialog[open]").getByRole("button", { name: u.yes }).click();
      await expect(page.locator("[data-e2e=booked-panel]")).toHaveCount(0);
      await expect(visible(page, `a[href*="/checkout?class=${w.next.id}"]`).first(), "the seat is back on sale").toBeVisible();
      await expect(page.getByText(u.cancelled).filter({ visible: true }).first(), "what the server did, said").toBeVisible();
      await expect
        .poll(async () => (await sql<{ status: string }[]>`select status from bookings where id = ${booking.id}`)[0].status)
        .toBe("cancelled");
      await page.context().close();
    });
  }
});

test.describe("H2 · a class is over at start + its own duration", () => {
  for (const locale of ["fr", "ar"] as const) {
    for (const size of ["desktop", "phone"] as const) {
      test(`${locale} · ${size}: an ended booked class shows no booked panel; Mes classes says « ${L[locale].ended} »`, async ({ browser }) => {
        const w = await world();
        // 45 minutes, started an hour ago: over 15 minutes ago — still « scheduled » in the row.
        const ended = await seedClass({ tutorId: w.tutor.id, at: new Date(Date.now() - 60 * MIN), seats: 6, isFreeFirst: false });
        await sql`update classes set duration_min = 45 where id = ${ended.id}`;
        // 3 hours, started 2 h 30 ago: still on.
        const long = await seedClass({ tutorId: w.tutor.id, at: new Date(Date.now() - 150 * MIN), seats: 6, isFreeFirst: false });
        await sql`update classes set duration_min = 180 where id = ${long.id}`;
        const { student } = await studentWithSeat(ended.id);

        const page = await open(browser, size, { id: student.id, role: "student" });
        await visit(page, `/${locale}/class/${ended.id}`);
        await expect(page.locator("[data-e2e=booked-panel]"), "over: nothing to join, nothing to cancel").toHaveCount(0);
        await expect(page.getByText(L[locale].closed).filter({ visible: true })).toHaveCount(1);
        await expect(page.locator(`a[href*="/live/${ended.id}"]`)).toHaveCount(0);
        await page.context().close();

        const prof = await open(browser, size, { id: w.owner.id, role: "tutor" });
        await visit(prof, `/${locale}/dashboard/classes`);
        const phaseOf = (id: string) => prof.locator(`[data-e2e=class-row][data-class-id="${id}"] [data-e2e=class-phase]`);
        await expect(prof.locator(`[data-e2e=classes-past] [data-class-id="${ended.id}"]`), "listed with the past ones").toHaveCount(1);
        await expect(phaseOf(ended.id)).toHaveAttribute("data-phase", "done");
        await expect(phaseOf(ended.id)).toHaveText(L[locale].ended);
        await expect(prof.locator(`[data-e2e=classes-upcoming] [data-class-id="${long.id}"]`)).toHaveCount(1);
        await expect(phaseOf(long.id)).toHaveAttribute("data-phase", "live");
        await expect(phaseOf(long.id)).toHaveText(L[locale].onNow);
        expect((await sql<{ status: string }[]>`select status from classes where id = ${ended.id}`)[0].status, "derived — the cron has not run").toBe("scheduled");
        await prof.context().close();
      });
    }
  }
});
