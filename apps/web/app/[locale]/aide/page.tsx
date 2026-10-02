import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { SiteShell } from "@/components/SiteShell";
import { PaymentStory } from "@/components/PaymentStory";
import { Shield, Wallet, Share, Bolt, Calendar, Forward, Chat } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { pageMetadata } from "@/lib/metadata";
import {
  CANCEL_FREE_WINDOW_HOURS, ID_DOCUMENT_RETENTION_DAYS, LATE_CANCEL_RETAINED_PCT, supportWhatsAppHref,
  OFFER_MAX_PER_TUTOR, OFFER_SESSIONS_MAX, OFFER_SESSIONS_MIN,
  PRICE_FLOOR_TND, PRICE_STEP_TND, PROMO_PERCENT_MAX, PROMO_PERCENT_MIN,
} from "@tnajem/shared";
// Server component: the zod module stays on the server.
import { PROMO_MAX_DAYS } from "@tnajem/shared/growth-input";

/* ───────────────────────────────────────────────────────────────────────────
   /aide — the short help page for tutors (espace prof v2 · phase 7, contract C9).
   Public, FR/AR, linked from the prof shell ("Aide") and listed in the sitemap.

   EVERY ANSWER DESCRIBES WHAT THE PRODUCT DOES — check the code before editing:
     • verification   apps/web/components/onboarding/VerifyInner.tsx (ID required,
                      the rest optional, the décret 2015-1619 declaration), the
                      booking gate in apps/api/src/routes/bookings.ts (no booking
                      before "verified"), the retention window in @tnajem/shared/legal.
     • getting paid   payments are OFF (paymentsEnabled()): Tnajem takes nothing and
                      the student pays the tutor outside Tnajem; the online payment
                      is the one payment story, shown with « Bientôt » (PaymentStory).
                      The late-cancel figure is the ledger rule (@tnajem/shared/cancellation).
     • sharing        the share sheet, deep links, the owner preview / "arrive
                      bientôt" page and the privacy-safe vitrine counters (phases 1, 3, 4).
     • promotions     1–20 %, one at a time (the best), rounded to 0.5 TND, floor
                      1 TND (packages/shared/src/pricing.ts, the DB CHECK, zod — phase 5).
     • subscriptions  up to 3 monthly offers, 1–31 sessions, confirmed by hand after a
                      payment received outside Tnajem, one month, renewed in one click (phase 5).

   A server component on purpose: the whole page is in the first HTML, prerendered
   like /privacy and /terms, and readable with no JavaScript.
   ─────────────────────────────────────────────────────────────────────────── */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tnajem.com";
const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).host;
  } catch {
    return "tnajem.com";
  }
})();
const WA_LINK = supportWhatsAppHref(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP);
const PCT = Math.round(LATE_CANCEL_RETAINED_PCT * 100);
const H = CANCEL_FREE_WINDOW_HOURS;
/** "0,5" — the Tunisian decimal comma, in both languages (prices elsewhere read "0,5 د.ت" too). */
const frNum = (n: number) => String(n).replace(".", ",");

/** One answer line. `code` is shown left-to-right (a link) inside either language. */
type Line = string | { text: string; code: string };
type Topic = { id: string; toc: string; q: string; a: Line[]; story?: boolean; after?: string; cta?: { label: string; href: string } };

const meta = bilingual({
  fr: {
    title: "Aide pour les profs",
    description:
      "Vérification, paiement pendant le pilote, partage de ta page, promotions et abonnements mensuels : les réponses courtes, pour les profs sur Tnajem.",
  },
  ar: {
    title: "مساعدة للأساتذة",
    description:
      "التثبّت من الحساب، الخلاص في فترة التجربة، مشاركة صفحتك، التخفيضات والاشتراكات الشهرية : الأجوبة القصيرة للأساتذة على Tnajem.",
  },
});

