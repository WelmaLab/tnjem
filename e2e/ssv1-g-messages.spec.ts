import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass, seedBooking } from "./support/seed";
import { mintSession } from "./support/session";
import { api, contextAs } from "./support/journey";

/* student-space-v1 · G — ONE CONVERSATION PER PROF (and per student, on the prof's
   side), as people see it: /messages and /messages/with/<id>, FR + AR, at 1440×900
   and at 390×844 where the list and the conversation are each their own screen.

   The API half (merge, target booking, ownership, rate limit) is proven in
   apps/api/test/ssv1-g-conversations.test.ts. Screenshots for the side-by-side
   with mockup 3b land in ui-student-v1/g/ (gitignored). */

const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } } as const;
const SHOTS = "ui-student-v1/g";
mkdirSync(SHOTS, { recursive: true });

const T = {
  fr: { first: "Écris le premier message", send: "Envoyer", see: "Voir ses séances", empty: "Pas encore de conversation",
        explore: "Trouver un prof", book: "Réserve une séance pour écrire à ce prof", bookCta: "Réserver", marker: "Séance «",
        back: "Toutes les conversations", noConv: "Pas encore de conversation", privacy: "retirés automatiquement" },
  ar: { first: "اكتب أوّل رسالة", send: "ابعث", see: "شوف الحصص متاعو", empty: "ما فمّاش محادثات لتوّا",
        explore: "لقّي أستاذ", book: "احجز حصة باش تنجّم تكتب للأستاذ هذا", bookCta: "احجز", marker: "حصة «",
        back: "المحادثات الكل", noConv: "ما فمّاش محادثات لتوّا", privacy: "يتنحّاو آليًا" },
} as const;

const DAY = 86_400_000;

/** Walid (2 classes with Amine: one 2 days ago with a message, one upcoming) and
    Sana (one upcoming class with Amine, no message yet). */
