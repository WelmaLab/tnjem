/* @tnajem/shared — the contract between apps/web and apps/api.

   Pure modules only: no `server-only`, no database, no cookies, no Next imports.
   Fastify, the Next server, Next CLIENT components and plain unit tests all
   import from here, so anything with a runtime dependency belongs elsewhere.

   TWO modules are deliberately NOT re-exported here, and both for the same
   reason: this barrel is imported by CLIENT components.

     ./auth-core  imports node:crypto. Re-exporting it made webpack try to bundle
                  node:crypto for the browser and the web build died with
                  "UnhandledSchemeError: Reading from node:crypto is not handled".
                  Import it from "@tnajem/shared/auth-core" — server only.
     ./contracts  zod, ~14kB min+gz (Step 3+).

   Zod and node:crypto are NEVER re-exported from this
   barrel. That is deliberate, not cosmetic: this module is imported by client
   components (for the DTO types and safeNext), and zod is ~14kB min+gz. On a
   product whose scaling thesis is a mid-range Android on Tunisian 3G, dragging a
   validation library into the client bundle through a barrel export is a real
   regression. Verify with `npm run ui:weight` after touching this file. */

export * from "./types";
/* Every legal value (LEGAL-REVIEW). Pure constants — safe in the barrel. */
export * from "./legal";
export * from "./validation";
export * from "./admin";
export * from "./profile-input";
/* Pure predicates, no node builtins — safe in the barrel, unlike auth-core/mail. */
export * from "./free-first";
export * from "./standing";
export * from "./class-time";
/* Africa/Tunis formatting and parsing. Pure Intl, no dependencies. */
export * from "./time";
export * from "./cancellation";
/* Zero contact exchange: the allow-list and the text scanner. Both pure. */
export * from "./public-profile";
export * from "./contact-info";
export * from "./message-text";
export * from "./uploads";
/* Plans and entitlements (Step 16). Pure numbers and predicates — /tarifs is a
   client component and renders its prices straight from this catalogue. */
export * from "./plans";
// phase-a lane L1
/* When a conversation closes (A2). Pure constants and a mapping. */
export * from "./thread-state";
/* The support WhatsApp link, from NEXT_PUBLIC_SUPPORT_WHATSAPP (A12). Pure. */
export * from "./support-contact";
// end phase-a lane L1
// phase-a lane L2 — birth month + year, isAdult, the ALLOW_MINORS switch (A24). Pure.
export * from "./age";
// end phase-a lane L2
// phase-a lane L3 (A22): the one payment story (D4). Pure strings — safe in the barrel.
export * from "./payment-story";
// phase-a lane L5 — canonical codes for school levels (A18.7). Pure.
export * from "./levels";
// phase-a lane L5 — where a class stands: upcoming · live · done · cancelled (A18.10). Pure.
export * from "./class-phase";
// phase-a lane L5 — subjects stored as canonical codes, translated for display (A18.12). Pure.
export * from "./subjects";
// phase-a lane L5 — which role /account names: Élève · Prof · Parent · Admin (A18.13). Pure.
export * from "./account-role";
// espace prof v2 · shell — the tutor space payloads (AppShell, Mes élèves, vitrine visibility). Pure.
export * from "./tutor-space";
// espace prof v2 · auth (phase 2) — password length rules + the strength-meter heuristic. Pure.
// The 10k common-password list is NOT here: server-only subpath "@tnajem/shared/password-check".
export * from "./password-policy";
// espace prof v2 · growth (P3) — share links, utm_source vocabulary, pre-written messages. Pure.
export * from "./share-links";
// espace prof v2 · growth (P4, contract C5) — the e-mail preference kinds. Pure.
export * from "./email-prefs";
// espace prof v2 · growth (P5, contract C6) — THE price calculation, and the offer/promotion DTOs. Pure.
export * from "./pricing";
export * from "./offers";
// espace prof v2 · pro (P7) — .ics events, who may review, JSON-LD builders. All pure.
export * from "./ics";
export * from "./review-eligibility";
export * from "./structured-data";
export * from "./admin-offers";
// live-fixes-1 · pages (B) — « Mes fiches »: a pack and its file or video as ONE fiche. Pure.
export * from "./fiches";
// live-fixes-1 · pages (C2) — names, phones and subjects as they are SHOWN (never stored). Pure.
export * from "./display";
// student-space-v1 · A — the student shell: its nav table, breadcrumbs, badges and old-link map. Pure.
export * from "./student-shell";
// student-space-v1 · pages — the student space payloads (Accueil, Mes cours, Mes profs, Mes fiches). Pure.
export * from "./student-space";
// student-space-v1 · G — one conversation per (student, prof) pair: DTOs and two pure helpers.
export * from "./conversations";
// student-space-v1 · fixes (H2, C7) — a class is over at start + duration, whatever classes.status says. Pure.
export * from "./class-state";
