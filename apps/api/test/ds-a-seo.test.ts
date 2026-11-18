import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { profileJsonLd } from "@tnajem/shared";

/* december-sprint · A (D17) — technical SEO, the static half (the rendered half is
   e2e/ds-a-test-accounts.spec.ts).

   robots.txt: the bare rules stay; the PRIVATE areas get /fr and /ar twins, for
   every crawler group; auth, signup and class pages are NOT disallowed — auth and
   signup carry `noindex, follow`, which a crawler can only read if it may fetch the
   page. The tutor Service JSON-LD speaks the page's language. */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../../web");

/* robots.ts is LOADED and run, through a computed specifier: a static import would
   pull `next`'s global types into this package's tsc (they make NODE_ENV read-only).
   tsx may hand the default export back wrapped once (CommonJS interop). */
type RobotsRule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
async function loadRobots(): Promise<RobotsRule[]> {
  const spec = pathToFileURL(resolve(WEB, "app/robots.ts")).href;
  const mod = (await import(spec)) as { default: unknown };
  const fn = (typeof mod.default === "function" ? mod.default : (mod.default as { default: unknown }).default) as () => { rules: RobotsRule | RobotsRule[] };
  const rules = fn().rules;
  return Array.isArray(rules) ? rules : [rules];
}
const PRIVATE = ["dashboard", "account", "admin", "onboarding", "student", "live", "checkout", "messages", "guardian", "api"];
const BARE = [
  "/api/", "/admin/", "/dashboard", "/dashboard/", "/account",
  "/checkout", "/auth", "/signup", "/onboarding", "/student", "/live/", "/class/",
];

describe("D17 · robots.txt", () => {
  let groups: RobotsRule[] = [];
  before(async () => { groups = await loadRobots(); });

  test("every group: the bare rules unchanged, plus /fr and /ar for each private area", () => {
    assert.ok(groups.length > 1, "the wildcard group and the AI-bot groups");
    for (const g of groups) {
      const dis = ([] as string[]).concat(g.disallow ?? []);
      for (const b of BARE) assert.ok(dis.includes(b), `${String(g.userAgent)}: keeps ${b}`);
      for (const loc of ["fr", "ar"]) {
        for (const area of PRIVATE) {
          assert.ok(dis.includes(`/${loc}/${area}$`), `${String(g.userAgent)}: /${loc}/${area}$`);
          assert.ok(dis.includes(`/${loc}/${area}/`), `${String(g.userAgent)}: /${loc}/${area}/`);
          assert.ok(!dis.includes(`/${loc}/${area}`), `${String(g.userAgent)}: never the bare prefix /${loc}/${area}`);
        }
      }
      assert.equal(g.allow, "/");
    }
  });

  test("auth, consent, signup and class pages stay crawlable under /fr and /ar", () => {
    /* Google's matcher (RFC 9309): a rule is a prefix, a trailing "$" anchors it to the
       end of the path; the longest matching rule wins, allow on a tie. Every group
       allows "/", so any matching disallow wins. (No rule here uses "*".) */
    const matches = (rule: string, path: string) =>
      rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule);
    const longest = (path: string, rules: string[]) =>
      Math.max(-1, ...rules.filter((r) => matches(r, path)).map((r) => r.length));
    const blocks = (path: string, dis: string[]) => longest(path, dis) > longest(path, ["/"]);
    for (const g of groups) {
      const dis = ([] as string[]).concat(g.disallow ?? []);
      for (const loc of ["fr", "ar"]) {
        for (const p of ["/auth", "/auth/consent", "/signup/eleve", "/signup/prof", "/class/0b6c7a52-0000-4000-8000-000000000000", "/explore", "/walid-tester", "/students-maths", "/livestream-bac", "/apiculture", "/admin-maths", "/accounting-bac", "/messagesx", "/guardians-club", "/checkout-prof", "/onboarding-x", "/dashboards"]) {
          assert.equal(blocks(`/${loc}${p}`, dis), false, `${String(g.userAgent)}: /${loc}${p} must stay crawlable`);
        }
        for (const p of ["/dashboard", "/dashboard/settings", "/admin", "/student", "/live", "/api/x", "/admin/accounts", "/account", "/student/cours", "/messages", "/guardian/x", "/live/x", "/checkout", "/onboarding"]) {
          assert.equal(blocks(`/${loc}${p}`, dis), true, `${String(g.userAgent)}: /${loc}${p} is private`);
        }
      }
    }
  });
});

describe("D17 · noindex, follow on auth and signup (source)", () => {
  for (const f of ["auth/page.tsx", "signup/eleve/page.tsx", "signup/prof/page.tsx", "auth/consent/layout.tsx"]) {
    test(f, () => {
      const src = readFileSync(resolve(WEB, "app/[locale]", f), "utf8");
      assert.match(src, /robots: \{ index: false, follow: true \}/);
    });
  }

  test("signup/prof's description: the approved short line, no « Gratuit pendant le pilote »", () => {
    const src = readFileSync(resolve(WEB, "app/[locale]/signup/prof/page.tsx"), "utf8");
    assert.doesNotMatch(src, /Gratuit pendant le pilote|فابور في فترة التجربة/);
    assert.match(src, /3 mois sans abonnement\. \$\{COMMISSION_PCT\} % sur chaque élève payant, dès que le paiement passe par Tnajem\./);
    assert.match(src, /3 شهور بلا اشتراك\. \$\{COMMISSION_PCT\} % على كل تلميذ خالص، كي الخلاص يعدّي من Tnajem\./);
  });
});

describe("D17 · locale-aware structured data", () => {
  const base = {
    siteUrl: "https://tnajem.com",
    slug: "mohamed-math",
    name: "Mohamed B.",
    subject: "Maths",
    bio: "",
    imageUrl: null,
    reviews: { count: 0, average: 0 },
    students: 0,
    classes: [],
  };
  const service = (locale: "fr" | "ar") =>
    profileJsonLd({ ...base, locale }).find((o) => o["@type"] === "Service") as Record<string, unknown>;

  test("Service.serviceType: French unchanged, darija on the Arabic page", () => {
    assert.equal(service("fr").serviceType, "Cours particuliers en direct");
    assert.equal(service("ar").serviceType, "دروس خصوصية دايركت");
  });

  test("the Organization JSON-LD reads DESCRIPTION_AR on Arabic pages (source)", () => {
    const src = readFileSync(resolve(WEB, "app/[locale]/layout.tsx"), "utf8");
    assert.match(src, /description: locale === "ar" \? DESCRIPTION_AR : DESCRIPTION/);
  });
});
