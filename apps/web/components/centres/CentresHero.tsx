import { SUPPORT_HOURS } from "@tnajem/shared";
import type { AppLocale } from "@/lib/locale";
import { IconArrow, IconBuilding } from "@/components/landing/landing-icons";
import { pageCopy } from "./centres-copy";
import { centreWhatsAppHref } from "./centres-offer";
import "@/components/landing/kit.css";
import "./centres.css";

/* december-sprint · B (D12) — the hero of /pour-les-centres. Server component.

   The H1 is the LCP: text, no entrance animation, nothing async above it. The main
   action is an in-page anchor to the lead form (#demo), so it works with JavaScript
   off. The WhatsApp button and the hours under it exist only while
   NEXT_PUBLIC_SUPPORT_WHATSAPP holds a valid number (gate amendment 2). */

export function CentresHero({ locale }: { locale: AppLocale }) {
  const c = pageCopy[locale];
  const wa = centreWhatsAppHref(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP, locale);
  return (
    <section className="ce-hero" data-e2e="centres-hero">
      <div className="container">
        <div className="ce-hero-in">
          <span className="ce-pill">
            <IconBuilding />
            {c.pill}
          </span>
          <h1 className="web-h1 ce-h1">{c.h1}</h1>
          <p className="web-lead ce-lead">{c.lead}</p>
          <div className="ce-actions">
            <a href="#demo" className="btn btn-primary" data-e2e="centres-demo">
              {c.demo} <IconArrow className="w-[18px] h-[18px]" />
            </a>
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" data-e2e="centres-whatsapp">
                {c.whatsapp}
              </a>
            )}
          </div>
          {wa && <p className="ce-hours" data-e2e="centres-hours">{SUPPORT_HOURS[locale]}</p>}
        </div>
      </div>
    </section>
  );
}
