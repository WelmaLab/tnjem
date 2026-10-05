"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { closeOnLeave } from "@/components/app/disclosure";
import { cancelBooking } from "@/app/actions";
import {
  CANCEL_FREE_WINDOW_HOURS, CANCEL_FREE_WINDOW_MS, CANCEL_GRACE_MINUTES, LATE_CANCEL_RETAINED_PCT,
  bookingGraceEndsAt, tunisClock, withinBookingGrace, type StudentClassRow,
} from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* « Annuler ma place » — student-space-v1 · pages (letter B: « in an overflow menu »).

   The cancel is not a main action of a booked class, so it sits behind « ⋯ »: a small
   disclosure menu, then the confirmation dialog. The dialog says what THIS seat would
   retain — the 48 h rule, the 15-minute grace after booking, the real figure the API
   computed (lateCancelRetainedTnd) — before the student commits; the server decides on
   its own clock and the page then says what actually happened (cancelOutcomeText).
   The 48 h window and the 40 % come from @tnajem/shared/cancellation, never hardcoded. */

const copy = bilingual({
  fr: {
    more: (t: string) => `Plus d'options pour « ${t} »`,
    cancel: "Annuler ma place",
    cancelSure: "Annuler cette réservation ?",
    cancelYes: "Oui, annuler",
    cancelNo: "Garder ma place",
    cancelRule: `Annulation gratuite jusqu'à ${CANCEL_FREE_WINDOW_HOURS}h avant le cours.`,
    cancelLateWarnAmount: (tnd: string) => `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux quand même annuler, et ta place repart tout de suite — ${tnd} TND (${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} % du prix de la place) seront notés comme retenus pour ton prof dans le registre des annulations. Aucun montant n'est prélevé pendant le pilote.`,
    cancelLateWarnNothing: `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux annuler, ta place repart tout de suite, et rien n'est retenu pour cette place.`,
    cancelGrace: (until: string) => `Annulation gratuite jusqu'à ${until} : tu as réservé il y a moins de ${CANCEL_GRACE_MINUTES} min. Rien n'est retenu pour ton prof.`,
    alreadyStarted: "Le cours a déjà commencé, on ne peut plus l'annuler en ligne. Écris à ton prof.",
    cancelErr: "L'annulation n'a pas marché. Réessaie.",
  },
  ar: {
    more: (t: string) => `خيارات أخرى لـ « ${t} »`,
    cancel: "ألغي مكاني",
    cancelSure: "تحب تلغي هذا الحجز ؟",
    cancelYes: "إيه، ألغي",
    cancelNo: "نحافظ على مكاني",
    cancelRule: `الإلغاء مجاني حتى ${CANCEL_FREE_WINDOW_HOURS} ساعة قبل الحصة.`,
    cancelLateWarnAmount: (tnd: string) => `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم برك تلغي، ومكانك يرجع متوفّر على طول — ${tnd} د.ت (⁦${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %⁩ من ثمن البلاصة) يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelLateWarnNothing: `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم تلغي، ومكانك يرجع متوفّر على طول، وما يتحسب عليك حتى شي على هالبلاصة.`,
    cancelGrace: (until: string) => `الإلغاء بلاش حتى لـ ${until} : حجزت من أقل من ${CANCEL_GRACE_MINUTES} دقيقة. ما يتحسب حتى شي لأستاذك.`,
    alreadyStarted: "الحصة بدات قبل، ما عادش تنجم تلغي أونلاين. اكتب لأستاذك.",
    cancelErr: "الإلغاء ما مشاش. عاود حاول.",
  },
});

const outcomeCopy = bilingual({
  fr: {
    cancelled: "Réservation annulée. La place est de nouveau libre.",
    cancelledGrace: `Réservation annulée, la place est de nouveau libre. C'était dans les ${CANCEL_GRACE_MINUTES} min après ta réservation : c'est gratuit, rien n'est retenu.`,
    cancelledLateAmount: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont notés comme retenus pour ton prof dans le registre des annulations. Rien n'est prélevé pendant le pilote.`,
    cancelledLateCharged: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont retenus pour ton prof.`,
    cancelledNothing: "Réservation annulée, la place est de nouveau libre. Rien n'est retenu pour cette place.",
  },
  ar: {
    cancelled: "الحجز تلغى. المكان ولّى متوفّر.",
    cancelledGrace: `الحجز تلغى، والمكان ولّى متوفّر. كان في الـ${CANCEL_GRACE_MINUTES} دقيقة اللي بعد الحجز : بلاش، ما يتحسب عليك حتى شي.`,
    cancelledLateAmount: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelledLateCharged: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتحسبو لأستاذك.`,
    cancelledNothing: "الحجز تلغى، والمكان ولّى متوفّر. ما يتحسب عليك حتى شي على هالبلاصة.",
  },
});

