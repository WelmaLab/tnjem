import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { seedBooking, seedClass, seedProfile, seedTutor } from "./support/seed";
import { contextAs } from "./support/journey";

/* live-fixes-3 · E — NAMES.

   In the live class the public class page, the checkout and the prof's live lobby
   said « walid tester » (lower case, the whole surname) while Explore, the storefront
   and the student pages said « Walid T. ». Every one of those three now goes through
   publicTutorName — on the API (GET /classes/:id, for every reader, the owner
   included: apps/api/test/lf3-e-names.test.ts) and again where it is rendered.

   A tutor STORED as « walid tester »: on the class page (signed out, a student, the
   owner), the checkout (a student) and the live lobby (the booked student, the owner),
   in FR and AR, « Walid T. » is on screen and « tester » is nowhere in the page — not
   in the text, the <head> (title, og:, twitter:), nor the JSON-LD. For the readers who
   are not the tutor, not in any response the page received either.
   ADDED as its own spec. */

const STORED = "walid tester";
const SHOWN = "Walid T.";

async function world() {
  const me = await seedProfile({ role: "tutor", birthYear: 1990, fullName: STORED });
  const tutor = await seedTutor({ profileId: me.id, status: "verified", fullName: STORED });
  const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 72, priceTnd: 20, isFreeFirst: false });
  const student = await seedProfile({ role: "student", birthYear: 1995 });
  const booked = await seedProfile({ role: "student", birthYear: 1995 });
  await seedBooking({ classId: klass.id, studentId: booked.id, isFree: false });
  return { me, tutor, klass, student, booked };
}

/** Every response body the page receives from the web app (documents, RSC, server
    actions). The returned check fails on « tester » in any of them, and — the positive
    control, so a recorder that caught nothing cannot pass — needs « Walid T. » in one. */
function recordResponses(page: Page): (who: string) => Promise<void> {
  const pending: Promise<string>[] = [];
  page.on("response", (res) => {
    const type = res.request().resourceType();
    if (!["document", "fetch", "xhr"].includes(type)) return;
    pending.push(res.text().then((body) => `${res.url()}\n${body}`).catch(() => ""));
  });
  return async (who) => {
    const bodies = await Promise.all(pending);
    expect(bodies.join("\n"), `${who}: the recorder saw the class`).toContain(SHOWN);
    for (const body of bodies) expect(body, `a response to ${who}`).not.toMatch(/tester/i);
  };
}

async function expectNamed(page: Page, url: string, where: string, nameLocator: string) {
  await page.goto(url);
  await expect(page.locator(nameLocator).first(), `${where}: the tutor's name`).toContainText(SHOWN, { timeout: 20_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  const html = await page.content();
  expect(html, `${where}: « tester » in the page`).not.toMatch(/tester/i);
  await expect(page.locator("body")).not.toContainText(/tester/i);
}

for (const loc of ["fr", "ar"] as const) {
  test(`E · the class page, the checkout and the live lobby say « ${SHOWN} » (${loc})`, async ({ browser }) => {
    test.setTimeout(180_000);
    const w = await world();
    const contexts: BrowserContext[] = [];
    const as = async (profileId: string | null) => {
      const ctx = profileId ? await contextAs(browser, profileId) : await browser.newContext({ reducedMotion: "reduce" });
      contexts.push(ctx);
      return ctx.newPage();
    };
    try {
      // Signed out: the ISR page, its <head> and its JSON-LD.
      const anon = await as(null);
      const anonSeen = recordResponses(anon);
      await expectNamed(anon, `/${loc}/class/${w.klass.id}`, `${loc} class page (signed out)`, ".cd-with");
      await expect(anon.locator(".cd-tutor-name")).toHaveText(SHOWN);
      const ogTitle = await anon.locator('meta[property="og:title"]').getAttribute("content");
      expect(ogTitle, "the link preview's title").toContain(SHOWN);
      const ld = (await anon.locator('script[type="application/ld+json"]').allTextContents()).join("\n");
      expect(ld, "the JSON-LD names the tutor").toContain(`"name":"${SHOWN}"`);
      await anonSeen("the signed-out reader");

      // A student: the class page and the checkout.
      const student = await as(w.student.id);
      const studentSeen = recordResponses(student);
      await expectNamed(student, `/${loc}/class/${w.klass.id}`, `${loc} class page (student)`, ".cd-with");
      await expectNamed(student, `/${loc}/checkout?class=${w.klass.id}`, `${loc} checkout (student)`, ".ck-class-who");
      await studentSeen("the student");

      // The booked student: the live lobby.
      const booked = await as(w.booked.id);
      const bookedSeen = recordResponses(booked);
      await expectNamed(booked, `/${loc}/live/${w.klass.id}`, `${loc} live lobby (booked student)`, "main");
      await bookedSeen("the booked student");

      // The owner, on the pages that name them to others: the same public name.
      const owner = await as(w.me.id);
      await expectNamed(owner, `/${loc}/class/${w.klass.id}`, `${loc} class page (owner)`, ".cd-with");
      await expectNamed(owner, `/${loc}/live/${w.klass.id}`, `${loc} live lobby (owner)`, "main");
    } finally {
      for (const ctx of contexts) await ctx.close();
    }
  });
}
