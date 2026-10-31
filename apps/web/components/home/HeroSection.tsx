import type { HomeTutor } from "@tnajem/shared";
import type { AppLocale } from "@/lib/locale";
import { bilingual } from "@/lib/i18n";
import { Link } from "@/components/Link";
import { PilotTag } from "@/components/PilotTag";
import { Calendar, Forward, Shield, Video, Wallet } from "@/components/icons";
import { TrustRow } from "@/components/home/TrustRow";
import { HeroTutorsCard } from "@/components/home/HeroTutorsCard";
import "./hero.css";

/* home v2 · B — THE HERO. Server component.

   Left: eyebrow + the pilot tag, the H1 (« vérifié » in ochre), the lead, ONE
   primary action (« Trouve ton prof ») and the anchor to #etapes, then the four
   trust items. Right: the real-tutors card (HeroTutorsCard).

   LCP is the H1 TEXT: no image above it, no entrance animation on it, no web font
   added for it, and the card next to it is server-rendered with its data, so nothing
   arrives late and pushes it. On a phone the card comes after the text. */

const copy = bilingual({
  fr: {
    eyebrow: "Cours particuliers en ligne · Tunisie",
    h1a: "Un prof ",
    h1Hi: "vérifié",
    h1b: ", en ligne, du primaire au Bac.",
    sub: "Choisis ta matière, réserve une séance en vidéo. Le tarif est affiché avant que tu réserves.",
    ctaPrimary: "Trouve ton prof",
    ctaSecondary: "Comment ça marche ?",
    trust: [
      "Réservation en quelques clics",
      "Des profs vérifiés à la main",
      "Cours en vidéo depuis chez toi",
      "Le tarif est affiché avant de réserver",
    ],
  },
  ar: {
    eyebrow: "دروس خصوصية أونلاين · تونس",
    h1a: "أستاذ ",
    h1Hi: "متثبّت منّو",
    h1b: "، أونلاين، من الابتدائي للباك.",
    sub: "اختار المادة، واحجز حصة بالفيديو. الثمن يبان قبل ما تحجز.",
    ctaPrimary: "لقّي أستاذك",
    ctaSecondary: "كيفاش يخدم؟",
    trust: [
      "تحجز في كليكات قلال",
      "أساتذة متثبّت منهم بيدينا",
      "تقرا بالفيديو من دارك",
      "الثمن يبان قبل ما تحجز",
    ],
  },
});

/* The mockup's tints: blue · green (the verified colour) · blue · ochre (money). */
const TRUST_ICONS = [
  { Icon: Calendar, tint: "" },
  { Icon: Shield, tint: "text-green-ink" },
  { Icon: Video, tint: "" },
  { Icon: Wallet, tint: "text-ochre-ink" },
];

export function HeroSection({ locale, tutors }: { locale: AppLocale; tutors: HomeTutor[] }) {
  const c = copy[locale];
  return (
    <section className="hv-hero" data-e2e="home-hero">
      <div className="container">
        <div className="hv-grid">
          <div className="hv-copy">
            {/* Phase A+ (P4) + home v2 · E: the pilot tag arrives after hydration (it asks
                /api/pilot). `reserve` holds its box from the first paint and .lp-eyebrow-row
                (home.css) decides the wrap by viewport, never by a font — so its arrival
                shifts nothing. Keep both when restyling. */}
            <div className="lp-eyebrow-row">
              <p className="web-eyebrow">{c.eyebrow}</p>
              <PilotTag reserve />
            </div>

            {/* web-h1 first: the system's H1 class (its Arabic safety net, and
                home-v2-perf.spec's « the H1 is in the server HTML »); .hv-h1 (unlayered)
                sets the hero scale on top of it. */}
            <h1 className="web-h1 hv-h1">
              {c.h1a}
              <span className="hv-h1-hi">{c.h1Hi}</span>
              {c.h1b}
            </h1>

            <p className="web-lead hv-lead">{c.sub}</p>

            <div className="hv-actions">
              <Link href="/explore" className="btn btn-primary hv-cta">
                {c.ctaPrimary} <Forward className="hv-cta-ic" />
              </Link>
              {/* Deliberately not a second button: the hero has one action. */}
              <a href="#etapes" className="hv-how">
                {c.ctaSecondary}
              </a>
            </div>

            <TrustRow
              className="hv-trust"
              items={c.trust.map((label, i) => {
                const { Icon, tint } = TRUST_ICONS[i];
                return { icon: <Icon className={tint} />, label };
              })}
            />
          </div>

          <HeroTutorsCard locale={locale} tutors={tutors} />
        </div>
      </div>
    </section>
  );
}
