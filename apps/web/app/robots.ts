import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

/* Everything behind auth (dashboard, account, checkout, live rooms), the admin
   review queue and the protected document viewer must stay out of the index.

   /signup is in here with /auth, not treated as a landing page: both signup screens
   are transactional forms whose only content is a phone field, and the pages we
   actually want to rank for those two intents already exist — /pour-les-profs for
   tutors, /explore for students, each of which links into the funnel. Indexing a
   thin duplicate of that intent splits the ranking signal instead of adding one. */
const DISALLOW = [
  "/api/", "/admin/", "/dashboard", "/dashboard/", "/account",
  "/checkout", "/auth", "/signup", "/onboarding", "/student", "/live/", "/class/",
];

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
