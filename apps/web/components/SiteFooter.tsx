"use client";
import "./SiteFooter.css";
import { Link } from "@/components/Link";
import { Logo } from "@/components/Logo";
import { SOCIAL_LINKS, type SocialNetwork } from "@/lib/social";
import { CONTACT_EMAIL, SUPPORT_HOURS, SUPPORT_WHATSAPP_MESSAGE, supportWhatsAppHref } from "@tnajem/shared";
import { useLocale } from "./LocaleProvider";
import { useRoleHint } from "./role-hint";

/* Site footer — brand, then the same two-audience split as the header
   (students/parents · tutors), then legal. A visitor who scrolled to the bottom
   without deciding still sees exactly two doors.
   Bilingual + RTL-safe: logical properties only, no left/right.
   Page-scoped CSS is prefixed `qf-` and lives in ./SiteFooter.css (home v2 · G:
   it was an inline <style> shipped in every page's HTML and in the JS bundle).

   AUTH-AWARE (student-space-v1 · A), read after hydration from the role hint (./role-hint.ts)
   so the server HTML — the logged-out footer — stays cacheable and /[slug] stays ISR:
     logged out        exactly as before;
     a student         « Mon espace » (→ /student) for « Mes cours »; no « Se connecter »,
                       no « Tableau de bord » (that one is the prof's);
     a prof            « Tableau de bord »; no « Se connecter », no student link (it would
                       only bounce them to /dashboard), no « Créer ma page » (they have one);
     a parent          « Espace parent »; no « Se connecter », no « Tableau de bord ».

   home v2 · D (UI_options/home-v2-reference.png): the mockup's 4 columns were already
   this footer; the bottom bar now reads « © 2026 Tnajem · Tunisie » on the start side
   and the social icons + the contact address on the end side. The icons follow
   honesty rule 5: one per account whose URL is configured (lib/social.ts), none —
   and no empty list — when nothing is. */

/* december-sprint · B (D14, gate amendment 2): the contact address is CONTACT_EMAIL and
   the WhatsApp number is NEXT_PUBLIC_SUPPORT_WHATSAPP, both through
   @tnajem/shared/support-contact — the one source the footer, /aide, /account and
   /pour-les-centres share. NEXT_PUBLIC_ is inlined at build time, read by its full
   literal name. While it is empty or invalid, supportWhatsAppHref() answers null and
   no WhatsApp element renders at all; the support hours stay, beside the e-mail. */
const WHATSAPP_RAW = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;

/* HARDCODED, on purpose. A copyright notice carries the year of first publication,
   and Tnajem's is 2026 — that stays true. A computed year would not be more honest:
   the static pages (terms, privacy, tarifs…) are rendered once at build time and
   would freeze the build's year in their HTML, while this client component would
   compute the visitor's year on hydration — two different texts, i.e. a hydration
   mismatch every 1 January until the next build. Extend it to a range (« 2026–2027 »)
   by hand if the founder wants the latest year shown. */
const COPYRIGHT_YEAR = 2026;

/* Footer link labels are page-local (lib/i18n.ts is shared/read-only). */
const F = {
  fr: {
    students: "Élèves & parents",
    tutors: "Profs",
    findTutor: "Trouver un prof",
    myClasses: "Mes cours",
    mySpace: "Mon espace",
    guardianArea: "Espace parent",
    signIn: "Se connecter",
    forTutors: "Pour les profs",
    forCentres: "Pour les centres",
    whatsapp: "WhatsApp",
    pricing: "Tarifs",
    createPage: "Créer ma page de prof",
    dashboard: "Tableau de bord",
    social: "Tnajem sur les réseaux sociaux",
    instagram: "Tnajem sur Instagram",
    facebook: "Tnajem sur Facebook",
    linkedin: "Tnajem sur LinkedIn",
  },
  ar: {
    students: "تلامذة وأولياء",
    tutors: "أساتذة",
    findTutor: "لقّي أستاذ",
    myClasses: "حصصي",
    mySpace: "فضائي",
    guardianArea: "فضاء الولي",
    signIn: "دخول",
    forTutors: "للأساتذة",
    forCentres: "للمراكز",
    whatsapp: "WhatsApp",
    pricing: "الأسعار",
    createPage: "اعمل صفحتك متاع أستاذ",
    dashboard: "لوحتي",
    social: "تنجّم على الشبكات الاجتماعية",
    instagram: "تنجّم على إنستغرام",
    facebook: "تنجّم على فايسبوك",
    linkedin: "تنجّم على لينكد إن",
  },
} as const;

