import { Link } from "@/components/Link";
import { Check, Forward, Video } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { Doodle } from "./Doodle";
import "./sections.css";

/* home v2 · C — the closing CTA banner.

   NO PHOTO, by founder decision (31 Oct 2026). The mockup's student photo needs an
   asset we own (HOME_V2 honesty rule 4) and none is approved yet, so the card is
   text-only by design: the message and the action on the inline-start side, the
   ochre doodles and a faint blob carrying the inline-end side. e2e/home-v2-sections
   asserts there is no <img> in it, so nobody slips a stock photo in.

   The mockup's « Cours en ligne depuis chez toi » bubble lived on the photo; without
   it, it becomes a small pill beside the CTA.

   Keep-list: « Sans engagement » and « annulation libre jusqu'à 48h avant » are two
   of the three check items. */

const copy = bilingual({
  fr: {
    title: "Choisis ton prof. Le tarif est affiché avant de réserver.",
    sub: "Des profs vérifiés, du primaire au Bac. Cours en ligne, en toute simplicité.",
    cta: "Trouve ton prof",
    online: "Cours en ligne depuis chez toi",
    checks: ["Sans engagement", "Annulation libre jusqu'à 48h avant", "Des profs vérifiés"],
  },
  ar: {
    title: "اختار أستاذك. الثمن يبان قبل ما تحجز.",
    sub: "أساتذة متثبّت منهم، من الابتدائي للباك. دروس أونلاين، ساهلة وبسيطة.",
    cta: "لقّي أستاذك",
    online: "دروس أونلاين من دارك",
    checks: ["بلا التزام", "تنجّم تلغي حتى 48 ساعة قبل", "أساتذة متثبّت منهم"],
  },
});

export function CtaBanner({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="hs-sec hs-sec-tight" aria-labelledby="hs-cta-title" data-e2e="home-cta">
      <div className="container">
        <div className="hs-cta">
          <Doodle kind="blob" tone="blue" className="hs-cta-blob" />
          <Doodle kind="rays" tone="ochre" className="hs-doodle hs-doodle-cta" />
          <Doodle kind="squiggle" tone="ochre" className="hs-doodle hs-doodle-cta-wave" />

          <div className="hs-cta-text">
            <h2 id="hs-cta-title" className="web-h2 hs-cta-title">{c.title}</h2>
            <p className="hs-cta-sub">{c.sub}</p>
            <div className="hs-cta-actions">
              <Link href="/explore" className="btn btn-primary hs-cta-btn">
                {c.cta} <Forward className="h-[18px] w-[18px]" />
              </Link>
              <p className="hs-cta-pill">
                <Video />
                {c.online}
              </p>
            </div>
            <ul className="hs-cta-checks">
              {c.checks.map((label) => (
                <li key={label}>
                  <span className="hs-cta-tick" aria-hidden="true">
                    <Check />
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {/* PHOTO SLOT (inline-end side). When an owned, approved image exists: a
              <div className="hs-cta-media"> here holding a next/image (lazy, explicit
              width/height, `sizes`; the optimizer is off, so ship a pre-sized WebP from
              public/images/home/), and in sections.css give .hs-cta a second grid column
              from 900px. On a phone it stacks below the text, uncropped. Then drop the
              no-<img> assertion in e2e/home-v2-sections.spec.ts. */}
        </div>
      </div>
    </section>
  );
}
