import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

/* Everything behind auth (dashboard, account, checkout, live rooms), the admin
   review queue and the protected document viewer must stay out of the index.

   /signup is in here with /auth, not treated as a landing page: both signup screens
   are transactional forms whose only content is a phone field, and the pages we
   actually want to rank for those two intents already exist — /pour-les-profs for
   tutors, /explore for students, each of which links into the funnel. Indexing a
   thin duplicate of that intent splits the ranking signal instead of adding one. */
const BARE = [
  "/api/", "/admin/", "/dashboard", "/dashboard/", "/account",
  "/checkout", "/auth", "/signup", "/onboarding", "/student", "/live/", "/class/",
];

/* december-sprint · A (D17, gate amendment 3). EVERY PAGE THE SITE SERVES IS UNDER
   /fr OR /ar, so the bare rules above only ever matched the locale-less redirects:
   /fr/dashboard, /fr/admin/… were crawlable. These are the PRIVATE AREAS, prefixed.

   Deliberately NOT here:
     • auth, auth/consent, signup/eleve, signup/prof — they carry `noindex, follow`
       in their metadata, and a crawler blocked by robots.txt can never read that tag
       (a disallowed URL can still be indexed from links, without its content);
     • /fr/class/…, /ar/class/… — a class page is public and bookable, with its own
       Course JSON-LD; only the bare /class/ above stays, as before. A test
       account's class carries noindex instead (D11). */
const PRIVATE_AREAS = [
  "dashboard", "account", "admin", "onboarding", "student", "live", "checkout", "messages", "guardian", "api",
] as const;

/* TWO rules per area, never the bare prefix: robots rules are PREFIXES, so
   "/fr/student" would also block a tutor whose slug merely starts with it
   (/fr/students-maths, /fr/apiculture, /ar/livestream-bac). RESERVED_SLUGS only
   refuses exact matches. "$" anchors the page itself, the trailing "/" its subtree. */
const PREFIXED = ["fr", "ar"].flatMap((locale) =>
  PRIVATE_AREAS.flatMap((area) => [`/${locale}/${area}$`, `/${locale}/${area}/`]),
);

/* Bare first (unchanged), then the prefixed ones. */
const DISALLOW = [...BARE, ...PREFIXED];

/* AI assistant crawlers — EXPLICITLY WELCOMED (founder decision 2026-07-12). A
   marketplace that wants to be *recommended* by ChatGPT / Claude / Perplexity / AI
   Overviews should be citable by them. Everything on the public site is truthful —
   no fabricated ratings, stats or testimonials (ratings render only from real
   reviews) — so there is no fabricated-data liability in being quoted. `userAgent:
   "*"` already allows them, but listing them makes the intent explicit and survives
   a future tightening of the wildcard. They still stay out of the private areas. */
const AI_BOTS = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",      // OpenAI
  "ClaudeBot", "Claude-Web", "anthropic-ai",       // Anthropic
  "PerplexityBot", "Perplexity-User",              // Perplexity
  "Google-Extended",                               // Google (Gemini / AI Overviews training)
  "Applebot-Extended",                             // Apple Intelligence
  "CCBot",                                         // Common Crawl (feeds many models)
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      ...AI_BOTS.map((userAgent) => ({ userAgent, allow: "/", disallow: DISALLOW })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
