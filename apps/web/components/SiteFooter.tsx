"use client";
import { Link } from "@/components/Link";
import { Logo } from "@/components/Logo";
import { useLocale } from "./LocaleProvider";

/* Site footer — brand, then the same two-audience split as the header
   (students/parents · tutors), then legal. A visitor who scrolled to the bottom
   without deciding still sees exactly two doors.
   Bilingual + RTL-safe: logical properties only, no left/right.
   Page-scoped CSS is prefixed `qf-` and injected with dangerouslySetInnerHTML
   (inline <style>{`…`}</style> in a client component triggers hydration errors). */

const CONTACT_EMAIL = "contact@tnajem.com";

/* Footer link labels are page-local (lib/i18n.ts is shared/read-only). */
const F = {
  fr: {
    students: "Élèves & parents",
    tutors: "Profs",
    findTutor: "Trouver un prof",
    myClasses: "Mes cours",
    signIn: "Se connecter",
    forTutors: "Pour les profs",
    pricing: "Tarifs",
    createPage: "Créer ma page de prof",
    dashboard: "Tableau de bord",
  },
  ar: {
    students: "تلامذة وأولياء",
    tutors: "أساتذة",
    findTutor: "لقّي أستاذ",
    myClasses: "حصصي",
    signIn: "دخول",
    forTutors: "للأساتذة",
    pricing: "الأسعار",
    createPage: "اعمل صفحتك متاع أستاذ",
    dashboard: "لوحتي",
  },
} as const;

const CSS = `
.site-footer .container.qf-grid{
  display:grid;grid-template-columns:1fr;gap:28px;align-items:start;justify-content:initial;
  padding-top:44px;padding-bottom:28px;
}
@media (min-width:560px){
  .site-footer .container.qf-grid{grid-template-columns:1fr 1fr;gap:28px 24px}
  .qf-brand{grid-column:1 / -1}
}
@media (min-width:900px){
  .site-footer .container.qf-grid{grid-template-columns:1.5fr 1fr 1fr 1fr;gap:36px}
  .qf-brand{grid-column:auto}
}
.qf-brand p{margin-top:12px;max-width:34ch;font-size:13.5px;line-height:1.6;color:var(--muted)}
.qf-col h2{font-family:var(--fd);font-size:13px;letter-spacing:.4px;text-transform:uppercase;
  color:var(--ink);margin-bottom:12px}
html[dir="rtl"] .qf-col h2{font-family:var(--fa);letter-spacing:normal}
.qf-col ul{list-style:none;display:flex;flex-direction:column;gap:2px}
.qf-col a{display:inline-flex;align-items:center;min-height:44px;font-size:13.5px;font-weight:600;
  color:var(--muted);transition:.15s}
.qf-col a:hover{color:var(--blue)}
.qf-bottom{border-top:1px solid var(--line)}
.site-footer .container.qf-bottom-in{
  display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;
  padding-top:16px;padding-bottom:26px;font-size:13px;color:var(--muted);
}
/* min-height:44px — as a bare run of text this mailto measured 106x16. */
.qf-bottom-in a{word-break:break-word;display:inline-flex;align-items:center;min-height:44px}
`;

export function SiteFooter() {
  const { t, locale } = useLocale();
  const f = F[locale];
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="container qf-grid">
        <div className="qf-brand">
          <Logo variant="full" height={32} className="text-[17px]" />
          <p>{t.footer.tagline}</p>
        </div>

        <nav className="qf-col" aria-label={f.students}>
          <h2>{f.students}</h2>
          <ul>
            <li><Link href="/explore">{f.findTutor}</Link></li>
            <li><Link href="/student">{f.myClasses}</Link></li>
            <li><Link href="/auth">{f.signIn}</Link></li>
          </ul>
        </nav>

        <nav className="qf-col" aria-label={f.tutors}>
          <h2>{f.tutors}</h2>
          <ul>
            <li><Link href="/pour-les-profs">{f.forTutors}</Link></li>
            <li><Link href="/tarifs">{f.pricing}</Link></li>
            <li><Link href="/signup/prof">{f.createPage}</Link></li>
            <li><Link href="/dashboard">{f.dashboard}</Link></li>
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
          <span>{t.footer.rights(year)}</span>
          <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr">{CONTACT_EMAIL}</a>
        </div>
      </div>
    </footer>
  );
}