/* The networks' marks, drawn in the site's own line style (.ic: currentColor,
   1.85 stroke). Brand marks are not directional: never mirrored in Arabic. */
function SocialIcon({ network }: { network: SocialNetwork }) {
  return (
    <svg viewBox="0 0 24 24" className="ic" aria-hidden="true" focusable="false">
      {network === "instagram" ? (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="3.8" />
          <circle cx="17.2" cy="6.8" r="0.6" />
        </>
      ) : network === "facebook" ? (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M14.8 8.3h-1.3a2 2 0 0 0-2 2v10.2M9.6 13.2h4.8" />
        </>
      ) : (
        <>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
          <path d="M8.2 10.6v5.6M8.2 7.8v.1M11.8 16.2v-5.6M11.8 13.3a2.4 2.4 0 0 1 4.8 0v2.9" />
        </>
      )}
    </svg>
  );
}


export function SiteFooter() {
  const { t, locale } = useLocale();
  const f = F[locale];
  const role = useRoleHint();
  const whatsapp = supportWhatsAppHref(WHATSAPP_RAW, SUPPORT_WHATSAPP_MESSAGE[locale]);

  return (
    <footer className="site-footer">

      <div className="container qf-grid">
        <div className="qf-brand">
          <Logo variant="full" height={32} className="text-[17px]" />
          <p>{t.footer.tagline}</p>
        </div>

        <nav className="qf-col" aria-label={f.students}>
          <h2>{f.students}</h2>
          <ul>
            <li><Link href="/explore">{f.findTutor}</Link></li>
            {role === "student" ? (
              <li><Link href="/student" data-e2e="footer-space">{f.mySpace}</Link></li>
            ) : role === "guardian" ? (
              <li><Link href="/guardian" data-e2e="footer-space">{f.guardianArea}</Link></li>
            ) : role === null ? (
              <li><Link href="/student">{f.myClasses}</Link></li>
            ) : null}
            {role === null && <li><Link href="/auth" data-e2e="footer-signin">{f.signIn}</Link></li>}
          </ul>
        </nav>

        <nav className="qf-col" aria-label={f.tutors}>
          <h2>{f.tutors}</h2>
          <ul>
            <li><Link href="/pour-les-profs">{f.forTutors}</Link></li>
            <li><Link href="/pour-les-centres" data-e2e="footer-centres">{f.forCentres}</Link></li>
            <li><Link href="/tarifs">{f.pricing}</Link></li>
            {role !== "tutor" && <li><Link href="/signup/prof">{f.createPage}</Link></li>}
            {(role === null || role === "tutor") && <li><Link href="/dashboard" data-e2e="footer-dashboard">{f.dashboard}</Link></li>}
          </ul>
        </nav>

        <nav className="qf-col" aria-label={t.footer.legal}>
          <h2>{t.footer.legal}</h2>
          <ul>
            <li><Link href="/terms">{t.footer.terms}</Link></li>
            <li><Link href="/privacy">{t.footer.privacy}</Link></li>
            <li><a href={`mailto:${CONTACT_EMAIL}`}>{t.footer.contact}</a></li>
          </ul>
        </nav>
      </div>

      <div className="qf-bottom">
        <div className="container qf-bottom-in">
          <span data-e2e="footer-rights">{t.footer.rights(COPYRIGHT_YEAR)}</span>
          <div className="qf-bottom-end">
            {SOCIAL_LINKS.length > 0 && (
              <ul className="qf-social" aria-label={f.social} data-e2e="footer-social">
                {SOCIAL_LINKS.map(({ network, href }) => (
                  <li key={network}>
                    <a href={href} rel="noopener noreferrer me" aria-label={f[network]} data-network={network}>
                      <SocialIcon network={network} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {whatsapp && (
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="qf-mail" data-e2e="footer-whatsapp">{f.whatsapp}</a>
            )}
            <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr" className="qf-mail" data-e2e="footer-email">{CONTACT_EMAIL}</a>
            <span className="qf-hours" data-e2e="footer-hours">{SUPPORT_HOURS[locale]}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
