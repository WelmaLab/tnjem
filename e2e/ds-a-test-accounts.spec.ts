import { randomBytes } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedAdmin, seedProfile, seedTutor, seedClass } from "./support/seed";
import { sql } from "./support/db";
import { mintSession, loginAs } from "./support/session";
import { api } from "./support/journey";

/* december-sprint · A — D11 (test accounts) and D17 (technical SEO), rendered.

   D11: a seeded TEST tutor is reachable by link (200, robots noindex) for its
   storefront and its class page, in both locales, and absent from Explore (and its
   search), the home card, the sitemap and the student suggestions. The switch on
   /admin/accounts shows the state and flips it; the API refuses it to a non-admin.

   D17: auth, consent and signup say `noindex, follow` and stay crawlable; robots.txt
   blocks the /fr and /ar private areas; the Arabic Organization JSON-LD is Arabic;
   /signup/prof's description carries the approved short line.

   ADDED, never edited into an existing spec. */

const robotsMeta = (html: string) => html.match(/<meta name="robots" content="([^"]*)"/)?.[1] ?? null;

async function page200(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url, { maxRedirects: 0 });
  expect(res.status(), `${url} answers by link`).toBe(200);
  return res.text();
}

test.describe("D11 · test accounts", () => {
  test("a test tutor is reachable by link with noindex, and in no public list", async ({ request, browser, baseURL }) => {
    const profile = await seedProfile({ role: "tutor", fullName: "Walid Tester" });
    const tutor = await seedTutor({ profileId: profile.id, fullName: "Walid Tester" });
    const klass = await seedClass({ tutorId: tutor.id, hoursFromNow: 96 });
    const control = await seedTutor({});
    // One subject nobody else has: the student below matches exactly these two tutors.
    const subject = `ds-a-subject-${randomBytes(3).toString("hex")}`;
    await sql`update tutors set subject = ${subject} where id in ${sql([control.id, tutor.id])}`;
    await sql`update tutors set is_test = true where id = ${tutor.id}`;

    for (const locale of ["fr", "ar"]) {
      const sf = await page200(request, `/${locale}/${tutor.slug}`);
      expect(robotsMeta(sf), `/${locale}/${tutor.slug}`).toBe("noindex, nofollow");
      const cls = await page200(request, `/${locale}/class/${klass.id}`);
      expect(robotsMeta(cls), `/${locale}/class/${klass.id}`).toBe("noindex, nofollow");
    }
    expect(robotsMeta(await page200(request, `/fr/${control.slug}`)), "an ordinary storefront is indexable").not.toContain("noindex");

    // Explore and its search: the API list, and the rendered page searched by the test tutor's own slug.
    const explore = (await api(`/tutors/explore?q=${encodeURIComponent(tutor.slug)}`)) as unknown as unknown[];
    expect(explore).toEqual([]);
    const page = await browser.newPage({ baseURL });
    await page.goto(`/fr/explore?q=${encodeURIComponent(tutor.slug)}`);
    await page.waitForLoadState("networkidle");
    await expect(page.locator(`a[href$="/${tutor.slug}"]`)).toHaveCount(0);
    await page.close();

    // The home card and the sitemap.
    const home = (await api("/tutors/home")) as unknown as { slug: string }[];
    expect(home.some((t) => t.slug === tutor.slug)).toBe(false);
    const refs = (await api("/tutors/public-refs")) as unknown as { slug: string }[];
    expect(refs.some((r) => r.slug === tutor.slug)).toBe(false);
    expect(refs.some((r) => r.slug === control.slug)).toBe(true);
    const sitemap = await (await request.get("/sitemap.xml")).text();
    expect(sitemap).not.toContain(`/${tutor.slug}<`);

    // The signed-in student's suggestions: matched on the shared subject — the control is in, the test tutor out.
    const student = await seedProfile({ role: "student" });
    await sql`update profiles set subjects = ${subject} where id = ${student.id}`;
    const studentHome = await api("/student/home", await mintSession(student.id));
    expect(studentHome.suggestionsMatched).toBe(true);
    const suggested = (studentHome.suggestions as { id: string }[]).map((t) => t.id);
    expect(suggested).toContain(control.id);
    expect(suggested).not.toContain(tutor.id);
  });

  test("/admin/accounts shows the state and flips it; the API refuses a non-admin", async ({ page, baseURL }) => {
    const profile = await seedProfile({ role: "tutor" });
    const tutor = await seedTutor({ profileId: profile.id });

    // Refused to a non-admin — the tutor themselves and a student — before any UI.
    for (const who of [profile.id, (await seedProfile({ role: "student" })).id]) {
      const res = await api("/admin/accounts/test", await mintSession(who), { profileId: profile.id, isTest: true });
      expect(res).toEqual({ ok: false, error: "forbidden" });
    }

    const admin = await seedAdmin();
    await loginAs(page.context(), admin.id);
    await page.goto(`${baseURL}/fr/admin/accounts`);
    await page.locator("[data-e2e=account-email]").fill(profile.email);
    await page.getByRole("button", { name: "Chercher" }).click();
    const row = page.locator("[data-e2e=account-test]");
    await expect(row).toHaveAttribute("data-test", "false");
    const sw = page.locator("[data-e2e=account-test-switch]");
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("[data-e2e=account-test-state]")).toHaveText("Non : visible dans les listes publiques");

    await sw.click();
    await expect(row).toHaveAttribute("data-test", "true");
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-e2e=account-test-state]")).toHaveText("Oui : masqué des listes publiques");
    let refs = (await api("/tutors/public-refs")) as unknown as { slug: string }[];
    expect(refs.some((r) => r.slug === tutor.slug)).toBe(false);
    const [t] = await sql<{ is_test: boolean }[]>`select is_test from tutors where id = ${tutor.id}`;
    expect(t.is_test).toBe(true);
    const audit = await sql<{ action: string }[]>`
      select action from admin_actions where subject_kind = 'tutor' and subject_id = ${tutor.id} order by created_at`;
    expect(audit.map((r) => r.action)).toEqual(["account.test.mark"]);

    await sw.click();
    await expect(row).toHaveAttribute("data-test", "false");
    refs = (await api("/tutors/public-refs")) as unknown as { slug: string }[];
    expect(refs.some((r) => r.slug === tutor.slug)).toBe(true);
  });
});