async function world() {
  const walidP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Walid Trabelsi" });
  const walid = await seedTutor({ profileId: walidP.id, fullName: "Walid Trabelsi" });
  const sanaP = await seedProfile({ role: "tutor", birthYear: 1988, fullName: "Sana Ben Ali" });
  const sana = await seedTutor({ profileId: sanaP.id, fullName: "Sana Ben Ali" });
  const amine = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
  const past = await seedClass({ tutorId: walid.id, at: new Date(Date.now() - 2 * DAY) });
  const next = await seedClass({ tutorId: walid.id, hoursFromNow: 50 });
  const sanaClass = await seedClass({ tutorId: sana.id, hoursFromNow: 70 });
  const bPast = await seedBooking({ classId: past.id, studentId: amine.id });
  const bNext = await seedBooking({ classId: next.id, studentId: amine.id });
  await seedBooking({ classId: sanaClass.id, studentId: amine.id });

  const walidToken = await mintSession(walidP.id);
  const opened = await api("/threads", walidToken, { bookingId: bPast.id });
  expect(opened.ok, JSON.stringify(opened)).toBe(true);
  const sent = await api(`/threads/${opened.threadId}/messages`, walidToken, { body: "Bonjour Amine, j'ai ajouté le corrigé de la série 3." });
  expect(sent.ok, JSON.stringify(sent)).toBe(true);
  return { walid, walidP, sana, amine, past, next, bPast, bNext, pastThread: String(opened.threadId) };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

for (const loc of ["fr", "ar"] as const) {
  const t = T[loc];

  test(`/${loc} 1440: a student's inbox is one row per prof; writing goes to the newest booking`, async ({ browser }) => {
    const w = await world();
    const ctx = await contextAs(browser, w.amine.id);
    const page = await ctx.newPage();
    await page.setViewportSize(SIZES.desktop);
    await page.goto(`/${loc}/messages`);

    const items = page.locator("[data-e2e=conv-item]");
    await expect(items).toHaveCount(2);
    await expect(page.getByText(t.noConv)).toHaveCount(0); // the empty-state lie is gone
    const walidRow = items.filter({ hasText: "Walid T." });
    await expect(walidRow.locator("[data-e2e=conv-unread]")).toHaveText(/1/);
    await expect(items.filter({ hasText: "Sana B." })).toContainText(t.first);
    await expect(page.locator("html")).toHaveAttribute("dir", loc === "ar" ? "rtl" : "ltr");
    await shot(page, `${loc}-1440-student-list`);

    await walidRow.click();
    await expect(page).toHaveURL(new RegExp(`/${loc}/messages/with/${w.walid.id}$`));
    const conv = page.locator("[data-e2e=conv]");
    await expect(conv.getByRole("heading", { name: "Walid T." })).toBeVisible();
    await expect(conv.locator("[data-e2e=conv-marker]")).toContainText(t.marker);
    await expect(conv.locator("[data-e2e=conv-marker]")).toContainText(w.past.title);
    await expect(conv.getByText("j'ai ajouté le corrigé")).toBeVisible();
    await expect(conv.getByText(t.privacy)).toBeVisible();
    await expect(conv.locator("[data-e2e=conv-see-classes]")).toHaveAttribute("href", new RegExp(`/student/cours\\?prof=${w.walid.id}$`));
    // Reading it cleared the count.
    await expect(walidRow.locator("[data-e2e=conv-unread]")).toHaveCount(0);

    await page.locator("textarea#msg").fill("Merci ! L'exercice 4, je n'ai pas compris la primitive.");
    await page.getByRole("button", { name: t.send }).click();
    await expect(conv.locator(".msg-bubble.is-mine")).toContainText("L'exercice 4");
    // Two class threads now: two markers, the new one for the upcoming class.
    await expect(conv.locator("[data-e2e=conv-marker]")).toHaveCount(2);
    await expect(conv.locator("[data-e2e=conv-marker]").nth(1)).toContainText(w.next.title);
    const [row] = await sql<{ booking_id: string }[]>`
      select t.booking_id from messages m join message_threads t on t.id = m.thread_id
      where m.sender_profile_id = ${w.amine.id}`;
    expect(row.booking_id, "the pair's most recent non-cancelled booking").toBe(w.bNext.id);
    await shot(page, `${loc}-1440-student-conversation`);
    await ctx.close();
  });

  test(`/${loc} 390: the list and the conversation are each their own screen`, async ({ browser }) => {
    const w = await world();
    const ctx = await contextAs(browser, w.amine.id);
    const page = await ctx.newPage();
    await page.setViewportSize(SIZES.phone);
    await page.goto(`/${loc}/messages`);

    await expect(page.locator("[data-e2e=conv-item]")).toHaveCount(2);
    await expect(page.locator(".msg-conv")).toBeHidden();
    await shot(page, `${loc}-390-student-list`);

    await page.locator("[data-e2e=conv-item]").filter({ hasText: "Walid T." }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/with/${w.walid.id}$`));
    await expect(page.locator(".msg-list")).toBeHidden();
    await expect(page.locator("textarea#msg")).toBeVisible();
    await expect(page.getByRole("button", { name: t.send })).toBeVisible();
    // Nothing wider than the screen.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, `${loc}-390-student-conversation`);

    await page.locator("[data-e2e=conv-back]").click();
    await expect(page).toHaveURL(new RegExp(`/${loc}/messages$`));
    await expect(page.locator("[data-e2e=conv-item]")).toHaveCount(2);
    await ctx.close();
  });

  for (const [size, vp] of Object.entries(SIZES)) {
    test(`/${loc} ${vp.width}: the prof's side is one conversation per student, « Amine K. »`, async ({ browser }) => {
      const w = await world();
      // A second booking's thread from the student side, so the prof's merge has two threads.
      const studentToken = await mintSession(w.amine.id);
      const t2 = await api("/threads", studentToken, { bookingId: w.bNext.id });
      expect((await api(`/threads/${t2.threadId}/messages`, studentToken, { body: "À mercredi !" })).ok).toBe(true);

      const ctx = await contextAs(browser, w.walidP.id);
      const page = await ctx.newPage();
      await page.setViewportSize(vp);
      await page.goto(`/${loc}/messages`);
      const items = page.locator("[data-e2e=conv-item]");
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText("Amine K.");
      await expect(page.locator("main")).not.toContainText("Karoui");
      await shot(page, `${loc}-${vp.width}-tutor-list`);

      await items.first().click();
      await expect(page).toHaveURL(new RegExp(`/messages/with/${w.amine.id}$`));
      const conv = page.locator("[data-e2e=conv]");
      await expect(conv.locator("[data-e2e=conv-marker]")).toHaveCount(2);
      await expect(conv.getByText("À mercredi !")).toBeVisible();
      await expect(conv.locator("[data-e2e=conv-see-classes]")).toHaveAttribute("href", /\/dashboard\/students$/);
      await page.locator("textarea#msg").fill("D'accord, on revoit ça mercredi.");
      await page.locator("textarea#msg").press("Enter");
      await expect(conv.locator(".msg-bubble.is-mine").last()).toContainText("on revoit ça mercredi");
      await shot(page, `${loc}-${vp.width}-tutor-conversation`);
      await ctx.close();
      void size;
    });
  }

  test(`/${loc}: no open booking → « réserve une séance » and his next class, no composer`, async ({ browser }) => {
    const tutorP = await seedProfile({ role: "tutor", birthYear: 1985, fullName: "Walid Trabelsi" });
    const tutor = await seedTutor({ profileId: tutorP.id, fullName: "Walid Trabelsi" });
    const student = await seedProfile({ role: "student", birthYear: 1995, fullName: "Amine Karoui" });
    const old = await seedClass({ tutorId: tutor.id, at: new Date(Date.now() - 10 * DAY) });
    const onSale = await seedClass({ tutorId: tutor.id, hoursFromNow: 80 });
    await seedBooking({ classId: old.id, studentId: student.id });

    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const vp of Object.values(SIZES)) {
      await page.setViewportSize(vp);
      await page.goto(`/${loc}/messages/with/${tutor.id}`);
      const box = page.locator("[data-e2e=conv-book]");
      await expect(box).toContainText(t.book);
      await expect(box).toContainText(onSale.title);
      await expect(box.getByRole("link", { name: t.bookCta })).toHaveAttribute("href", new RegExp(`/class/${onSale.id}$`));
      await expect(page.locator("textarea#msg")).toHaveCount(0);
      await shot(page, `${loc}-${vp.width}-student-book-to-write`);
    }
    await ctx.close();
  });

  test(`/${loc}: a student with no booking gets the real empty state, one primary action`, async ({ browser }) => {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const ctx = await contextAs(browser, student.id);
    const page = await ctx.newPage();
    for (const vp of Object.values(SIZES)) {
      await page.setViewportSize(vp);
      await page.goto(`/${loc}/messages`);
      const empty = page.locator("[data-e2e=conv-empty]");
      await expect(empty).toContainText(t.empty);
      await expect(empty.locator(".btn-primary")).toHaveCount(1);
      await expect(empty.getByRole("link", { name: t.explore })).toHaveAttribute("href", /\/explore$/);
      await shot(page, `${loc}-${vp.width}-student-empty`);
    }
    await ctx.close();
  });
}

