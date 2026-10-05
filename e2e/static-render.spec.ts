import { test, expect, type APIRequestContext } from "@playwright/test";
import { seedProfile, seedTutor } from "./support/seed";
import { mintSession } from "./support/session";

/* ════════════════════════════════════════════════════════════════════════════
   Static where it can be, request-time where it must be, 404 where it should be.

   Until 15 Sept app/[locale]/not-found.tsx called headers(), which made EVERY
   locale page dynamic: /fr answered "Cache-Control: private, no-store" and the
   storefront — the page a WhatsApp link opens — re-rendered on every hit. Removing
   that is only safe if the pages that DEPEND on the request stay dynamic on
   purpose, and if unknown URLs keep answering a real 404 that is never cached.

   Runs against the production build (ISR does not exist in `next dev`).
   ADDED, never edited into an existing spec. */

async function head(request: APIRequestContext, path: string, cookie?: string, extra: Record<string, string> = {}) {
  const res = await request.get(path, {
    maxRedirects: 0,
    headers: { "x-forwarded-proto": "https", ...(cookie ? { cookie } : {}), ...extra },
  });
  return { status: res.status(), headers: res.headers(), body: await res.text() };
}

test.describe("static rendering and 404s", () => {
  test("marketing pages are served from the prerendered cache", async ({ request }) => {
    for (const path of ["/fr", "/ar", "/fr/pour-les-profs", "/fr/privacy", "/fr/terms"]) {
      const r = await head(request, path);
      expect(r.status, path).toBe(200);
      expect(r.headers["x-nextjs-cache"], `${path} is prerendered`).toBe("HIT");
    }
  });

  test("the site root is rewritten, not proxied — it works behind a TLS proxy", async ({ request }) => {
    const r = await head(request, "/");
    expect(r.status, "GET / with X-Forwarded-Proto: https used to be a 500 (EPROTO)").toBe(200);
    expect(r.body).toContain('<html lang="fr"');
  });

  test("the cacheable root never depends on the language cookie: a stored Arabic choice is a redirect", async ({ request }) => {
    const plain = await head(request, "/");
    expect(plain.headers["cache-control"], "/ is served from the prerendered /fr").toContain("s-maxage");
    expect(plain.headers["vary"] ?? "", "Next replaces Vary, so the body cannot rely on it").not.toContain("Cookie");

    const ar = await head(request, "/", "NEXT_LOCALE=ar");
    expect(ar.status).toBe(307);
    expect(ar.headers["location"]).toMatch(/\/ar$/);

    const fr = await head(request, "/", "NEXT_LOCALE=fr");
    expect(fr.status, "the default locale keeps the no-hop rewrite").toBe(200);
    expect(fr.body).toContain('<html lang="fr"');
  });

  test("guarded pages still decide per request: a bogus cookie is sent to /auth", async ({ request }) => {
    for (const path of ["/fr/onboarding", "/fr/onboarding/verify", "/fr/onboarding/upgrade", "/fr/student/welcome"]) {
      const r = await head(request, path, "tnajem_session=not-a-real-session");
      expect(r.status, `${path} must not be a baked static page`).toBe(307);
      expect(r.headers["location"], path).toContain("/fr/auth");
    }
  });

  test("…and a real session gets its own answer, not a cached one", async ({ request }) => {
    const student = await seedProfile({ role: "student", birthYear: 1995 });
    const r = await head(request, "/fr/onboarding", `tnajem_session=${await mintSession(student.id)}`);
    expect(r.status).toBe(307);
    expect(r.headers["location"], "a student is sent to the upgrade screen, not to /auth").toContain("/fr/onboarding/upgrade");
  });

  test("request-time pages are not cached", async ({ request }) => {
    for (const path of ["/fr/auth", "/fr/signup/prof", "/fr/tarifs", "/fr/explore"]) {
      const r = await head(request, path);
      expect(r.status, path).toBe(200);
      expect(r.headers["cache-control"] ?? "", path).toContain("no-store");
    }
  });

  test("a storefront is ISR: rendered once, then served from cache", async ({ request }) => {
    const tutor = await seedTutor({ status: "verified", fullName: "Cached Storefront Tutor" });
    const first = await head(request, `/fr/${tutor.slug}`);
    expect(first.status).toBe(200);
    expect(first.headers["x-nextjs-cache"]).toBe("MISS");
    expect(first.headers["cache-control"]).toContain("s-maxage=60");
    const second = await head(request, `/fr/${tutor.slug}`);
    expect(second.headers["x-nextjs-cache"]).toBe("HIT");
    expect(second.body).toContain("Cached S."); // phase-a lane L2 (A23): first name + initial
  });

  test("unknown URLs are a localized 404 that is never cached", async ({ request }) => {
    const cases: [string, string][] = [
      ["/fr/a/b", "Cette page n'existe pas"],
      ["/ar/a/b", "الصفحة هاذي ما موجودةش"],
      ["/fr/class", "Cette page n'existe pas"],
      ["/fr/signup", "Cette page n'existe pas"],
      ["/fr/x.y", "Cette page n'existe pas"],
      ["/fr/Not-A-Slug", "Cette page n'existe pas"],
      [`/fr/no-such-tutor-${Date.now()}`, "Cette page n'existe pas"],
    ];
    /* student-space-v1 · I: as a visitor of its OWN. The proxy's slug lookup has a per-IP
       budget (lib/tutor-lookup.ts: 20, +1 every 3 s) and, over it, fails open to the soft
       404 on purpose; the ssv1-* specs that run just before open dozens of storefronts from
       the same 127.0.0.1 and left none — a 200 here, only in the full run. The budget
       itself is pinned in tutor-lookup.spec.ts. 198.51.100.0/24 is TEST-NET-2. */
    const visitor = { "x-real-ip": `198.51.100.${1 + Math.floor(Math.random() * 250)}` };
    for (const [path, title] of cases) {
      for (const attempt of [1, 2]) {
        const r = await head(request, path, undefined, visitor);
        expect(r.status, `${path} (attempt ${attempt})`).toBe(404);
        expect(r.headers["x-nextjs-cache"], `${path} must not enter the ISR cache`).toBeUndefined();
        expect(r.body.replace(/&#x27;/g, "'"), path).toContain(title);
        expect(r.body, `${path} is not Next's English page`).not.toContain("<h1 class=\"next-error-h1\"");
      }
    }
  });
});
