/* Every page under app/[locale], as a pattern — so middleware can tell a real route
   from a 404 BEFORE anything renders.

   Why middleware needs it: /fr/a/b used to reach Next's built-in English "404 —
   This page could not be found" (no locale, no header, no way onward), and
   /fr/class or /fr/live — reserved names with no page of their own — fell into
   app/[locale]/[slug] and rendered the storefront's not-found screen with a 200.
   Middleware now rewrites anything that is not in this table to the localized
   catch-all (app/[locale]/[...rest]) with a 404 status.

   KEPT IN SYNC BY A TEST: e2e/route-table.spec.ts walks app/[locale] and fails if
   a page.tsx exists that is not listed here, or the other way round. `[slug]` and
   `[...rest]` are not listed: middleware handles them itself. Edge-safe. */
export const ROUTE_PATTERNS: readonly string[] = [
  "",
  "account",
  "aide", // espace prof v2 · pro (P7)
  "admin/accounts",
  "admin/moderation",
  "admin/plans",
  "admin/verifications",
  "auth",
  "auth/consent",
  "checkout",
  "class/[id]",
  "dashboard",
  "dashboard/classes", // espace prof v2 · shell
  "dashboard/materials",
  "dashboard/new-class",
  "dashboard/new-pack",
  "dashboard/payout",
  "dashboard/plan", // espace prof v2 · shell
  "dashboard/promotions", // espace prof v2 · growth (P5)
  "dashboard/settings", // espace prof v2 · shell (phase 6)
  "dashboard/storefront", // espace prof v2 · shell
  "dashboard/storefront/preview", // espace prof v2 · shell
  "dashboard/students", // espace prof v2 · shell
  "dashboard/subscriptions", // espace prof v2 · growth (P5)
  "email/unsubscribe", // espace prof v2 · growth (P4, C5)
  "explore",
  "guardian",
  "guardian/threads/[id]",
  "live/[id]",
  "messages",
  "messages/[id]",
  "onboarding",
  "onboarding/upgrade",
  "onboarding/verify",
  "pour-les-profs",
  "privacy",
  "signup/eleve",
  "signup/prof",
  "student",
  "student/cours", // student-space-v1 · pages (C)
  "student/cours/[bookingId]", // student-space-v1 · pages (C)
  "student/profs", // student-space-v1 · pages (D)
  "student/welcome",
  "tarifs",
  "terms",
];

const COMPILED = ROUTE_PATTERNS.map((p) => ({
  pattern: p,
  re: new RegExp(`^/${p.split("/").map((s) => (s.startsWith("[") ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/")}$`),
}));

/** The route pattern a locale-stripped path matches ("/class/abc" → "class/[id]"), or null. */
export function matchRoute(bare: string): string | null {
  const path = bare === "/" ? "/" : bare.replace(/\/+$/, "");
  if (path === "/") return "";
  return COMPILED.find((c) => c.re.test(path))?.pattern ?? null;
}

/** Where middleware rewrites an unmatched path: two segments, so it can only land on
    app/[locale]/[...rest] — never on the single-segment [slug] storefront. */
export const NOT_FOUND_SEGMENT = "404";
