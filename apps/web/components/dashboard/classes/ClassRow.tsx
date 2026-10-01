"use client";
import { useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Copy as CopyIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { DateTimeField } from "@/components/app/DatePicker";
import { CopyLinkButton } from "@/components/app/CopyLinkButton";
import { classUrl } from "@/components/app/links";
import { cancelClass, rescheduleClass } from "@/app/actions";
import { monthLabel, toWallInput, type DashboardClass } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — one row of « Mes classes », with its actions:

     Dupliquer        → the new-class form, prefilled from this class (?from=<id>)
     Modifier la date → move it (POST /classes/:id/reschedule): nobody is dropped,
                        everyone is told, and those who booked may cancel free
     Annuler          → POST /classes/:id/cancel, behind a confirmation dialog:
                        every seat is released and nothing is retained
     Copier le lien   → the class page ({/* ep2:share-slot *\/})

   The two confirmations say different things because the consequences differ —
   cancelling ends the class for everyone and cannot be undone, moving keeps every
   seat. Both say what happens to the STUDENTS, the part a tutor cannot see from
   here. The rules themselves are the API's (Step 11); this only asks. */

const copy = bilingual({
  fr: {
    duplicate: "Dupliquer",
    edit: "Modifier la date",
    cancel: "Annuler",
    keep: "Garder la séance",
    back: "Retour",
    confirmCancel: "Annuler cette séance ?",
    cancelBody:
      "Toutes les places réservées sont libérées et chaque élève est prévenu. Rien n'est retenu : c'est toi qui annules, ils ne doivent rien. C'est définitif.",
    confirmCancelCta: "Oui, annuler",
    cancelling: "Annulation…",
    confirmMove: "Nouvelle date et heure",
    moveBody:
      "Personne n'est désinscrit : les élèves sont prévenus du nouvel horaire. Ceux qui avaient déjà réservé pourront annuler sans frais, même à moins de 48h — ils n'avaient pas choisi ce créneau.",
    confirmMoveCta: "Déplacer la séance",
    moving: "Déplacement…",
    okCancelled: (n: number) => (n === 1 ? "Séance annulée. 1 élève prévenu." : `Séance annulée. ${n} élèves prévenus.`),
    okMoved: (n: number) => (n === 1 ? "Séance déplacée. 1 élève prévenu." : `Séance déplacée. ${n} élèves prévenus.`),
    errStarted: "Cette séance a déjà commencé.",
    errDate: "Choisis une date à venir.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    seats: (taken: number, total: number) => `${taken}/${total} inscrits`,
    copyLabel: (t: string) => `Copier le lien de « ${t} »`,
    phaseUpcoming: "À venir",
    phaseLive: "En direct",
    phaseDone: "Terminée",
    phaseCancelled: "Annulée",
    actions: (t: string) => `Actions pour « ${t} »`,
  },
  ar: {
    duplicate: "انسخ",
    edit: "بدّل الوقت",
    cancel: "ألغي",
    keep: "خلّي الحصة",
    back: "ارجع",
    confirmCancel: "تلغي الحصة هاذي ؟",
    cancelBody:
      "البلايص المحجوزة الكل تتسرّح وكل تلميذ يتعلم. ما يتحبس والو: إنت اللي لغيت، وما عليهم والو. القرار نهائي.",
    confirmCancelCta: "إي، ألغي",
    cancelling: "قاعد يلغي…",
    confirmMove: "التاريخ والوقت الجداد",
    moveBody:
      "حتّى حد ما يتشطب: التلامذة يتعلمو بالوقت الجديد. واللي كانو حاجزين ينجّمو يلغيو بلا مصاريف، حتى كان أقلّ من 48 ساعة — ما اختاروش الوقت هذا.",
    confirmMoveCta: "بدّل الوقت",
    moving: "قاعد يبدّل…",
    okCancelled: (n: number) => `الحصة تلغات. ${n} تلميذ تعلمو.`,
    okMoved: (n: number) => `الحصة تبدّلت. ${n} تلميذ تعلمو.`,
    errStarted: "الحصة هاذي بدات قبل.",
    errDate: "اختار تاريخ جاي.",
    errGeneric: "ما مشاتش. عاود حاول.",
    seats: (taken: number, total: number) => `${taken}/${total} محجوز`,
    copyLabel: (t: string) => `انسخ لينك « ${t} »`,
    phaseUpcoming: "جاية",
    phaseLive: "دايركت",
    phaseDone: "وفات",
    phaseCancelled: "تلغات",
    actions: (t: string) => `أعمال « ${t} »`,
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];

function PhaseTag({ k, c }: { k: DashboardClass; c: Copy }) {
  const phase = k.status === "cancelled" ? "cancelled" : (k.phase ?? "upcoming");
  // Phase A+ (U3): "En direct" is the paper pill with a rose dot — never green.
  const [label, cls] =
    phase === "live" ? [c.phaseLive, "tag tag-live"]
      : phase === "done" ? [c.phaseDone, "chip chip-sand"]
      : phase === "cancelled" ? [c.phaseCancelled, "chip chip-rose"]
      : [c.phaseUpcoming, "chip chip-soft"];
  return <span className={cls} data-e2e="class-phase" data-phase={phase}>{label}</span>;
}

export function ClassRow({ k, onChanged, notify }: { k: DashboardClass; onChanged: () => void; notify: (msg: string) => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [dialog, setDialog] = useState<"none" | "cancel" | "move">("none");
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const actionable = k.status === "scheduled" && k.phase === "upcoming";
  const shareable = k.status !== "cancelled" && (k.phase === "upcoming" || k.phase === "live");

  function messageFor(code: string | undefined): string {
    if (code === "already-started") return c.errStarted;
    if (code === "invalid-date" || code === "date-in-past") return c.errDate;
    return c.errGeneric;
  }

  async function doCancel() {
    if (busy) return;
    setBusy(true);
    const res = await cancelClass({ classId: k.id }).catch(() => null);
    setBusy(false);
    setDialog("none");
    if (!res?.ok) {
      notify(messageFor(res?.error));
      return;
    }
    notify(c.okCancelled(res.cancelled ?? 0));
    onChanged();
  }

  async function doMove() {
    if (busy) return;
    if (!when) {
      setErr(c.errDate);
      return;
    }
    setBusy(true);
    /* The WALL TIME, as picked — the API reads it as Tunis time, exactly like
       creating a class (never converted in the browser's zone). */
    const res = await rescheduleClass({ classId: k.id, scheduledAt: when }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setErr(messageFor(res?.error));
      return;
    }
    setDialog("none");
    notify(c.okMoved(res.notified ?? 0));
    onChanged();
  }

  const taken = Math.max(0, k.seats - k.seats_left);
  return (
    <li className="mc-row" data-e2e="class-row" data-class-id={k.id}>
      <span className="thumb mc-thumb" aria-hidden="true">
        <b>{k.day}</b>
        <span>{monthLabel(k.month, locale)}</span>
      </span>
      <div className="mc-main">
        <Link href={`/class/${k.id}`} className="mc-title">
          <UserText>{k.title}</UserText>
        </Link>
        <div className="mc-meta">
          <time dateTime={k.starts_at}>{k.day} {monthLabel(k.month, locale)} · {k.time}</time>
          {k.duration_min ? <span>{k.duration_min} min</span> : null}
          <span className="hp-num">{c.seats(taken, k.seats)}</span>
          <span className="hp-num">{k.price_tnd} TND</span>
          <PhaseTag k={k} c={c} />
        </div>
      </div>
      <div className="mc-actions" role="group" aria-label={c.actions(k.title)}>
        <Link href={`/dashboard/new-class?from=${encodeURIComponent(k.id)}`} className="btn btn-ghost btn-sm" data-e2e="class-duplicate">
          <CopyIcon />
          {c.duplicate}
        </Link>
        {actionable && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setWhen(toWallInput(k.starts_at)); // start from the class's own time, in Tunis
                setErr(null);
                setDialog("move");
              }}
              data-e2e="class-edit"
            >
              {c.edit}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog("cancel")} data-e2e="class-cancel">
              {c.cancel}
            </button>
          </>
        )}
        {shareable && (
          /* ep2:share-slot — growth (phase 3) replaces this with <ShareButton kind="class" slug={…} classId={k.id} />. */
          <CopyLinkButton url={classUrl(k.id)} label={c.copyLabel(k.title)} compact />
        )}
      </div>

      <ConfirmDialog
        open={dialog === "cancel"}
        title={c.confirmCancel}
        confirmLabel={busy ? c.cancelling : c.confirmCancelCta}
        cancelLabel={c.keep}
        onConfirm={doCancel}
        onClose={() => setDialog("none")}
        busy={busy}
      >
        <p>{c.cancelBody}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "move"}
        title={c.confirmMove}
        confirmLabel={busy ? c.moving : c.confirmMoveCta}
        cancelLabel={c.back}
        onConfirm={doMove}
        onClose={() => setDialog("none")}
        busy={busy}
        tone="primary"
      >
        <p className="mb-3">{c.moveBody}</p>
        {dialog === "move" && (
          <DateTimeField value={when} onChange={(w) => { setWhen(w); setErr(null); }} error={err ?? undefined} />
        )}
      </ConfirmDialog>
    </li>
  );
}
