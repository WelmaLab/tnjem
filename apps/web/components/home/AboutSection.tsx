import { CONTACT_EMAIL } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { COMPANY_IDENTITY, companyIdentityParts } from "@/lib/company-identity";
import { PilotAgeLine } from "./PilotAgeLine";
import "./sections.css";
import "./about.css";

/* december-sprint · D (D15, D16) — « Qui sommes-nous ? », the last block before
   the footer. Server component.

   ONLY what the site already says and the product already does (truth rule):
     • the platform, in the privacy page's own words (« plateforme tunisienne de
       mise en relation entre élèves et profs particuliers ») and the « vérifiés à
       la main » the hero and the facts already state;
     • who the pilot is open to (D16) — <PilotAgeLine>, shown only while the
       running server is adults-only;
     • the contact address, CONTACT_EMAIL (packages/shared/src/support-contact.ts);
     • the company's identity from legal.ts, filled values only — all six are
       empty today, so that list does not render (lib/company-identity.ts).
   No team size, no date, no figure, no investor, no address that legal.ts does not
   hold. Nothing about how a student pays (e2e/payment-story.spec.ts crawls this
   page). No <Reveal>: home-v2-perf.spec.ts counts exactly three reveal sections. */

const copy = bilingual({
  fr: {
    title: "Qui sommes-nous ?",
    intro:
      "Tnajem est une plateforme tunisienne qui met en relation des élèves et des profs particuliers, vérifiés à la main, pour des cours en ligne en vidéo.",
    contact: "Une question ? Écris-nous :",
    identity: "La société",
  },
  ar: {
    title: "شكون إحنا؟",
    intro: "Tnajem منصّة تونسية تربط التلامذة بأساتذة خصوصيين، متثبّت منهم بيدينا، باش تقرا أونلاين بالفيديو.",
    contact: "عندك سؤال؟ ابعثلنا إيميل:",
    identity: "الشركة",
  },
});

export function AboutSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  const identity = companyIdentityParts(COMPANY_IDENTITY, locale);
  return (
    <section className="hs-sec hs-sec-tight hs-sec-last" aria-labelledby="ha-title" data-e2e="home-about">
      <div className="container">
        <div className="ha-card">
          <div className="ha-main">
            <h2 id="ha-title" className="ha-title">{c.title}</h2>
            <p className="ha-body">{c.intro}</p>
            <PilotAgeLine locale={locale} className="ha-age" />
          </div>
          <div className="ha-side">
            <p className="ha-contact">
              {c.contact}{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} dir="ltr" className="ha-mail" data-e2e="home-about-email">
                {CONTACT_EMAIL}
              </a>
            </p>
            {identity.length > 0 && (
              <ul className="ha-id" aria-label={c.identity} data-e2e="home-identity">
                {identity.map((p) => (
                  <li key={p.key}>
                    {p.label && <span className="ha-id-k">{p.label} </span>}
                    {p.value}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
