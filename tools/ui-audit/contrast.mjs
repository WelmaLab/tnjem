#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════════
   contrast.mjs — WCAG 2.1 contrast audit of the design tokens.

   This is the SOURCE OF TRUTH for colour decisions. It reads the real token
   values out of app/globals.css :root (so it can never drift from the CSS) and
   computes the contrast ratio for every foreground/background pair the app
   actually renders. Every row cites the file:line it was found at.

   Thresholds (WCAG 2.1 AA):
     normal  4.5  body text < 24px (or < 18.66px when bold)
     large   3.0  >= 24px, or >= 18.66px bold
     ui      3.0  non-text: component boundaries, focus rings, state indicators
                  (1.4.11). Reported as ADVISORY — see NOTE at the bottom.

   Exit code 1 if any non-advisory row fails.
   ══════════════════════════════════════════════════════════════════════════════ */

import { readTokens, contrast, over } from "./lib-color.mjs";

/* Optional CSS path arg — lets the same table be re-run against a *baseline*
   stylesheet (e.g. the pre-fix tokens) to produce a genuine before/after diff. */
const T = readTokens(process.argv[2] || undefined);
const W = "#FFFFFF";

/* Resolve a spec to a solid colour: "--token", a literal hex, or {fg,alpha,bg}. */
function resolve(spec) {
  if (typeof spec === "object") return over(resolve(spec.fg), spec.alpha, resolve(spec.bg));
  if (spec.startsWith("--")) {
    const v = T[spec.slice(2)];
    if (!v) throw new Error(`unknown token ${spec} — is it declared in globals.css :root?`);
    return v.startsWith("var(") ? resolve("--" + v.match(/--([\w-]+)/)[1]) : v;
  }
  return spec;
}

/* A translucent token (`--on-blue-fill: rgba(255,255,255,.10)`) laid over a solid
   one, as {fg,alpha,bg} — the alpha is READ from the declaration, so the row
   follows the CSS if the token changes. */
function onFill(token, bg) {
  const m = /,\s*([\d.]+)\s*\)\s*$/.exec(T[token.slice(2)] ?? "");
  if (!m) throw new Error(`${token} is not an rgba() token in globals.css :root`);
  return { fg: token, alpha: Number(m[1]), bg };
}

/* How a spec prints in the table: a token without its dashes, a composite as
   "fill@alpha/backdrop". */
function specLabel(spec) {
  if (typeof spec === "object") return `${specLabel(spec.fg)}@${spec.alpha}/${specLabel(spec.bg)}`;
  return spec.replace(/^--/, "");
}

const NEED = { normal: 4.5, large: 3.0, ui: 3.0 };

