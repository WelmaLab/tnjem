import { test, expect } from "@playwright/test";
import { sql } from "./support/db";
import { seedProfile, seedTutor, seedClass } from "./support/seed";
import { fillWallTime, wallDaysAhead } from "./support/datetime"; // espace prof v2 · shell
import { mintSession, sessionCookie } from "./support/session";

async function asTutor(browser: any, profileId: string) {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  await ctx.addCookies([sessionCookie(await mintSession(profileId))]);
  return ctx;
}

test("a tutor creates a storefront from the onboarding form", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1988 });
  const ctx = await asTutor(browser, me.id);
  const page = await ctx.newPage();

  await page.goto("/fr/onboarding");
  await page.getByPlaceholder("ex. Yassine Khelifi").fill("E2E Storefront Tutor");
  await page.getByPlaceholder(/ex\. Maths/).fill("Maths — Bac");
  await page.getByPlaceholder(/On révise les maths/).fill("Seeded by the E2E suite.");
  await page.getByRole("button", { name: /Publier ma page/i }).dispatchEvent("click");

  await expect.poll(async () => {
    const [t] = await sql<{ n: number }[]>`
      select count(*)::int n from tutors where profile_id = ${me.id}`;
    return t.n;
  }, { timeout: 20_000 }).toBe(1);

  const [t] = await sql<{ slug: string; status: string; full_name: string }[]>`
    select slug, status, full_name from tutors where profile_id = ${me.id}`;
  // A new storefront is a DRAFT: only verified tutors are public.
  expect(t.status).toBe("draft");
  expect(t.full_name).toBe("E2E Storefront Tutor");

  await ctx.close();
});

test("an unverified tutor's storefront exposes nothing and is noindex", async ({ page }) => {
  const tutor = await seedTutor({ status: "pending", fullName: "Pending Person" });

  const res = await page.goto(`/fr/${tutor.slug}`);

  /* espace prof v2 · shell — a 200 now: a tutor who exists and is on the way gets
     « Ce prof arrive bientôt » instead of a bare 404 (it was a 404 from the 14 Sept
     review until then). Unknown slugs are still a hard 404 (e2e/not-found.spec.ts),
     and e2e/ep2-shell.spec.ts covers the owner preview. What this test protects is
     unchanged: an unverified tutor's details never reach the page, and the URL
     stays out of the index. */
  expect(res?.status()).toBe(200);
  await expect(page.locator("main h1")).toHaveText("Ce prof arrive bientôt");

  const html = await page.content();
  expect(html, "an unverified tutor's name must not be served").not.toContain("Pending Person");
  expect(html, "an unverified tutor's page must be noindex").toMatch(/noindex/);
});

test("a verified tutor's storefront is public and shows no contact details", async ({ page }) => {
  const tutor = await seedTutor({ status: "verified" });
  await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });

  const res = await page.goto(`/fr/${tutor.slug}`);
  expect(res?.status()).toBe(200);
  /* phase-a lane L2 (A23): "E2E Tutor <tag>" is shown as first name + initial. The
     public name keeps only the letters of the first name (publicDisplayName strips
     anything that could smuggle a number), so "E2E" renders as "EE": "EE T.". */
  await expect(page.locator("h1").first()).toContainText("EE T.");

  /* Step 8 will make this a hard, product-wide rule. Asserting it NOW means the
     Stage A port cannot quietly regress it before then.

     Scoped to <main>: SiteFooter carries Tnajem's OWN contact address, which is
     the platform's, not a counterparty's, and is meant to be there. */
  const main = await page.locator("main").innerHTML();
  expect(main, "a storefront must not expose an e-mail address").not.toMatch(/mailto:/);
  expect(main, "a storefront must not expose a phone number").not.toMatch(/tel:\+?\d/);
});

test("the tutor dashboard shows a booking on their own class", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1988 });
  const tutor = await seedTutor({ profileId: me.id, status: "verified" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });
  const student = await seedProfile({ role: "student", birthYear: 2000, fullName: "Amine Karoui" });
  const { seedBooking } = await import("./support/seed");
  await seedBooking({ classId: klass.id, studentId: student.id });

  const ctx = await asTutor(browser, me.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard");

  // espace prof v2 · shell: the home lists the class; who booked it is « Mes élèves ».
  await expect(page.locator("main")).toContainText(klass.title);
  await page.goto("/fr/dashboard/students");
  await expect(page.locator("main")).toContainText("Amine");

  await ctx.close();
});

