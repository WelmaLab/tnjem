"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { Calendar, Check, Clock, Play } from "@/components/icons";
import { cancelBooking } from "@/app/actions";
import { bilingual } from "@/lib/i18n";
import {
  CANCEL_FREE_WINDOW_HOURS, CANCEL_FREE_WINDOW_MS, CANCEL_GRACE_MINUTES, LATE_CANCEL_RETAINED_PCT,
  bookingGraceEndsAt, monthLabel, tunisClock, withinBookingGrace,
  type ViewerBooking,
} from "@tnajem/shared";

/* « ✓ TU ES INSCRIT À CETTE SÉANCE » — student-space-v1 · H1 (mockup 4b).

   Live test: a student who had booked opened the prof's page and the class page and
   was offered « Réserver la séance » again. Wherever the viewer already holds the
   seat, this replaces the booking CTA: the confirmation, « Rejoindre (dans 9 h) » —
   « Rejoindre » once it is on — to /live/<id>, and « Annuler ».

   « Annuler » is the cancel flow of the student space, unchanged: the same rule (free
   up to 48 h before, the 15-minute grace after booking, then the figure a late cancel
   retains — noted, never taken while payments are off), said BEFORE the student
   commits, then the outcome the server reports. Once the class has started the
   online cancel is closed (the server refuses it) and the panel says so.

   Two shapes: `panel` (the desktop aside / panel column) and `bar` (the phone's
   sticky bar). The copy is the student page's own, word for word, so the two places
   a seat can be cancelled from say the same thing. */