const copy = bilingual({
  fr: {
    eyebrow: "Aide",
    title: "Aide pour les profs",
    lead: "Les réponses courtes aux questions qu'on nous pose le plus. Elles décrivent ce que Tnajem fait aujourd'hui, pendant le pilote.",
    tocLabel: "Sur cette page",
    topics: [
      {
        id: "verification",
        toc: "Vérification",
        q: "Comment marche la vérification ?",
        a: [
          "Ta page et tes classes passent en ligne dès que ton compte est vérifié. Avant ça, personne ne peut réserver chez toi.",
          "Tu envoies une pièce d'identité (CIN ou passeport) : c'est la seule pièce obligatoire. Diplômes, expérience et liens sont facultatifs.",
          "Tu déclares aussi que tu n'enseignes pas dans un établissement public (décret n° 2015-1619).",
          "Une personne de l'équipe examine chaque dossier, à la main. Validé : ta page est publique et apparaît dans Explorer. Refusé : tu vois la raison, tu corriges et tu renvoies.",
          `Ta pièce d'identité n'est jamais publiée, et elle est supprimée au plus tard ${ID_DOCUMENT_RETENTION_DAYS} jours après la décision.`,
        ],
        cta: { label: "Envoyer mes documents", href: "/onboarding/verify" },
      },
      {
        id: "paiement",
        toc: "Être payé",
        q: "Comment je suis payé pendant le pilote ?",
        a: [
          "Tu fixes ton prix, classe par classe. Pendant le pilote, Tnajem ne touche pas à l'argent et ne prend aucune commission.",
          "Paiement en ligne bientôt : pour l'instant, ton élève te paie hors Tnajem — c'est entre vous.",
          `Une annulation à moins de ${H} h est notée dans le registre des annulations (${PCT} % du prix de la place), mais rien n'est prélevé pendant le pilote.`,
        ],
        story: true,
        after: "Les tarifs d'après le pilote sont sur la page Tarifs. On te préviendra avant tout changement.",
        cta: { label: "Voir les tarifs", href: "/tarifs" },
      },
      {
        id: "partage",
        toc: "Partager",
        q: "Comment partager ma page ?",
        a: [
          { text: "Ton lien :", code: `${SITE_HOST}/ton-identifiant` },
          "Chaque classe, ton offre mensuelle et chaque promotion ont aussi leur propre lien.",
          "Le bouton « Partager » (sur l'accueil, dans Ma vitrine, Mes classes, Promotions, Abonnements, et juste après avoir publié une classe) ouvre WhatsApp, Facebook, Messenger, X, Telegram, LinkedIn, « Copier le lien » et un QR code à télécharger. Sur mobile, il ouvre aussi le partage de ton téléphone (Instagram, TikTok…).",
          "Le message est déjà écrit, en français et en arabe : tu peux le modifier avant d'envoyer.",
          "Tant que tu n'es pas vérifié, ton lien t'affiche un aperçu privé ; les autres voient une page « Ce prof arrive bientôt ».",
          "On peut te « Suivre » depuis ta page, une classe ou la page « arrive bientôt ». Quand tu publies une classe ou une fiche, tes abonnés sont prévenus dans l'app, et par un seul email récapitulatif, au plus une fois par jour (désinscription en un clic). Tu vois chaque nouvel abonné, par son prénom seulement.",
          "Ma vitrine compte les vues et les clics de tes liens sur 30 jours, sans traceur et sans garder d'adresse IP.",
        ],
        cta: { label: "Ma vitrine", href: "/dashboard/storefront" },
      },
      {
        id: "promotions",
        toc: "Promotions",
        q: "Comment marchent les promotions ?",
        a: [
          `Dans Promotions, tu choisis une réduction de ${PROMO_PERCENT_MIN} à ${PROMO_PERCENT_MAX} %, jamais plus.`,
          `Elle vaut pour tout, pour une classe, une fiche ou ton offre mensuelle, avec une date de fin au plus ${PROMO_MAX_DAYS} jours après le début. Tu peux limiter le nombre d'utilisations.`,
          "Sans code, elle est publique : tout le monde voit le prix barré sur ta page. Avec un code, elle ne vaut que pour qui arrive par son lien (…?promo=CODE).",
          `Les promotions ne se cumulent pas : seule la meilleure pour l'élève s'applique. Le prix est arrondi à ${frNum(PRICE_STEP_TND)} TND et ne descend jamais sous ${frNum(PRICE_FLOOR_TND)} TND.`,
          "Tu peux la partager, la mettre en pause ou l'arrêter quand tu veux. Un code expiré ou invalide ne bloque rien : l'élève peut toujours réserver au prix normal.",
        ],
        cta: { label: "Mes promotions", href: "/dashboard/promotions" },
      },
      {
        id: "abonnements",
        toc: "Abonnements",
        q: "Comment marchent les abonnements mensuels ?",
        a: [
          `Dans Abonnements, tu crées jusqu'à ${OFFER_MAX_PER_TUTOR} offres mensuelles : un prix par mois, et de ${OFFER_SESSIONS_MIN} à ${OFFER_SESSIONS_MAX} séances par mois.`,
          "L'élève demande l'abonnement depuis ta page (« S'abonner »). Paiement en ligne bientôt : pour l'instant il te paie hors Tnajem, et tu confirmes à la main une fois le paiement reçu.",
          "L'abonnement est alors actif pour un mois, et tu le renouvelles en un clic. Pendant ce mois, ses réservations dans tes classes sont comprises dans l'abonnement, jusqu'à son nombre de séances du mois ; au-delà, c'est une réservation normale. S'il annule une séance, elle revient dans son mois.",
          "Vous êtes prévenus tous les deux 3 jours avant la fin. Sans renouvellement, l'abonnement expire.",
        ],
        cta: { label: "Mes abonnements", href: "/dashboard/subscriptions" },
      },
    ] as Topic[],
    moreTitle: "Une autre question ?",
    moreWa: "Écris-nous sur WhatsApp, on te répond.",
    moreWaCta: "Écrire au support",
    moreNoWa: "Tout ce que Tnajem propose aux profs, sur une page.",
    moreNoWaCta: "Tnajem pour les profs",
  },
  ar: {
    eyebrow: "مساعدة",
    title: "مساعدة للأساتذة",
    lead: "أجوبة قصيرة على الأسئلة اللي يسقسيونا عليها برشا. تحكي على اللي يعملو Tnajem اليوم، في فترة التجربة.",
    tocLabel: "في الصفحة هاذي",
    topics: [
      {
        id: "verification",
        toc: "التثبّت",
        q: "كيفاش يصير التثبّت من حسابك ؟",
        a: [
          "صفحتك وحصصك يولّيو ظاهرين كي يتثبّت حسابك. قبل هذاكا، حتى حد ما ينجم يحجز عندك.",
          "تبعث بطاقة تعريف (CIN ولا جواز سفر) : هي الوثيقة الوحيدة الضرورية. الشهائد، الخبرة والروابط اختيارية.",
          "تصرّح زادة اللي إنت ما تقرّيش في مؤسسة تعليم عمومية (الأمر عدد 2015-1619).",
          "واحد من الفريق يثبّت في كل ملف بيدو. يتقبل : صفحتك تولّي عمومية وتظهر في Explorer. يترفض : تشوف السبب، تصلّح وتعاود تبعث.",
          `بطاقة التعريف عمرها ما تتنشر، وتتفسخ في أقصى حد ${ID_DOCUMENT_RETENTION_DAYS} يوم بعد القرار.`,
        ],
        cta: { label: "ابعث وثائقي", href: "/onboarding/verify" },
      },
      {
        id: "paiement",
        toc: "الخلاص",
        q: "كيفاش نتخلّص في فترة التجربة ؟",
        a: [
          "إنت اللي تحدّد ثمنك، حصة بحصة. في فترة التجربة، Tnajem ما يمسّش الفلوس وما ياخذ حتى عمولة.",
          "الخلاص أونلاين قريب : للوقت هذا، التلميذ يخلّصك برّا Tnajem — هاذي بيناتكم.",
          `الإلغاء قبل أقل من ${H} ساعة يتسجّل في سجلّ الإلغاءات (\u2066${PCT} %\u2069 من ثمن البلاصة)، أما ما يتخصم حتى مليم في فترة التجربة.`,
        ],
        story: true,
        after: "أسعار ما بعد التجربة موجودة في صفحة الأسعار. نعلموك قبل أي تبديل.",
        cta: { label: "شوف الأسعار", href: "/tarifs" },
      },
      {
        id: "partage",
        toc: "المشاركة",
        q: "كيفاش نشارك صفحتي ؟",
        a: [
          { text: "الرابط متاعك :", code: `${SITE_HOST}/identifiant` },
          "كل حصة، العرض الشهري متاعك وكل تخفيض عندهم زادة الرابط متاعهم.",
          "زر المشاركة (في الرئيسية، في واجهتي، في حصصي، في التخفيضات، في الاشتراكات، وكي تنشر حصة) يحلّ WhatsApp، Facebook، Messenger، X، Telegram، LinkedIn، نسخ الرابط و QR code تنجّم تنزّلو. على التليفون، يحلّ زادة المشاركة متاع تليفونك (Instagram، TikTok…).",
          "الميساج مكتوب من قبل، بالفرنسية وبالعربية : تنجّم تبدّلو قبل ما تبعث.",
          "مادام حسابك ما تثبّتش، الرابط يورّيلك إنت معاينة خاصة ؛ والآخرين يشوفو صفحة « الأستاذ هذا جاي قريب ».",
          "الناس ينجمو « يتابعوك » من صفحتك، من حصة ولا من صفحة « جاي قريب ». كي تنشر حصة ولا ملخّص، المتابعين متاعك يوصلهم خبر في التطبيق، وإيميل واحد فيه الملخّص، على الأكثر مرّة في النهار (والإلغاء بكليك واحد). تشوف كل متابع جديد، باسمو الأوّل برك.",
          "واجهتي تحسب الزيارات والكليكات على روابطك في آخر 30 يوم، بلا traceur وبلا ما نخزنو عنوان IP.",
        ],
        cta: { label: "واجهتي", href: "/dashboard/storefront" },
      },
      {
        id: "promotions",
        toc: "التخفيضات",
        q: "كيفاش يخدمو التخفيضات ؟",
        a: [
          `في « التخفيضات »، تختار تخفيض من ${PROMO_PERCENT_MIN} إلى \u2066${PROMO_PERCENT_MAX} %\u2069، عمرو ما يفوت.`,
          `ينجم يكون على كل شي، على حصة، على ملخّص ولا على العرض الشهري متاعك، بتاريخ نهاية في أقصى حد ${PROMO_MAX_DAYS} يوم بعد البداية. تنجّم تحدّد عدد مرات الاستعمال.`,
          "بلا كود، يكون للناس الكل : الكل يشوفو الثمن المشطوب في صفحتك. بكود، ما يتطبّق كان على اللي يجي من الرابط متاعو (⁦…?promo=CODE⁩).",
          `التخفيضات ما يتجمعوش : الأحسن للتلميذ هو اللي يتطبّق برك. الثمن يتدوّر لـ ${frNum(PRICE_STEP_TND)} د.ت وعمرو ما ينزل تحت ${frNum(PRICE_FLOOR_TND)} د.ت.`,
          "تنجّم تشاركو، توقفو شويّة ولا تكمّلو وقت ما تحب. كود فات وقتو ولا غالط ما يعطّل حتى شي : التلميذ ينجم ديما يحجز بالثمن العادي.",
        ],
        cta: { label: "التخفيضات متاعي", href: "/dashboard/promotions" },
      },
      {
        id: "abonnements",
        toc: "الاشتراكات",
        q: "كيفاش يخدمو الاشتراكات الشهرية ؟",
        a: [
          `في « الاشتراكات »، تعمل حتى ${OFFER_MAX_PER_TUTOR} عروض شهرية : ثمن في الشهر، ومن ${OFFER_SESSIONS_MIN} إلى ${OFFER_SESSIONS_MAX} حصة في الشهر.`,
          "التلميذ يطلب الاشتراك من صفحتك (« اشترك »). الخلاص أونلاين قريب : للوقت هذا يخلّصك برّا Tnajem، وإنت تأكّد بيدك كيف يوصلك الخلاص.",
          "الاشتراك يولّي فعّال لمدة شهر، وتجدّدو بكليك واحد. في الشهر هذا، الحجوزات متاعو في حصصك داخلة في الاشتراك، في حدود عدد حصصو متاع الشهر ؛ وكي يفوتهم، يولّي حجز عادي. كان يلغي حصة، ترجع للشهر متاعو.",
          "يوصلكم خبر الزوز 3 أيام قبل النهاية. كان ما تجدّدش، الاشتراك يوفى.",
        ],
        cta: { label: "الاشتراكات متاعي", href: "/dashboard/subscriptions" },
      },
    ] as Topic[],
    moreTitle: "عندك سؤال آخر ؟",
    moreWa: "ابعثلنا على WhatsApp، نجاوبوك.",
    moreWaCta: "كلّم الدعم",
    moreNoWa: "كل شي يقدّمو Tnajem للأساتذة، في صفحة وحدة.",
    moreNoWaCta: "Tnajem للأساتذة",
  },
});

