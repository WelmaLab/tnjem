import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import "@/components/home/home.css"; // home v2 · E: was an inline <style> string
import { HeroSection } from "@/components/home/HeroSection"; // home v2 · B
import { getHomeTutors } from "@/lib/home-tutors"; // home v2 · B
// home v2 · C: the body sections — server components, each with its own FR/AR copy.
import { SubjectsSection } from "@/components/home/SubjectsSection";
import { StepsSection } from "@/components/home/StepsSection";
import { FactsSection } from "@/components/home/FactsSection";
import { CtaBanner } from "@/components/home/CtaBanner";
import { ProfBand } from "@/components/home/ProfBand";
import { AboutSection } from "@/components/home/AboutSection"; // december-sprint · D (D15, D16)

/* ── SERVER COMPONENT (home v2 · E) ────────────────────────────────────────────
   This page was one big "use client" module: the whole page — copy for BOTH
   locales included — shipped as JavaScript and hydrated, to render text. It now
   renders on the server; the only client code left is what needs the browser:
     • <Link> (locale-aware next/link, client by construction),
     • <PilotTag> (asks /api/pilot after hydration — the flag is the running
       server's, never the build's),
     • <Reveal> (components/Reveal.tsx — the shared reveal-on-scroll; it starts
       visible and only arms sections that are off-screen at hydration).
   The locale comes from the URL segment, like the layout and /explore.

   STATIC + ISR. Prerendered per locale at build (the layout's generateStaticParams),
   re-rendered at most once a minute. Reads no cookies() / headers() /
   searchParams — any of those would silently make /fr dynamic (static-render.spec
   asserts x-nextjs-cache: HIT on /fr and /ar). Data for this page must come
   through callAnonymous() (lib/api.ts) and must FAIL SOFT: `next build` runs with
   no API, and a throw there fails the build. */
export const revalidate = 60;

/* =====================================================================
   STUDENT / PARENT LANDING — Tnajem (تنجّم)
   Public home page at "/". Wrapped in <SiteShell> (header + footer come
   from there). All copy is self-contained below in `copy` (fr/ar) — we do
   NOT touch lib/i18n.ts. RTL is global (LocaleProvider sets dir), so the
   layout uses logical CSS props throughout and flips automatically.

   INFORMATION ARCHITECTURE — 5 blocks, deliberately. A parent must get
   "what is this / what does it do for me / what do I click" in 5 seconds:
     1. HERO      — what it is, one CTA; then the subject chips (the tool)
     2. STEPS     — the backbone: search → book → live → continue (#etapes)
     3. 3 FACTS   — price shown first · hand-verified tutors · payment, plainly
     4. FINAL CTA — one line, one button (text only: no photo yet)
     5. TEACHER   — cross-link for the other audience (bottom, not top)
     6. ABOUT     — « Qui sommes-nous ? »: who runs it, who the pilot is open to,
                    the contact address (december-sprint · D, founder's request)
   The body sections (chips, 2–5) are components/home/{Subjects,Steps,Facts}Section,
   CtaBanner and ProfBand (home v2 · C): server components with their own FR/AR copy.
   Each promise is stated ONCE. If you add a section, delete one.

   HONESTY RULES (load-bearing — do not break):
   • Zero lessons taught, zero reviews. The page says so out loud.
   • Never invent tutor names, ratings, review counts, student counts or
     testimonials. The hero card (home v2 · B) shows REAL verified tutors from
     GET /tutors/home, then neutral subject rows — a price only when the tutor
     has one, a rating only from 3 reviews, a photo only when approved.

   MOTION BUDGET: one reveal-on-scroll per section, nothing on the hero (its
   H1 is the LCP). Killed by prefers-reduced-motion at the bottom of
   components/home/home.css (the sections use its .lp-rv via home/reveal.ts).
   ===================================================================== */

const copy = bilingual({
  fr: {
    // <head>: the title and description the layout already gave the home page (unchanged).
    metaTitle: "Tnajem — apprends avec ton prof",
    metaDescription:
      "Trouve un prof en direct, du primaire au Bac — toutes les matières, avec des profs tunisiens vérifiés un par un.",

    // home v2 · B: the hero's copy lives in components/home/HeroSection.tsx and HeroTutorsCard.tsx.
    // home v2 · C: the body sections carry their own copy (components/home/*).
  },

  ar: {
    metaTitle: "Tnajem — تعلّم مع أستاذك",
    metaDescription:
      "لقّي أستاذ دايركت، من الابتدائي للباك — كل المواد، مع أساتذة توانسة مؤكّدين واحد واحد.",
  },
});

function localeOf(raw: string): AppLocale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

/* <head>. Through pageMetadata like every other public route, so the home page
   gets its canonical and its hreflang set (fr-TN · ar-TN · x-default → /fr) —
   as a client page it could export no metadata and had neither. The title stays
   the layout's own (absolute: no "· Tnajem" suffix on the brand page), and the
   OG image / twitter card are pageMetadata's (the same /og.png as the layout).

   JSON-LD: nothing page-level. The layout already emits Organization + WebSite on
   every page; a second Organization node here would be a duplicate entity. The
   WebSite SearchAction → /explore?q={search_term_string} lives on the layout's
   WebSite node too, since ExploreClient seeds its search box from ?q= (home v2 · G). */
export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = localeOf((await props.params).locale);
  const c = copy[locale];
  const m = pageMetadata({ locale, path: "", title: c.metaTitle, description: c.metaDescription });
  return {
    ...m,
    title: { absolute: c.metaTitle },
    openGraph: { ...m.openGraph, title: c.metaTitle },
    twitter: { ...m.twitter, title: c.metaTitle },
  };
}

export default async function HomePage(props: { params: Promise<{ locale: string }> }) {
  const locale = localeOf((await props.params).locale);
  const c = copy[locale];

  /* home v2 · B: up to 3 real, verified tutors for the hero card. callAnonymous
     only (no cookies()/headers(), so /fr stays prerendered), cached 60 s, and []
     whenever the API is not there — `next build` runs with none (lib/home-tutors.ts). */
  const tutors = await getHomeTutors();

  return (
    <SiteShell>
      {/* ── HERO (lane B) ── */}
      {/* home v2 · B: the hero and its real-tutors card (components/home/HeroSection.tsx). */}
      <HeroSection locale={locale} tutors={tutors} />

      {/* ── SECTIONS (lane C) ── */}
      <SubjectsSection locale={locale} />
      <StepsSection locale={locale} />
      <FactsSection locale={locale} />
      <CtaBanner locale={locale} />
      <ProfBand locale={locale} />
      <AboutSection locale={locale} />
      {/* ── /SECTIONS (lane C) ── */}
    </SiteShell>
  );
}