/* ── the pairs, grouped ───────────────────────────────────────────────────── */
const PAIRS = [
  // ── solid buttons: white label on a brand fill (15.5px/700 → NOT large) ──
  ["Buttons", W, "--ochre-btn", "normal", ".btn-primary label", "globals.css:78"],
  ["Buttons", W, "--ochre-btn-hover", "normal", ".btn-primary:hover", "globals.css:79"],
  ["Buttons", W, "--green-btn", "normal", ".btn-green label", "globals.css:81"],
  ["Buttons", W, "--ink", "normal", ".btn-ink label", "globals.css:80"],
  ["Buttons", W, "--blue", "normal", ".lp-chip-all / .verified", "page.tsx:271"],
  ["Buttons", W, "--blue700", "normal", ".lp-chip-all:hover", "page.tsx:272"],
  ["Buttons", W, "--rose", "normal", "student LIVE badge", "student/page.tsx"],
  // UI Option A (A3): cobalt carries STATE and the header way-in; the rose pill is destructive.
  ["Buttons", "--blue", "--bg", "normal", ".btn-outline label (header Tableau de bord)", "SiteHeader.tsx"],
  ["Buttons", "--blue", "--blue50", "normal", "selected language / sidebar current / .btn-outline:hover", "LocaleToggle.tsx, components/app/AppShell.tsx (.aps-link current)"],
  // espace prof v2 · shell (phase 1): the AppShell and its pages.
  ["Buttons", W, "--rose", "normal", ".aps-count unread badge (bell, messages) · .aps-danger", "globals.css .aps-count"],
  ["Buttons", W, "--blue", "normal", ".aps-fab « + » · .aps-dp-day.is-sel (picked date)", "globals.css .aps-fab"],
  ["Chips", "--ochre-ink", "--ochre-tint", "normal", ".aps-badge (Vérification) · .hp-mark-current", "globals.css .aps-badge"],
  ["Body text", "--ink", "--ochre-tint", "normal", ".aps-blocker title (Fais-toi vérifier)", "globals.css .aps-blocker"],
  ["Body text", "--ink2", "--ochre-tint", "normal", ".aps-blocker body", "globals.css .aps-blocker-txt"],
  ["Body text", "--muted", "--paper", "normal", ".aps-group-t · .aps-tab · .hp-kpi-v.is-zero (a greyed zero)", "globals.css .aps-*"],
  ["Accent text", "--blue", "--cream", "normal", ".hp-linkbox-url (tnajem.com/slug)", "globals.css .hp-linkbox"],
  ["Body text", "--ink2", "--paper", "normal", ".aps-link · .hp-kpi-l", "globals.css .aps-link"],
  ["Buttons", W, "--blue", "normal", "step numbers (HowItWorks, .lpp-node)", "dashboard/page.tsx, pour-les-profs"],
  ["Buttons", W, "--rose", "normal", "withdraw-consent confirm (rose destructive pill)", "guardian/page.tsx"],

  // ── chips & badges (11.5px/700 → normal) ──
  ["Chips", W, "--green-btn", "normal", ".chip-free", "globals.css:108"],
  ["Chips", W, "--green-btn", "normal", ".verified tick + .verified-pill word (A4)", "globals.css .verified"],
  ["Chips", W, "--green-btn", "normal", "pilot chip", "pour-les-profs:715"],
  ["Chips", "--blue", "--blue50", "normal", ".chip-soft", "globals.css:109"],
  ["Chips", "--ink2", "--sand", "normal", ".chip-sand", "globals.css:110"],
  ["Chips", "--rose", "--rose50", "normal", ".chip-rose", "globals.css:111"],
  ["Chips", "--green-ink", "--green50", "normal", "Nouveau badge", "ExploreClient.tsx:405"],
  ["Chips", "--green-ink", "--green50", "normal", "done chip", "dashboard/page.tsx:405"],
  // UI Option A (A5): the three status tags.
  ["Chips", "--ochre-ink", "--ochre-tint", "normal", ".tag-soon (Bientôt / Pas encore facturé)", "globals.css .tag-soon"],
  ["Chips", "--blue700", "--blue50", "normal", ".tag-neutral (Nouveau prof / levels / Recommandé)", "globals.css .tag-neutral"],
  ["Chips", "--blue700", "--blue50", "normal", "pilot tag \"Pilote · réservé aux 18 ans et +\" (FR + AR, .tag-neutral)", "components/PilotTag.tsx"],
  ["Chips", "--green-ink", "--green50", "normal", ".tag-success", "globals.css .tag-success"],
  // Phase A+ (U3): "En direct" — paper + ink, the rose dot.
  ["Chips", "--ink", "--paper", "normal", ".tag-live label (dashboard, live room, Pour les profs mock)", "globals.css .tag-live"],
  ["UI (advisory)", "--rose", "--paper", "ui", ".tag-live rose dot", "globals.css .tag-live::before"],
  ["Chips", "--blue", "--blue50", "normal", ".thumb month", "globals.css:148"],

  // ── body / meta text on every surface ──
  ["Body text", "--ink", "--paper", "normal", "default body", "globals.css:41"],
  ["Body text", "--ink", "--cream", "normal", "default body on .l-frame", "globals.css:58"],
  ["Body text", "--ink", "--sand", "normal", "default body on page bg", "globals.css:43"],
  // UI Option A (A1): the page background and the band.
  ["Body text", "--ink", "--bg", "normal", "body on the flat page bg", "globals.css body"],
  ["Body text", "--ink2", "--bg", "normal", ".web-lead on page bg", "globals.css body"],
  ["Body text", "--muted", "--bg", "normal", ".muted on page bg", "globals.css body"],
  ["Body text", "--ink", "--band", "normal", "text in the one band section", "page.tsx lp-sec / ExploreClient"],
  ["Body text", "--ink2", "--band", "normal", "lead in the band", "page.tsx lp-sec"],
  ["Body text", "--muted", "--band", "normal", "muted in the band", "ExploreClient filters"],
  ["Accent text", "--blue", "--band", "normal", "links / eyebrow in the band", "page.tsx lp-sec"],
  ["Accent text", "--blue", "--bg", "normal", ".web-eyebrow on page bg", "globals.css"],
  ["Body text", "--ink2", "--paper", "normal", ".web-lead / .side-nav", "globals.css:229"],
  ["Body text", "--ink2", "--cream", "normal", ".web-lead", "globals.css:229"],
  ["Body text", "--ink2", "--sand", "normal", ".chip-sand / .land p", "globals.css:192"],
  ["Body text", "--muted", "--paper", "normal", ".muted / .help / .metaline", "globals.css:96"],
  ["Body text", "--muted", "--cream", "normal", ".site-footer", "globals.css:223"],
  ["Body text", "--muted", "--sand", "normal", ".muted on page bg", "globals.css:96"],
  ["Body text", "--muted", "--blue50", "normal", ".thumb span", "globals.css:150"],
  ["Body text", "--muted", "--green50", "normal", ".muted in green callout", "globals.css:178"],
  ["Body text", "--green-ink", "--green50", "normal", ".trust p / .cd-callout", "globals.css:180"],
  // Phase A+ (U1): information is blue.
  ["Body text", "--blue700", "--blue50", "normal", ".note-info text / .cd-callout / .ck-cancel", "globals.css .note-info"],
  ["UI (advisory)", "--blue", "--blue50", "ui", ".note-info icon", "globals.css .note-info>.ic"],

  // ── coloured text on light surfaces ──
  ["Accent text", "--blue", "--paper", "normal", ".linklike / .sec a", "globals.css:313"],
  ["Accent text", "--blue", "--cream", "normal", ".web-eyebrow", "globals.css:226"],
  ["Accent text", "--blue", "--sand", "normal", ".web-eyebrow on page bg", "globals.css:226"],
  ["Accent text", "--green-ink", "--paper", "normal", ".sf-free Gratuite 17px", "StorefrontView.tsx:662"],
  ["Accent text", "--green-ink", "--cream", "normal", "0 TND 16px", "page.tsx:378"],
  ["Accent text", "--green-ink", "--sand", "normal", "green micro-copy", "pour-les-profs:745"],
  ["Accent text", "--ochre-ink", "--sand", "normal", "step line", "student/page.tsx:165"],
  ["Accent text", "--ochre-ink", "--cream", "normal", "step line", "verify/page.tsx:340"],
  ["Accent text", "--ochre-ink", "--ochre-tint", "normal", "TONES pill", "page.tsx:174"],
  ["Accent text", "--ochre-ink", "--ochre-tint", "normal", "MODE DÉMO banner 14px", "DemoBanner.tsx:28"],

  // ── large display text (h1 clamp(30,5.5vw,56) → large) ──
  ["Display", "--ochre-ink", "--cream", "large", "h1 highlight (verifie)", "page.tsx:319"],
  ["Display", "--ochre-ink", "--sand", "large", "h1 highlight on page bg", "page.tsx:319"],
  ["Display", "--green-ink", "--sand", "large", "h1 Tu gardes 100%", "pour-les-profs:726"],
  ["Display", "--green-ink", "--cream", "large", "h1 line 3", "pour-les-profs:726"],
  ["Display", "--blue", "--sand", "large", "h1 line 2", "pour-les-profs:723"],
  ["Display", "--blue", "--cream", "large", "h1 line 2", "pour-les-profs:723"],

  // ── on dark surfaces ──
  // The cobalt panels are gradients ending at --blue900, so every pair is
  // checked against the DARKER stop as well; that is the worst case for a light
  // foreground and the one a spot-check by eye always misses.
  ["On dark", W, "--blue", "normal", ".hero-blue body", "globals.css:135"],
  ["On dark", W, "--blue900", "normal", ".hero-blue gradient end", "globals.css:135"],
  ["On dark", "--on-blue-soft", "--blue", "normal", ".balance .lbl", "globals.css:159"],
  ["On dark", "--on-blue-soft", "--blue900", "normal", ".sf-subject", "StorefrontView.tsx:603"],
  ["On dark", "--on-blue", "--blue", "normal", ".lpp income copy", "pour-les-profs:493"],
  ["On dark", "--on-blue", "--blue900", "normal", ".sf-meta", "StorefrontView.tsx:611"],
  ["On dark", "--on-dark", "--ink800", "normal", "live-room body", "live/[id]:231"],
  ["On dark", "--on-dark", "--ink900", "normal", "live-room body (gradient end)", "live/[id]:199"],
  ["On dark", "--on-dark-soft", "--ink800", "normal", "live-room meta", "live/[id]:223"],
  ["On dark", "--on-dark-soft", "--ink900", "normal", "student panel meta", "student/page.tsx:272"],
  ["On dark", "--rose200", "--ink800", "normal", "LIVE badge / alert on dark", "student/page.tsx:338"],
  ["On dark", "--mint", "--blue900", "ui", "split-bar fill / dot", "pour-les-profs:506"],
  /* /tarifs' payoff number — --mint as TEXT at clamp(26-34px) on the hero-blue
     gradient, which runs --blue -> #082F54. Large text needs 3.0, but check it
     against BOTH ends: the gradient's light end is the harder one, and assuming
     the dark end because it looked fine is exactly how a contrast bug ships. */
  ["On dark", "--mint", "--blue", "large", ".tf-ex-net b payoff", "TarifsInner.tsx"],
  ["On dark", "--on-blue", "--blue", "normal", ".tf-ex-row b", "TarifsInner.tsx"],
  ["On dark", "--on-blue-soft", "--blue", "normal", ".tf-ex-row / cash / today", "TarifsInner.tsx"],
  ["On dark", "--mint200", "--blue900", "ui", ".sf-pill icon", "StorefrontView.tsx:631"],
  ["On dark", W, "--ink", "normal", ".toast / .side-nav .active", "globals.css:186"],

  // ── Auth Option B (AuthShell, OtpInput, the auth-* classes) ──
  // The brand panel is linear-gradient(--blue → --blue900): every text on it is
  // checked against BOTH ends — the light one is the hard one for light text.
  ["Auth (Option B)", "--on-blue-soft", "--blue", "normal", ".auth-eyebrow (13px) — light end", "globals.css .auth-eyebrow"],
  ["Auth (Option B)", "--on-blue-soft", "--blue900", "normal", ".auth-eyebrow (13px) — dark end", "globals.css .auth-eyebrow"],
  ["Auth (Option B)", W, "--blue", "normal", ".auth-panel-title H2 (mobile band 18px bold) — light end", "globals.css .auth-panel-title"],
  ["Auth (Option B)", W, "--blue900", "normal", ".auth-panel-title H2 (mobile band 18px bold) — dark end", "globals.css .auth-panel-title"],
  ["Auth (Option B)", "--on-blue-soft", "--blue", "normal", ".auth-panel-summary (mobile band 13px) — light end", "globals.css .auth-panel-summary"],
  ["Auth (Option B)", "--on-blue-soft", "--blue900", "normal", ".auth-panel-summary (mobile band 13px) — dark end", "globals.css .auth-panel-summary"],
  ["Auth (Option B)", "--on-blue", "--blue", "normal", ".auth-points li (14px) — light end", "globals.css .auth-points"],
  ["Auth (Option B)", "--on-blue", "--blue900", "normal", ".auth-points li (14px) — dark end", "globals.css .auth-points"],
  ["Auth (Option B)", W, onFill("--on-blue-rule", "--blue"), "ui", ".auth-tick white tick on its disc — light end", "globals.css .auth-tick"],
  ["Auth (Option B)", W, onFill("--on-blue-rule", "--blue900"), "ui", ".auth-tick white tick on its disc — dark end", "globals.css .auth-tick"],
  ["Auth (Option B)", "--on-blue", onFill("--on-blue-fill", "--blue"), "normal", ".auth-trust p (13px) + Shield on the note fill — light end", "globals.css .auth-trust"],
  ["Auth (Option B)", "--on-blue", onFill("--on-blue-fill", "--blue900"), "normal", ".auth-trust p (13px) + Shield on the note fill — dark end", "globals.css .auth-trust"],
  ["Auth (Option B)", "--ink", "--paper", "normal", ".auth-title (form H1) / .otp-box digits", "globals.css .auth-title, .otp-box"],
  ["Auth (Option B)", "--muted", "--paper", "normal", ".auth-lead / .auth-fine / .auth-terms / .auth-foot", "globals.css .auth-lead"],
  ["Auth (Option B)", "--blue", "--paper", "normal", ".auth-link (600, on <a> and <button>)", "globals.css .auth-link"],
  ["Auth (Option B)", "--blue", "--blue50", "ui", ".auth-icon-tile mail icon", "globals.css .auth-icon-tile"],
  ["Auth (Option B)", "--rose", "--paper", "normal", ".otp-error message (13px/600)", "globals.css .otp-error"],
  ["Auth (Option B)", "--rose", "--paper", "ui", ".otp-box[aria-invalid] rose border", "globals.css .otp-box"],
  ["Auth (Option B)", "--blue", "--paper", "ui", ".otp-box:focus border + 3px ring", "globals.css .otp-box:focus"],

  // ── avatar initials on their gradient — BOTH ends of every gradient ──
  ["Avatars", "--ink", "--amber", "normal", ".avatar / .cd-tutor-av initials (light end)", "globals.css .avatar"],
  ["Avatars", "--ink", "--ochre", "normal", ".avatar / .cd-tutor-av initials (dark end)", "globals.css .avatar"],
  ["Avatars", "--ink", "--amber", "normal", "hero seat A (amber end)", "pour-les-profs seats[0]"],
  ["Avatars", "--ink", "--ochre", "normal", "hero seat A (ochre end)", "pour-les-profs seats[0]"],
  ["Avatars", "--paper", "--blue", "normal", "hero seat S (blue end)", "pour-les-profs seats[1]"],
  ["Avatars", "--paper", "--blue700", "normal", "hero seat S (blue700 end)", "pour-les-profs seats[1]"],
  ["Avatars", "--ink", "--mint", "normal", "hero seat M (mint end)", "pour-les-profs seats[2]"],
  ["Avatars", "--ink", "--green", "normal", "hero seat M (green end)", "pour-les-profs seats[2]"],
  ["Avatars", "--ink", "--ochre300", "normal", "hero seat R (ochre300 end)", "pour-les-profs seats[3]"],
  ["Avatars", "--ink", "--ochre", "normal", "hero seat R (ochre end)", "pour-les-profs seats[3]"],

  // ── alert blocks ──
  ["Alerts", "--rose700", "--rose50", "normal", ".lg-notice b / .ck-alert", "privacy/page.tsx:47"],
  ["Alerts", "--rose600", "--rose50", "normal", ".lg-notice span", "privacy/page.tsx:48"],
  ["Alerts", "--blue", "--blue100", "normal", ".lpp-cross:hover", "pour-les-profs:710"],

  // ── espace prof v2 · auth (phase 2): the password strength meter + Sécurité ──
  // The segments carry the strength next to a word (.pw-meter-label), so 1.4.11's 3:1 applies.
  ["Password meter", "--rose", "--paper", "ui", ".pw-meter-bars span.on (weak)", "components/auth/PasswordField.tsx"],
  ["Password meter", "--ochre-ink", "--paper", "ui", ".pw-meter-bars[data-score=2] span.on (fair)", "components/auth/PasswordField.tsx"],
  ["Password meter", "--blue", "--paper", "ui", ".pw-meter-bars[data-score=3|4] span.on (good/strong)", "components/auth/PasswordField.tsx"],
  ["Password meter", "--ink2", "--paper", "normal", ".pw-meter-label", "components/auth/PasswordField.tsx"],
  ["Chips", "--blue", "--blue50", "normal", ".sec-pill-current (Cet appareil)", "components/settings/SecurityPanel.tsx"],
  ["UI (advisory)", "--muted", "--paper", "ui", ".pw-toggle eye icon", "components/auth/PasswordField.tsx"],
  // ── espace prof v2 · growth (P3–P5) ──
  ["Growth", "--blue700", "--blue50", "normal", "share target / FR·ع toggle selected, Abonné ✓, '−15 %' badge", "components/share/ShareSheet.tsx, follow/FollowButton.tsx, pricing/PromoPrice.tsx"],
  ["Growth", "--blue700", "--paper", "normal", "Abonné ✓ on the hero (white pill), share 'reset' link, consent/account links", "follow/FollowButton.tsx, share/ShareSheet.tsx, email/unsubscribe"],
  ["Growth", "--blue", "--paper", "normal", "Suivre (outline), S'abonner (btn-outline)", "follow/FollowButton.tsx, offers/OffersSection.tsx"],
  ["Growth", "--on-blue", "--blue", "normal", "follow note on the storefront hero", "follow/FollowButton.tsx"],
  ["Growth", "--ink2", "--cream", "normal", "share link field", "share/ShareSheet.tsx"],
  ["Growth", "--muted", "--paper", "normal", "struck price, '/ mois · jusqu'au …'", "pricing/PromoPrice.tsx, offers/OffersSection.tsx"],
  ["Growth", "--ochre-ink", "--ochre-tint", "large", "OG card price pill (30px)", "lib/og-card.tsx"],
  ["Growth", "--blue", "--cream", "large", "OG class card date line (32px)", "lib/og-card.tsx"],
  ["Growth", "--muted", "--cream", "large", "OG card URL (26px)", "lib/og-card.tsx"],
  ["Growth", "--rose700", "--blue50", "normal", "offer form error (.sb-err)", "dashboard/subscriptions/SubscriptionsView.tsx"],
  ["Growth", "--ink", "--blue50", "normal", "offer form labels and inputs (.sb-form)", "dashboard/subscriptions/SubscriptionsView.tsx"],
  ["Growth", "--ink2", "--blue50", "normal", "offer form help text (.sb-form)", "dashboard/subscriptions/SubscriptionsView.tsx"],
  ["Growth", "--rose700", "--paper", "normal", "promotion form error (.pv-err)", "dashboard/promotions/PromotionsView.tsx"],
  ["Growth", "--rose", "--paper", "normal", "admin promotions load error (.text-rose)", "components/admin/TutorPromotions.tsx"],

  // ── non-text UI (1.4.11) — ADVISORY, see NOTE ──
  ["UI (advisory)", "--blue", "--cream", "ui", ":focus-visible ring", "globals.css:49"],
  ["UI (advisory)", "--blue", "--paper", "ui", ":focus-visible ring", "globals.css:49"],
  ["UI (advisory)", "--line", "--paper", "ui", ".inp border", "globals.css:124"],
  ["UI (advisory)", "--line", "--cream", "ui", ".card / .u-card border", "globals.css:292"],
  ["UI (advisory)", "--paper", "--cream", "ui", ".u-card fill vs page", "globals.css:292"],
  ["UI (advisory)", "--paper", "--sand", "ui", ".u-card fill vs page bg", "globals.css:292"],
];