const copy = bilingual({
  fr: {
    booked: "Tu es inscrit à cette séance",
    join: "Rejoindre",
    joinIn: (rel: string) => `Rejoindre (dans ${rel})`,
    min: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} j`,
    liveNow: "En direct maintenant",
    cancel: "Annuler",
    cancelSure: "Annuler cette réservation ?",
    cancelYes: "Oui, annuler",
    cancelNo: "Garder ma place",
    cancelRule: `Annulation gratuite jusqu'à ${CANCEL_FREE_WINDOW_HOURS}h avant le cours.`,
    cancelLocked: "Le cours a commencé — l'annulation en ligne est fermée. Préviens ton prof, il s'arrangera avec toi.",
    cancelLateWarnAmount: (tnd: string) => `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux quand même annuler, et ta place repart tout de suite — ${tnd} TND (${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} % du prix de la place) seront notés comme retenus pour ton prof dans le registre des annulations. Aucun montant n'est prélevé pendant le pilote.`,
    cancelLateWarnNothing: `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux annuler, ta place repart tout de suite, et rien n'est retenu pour cette place.`,
    cancelGrace: (until: string) => `Annulation gratuite jusqu'à ${until} : tu as réservé il y a moins de ${CANCEL_GRACE_MINUTES} min. Rien n'est retenu pour ton prof.`,
    cancelled: "Réservation annulée. La place est de nouveau libre.",
    cancelledGrace: `Réservation annulée, la place est de nouveau libre. C'était dans les ${CANCEL_GRACE_MINUTES} min après ta réservation : c'est gratuit, rien n'est retenu.`,
    cancelledLateAmount: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont notés comme retenus pour ton prof dans le registre des annulations. Rien n'est prélevé pendant le pilote.`,
    cancelledLateCharged: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont retenus pour ton prof.`,
    cancelledNothing: "Réservation annulée, la place est de nouveau libre. Rien n'est retenu pour cette place.",
    alreadyStarted: "Le cours a déjà commencé, on ne peut plus l'annuler en ligne. Écris à ton prof.",
    cancelErr: "L'annulation n'a pas marché. Réessaie.",
  },
  ar: {
    booked: "إنت مسجّل في الحصة هاذي",
    join: "ادخل",
    joinIn: (rel: string) => `ادخل (بعد ${rel})`,
    min: (n: number) => `${n} دقيقة`,
    hours: (n: number) => (n === 1 ? "ساعة" : n === 2 ? "ساعتين" : n <= 10 ? `${n} سوايع` : `${n} ساعة`),
    days: (n: number) => (n === 2 ? "يومين" : n <= 10 ? `${n} أيام` : `${n} يوم`),
    liveNow: "الدايركت بدا توّا",
    cancel: "ألغي",
    cancelSure: "تحب تلغي هذا الحجز ؟",
    cancelYes: "إيه، ألغي",
    cancelNo: "نحافظ على مكاني",
    cancelRule: `الإلغاء مجاني حتى ${CANCEL_FREE_WINDOW_HOURS} ساعة قبل الحصة.`,
    cancelLocked: "الحصة بدات — الإلغاء أونلاين مسكّر. اعلم أستاذك وهو يتفاهم معاك.",
    cancelLateWarnAmount: (tnd: string) => `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم برك تلغي، ومكانك يرجع متوفّر على طول — ${tnd} د.ت (⁦${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %⁩ من ثمن البلاصة) يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelLateWarnNothing: `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم تلغي، ومكانك يرجع متوفّر على طول، وما يتحسب عليك حتى شي على هالبلاصة.`,
    cancelGrace: (until: string) => `الإلغاء بلاش حتى لـ ${until} : حجزت من أقل من ${CANCEL_GRACE_MINUTES} دقيقة. ما يتحسب حتى شي لأستاذك.`,
    cancelled: "الحجز تلغى. المكان ولّى متوفّر.",
    cancelledGrace: `الحجز تلغى، والمكان ولّى متوفّر. كان في الـ${CANCEL_GRACE_MINUTES} دقيقة اللي بعد الحجز : بلاش، ما يتحسب عليك حتى شي.`,
    cancelledLateAmount: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelledLateCharged: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتحسبو لأستاذك.`,
    cancelledNothing: "الحجز تلغى، والمكان ولّى متوفّر. ما يتحسب عليك حتى شي على هالبلاصة.",
    alreadyStarted: "الحصة بدات قبل، ما عادش تنجم تلغي أونلاين. اكتب لأستاذك.",
    cancelErr: "الإلغاء ما مشاش. عاود حاول.",
  },
});

const tndLabel = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** The clock, re-read every 20 s: enough for « dans 9 h » and the live switch. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** What the student is told after the server cancelled the seat — its outcome, not a guess. */
export type CancelledMessage = string;

export function BookedPanel({
  booking,
  variant,
  eyebrow,
  onCancelled,
}: {
  booking: ViewerBooking;
  variant: "panel" | "bar";
  /** A small label above the title (the storefront's « Prochaine séance »); panel only. */
  eyebrow?: string;
  /** The seat is gone: the message to show, already in the page's language. */
  onCancelled: (message: CancelledMessage) => void;
}) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startMs = Date.parse(booking.starts_at);
  const startsIn = startMs - now;
  const live = startsIn <= 0;
  const lateCancel = !live && startsIn < CANCEL_FREE_WINDOW_MS;
  const inGrace = lateCancel && withinBookingGrace({ bookedAt: booking.bookedAt, scheduledAt: startMs, now });

  const minutes = Math.max(1, Math.ceil(startsIn / 60_000));
  const rel = minutes < 60 ? c.min(minutes) : minutes < 48 * 60 ? c.hours(Math.floor(minutes / 60)) : c.days(Math.floor(minutes / (24 * 60)));
  const joinLabel = live ? c.join : c.joinIn(rel);

  const rule = inGrace
    ? c.cancelGrace(tunisClock(bookingGraceEndsAt({ bookedAt: booking.bookedAt, scheduledAt: startMs })))
    : !lateCancel
      ? c.cancelRule
      : booking.lateCancelRetainedTnd > 0
        ? c.cancelLateWarnAmount(tndLabel(booking.lateCancelRetainedTnd))
        : c.cancelLateWarnNothing;

  async function doCancel() {
    setBusy(true);
    setErr(null);
    try {
      const res = await cancelBooking({ bookingId: booking.bookingId });
      setConfirming(false);
      if (!res.ok) {
        setErr(res.error === "already-started" ? c.alreadyStarted : c.cancelErr);
        return;
      }
      /* The SERVER decides whether it was late — its clock is the one that counts.
         The local guess is only the fallback for a payload without the field. */
      const late = res.late ?? lateCancel;
      const retained = res.retainedTnd ?? 0;
      onCancelled(
        res.grace
          ? c.cancelledGrace
          : !late
            ? c.cancelled
            : retained > 0
              ? (res.paymentsEnabled ? c.cancelledLateCharged : c.cancelledLateAmount)(tndLabel(retained))
              : c.cancelledNothing,
      );
    } catch {
      setConfirming(false);
      setErr(c.cancelErr);
    } finally {
      setBusy(false);
    }
  }

  const when = `${booking.day} ${monthLabel(booking.month, locale)} · ${booking.time}`;

  return (
    <div className={`bk bk-${variant}`} data-e2e="booked-panel" data-phase={live ? "live" : "upcoming"}>
      {variant === "panel" && (
        <>
          {eyebrow && <div className="bk-eyebrow">{eyebrow}</div>}
          <UserText as="div" className="bk-title">{booking.title}</UserText>
          <div className="metaline bk-meta">
            <span>
              <Calendar />
              <time dateTime={booking.starts_at}>{when}</time>
            </span>
            <span>
              <Clock />
              {booking.duration_min} {t.common.min}
            </span>
          </div>
        </>
      )}

      <p className="bk-badge" data-e2e="booked-badge">
        <Check />
        <span>{c.booked}</span>
        {live && <span className="bk-live">{c.liveNow}</span>}
      </p>

      <div className="bk-actions">
        {/* ONE link styled as a button — never a control inside another (live-fixes-3 · H). */}
        <Link href={`/live/${booking.classId}`} className="btn btn-primary bk-join" data-e2e="booked-join">
          <Play /> {joinLabel}
        </Link>
        {!live && (
          <button type="button" className="btn btn-ghost bk-cancel" data-e2e="booked-cancel" onClick={() => { setErr(null); setConfirming(true); }}>
            {c.cancel}
          </button>
        )}
      </div>

      {live && variant === "panel" && <p className="bk-locked">{c.cancelLocked}</p>}
      {err && <p className="bk-err" role="alert">{err}</p>}

      <ConfirmDialog
        open={confirming}
        title={c.cancelSure}
        confirmLabel={c.cancelYes}
        cancelLabel={c.cancelNo}
        onConfirm={doCancel}
        onClose={() => { if (!busy) setConfirming(false); }}
        busy={busy}
      >
        <p data-e2e="booked-cancel-rule">{rule}</p>
      </ConfirmDialog>
    </div>
  );
}