const ICONS: Record<string, ReactNode> = {
  verification: <Shield />,
  paiement: <Wallet />,
  partage: <Share />,
  promotions: <Bolt />,
  abonnements: <Calendar />,
};

/* Page-scoped, prefixed `aide-`, logical properties only. One --band section (the
   closing "another question?" strip), per the Clair palette rule. */
const CSS = `
.aide-head{margin-bottom:clamp(18px,3vw,26px)}
.aide-head .web-h2{margin:8px 0 10px}
.aide-toc{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.aide-toc a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;
  background:var(--paper);border:1px solid var(--line);color:var(--ink2);font-size:14px;font-weight:600}
.aide-toc a:hover{border-color:var(--blue);color:var(--blue)}
.aide-list{display:flex;flex-direction:column;gap:clamp(12px,2vw,16px)}
.aide-card{scroll-margin-top:96px}
.aide-q{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.aide-ic{flex:none;width:38px;height:38px;border-radius:11px;display:grid;place-items:center;
  background:var(--blue50);color:var(--blue)}
.aide-ic .ic,.aide-ic svg{width:19px;height:19px}
.aide-q h2{font-family:var(--fd);font-size:clamp(17px,2vw,20px);line-height:1.3;min-width:0;overflow-wrap:anywhere}
.aide-a{display:flex;flex-direction:column;gap:8px;padding-inline-start:20px;list-style:disc}
.aide-a li{font-size:15px;line-height:1.65;color:var(--ink2)}
.aide-code{font-weight:700;color:var(--ink);overflow-wrap:anywhere}
.aide-after{font-size:14px;line-height:1.6;color:var(--muted);margin-top:10px}
.aide-story{display:block;margin-top:12px;font-size:14.5px;line-height:1.6;color:var(--ink2)}
.aide-cta{display:inline-flex;align-items:center;gap:6px;min-height:44px;margin-top:8px;
  color:var(--blue);font-weight:700;font-size:14.5px}
.aide-cta .ic,.aide-cta svg{width:16px;height:16px}
html[dir="rtl"] .aide-cta svg{transform:scaleX(-1)}
.aide-band{background:var(--band);border-block:1px solid var(--line)}
.aide-more{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:14px}
.aide-more h2{font-family:var(--fd);font-size:clamp(18px,2.2vw,22px);margin-bottom:4px}
.aide-more p{font-size:15px;color:var(--ink2);line-height:1.6}
html[dir="rtl"] .aide-q h2,html[dir="rtl"] .aide-more h2{font-family:var(--fa)}
`;

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const params = await props.params;
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  return pageMetadata({ locale, path: "/aide", ...meta[locale] });
}

