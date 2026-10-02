"use client";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { LEVEL_LABELS, isLevelCode } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · phase 6 — « Aperçu élève » (image 2): the class as a student will
   see it on the tutor's page, updated as the form is filled. Decorative and inert:
   nothing in it is a control (the « Réserver » is a picture of the button), so it
   is one labelled region a screen reader can skip. */

const copy = bilingual({
  fr: {
    label: "Aperçu élève",
    untitled: "Titre de ta classe",
    days: ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"],
    book: "Réserver",
    free: "Gratuite",
    seats: (n: number) => (n === 1 ? "1 place" : `${n} places`),
    online: "en ligne",
    noDate: "Date à choisir",
    was: "au lieu de",
  },
  ar: {
    label: "شنوّة يشوف التلميذ",
    untitled: "عنوان الحصة متاعك",
    days: ["أحد", "إثنين", "ثلاثاء", "إربعاء", "خميس", "جمعة", "سبت"],
    book: "احجز",
    free: "فابور",
    seats: (n: number) => `${n} بلايص`,
    online: "أونلاين",
    noDate: "النهار باش تختارو",
    was: "عوض",
  },
});

export function ClassPreview({
  title,
  wall,
  duration,
  price,
  seats,
  level,
  subject,
  free,
  promo = null,
}: {
  title: string;
  wall: string;
  duration: string;
  price: string;
  seats: string;
  level: string;
  subject: string;
  free: boolean;
  /** A live public promotion covering this class (phase 5): what the student pays. */
  promo?: { finalTnd: number; percent: number } | null;
}) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(wall);
  const day = m ? c.days[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()] : null;
  const meta = [
    m ? m[4] : null,
    duration ? `${duration} ${t.common.min}` : null,
    isLevelCode(level) ? LEVEL_LABELS[level][locale] : subject || null,
  ].filter(Boolean);
  const n = Number(seats);
  return (
    <aside className="nc-preview" aria-label={c.label} data-e2e="class-preview">
      <p className="nc-preview-t" aria-hidden="true">{c.label}</p>
      <div className="u-card nc-preview-card">
        <div className="nc-preview-head">
          <span className="nc-date" aria-hidden={!m}>
            {m ? (
              <>
                <b>{day}</b>
                <span>{m[3]}</span>
              </>
            ) : (
              <b>—</b>
            )}
          </span>
          <div className="min-w-0">
            <UserText as="div" className="nc-preview-title">{title.trim() || c.untitled}</UserText>
            <div className="nc-preview-meta">{m ? meta.join(" · ") : c.noDate}</div>
          </div>
        </div>
        <div className="nc-preview-row">
          {free || !promo ? (
            <span className="nc-preview-price hp-num">{free ? c.free : `${price || "—"} TND`}</span>
          ) : (
            <span className="nc-preview-price" data-e2e="preview-promo">
              <span className="sr-only">{c.was}</span>
              <del className="nc-preview-was hp-num">{price} TND</del>{" "}
              <span className="hp-num">{promo.finalTnd} TND</span>{" "}
              <span className="nc-promo-badge" dir="ltr">−{promo.percent} %</span>
            </span>
          )}
          <span className="btn btn-primary btn-sm nc-preview-book" aria-hidden="true">{c.book}</span>
        </div>
        <div className="nc-preview-foot">
          {Number.isFinite(n) && n > 0 ? c.seats(n) : null}
          {Number.isFinite(n) && n > 0 ? " · " : null}
          {c.online}
        </div>
      </div>
    </aside>
  );
}
