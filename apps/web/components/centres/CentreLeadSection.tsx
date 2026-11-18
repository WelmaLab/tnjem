import { CONTACT_EMAIL, SUPPORT_HOURS } from "@tnajem/shared";
import type { AppLocale } from "@/lib/locale";
import { pageCopy } from "./centres-copy";
import { centreWhatsAppHref } from "./centres-offer";
import { CentreLeadForm } from "./CentreLeadForm";
import "./centres.css";

/* december-sprint · B (D13, D14) — #demo: the lead form, and beside it the other ways
   in. The WhatsApp card exists only while NEXT_PUBLIC_SUPPORT_WHATSAPP is valid; the
   e-mail address (CONTACT_EMAIL) is always there, so the section never ends empty. */

export function CentreLeadSection({ locale }: { locale: AppLocale }) {
  const c = pageCopy[locale];
  const wa = centreWhatsAppHref(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP, locale);
  return (
    <section id="demo" className="ce-sec ce-form-sec" data-e2e="centres-lead">
      <div className="container">
        <div className="ce-lead-grid">
          <CentreLeadForm locale={locale} />
          <aside className="ce-aside" aria-label={wa ? c.contactTitle : c.emailLabel} data-e2e="centres-contact">
            {wa && (
              <>
                <p className="ce-aside-title">{c.contactTitle}</p>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" data-e2e="centres-contact-whatsapp">
                  {c.whatsapp}
                </a>
                <p className="ce-hours">{SUPPORT_HOURS[locale]}</p>
              </>
            )}
            <p className="ce-hours">{c.emailLabel}</p>
            <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr" className="ce-aside-mail" data-e2e="centres-contact-email">
              {CONTACT_EMAIL}
            </a>
          </aside>
        </div>
      </div>
    </section>
  );
}
