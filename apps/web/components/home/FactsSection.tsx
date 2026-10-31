import { Reveal } from "@/components/Reveal";
import { Shield, Wallet } from "@/components/icons";
import { PaymentStory } from "@/components/PaymentStory";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { Doodle } from "./Doodle";
import { InfoCard } from "./InfoCard";
import { HS_RV } from "./reveal";
import "./sections.css";

/* home v2 · C — « 3 choses à savoir avant de réserver. »

   Today's copy, kept where it was already right. The payment card carries THE
   payment sentence through <PaymentStory> (phase-a L3 · A22), which renders its own
   « Bientôt » tag and the data-payment-story hook e2e/payment-story.spec.ts crawls.
   It goes in the card's children rather than InfoCard's `soon` slot on purpose:
   that slot would draw a second « Bientôt » outside the [data-payment-story]
   element, and the spec requires the label INSIDE it. sections.css lays the
   story out as the mockup's pill row. Payments stay OFF: nothing here says they
   are live. */

const copy = bilingual({
  fr: {
    title: "3 choses à savoir avant de réserver.",
    price: {
      t: "Tu sais ce que tu paies, avant de réserver",
      p: "Le prof affiche son tarif sur sa page. Certains offrent la 1ʳᵉ séance — c'est leur choix, et c'est écrit chez eux.",
    },
    verified: {
      t: "Chaque prof est vérifié à la main",
      p: "On contrôle son identité, ses matières et ses niveaux, et on relit sa page avant de la publier.",
    },
    payment: {
      t: "Le paiement, en clair",
      p: "Il fixe son tarif et l'affiche avant que tu réserves. Sans engagement.",
    },
  },
  ar: {
    title: "3 حاجات لازم تعرفهم قبل ما تحجز.",
    price: {
      t: "تعرف شنوة باش تخلّص، قبل ما تحجز",
      p: "الأستاذ يبيّن ثمنو في صفحتو. فمّا اللي يعطي الحصة الأولى بلاش — هذا اختيارو هو، ومكتوب عندو.",
    },
    verified: {
      t: "كل أستاذ متثبّت منّو بيدينا",
      p: "نتثبّتو من هويتو، من المواد والمستويات اللي يقرّيهم، ونقراو صفحتو قبل ما ننشروها.",
    },
    payment: {
      t: "الخلاص، بالواضح",
      p: "هو اللي يحدّد ثمنو ويبيّنو قبل ما تحجز. بلا التزام.",
    },
  },
});

/** A receipt — « tu sais ce que tu paies » (the mockup's green document tile). */
function Receipt({ className }: { className?: string }) {
  return (
    <svg className={`ic ${className ?? ""}`} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h12v17l-2.4-1.5-2.4 1.5-2.4-1.5-2.4 1.5L6 20.5z" />
      <line x1="9" y1="8.5" x2="15" y2="8.5" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15.5" x2="12.5" y2="15.5" />
    </svg>
  );
}

export function FactsSection({ locale }: { locale: AppLocale }) {
  const c = copy[locale];
  return (
    <section className="hs-sec hs-facts" aria-labelledby="hs-facts-title" data-e2e="home-facts">
      <Reveal {...HS_RV} className="container">
        <h2 id="hs-facts-title" className="web-h2 hs-h2">{c.title}</h2>
        <div className="hs-facts-grid">
          <Doodle kind="rays" tone="ochre" className="hs-doodle hs-doodle-facts-start" />
          <Doodle kind="rays" tone="ochre" className="hs-doodle hs-doodle-facts-end" />
          <InfoCard icon={<Receipt />} tone="green" title={c.price.t}>
            <p>{c.price.p}</p>
          </InfoCard>
          <InfoCard icon={<Shield />} tone="blue" title={c.verified.t}>
            <p>{c.verified.p}</p>
          </InfoCard>
          <InfoCard icon={<Wallet />} tone="ochre" title={c.payment.t}>
            <p>{c.payment.p}</p>
            <p className="hs-paystory">
              <PaymentStory locale={locale} />
            </p>
          </InfoCard>
        </div>
      </Reveal>
    </section>
  );
}
