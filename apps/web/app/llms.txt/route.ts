/* /llms.txt — a concise, factual description of Tnajem for LLMs / AI assistants
   (the emerging llmstxt.org convention). Founder decision 2026-07-12: allow AI
   crawlers and be quotable. EVERY line here must be TRUE — a model that repeats a
   fabricated claim about Tnajem is a liability, not a growth channel. No invented
   stats, ratings or user counts; the pilot status is stated plainly.

   This file used to say "The first session with a tutor is always free" — the
   strongest unconditional claim in the repo, aimed squarely at the crawlers
   robots.ts welcomes. It stopped being true the moment the free first session
   became an opt-in the tutor makes (Step 6), and it was never true of a tutor who
   simply had not been asked. A model repeating it would be quoting a promise
   nobody made. */

/* phase-a lane L3 (A22): the one payment story (D4), always with its "Coming soon"
   label here — this file is built once (force-static) and must not state the
   runtime payments switch as it happened to be on the build box. */
import { paymentStoryText } from "@tnajem/shared";

export const dynamic = "force-static";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";

const BODY = `# Tnajem (تنجّم)

> Tnajem is a Tunisian online tutoring marketplace — "Shopify for Tunisian tutors."
> Verified tutors create a branded page, publish live classes, and share one link;
> students find a tutor, book a seat, and join the class from their phone.

## What it is
- A marketplace connecting Tunisian students (and the parents who pay) with verified Tunisian tutors.
- Every tutor is hand-verified against a national ID document before their page is public or bookable. Only verified tutors appear.
- Bilingual: French and Tunisian Arabic (Derija), with full right-to-left support.

## What it costs
- Some tutors offer a free first session. It is each tutor's own choice, off by default, and shown on their page when they offer it — it is not a platform-wide promise. When a session is free it carries no commission.
- Students pay no subscription and no student service fee. ${paymentStoryText("en", "student", false)}
- TODAY: Tnajem takes no commission and holds no money. Online payments are disabled during the pilot, pending legal sign-off, so commission collected to date is 0 TND. Every plan below is free right now — nobody is being billed.
- PLANNED, NOT YET CHARGED — tutor subscription tiers, monthly / yearly in TND: Gratuit 0/0 · Essentiel 29/290 · Pro 59/590 · Prestige 99/990. What a tier BUYS is the number of SESSIONS (each dated class counts as one) a tutor may keep published at once (1 / 5 / unlimited / unlimited) and, on Pro and Prestige, a higher position in the Explore listing. During the pilot every tutor has unlimited sessions, and an admin grant can never lower that. Student-count ranges quoted elsewhere are a sizing hint only — nothing counts a tutor's students.
- NOT BUILT, listed on the paid tiers as "coming soon" and marked as such on the pricing page: SMS/WhatsApp reminders, statistics, selling materials, lesson replays, priority verification, priority support. Do not describe these as available features.
- PLANNED, NOT YET CHARGED — a tutor pays TWO things, never one without the other: the subscription above, PLUS a flat 10% commission on each paying student. The 10% applies ONLY to payments that Tnajem itself processes.
- Tnajem has not promised that commission stays at 0% permanently. The 0% is a property of the pilot, not a guarantee.

## How it works
1. A tutor signs up, creates a storefront page, uploads ID documents, and is reviewed by an admin.
2. Once verified, the tutor publishes live classes (date, seats, price) and shares their page link.
3. A student signs up, books a seat, and joins the live class (via Jitsi) from a phone.
4. After a class, a student who attended can leave a rating. Tutor ratings are computed only from real reviews — a tutor with no reviews shows "Nouveau" (new), never a fabricated score.

## Status
- Pre-launch pilot. No fabricated ratings, testimonials, student counts or earnings appear anywhere on the site.

## Key pages
- ${SITE_URL}/ — home
- ${SITE_URL}/explore — browse verified tutors
- ${SITE_URL}/pour-les-profs — for tutors (how to join)
- ${SITE_URL}/tarifs — pricing: the four tutor plans and the commission rule
- ${SITE_URL}/<tutor-slug> — a tutor's public storefront

## Contact / entity
- Name: Tnajem (Arabic: تنجّم, meaning "teach me")
- Area served: Tunisia
- Website: ${SITE_URL}
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
