import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession, sessionCookie } from "./support/session";

/* ════════════════════════════════════════════════════════════════════════════
   Every route names itself — in the tab, in search, and in the WhatsApp card.

   On 14 Sept nine routes shared the home page's title and preview. The costly one
   was /pour-les-profs: tutors forward it to recruit other tutors and the card
   read "apprends avec ton prof" — the student pitch.

   Pinned: a distinct <title> per route in both locales; a complete share card
   (og:title, og:image, twitter) on public routes; noindex on the private ones,
   read with a real session because middleware redirects them otherwise.

   ADDED, never edited into an existing spec. */

const PUBLIC = ["", "/auth", "/signup/prof", "/signup/eleve", "/pour-les-profs", "/terms", "/privacy", "/explore", "/tarifs"];
const NOINDEX_FOLLOW = new Set(["/auth", "/signup/prof", "/signup/eleve"]); // december-sprint · A (D17)

function head(html: string) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const meta = (attr: string, key: string) =>
    html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1] ?? null;
  return {
    title,
    ogTitle: meta("property", "og:title"),
    ogImage: meta("property", "og:image"),
    twitterTitle: meta("name", "twitter:title"),
    robots: meta("name", "robots"),
  };
}

async function read(request: APIRequestContext, url: string) {
  const res = await request.get(url, { maxRedirects: 0 });
  expect(res.status(), `${url} must render, not redirect`).toBe(200);
  return head(await res.text());
}

for (const locale of ["fr", "ar"] as const) {
  test(`/${locale}: every public route has its own title and a complete share card`, async ({ request }) => {
    const seen = new Map<string, string>();
    for (const path of PUBLIC) {
      const url = `/${locale}${path}`;
      const h = await read(request, url);
      expect(h.title, `${url} needs a title`).not.toBe("");
      expect(seen.get(h.title), `${url} shares its title with ${seen.get(h.title)}`).toBeUndefined();
      seen.set(h.title, url);
      expect(h.ogTitle, `${url} og:title`).toBeTruthy();
      /* profs-v2 · D: /pour-les-profs has its own tutor-facing card, every other route the brand one. */
      const card = path === "/pour-les-profs" ? `/${locale}/pour-les-profs/opengraph-image` : "/og.png";
      expect(h.ogImage, `${url} og:image — a child openGraph must not drop the image`).toContain(card);
      expect(h.twitterTitle, `${url} twitter:title must describe this page, not the home page`).toBe(h.ogTitle);
      /* december-sprint · A (D17, gate amendment 3): auth and signup keep their share
         card but are `noindex, follow` — crawlable, never ranked. */
      if (NOINDEX_FOLLOW.has(path)) expect(h.robots, `${url} is noindex, follow`).toBe("noindex, follow");
      else expect(h.robots, `${url} is public`).not.toContain("noindex");
    }
  });
}

test("/pour-les-profs shares a tutor-facing card, not the student pitch", async ({ request }) => {
  const fr = await read(request, "/fr/pour-les-profs");
  expect(fr.ogTitle).toBe("Donne tes cours en ligne · Tnajem");
  expect(fr.ogTitle).not.toContain("apprends avec ton prof");

  const ar = await read(request, "/ar/pour-les-profs");
  expect(ar.title).toBe("اعطي دروسك أونلاين · Tnajem");

  for (const locale of ["fr", "ar"]) {
    const card = await request.get(`/${locale}/pour-les-profs/opengraph-image`);
    expect(card.status(), `/${locale} card`).toBe(200);
    expect(card.headers()["content-type"]).toContain("image/png");
  }
});

test("dashboard, student space and onboarding are noindex, with their own titles", async ({ browser, baseURL }) => {
  const tutorProfile = await seedProfile({ role: "tutor", birthYear: 1985 });
  await seedTutor({ profileId: tutorProfile.id, status: "verified" });
  const student = await seedProfile({ role: "student", birthYear: 1990 });

  const tutorCtx = await browser.newContext({ baseURL });
  await tutorCtx.addCookies([sessionCookie(await mintSession(tutorProfile.id))]);
  const studentCtx = await browser.newContext({ baseURL });
  await studentCtx.addCookies([sessionCookie(await mintSession(student.id))]);

  const titles = new Set<string>();
  for (const [ctx, path] of [
    [tutorCtx, "/fr/dashboard"],
    [tutorCtx, "/fr/onboarding"],
    [studentCtx, "/fr/student"],
  ] as const) {
    const h = await read(ctx.request, path);
    expect(h.robots, `${path} is private`).toContain("noindex");
    expect(h.title, `${path} must not wear the home title`).not.toContain("apprends avec ton prof");
    titles.add(h.title);
  }
  expect(titles.size, "three private routes, three titles").toBe(3);

  await tutorCtx.close();
  await studentCtx.close();
});
