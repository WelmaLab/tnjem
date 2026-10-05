"use client";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Star } from "@/components/icons";
import { createReview } from "@/app/actions";
import type { StudentClassDetail } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* « Ton avis » — the existing review flow (POST /reviews), inline in the class detail
   (student-space-v1 · C, mockup 2a). Five stars, an optional word, « Envoyer mon
   avis ». Every rule is the API's (a booking that was not cancelled, a class that has
   ENDED — review-eligibility.ts); this only shows its answer. A review is MASKED, not
   refused, when it carries contact details, and says so. */

const copy = bilingual({
  fr: {
    title: "Ton avis",
    note: "Ton avis est publié sur la page du prof, avec ton prénom seulement.",
    ratePh: "Un mot pour les autres élèves (optionnel)",
    send: "Envoyer mon avis",
    sending: "Envoi…",
    thanks: "Merci ! Ton avis aide les autres élèves à choisir.",
    thanksMasked: "Merci ! Ton avis est publié — on a retiré les coordonnées (numéro, email ou lien), qui ne sont pas autorisées sur une page publique.",
    already: "Tu as déjà noté ce cours.",
    notBooked: "Tu n'étais pas inscrit à ce cours.",
    notStarted: "Ce cours n'a pas encore eu lieu.",
    notEnded: "Tu pourras noter ce cours une fois la séance terminée.",
    cancelled: "Cette séance a été annulée : il n'y a rien à noter.",
    pickStars: "Choisis une note de 1 à 5 étoiles.",
    reviewErr: "L'avis n'est pas parti. Réessaie.",
    stars: (n: number) => `${n} étoile${n > 1 ? "s" : ""}`,
    yourStars: (n: number) => `Ta note : ${n} sur 5`,
  },
  ar: {
    title: "تقييمك",
    note: "تقييمك يتنشر في صفحة الأستاذ، بإسمك الأول برك.",
    ratePh: "كلمة للتلاميذ الآخرين (اختياري)",
    send: "ابعث تقييمي",
    sending: "قاعد يتبعث…",
    thanks: "يعيشك ! تقييمك يعاون التلاميذ الآخرين.",
    thanksMasked: "يعيشك ! تقييمك تنشر — نحّينا معلومات الاتصال (النمرة، الإيميل ولا الرابط)، علاخاطر موش مسموحة في صفحة عمومية.",
    already: "قيّمت الحصة هاذي من قبل.",
    notBooked: "ما كنتش محجوز في الحصة هاذي.",
    notStarted: "الحصة هاذي ما زالت ما صارتش.",
    notEnded: "تنجّم تنقّم الحصة كي توفى.",
    cancelled: "الحصة هاذي تلغات : ما فمّا شي باش تقيّمو.",
    pickStars: "اختار تقييم من 1 إلى 5 نجوم.",
    reviewErr: "التقييم ما مشاش. عاود حاول.",
    stars: (n: number) => `${n} نجوم`,
    yourStars: (n: number) => `تقييمك : ${n} من 5`,
  },
});

function Stars({ value, label }: { value: number; label: string }) {
  return (
    <div className="ssv-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= value ? "fill ssv-star-on" : "ssv-star-off"} />
      ))}
    </div>
  );
}

export function ReviewBox({ detail, onDone }: { detail: StudentClassDetail; onDone: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sent, setSent] = useState<{ rating: number; text: string | null } | null>(null);

  const mine = sent ?? detail.review;

  async function submit() {
    if (rating < 1) {
      setMsg({ kind: "err", text: c.pickStars });
      return;
    }
    setBusy(true);
    let res: Awaited<ReturnType<typeof createReview>>;
    try {
      res = await createReview({ classId: detail.row.classId, rating, text: text.trim() || undefined });
    } catch {
      setBusy(false);
      setMsg({ kind: "err", text: c.reviewErr });
      return;
    }
    setBusy(false);
    if (res.ok) {
      setSent({ rating, text: text.trim() || null });
      setMsg({ kind: "ok", text: res.masked ? c.thanksMasked : c.thanks });
      onDone();
      return;
    }
    const e = res.error;
    setMsg({
      kind: "err",
      text: e === "already-reviewed" ? c.already
        : e === "not-booked" ? c.notBooked
        : e === "class-not-started" ? c.notStarted
        : e === "class-not-ended" ? c.notEnded
        : e === "invalid-rating" ? c.pickStars
        : c.reviewErr,
    });
  }

  let body: React.ReactNode;
  if (mine) {
    body = (
      <>
        <Stars value={mine.rating} label={c.yourStars(mine.rating)} />
        {mine.text ? <UserText as="p" className="ssv-review-text">{mine.text}</UserText> : null}
        {msg?.kind === "ok" ? <p className="ssv-ok" role="status">{msg.text}</p> : null}
      </>
    );
  } else if (detail.reviewBlock) {
    body = <p className="ssv-muted">{detail.row.state === "cancelled" ? c.cancelled : c.notEnded}</p>;
  } else {
    body = (
      <>
        <div className="ssv-stars-pick" role="group" aria-label={c.title}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={n <= rating ? "ssv-star-btn is-on" : "ssv-star-btn"}
              aria-label={c.stars(n)}
              aria-pressed={rating === n}
              onClick={() => {
                setRating(n);
                setMsg(null);
              }}
            >
              <Star className={n <= rating ? "fill" : ""} />
            </button>
          ))}
        </div>
        {rating > 0 ? (
          <>
            <textarea
              className="ssv-review-inp"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={c.ratePh}
              placeholder={c.ratePh}
              maxLength={1000}
              rows={3}
            />
            <button type="button" className="btn btn-ghost btn-sm ssv-review-send" onClick={submit} disabled={busy}>
              {busy ? c.sending : c.send}
            </button>
          </>
        ) : null}
        {msg?.kind === "err" ? <p className="ssv-err" role="alert">{msg.text}</p> : null}
        <p className="ssv-muted">{c.note}</p>
      </>
    );
  }

  return (
    <section className="ssv-dsec" aria-labelledby="ssv-review-t" data-e2e="class-review">
      <h3 id="ssv-review-t" className="ssv-dsec-t">{c.title}</h3>
      {body}
    </section>
  );
}
