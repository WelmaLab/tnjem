"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Spinner } from "@/components/ui";
import {
  getDeletionState,
  requestAccountDeletion,
  cancelAccountDeletion,
  type DeletionState,
} from "@/app/actions";
import { bilingual } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/app/ConfirmDialog"; // espace prof v2 · shell (Réglages › Sécurité)
import { DELETION_GRACE_DAYS, formatLongDate } from "@tnajem/shared";

/* CLOSING YOUR ACCOUNT (Step 15).

   THE COPY IS THE FEATURE HERE. Three things are true and none of them are
   guessable from a button labelled "delete", so each is said before the person
   commits rather than discovered afterwards:

     1. IT IS REVERSIBLE FOR 30 DAYS. The commonest reason to close an account is
        a bad day; the commonest regret is having done it irreversibly.
     2. WHAT GOES AND WHAT STAYS, exactly as packages/db/src/erasure.ts does it and
        /privacy §3 says it. The account is anonymised, not deleted: a tutor's roster
        and the cancellation ledger keep an anonymous seat.
     3. REVIEWS STAY, WITHOUT THE NAME. Someone expecting their words to vanish
        deserves to know they will not — a tutor's public rating is not theirs to
        retract by leaving, and finding that out later feels like a betrayal.
     4. IT IS BLOCKED WHILE BOOKED, and the message says which side is blocking.
        "Something went wrong" on a deletion request reads as the product
        refusing to let you go.

   A two-step confirm, not a modal: the destructive control is never the one
   under the cursor when the section first renders. */

const copy = bilingual({
  fr: {
    title: "Supprimer mon compte",
    body:
      `Tu peux fermer ton compte quand tu veux. On te laisse ${DELETION_GRACE_DAYS} jours pour changer d'avis — pendant ce délai, tu peux tout annuler en revenant ici.`,
    whatGoes:
      "Ensuite, ton nom, ton e-mail, ton téléphone et ton année de naissance sont effacés, tu es déconnecté de tous tes appareils, et les messages que tu as écrits sont supprimés. Si tu es prof : ta page est retirée, et tes pièces d'identité, tes documents partagés et ta photo sont effacés de nos serveurs.",
    whatStays:
      "Ce qui reste, sans rien qui permette de te reconnaître : les avis que tu as écrits (sans ton nom — la note d'un prof ne doit pas changer parce qu'un élève est parti), la trace des places réservées pour l'historique du prof et le registre des annulations, et un message que quelqu'un a signalé, gardé comme preuve.",

    ask: "Supprimer mon compte",
    confirmTitle: "Confirmer la suppression ?",
    confirmBody: `Ton compte sera supprimé dans ${DELETION_GRACE_DAYS} jours. Tu peux annuler à tout moment d'ici là. Tes autres appareils sont déconnectés dès maintenant.`,
    confirmCta: "Oui, lancer la suppression",
    keep: "Garder mon compte",
    working: "…",

    pendingTitle: "Suppression programmée",
    pendingBody: (d: string) => `Ton compte sera supprimé le ${d}. Tu peux encore tout annuler.`,
    undo: "Annuler la suppression",

    errBookings:
      "Tu as encore une séance à venir. Annule-la d'abord — ton prof doit savoir que tu ne viendras pas.",
    errClasses:
      "Tu as encore une séance programmée. Annule-la d'abord — tes élèves doivent être prévenus.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    loading: "Chargement…",
    // espace prof v2 · shell — the folded version in Réglages › Sécurité (image 4).
    grace: `${DELETION_GRACE_DAYS} jours pour changer d'avis.`,
    whatIsErased: "Ce qui est effacé",
    askShort: "Supprimer…",
  },
  ar: {
    title: "امسح حسابي",
    body:
      `تنجّم تسكّر حسابك وقت ما تحب. نخلّيولك ${DELETION_GRACE_DAYS} يوم باش تبدّل رايك — في المدّة هاذي تنجّم تلغي كل شي كي ترجع لهوني.`,
    whatGoes:
      "من بعد، إسمك، الإيميل، التليفون وسنة ميلادك يتمسحو، تخرج من الأجهزة الكل، والرسائل اللي كتبتهم يتمسحو. كان إنت أستاذ: صفحتك تتنحّى، ووثائق هويتك، الملفات اللي شاركتهم وتصويرتك يتمسحو من السيرفرات متاعنا.",
    whatStays:
      "اللي يبقى، بلا حتى حاجة تعرّف بيك: التقييمات اللي كتبتهم (بلا إسمك — نقطة الأستاذ ما لازمش تتبدّل خاطر تلميذ مشى)، أثر البلايص المحجوزة لتاريخ الأستاذ وسجل الإلغاءات، ورسالة بلّغ عليها حد، تتحفظ كدليل.",

    ask: "امسح حسابي",
    confirmTitle: "تأكّد المسح ؟",
    confirmBody: `حسابك يتمسح بعد ${DELETION_GRACE_DAYS} يوم. تنجّم تلغي وقت ما تحب قبل. الأجهزة الأخرى تخرج من توّا.`,
    confirmCta: "إي، ابدا المسح",
    keep: "خلّي حسابي",
    working: "…",

    pendingTitle: "المسح مبرمج",
    pendingBody: (d: string) => `حسابك يتمسح نهار ${d}. ما زال تنجّم تلغي.`,
    undo: "ألغي المسح",

    errBookings:
      "ما زال عندك حصة جاية. ألغيها الأول — أستاذك لازمو يعرف إلّي ما باش تجي.",
    errClasses:
      "ما زال عندك حصة مبرمجة. ألغيها الأول — تلامذتك لازمهم يتعلمو.",
    errGeneric: "ما مشاتش. عاود حاول.",
    loading: "قاعد يحمّل…",
    grace: `${DELETION_GRACE_DAYS} يوم باش تبدّل رايك.`,
    whatIsErased: "شنوّة يتمسح",
    askShort: "امسح…",
  },
});