test("/messages/<threadId> (old links, bell items) opens the pair's conversation, for each side", async ({ browser }) => {
  const w = await world();
  for (const [who, expected] of [[w.amine.id, w.walid.id], [w.walidP.id, w.amine.id]] as const) {
    const ctx = await contextAs(browser, who);
    const page = await ctx.newPage();
    await page.goto(`/fr/messages/${w.pastThread}`);
    await expect(page).toHaveURL(new RegExp(`/fr/messages/with/${expected}$`));
    await expect(page.locator("[data-e2e=conv]")).toBeVisible();
    await ctx.close();
  }
  // A stranger is told it does not exist — never which ids do.
  const stranger = await seedProfile({ role: "student", birthYear: 1995 });
  const ctx = await contextAs(browser, stranger.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/messages/${w.pastThread}`);
  await expect(page.locator("[data-e2e=conv-gone]")).toBeVisible();
  await ctx.close();
});

test("« Message » on a booking row gives immediate feedback and opens the merged conversation", async ({ browser }) => {
  const w = await world();
  const ctx = await contextAs(browser, w.walidP.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/students");
  const card = page.locator("details").filter({ hasText: "Amine" }).first();
  await card.locator("summary").click();
  // Hold the action's answer back a moment so the pending state is observable.
  await page.route("**/dashboard/students", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  const btn = card.locator("[data-e2e=message-booking]").first();
  await btn.click();
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(new RegExp(`/fr/messages/with/${w.amine.id}$`));
  await ctx.close();
});

test("the live lobby's « Message » leads a student to the prof's conversation", async ({ browser }) => {
  const w = await world();
  const ctx = await contextAs(browser, w.amine.id);
  const page = await ctx.newPage();
  await page.goto(`/fr/live/${w.next.id}`);
  const link = page.locator("[data-e2e=message-link]");
  await expect(link).toHaveAttribute("href", new RegExp(`/fr/messages/with/${w.walid.id}$`));
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/fr/messages/with/${w.walid.id}$`));
  await expect(page.locator("[data-e2e=conv]")).toBeVisible();
  await ctx.close();

  // The prof in his own lobby has no « Message » (he has a whole class there).
  const tctx = await contextAs(browser, w.walidP.id);
  const tpage = await tctx.newPage();
  await tpage.goto(`/fr/live/${w.next.id}`);
  await expect(tpage.getByRole("button", { name: /Rejoindre|Entrer/ })).toBeVisible();
  await expect(tpage.locator("[data-e2e=message-link]")).toHaveCount(0);
  await tctx.close();
});
