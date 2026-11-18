import Image from "next/image";
import type { AppLocale } from "@/lib/locale";
import { bilingual } from "@/lib/i18n";
import { FREE_MONTHS, PRICING } from "@/lib/pricing-copy";
import { PROF_DEMO_URL } from "@/lib/prof-demo";
import { Link } from "@/components/Link";
import { IconBoard as Board, IconPlay as Play } from "./landing-icons";
import { Doodle } from "@/components/home/Doodle";
import { IconArrow } from "./landing-icons";
import { MockDashboardCard } from "./MockDashboardCard";
import "./profs-hero.css";

/* profs-v2 · B — THE HERO of /pour-les-profs. Server component.

   Left: the pill + the badge, the H1 on four lines (« 3 mois » in ochre), the lead,
   the primary action, the secondary (honesty rule 3), and the pricing line under them.
   december sprint · C (D23): « Tu gardes 100 % pendant le pilote » is gone with the
   free-pilot framing. The badge is the approved « 3 mois sans abonnement », the H1's
   last line says the same in display type, and the small print names both costs, with
   the commission's « dès que le paiement passe par Tnajem » (the FAQ carries the full
   long version).
   Right: the photo in its organic shape, MockDashboardCard over its edge, doodles.

   LCP is the H1 TEXT: no entrance animation, and everything above it is static (the
   tag here is the fixed badge chip, not the async <PilotTag>).

   The photo shows a FICTIONAL teacher (honesty rule 5): decorative, alt="", no caption,
   nothing that suggests she teaches on Tnajem. */

const copy = bilingual({
  fr: {
    pill: "Pour les profs",
    pilotChip: PRICING.fr.badge,
    h1a: "Ta page de prof.",
    h1b: "Tes cours en direct.",
    h1c: "",
    h1Hi: `${FREE_MONTHS} mois`,
    h1d: "sans abonnement.",
    lead: "Crée ta page, publie tes cours, fixe ton tarif et gère tes réservations, simplement.",
    cta: "Créer ma page de prof",
    demo: "Voir la démo (2 min)",
    seeTutors: "Voir les profs sur Tnajem",
    micro: PRICING.fr.costs,
    tarifsCta: "Voir les tarifs",
  },
  ar: {
    pill: "للأساتذة",
    pilotChip: PRICING.ar.badge,
    h1a: "صفحتك متاع أستاذ.",
    h1b: "دروسك مباشرة.",
    h1c: "و", // « و3 شهور »: the line reads as part of the sentence
    h1Hi: `${FREE_MONTHS} شهور`,
    h1d: "بلا اشتراك.",
    lead: "اعمل صفحتك، انشر دروسك، حدّد تعريفتك وتصرّف في حجوزاتك، بالساهل.",
    cta: "اعمل صفحتك متاع أستاذ",
    demo: "شوف الديمو (دقيقتين)",
    seeTutors: "شوف الأساتذة في Tnajem",
    micro: PRICING.ar.costs,
    tarifsCta: "شوف الأسعار",
  },
});

export function ProfsHero({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="ph-hero" data-e2e="profs-hero">
      <div className="container">
        <div className="ph-grid">
          <div className="ph-copy">
            <div className="ph-tags">
              <span className="ph-pill">
                <Board className="ph-pill-ic" />
                {c.pill}
              </span>
              {/* Information, so neutral: green is Vérifié/success only (Phase A+ · U3). */}
              <span className="tag tag-neutral">{c.pilotChip}</span>
            </div>

            {/* web-h1 first: the system's H1 class (tools/ui-audit/routes.mjs looks for it);
                .ph-h1 (unlayered) sets the hero scale on top of it. <br>, not one block per
                line: the browser's LCP counts a block's text as one candidate, and four
                blocks would each lose to the small print under them. */}
            <h1 className="web-h1 ph-h1">
              {c.h1a}
              <br />
              {c.h1b}
              <br />
              {c.h1c}
              <span className="ph-h1-hi">{c.h1Hi}</span>
              <br />
              {c.h1d}
            </h1>

            <p className="web-lead ph-lead">{c.lead}</p>

            <div className="ph-actions">
              <Link href="/signup/prof" className="btn btn-primary ph-cta" data-e2e="profs-cta">
                {c.cta} <IconArrow className="ph-cta-ic" />
              </Link>
              {/* Honesty rule 3: a demo button only once a demo exists. A plain new-tab link,
                  so it needs no client code and works with JavaScript off. */}
              {PROF_DEMO_URL ? (
                <a
                  href={PROF_DEMO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost ph-ghost"
                  data-e2e="profs-demo"
                >
                  <span className="ph-play" aria-hidden="true">
                    <Play />
                  </span>
                  {c.demo}
                </a>
              ) : (
                <Link href="/explore" className="btn btn-ghost ph-ghost" data-e2e="profs-see-tutors">
                  {c.seeTutors}
                </Link>
              )}
            </div>

            <p className="ph-later" data-e2e="profs-later">
              {c.micro}{" "}
              <Link href="/tarifs" className="linklike ph-later-link">
                {c.tarifsCta}
              </Link>
            </p>
          </div>

          <div className="ph-stage">
            <Doodle kind="blob" tone="ochre" className="ph-blob" />
            <div className="ph-photo">
              {/* images.unoptimized is a deliberate security setting (next.config): one file,
                  served as is. Decorative: the copy carries the meaning. */}
              <Image
                src="/images/profs/hero-teacher.webp"
                alt=""
                width={800}
                height={992}
                loading="lazy"
                sizes="(min-width: 1024px) 260px, 68vw"
                className="ph-img"
              />
            </div>
            <div className="ph-card-wrap">
              <Doodle kind="rays" className="ph-rays" />
              <MockDashboardCard locale={locale} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