/* variant "compact" (espace prof v2, Réglages › Sécurité, image 4): one line, the
   detail and the legal links folded behind « Ce qui est effacé ▸ », and the
   confirmation in a dialog. "full" is the student's /account, unchanged. */
export function DeleteAccount({ variant = "full", legal }: { variant?: "full" | "compact"; legal?: ReactNode } = {}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [state, setState] = useState<DeletionState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await getDeletionState().catch(() => null);
    setState(s ?? { requested: false, graceDays: 30 });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function doRequest() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await requestAccountDeletion().catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (!res?.ok) {
      /* Name WHICH side is blocking. A generic failure on a deletion request
         reads as the product refusing to let you leave. */
      setErr(
        res?.error === "has-upcoming-bookings" ? c.errBookings
          : res?.error === "has-upcoming-classes" ? c.errClasses
          : c.errGeneric,
      );
      return;
    }
    await load();
  }

  async function doCancel() {
    setBusy(true);
    const res = await cancelAccountDeletion().catch(() => null);
    setBusy(false);
    if (!res?.ok) { setErr(c.errGeneric); return; }
    setErr(null);
    await load();
  }

  if (!state) {
    return (
      <div className="panel panel-pad grid place-items-center min-h-[120px]">
        <Spinner />
        <span className="sr-only">{c.loading}</span>
      </div>
    );
  }

  if (state.requested && state.purgeAt) {
    const when = formatLongDate(state.purgeAt, locale); // the Tunis calendar day
    return (
      <div className="panel panel-pad">
        <h2 className="font-display text-[16px] font-bold mb-1.5">{c.pendingTitle}</h2>
        <p className="text-[13px] text-muted leading-[1.6] mb-3">{c.pendingBody(when)}</p>
        <button type="button" onClick={doCancel} disabled={busy} className="btn btn-primary btn-sm">
          {busy ? c.working : c.undo}
        </button>
        {err && (
          <p role="alert" className="text-[13px] mt-2" style={{ color: "var(--rose)" }}>{err}</p>
        )}
      </div>
    );
  }

  if (variant === "compact") {
    return (
      <section className="st-danger" aria-labelledby="st-danger-t" data-e2e="delete-account">
        <div className="st-danger-row">
          <div className="min-w-0 flex-1">
            <h3 id="st-danger-t" className="st-danger-t">{c.title}</h3>
            <p className="text-[13px] text-muted leading-[1.6]">{c.grace}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm st-danger-btn" onClick={() => setConfirming(true)} disabled={busy}>
            {c.askShort}
          </button>
        </div>
        <details className="st-fold" data-e2e="what-is-erased">
          <summary>{c.whatIsErased}</summary>
          <p className="text-[13px] text-muted leading-[1.6] mt-2">{c.body}</p>
          <p className="text-[13px] text-muted leading-[1.6] mt-2">{c.whatGoes}</p>
          <p className="text-[13px] text-muted leading-[1.6] mt-2">{c.whatStays}</p>
          {legal}
        </details>
        <ConfirmDialog
          open={confirming}
          title={c.confirmTitle}
          confirmLabel={busy ? c.working : c.confirmCta}
          cancelLabel={c.keep}
          onConfirm={doRequest}
          onClose={() => setConfirming(false)}
          busy={busy}
        >
          <p>{c.confirmBody}</p>
        </ConfirmDialog>
        {err && (
          <p role="alert" className="text-[13px] mt-2.5 leading-[1.6]" style={{ color: "var(--rose)" }}>
            {err}
          </p>
        )}
      </section>
    );
  }

  return (
    <div className="panel panel-pad">
      <h2 className="font-display text-[16px] font-bold mb-1.5">{c.title}</h2>
      <p className="text-[13px] text-muted leading-[1.6] mb-2">{c.body}</p>
      <p className="text-[13px] text-muted leading-[1.6] mb-2">{c.whatGoes}</p>
      <p className="text-[13px] text-muted leading-[1.6] mb-3.5">{c.whatStays}</p>

      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-ghost btn-sm">
          {c.ask}
        </button>
      ) : (
        <div className="rounded-[14px] p-3" style={{ background: "var(--cream)", border: "1px solid var(--line)" }}>
          <div className="text-[13px] font-bold mb-1">{c.confirmTitle}</div>
          <p className="text-[13px] text-muted leading-[1.6] mb-2.5">{c.confirmBody}</p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={doRequest}
              disabled={busy}
              className="border-0 bg-rose text-white font-bold text-[13px] py-3 px-4 rounded-[999px] cursor-pointer min-h-11"
            >
              {busy ? c.working : c.confirmCta}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost btn-sm">
              {c.keep}
            </button>
          </div>
        </div>
      )}

      {err && (
        <p role="alert" className="text-[13px] mt-2.5 leading-[1.6]" style={{ color: "var(--rose)" }}>
          {err}
        </p>
      )}
    </div>
  );
}