/* ── run ──────────────────────────────────────────────────────────────────── */
let fails = 0;
let advisoryFails = 0;
let group = null;
const w = (s, n) => String(s).padEnd(n).slice(0, n);

console.log("\nWCAG 2.1 AA contrast audit — tokens read from app/globals.css\n");
console.log("  " + w("FG", 28) + w("BG", 30) + w("RATIO", 8) + w("NEED", 11) + w("", 7) + "WHERE");
console.log("  " + "-".repeat(122));

for (const [g, fgSpec, bgSpec, size, what, where] of PAIRS) {
  if (g !== group) {
    group = g;
    console.log(`\n  ${g.toUpperCase()}`);
  }
  const fg = resolve(fgSpec);
  const bg = resolve(bgSpec);
  const ratio = contrast(fg, bg);
  const need = NEED[size];
  const ok = ratio >= need;
  const advisory = g.includes("advisory");
  if (!ok) advisory ? advisoryFails++ : fails++;
  const mark = ok ? "PASS" : advisory ? "ADVIS" : "FAIL";
  const label = typeof fgSpec === "string" && fgSpec.startsWith("--") ? `${fgSpec} (${fg})` : specLabel(fgSpec);
  console.log(
    "  " +
      w(label, 28) +
      w(specLabel(bgSpec), 30) +
      w(ratio.toFixed(2), 8) +
      w(`${need.toFixed(1)} ${size}`, 11) +
      w(mark, 7) +
      `${what}  ${where}`
  );
}

console.log("\n  " + "-".repeat(122));
console.log(`  ${PAIRS.length} pairs checked — ${fails} FAIL, ${advisoryFails} advisory below 3.0\n`);

if (advisoryFails) {
  console.log(
    "  NOTE  The advisory rows are WCAG 1.4.11 (non-text contrast) on hairline borders and\n" +
      "        card fills. They are decorative separators, not the sole means of identifying a\n" +
      "        component (every field has a visible <label>, every card has heading text), so\n" +
      "        they are reported but do not fail the build. Darkening --line to satisfy 3.0\n" +
      "        would visibly change the brand's soft-paper look on every surface.\n"
  );
}

if (fails) {
  console.error(`  x ${fails} WCAG AA contrast failure(s).\n`);
  process.exit(1);
}
console.log("  OK — zero WCAG AA contrast failures.\n");