test.describe("D17 · technical SEO", () => {
  test("auth, consent and signup: noindex, follow — and robots.txt does not block them", async ({ request }) => {
    for (const locale of ["fr", "ar"]) {
      for (const path of ["/auth", "/auth/consent", "/signup/eleve", "/signup/prof"]) {
        const html = await page200(request, `/${locale}${path}`);
        expect(robotsMeta(html), `/${locale}${path}`).toBe("noindex, follow");
      }
    }
    const txt = await (await request.get("/robots.txt")).text();
    for (const locale of ["fr", "ar"]) {
      for (const area of ["dashboard", "account", "admin", "onboarding", "student", "live", "checkout", "messages", "guardian", "api"]) {
        expect(txt).toContain(`Disallow: /${locale}/${area}$\n`);
        expect(txt).toContain(`Disallow: /${locale}/${area}/\n`);
        // Never the bare prefix: it would also block tutor slugs such as /fr/students-maths.
        expect(txt).not.toContain(`Disallow: /${locale}/${area}\n`);
      }
      for (const open of ["auth", "signup", "class"]) {
        expect(txt, `/${locale}/${open} stays crawlable`).not.toContain(`Disallow: /${locale}/${open}`);
      }
    }
    expect(txt, "the bare rules stay").toContain("Disallow: /auth\n");
  });

  test("the Arabic Organization JSON-LD is Arabic; signup/prof's description is the approved line", async ({ request }) => {
    const org = (html: string) => {
      const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
        const v = JSON.parse(m[1]);
        return Array.isArray(v) ? v : [v];
      });
      return blocks.find((b) => b["@type"] === "Organization");
    };
    expect(org(await page200(request, "/ar")).description).toBe("لقّي أستاذ دايركت، من الابتدائي للباك — كل المواد، مع أساتذة توانسة مؤكّدين واحد واحد.");
    expect(org(await page200(request, "/fr")).description).toContain("Trouve un prof en direct");

    const desc = (html: string) => html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
    const fr = desc(await page200(request, "/fr/signup/prof"));
    expect(fr).toContain("3 mois sans abonnement. 10 % sur chaque élève payant, dès que le paiement passe par Tnajem.");
    expect(fr).not.toContain("Gratuit pendant le pilote");
    const ar = desc(await page200(request, "/ar/signup/prof"));
    expect(ar).toContain("3 شهور بلا اشتراك. 10 % على كل تلميذ خالص، كي الخلاص يعدّي من Tnajem.");
    expect(ar).not.toContain("فابور في فترة التجربة");
  });

  test("the footer logo sits beside its wordmark (the name is announced once, from the text)", async ({ page, baseURL }) => {
    for (const locale of ["fr", "ar"]) {
      await page.goto(`${baseURL}/${locale}`);
      const mark = page.locator("footer .brand-mark");
      await expect(mark.locator("img")).toHaveAttribute("alt", "");
      await expect(mark.locator(".brand-word")).toContainText("Tnajem");
    }
  });
});