export default async function AidePage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const c = copy[locale];

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <section className="web-section">
        <div className="container container-narrow">
          <header className="aide-head">
            <div className="web-eyebrow">{c.eyebrow}</div>
            <h1 className="web-h2">{c.title}</h1>
            <p className="web-lead">{c.lead}</p>
            <nav aria-label={c.tocLabel} className="aide-toc">
              {c.topics.map((t) => (
                <a key={t.id} href={`#${t.id}`}>{t.toc}</a>
              ))}
            </nav>
          </header>

          <div className="aide-list">
            {c.topics.map((t) => (
              <article key={t.id} id={t.id} className="panel panel-pad aide-card" aria-labelledby={`${t.id}-q`}>
                <div className="aide-q">
                  <span className="aide-ic" aria-hidden="true">{ICONS[t.id]}</span>
                  <h2 id={`${t.id}-q`}>{t.q}</h2>
                </div>
                <ul className="aide-a">
                  {t.a.map((line, i) => (
                    <li key={i}>
                      {typeof line === "string" ? (
                        line
                      ) : (
                        <>
                          {line.text} <bdi dir="ltr" className="aide-code">{line.code}</bdi>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {t.story && <PaymentStory locale={locale} audience="tutor" className="aide-story" />}
                {t.after && <p className="aide-after">{t.after}</p>}
                {t.cta && (
                  <Link href={t.cta.href} className="aide-cta">
                    {t.cta.label} <Forward />
                  </Link>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="web-section tight aide-band">
        <div className="container container-narrow aide-more">
          <div className="min-w-0">
            <h2>{c.moreTitle}</h2>
            <p>{WA_LINK ? c.moreWa : c.moreNoWa}</p>
          </div>
          {WA_LINK ? (
            <a href={WA_LINK} className="btn btn-primary" style={{ width: "auto" }} target="_blank" rel="noopener noreferrer">
              <Chat /> {c.moreWaCta}
            </a>
          ) : (
            <Link href="/pour-les-profs" className="btn btn-primary" style={{ width: "auto" }}>
              {c.moreNoWaCta}
            </Link>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