test("a tutor publishes a class, and only a verified tutor can", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1988 });
  const tutor = await seedTutor({ profileId: me.id, status: "verified" });

  const ctx = await asTutor(browser, me.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/new-class");

  const title = `E2E Published ${Date.now()}`;
  await page.getByPlaceholder(/Intégrales/).fill(title);
  await fillWallTime(page, wallDaysAhead(5)); // espace prof v2: the DD/MM/YYYY + 24 h picker
  /* price starts EMPTY and is `required`, so leaving it blank makes HTML5
     validation swallow the submit with no error anywhere -- the form just does
     nothing. duration (90) and seats (20) already have defaults. */
  await page.getByPlaceholder("15").fill("40");
  /* A real click, not dispatchEvent: this is a type="submit" button inside a
     <form>, and a dispatched click event does not trigger form submission. (The
     student dashboard needs the opposite treatment -- see student.spec.ts -- but
     only because of its live countdown; this page is static.) */
  await page.getByRole("button", { name: /Publier la classe/i }).click();

  await expect.poll(async () => {
    const [c] = await sql<{ n: number }[]>`
      select count(*)::int n from classes where tutor_id = ${tutor.id} and title = ${title}`;
    return c.n;
  }, { timeout: 20_000 }).toBe(1);

  await ctx.close();
});

test("an UNVERIFIED tutor cannot publish a class", async ({ browser }) => {
  const me = await seedProfile({ role: "tutor", birthYear: 1988 });
  const tutor = await seedTutor({ profileId: me.id, status: "pending" });

  const ctx = await asTutor(browser, me.id);
  const page = await ctx.newPage();
  await page.goto("/fr/dashboard/new-class");

  const title = `E2E Blocked ${Date.now()}`;
  const nameField = page.getByPlaceholder(/Intégrales/);

  /* The UI may not even offer the form to an unverified tutor. Either way the
     contract is the same and it is enforced in createClass(), server-side: no
     row is written. That is what must survive the move to Fastify. */
  if (await nameField.count()) {
    await nameField.fill(title);
    await fillWallTime(page, wallDaysAhead(5)); // espace prof v2: the DD/MM/YYYY + 24 h picker
    const price = page.getByPlaceholder("15");
    if (await price.count()) await price.fill("40");
    const btn = page.getByRole("button", { name: /Publier la classe/i });
    if (await btn.count()) await btn.click();
    await page.waitForTimeout(2000);
  }

  const [c] = await sql<{ n: number }[]>`
    select count(*)::int n from classes where tutor_id = ${tutor.id}`;
  expect(c.n, "an unverified tutor must not be able to publish").toBe(0);

  await ctx.close();
});

test("a tutor with no reviews shows no rating markup", async ({ page }) => {
  /* The truth rule, guarded: a tutor with no reviews must show "Nouveau" and must
     NOT emit AggregateRating JSON-LD. Google issues manual actions for fabricated
     rating markup. The gating exists in [slug]/page.tsx; this keeps the port from
     quietly removing it. */
  const tutor = await seedTutor({ status: "verified", fullName: "Unreviewed Tutor" });
  await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: 96 });

  const html = await (await page.request.get(`/fr/${tutor.slug}`)).text();
  expect(html.includes("AggregateRating"), "no reviews must mean no rating markup").toBe(false);
  expect(html).toContain("Pas encore d");
});

test("the storefront renders a real review, bylined with the FIRST NAME only", async ({ browser }) => {
  /* getTutorReviews moved to apps/api in the tutors domain and nothing asserted its
     RESULT — the storefront renders fine with an empty feed, so a broken port would
     have been invisible.

     A SEPARATE tutor from the test above, seeded WITH its review before the page is
     ever requested. Sharing one tutor fails, and correctly: the first request warms
     the ISR cache, so a review inserted afterwards is not visible until the entry
     expires. That is the caching e2e/isr.spec.ts exists to protect. */
  const tutor = await seedTutor({ status: "verified", fullName: "Reviewed Tutor" });
  const klass = await seedClass({ tutorId: tutor.id, seats: 5, hoursFromNow: -48 });
  const student = await seedProfile({ role: "student", birthYear: 1990, fullName: "Amine Karoui" });

  const { seedBooking } = await import("./support/seed");
  await seedBooking({ classId: klass.id, studentId: student.id, status: "attended" });
  await sql`insert into reviews (id, tutor_id, student_id, class_id, rating, text)
            values (gen_random_uuid(), ${tutor.id}, ${student.id}, ${klass.id}, 5, 'Excellent cours.')`;

  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`/fr/${tutor.slug}`);

  await expect(page.locator("main")).toContainText("Excellent cours.");
  /* THE FIRST NAME ONLY. This asserted "Amine K." until Step 8 replaced
     publicName with publicDisplayName: a surname initial alongside a subject and
     a level narrows a person a long way in a country of twelve million, and buys
     a reader nothing the first name does not.

     publicDisplayName is a security boundary on a fully public, unauthenticated
     page — not formatting. The assertion below got STRICTER, not looser: it now
     also forbids the initial. */
  await expect(page.locator("main")).toContainText("Amine");
  const main = await page.locator("main").innerHTML();
  expect(main, "the reviewer's full name must never reach a public page").not.toContain("Amine Karoui");
  expect(main, "not even the surname INITIAL — Step 8 removed it").not.toContain("Amine K.");

  await ctx.close();
});