export type CancelOutcome = { late: boolean; retainedTnd: number; paymentsEnabled: boolean; grace: boolean };
const tndLabel = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

/** What the page says once a seat is cancelled — what the SERVER decided. */
export function cancelOutcomeText(o: CancelOutcome, locale: "fr" | "ar"): string {
  const c = outcomeCopy[locale];
  if (o.grace) return c.cancelledGrace;
  if (!o.late) return c.cancelled;
  if (o.retainedTnd > 0) return (o.paymentsEnabled ? c.cancelledLateCharged : c.cancelledLateAmount)(tndLabel(o.retainedTnd));
  return c.cancelledNothing;
}

/** The « ⋯ » of a booked class. Renders nothing once the class has started (no online cancel then). */
export function SeatMenu({
  row,
  onCancelled,
  tone = "light",
}: {
  row: StudentClassRow;
  onCancelled: (o: CancelOutcome) => void;
  /** "dark" on the navy hero. */
  tone?: "light" | "dark";
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // A tap anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const ts = Date.parse(row.startsAt);
  const startsIn = ts - now;
  if (startsIn <= 0 || row.state === "cancelled") return null;
  const lateCancel = startsIn < CANCEL_FREE_WINDOW_MS;
  const inGrace = lateCancel && withinBookingGrace({ bookedAt: row.bookedAt, scheduledAt: ts, now });

  const rule = inGrace
    ? c.cancelGrace(tunisClock(bookingGraceEndsAt({ bookedAt: row.bookedAt, scheduledAt: ts })))
    : !lateCancel
      ? c.cancelRule
      : row.lateCancelRetainedTnd > 0
        ? c.cancelLateWarnAmount(tndLabel(row.lateCancelRetainedTnd))
        : c.cancelLateWarnNothing;

  async function doCancel() {
    setBusy(true);
    setErr(null);
    let res: Awaited<ReturnType<typeof cancelBooking>>;
    try {
      res = await cancelBooking({ bookingId: row.bookingId });
    } catch {
      setBusy(false);
      setErr(c.cancelErr);
      return;
    }
    setBusy(false);
    if (res.ok) {
      setConfirming(false);
      onCancelled({ late: res.late ?? lateCancel, retainedTnd: res.retainedTnd ?? 0, paymentsEnabled: res.paymentsEnabled ?? false, grace: res.grace ?? false });
      return;
    }
    setErr(res.error === "already-started" ? c.alreadyStarted : c.cancelErr);
  }

  return (
    <div className="ssv-menu" ref={wrap} onBlur={(e) => closeOnLeave(e, () => setOpen(false))}>
      <button
        ref={trigger}
        type="button"
        className={tone === "dark" ? "ssv-more ssv-more-dark" : "ssv-more ssv-more-light"}
        aria-label={c.more(row.title)}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
        data-e2e="seat-menu"
      >
        <svg viewBox="0 0 24 24" className="ic" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" className="fill" /><circle cx="12" cy="12" r="1.6" className="fill" /><circle cx="18.5" cy="12" r="1.6" className="fill" /></svg>
      </button>
      <div id={menuId} className="ssv-menu-pop" hidden={!open}>
        <button
          type="button"
          className="ssv-menu-item ssv-menu-danger"
          onClick={() => {
            setOpen(false);
            setErr(null);
            setNow(Date.now());
            setConfirming(true);
          }}
          data-e2e="seat-cancel"
        >
          {c.cancel}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title={c.cancelSure}
        confirmLabel={c.cancelYes}
        cancelLabel={c.cancelNo}
        onConfirm={doCancel}
        onClose={() => {
          setConfirming(false);
          trigger.current?.focus();
        }}
        busy={busy}
      >
        <p>{rule}</p>
        {err ? <p role="alert" className="ssv-err">{err}</p> : null}
      </ConfirmDialog>
    </div>
  );
}
