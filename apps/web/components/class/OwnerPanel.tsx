"use client";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { ShareButton } from "@/components/share/ShareButton";
import { StartSessionLink, useStartState } from "@/components/dashboard/classes/StartSessionLink";
import { markLinkShared } from "@/app/actions-shell";
import { isOpenForBooking, type ClassItem } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* live-fixes-3 · A3 — the OWNER on their own class page (/class/<id>).

   The page offered the tutor « Réserver cette séance » on their own class — a
   self-booking the API refuses (`own-class`). In its place, the tutor's own panel:
   « C'est ta séance », the way into the room (« Démarrer la séance », the same
   button and window as Mes classes), « Modifier » and « Partager ».

   « Modifier » is Mes classes with this class's date dialog open
   (/dashboard/classes?edit=<id>): a published class is changed by its date — there
   is no other edit screen — and only before it starts. « Partager » is the share
   sheet of Mes classes (contract C3), recording the « lien partagé » step.

   The class page reads the class in the browser WITH the session (getClass), and
   the API answers viewer_is_owner in that same payload — so the owner never sees
   the booking CTA flash before this panel replaces it. */

const copy = bilingual({
  fr: {
    title: "C'est ta séance",
    sub: "Ta page de séance, telle que tes élèves la voient.",
    ended: "Cette séance est terminée.",
    cancelled: "Cette séance est annulée.",
    edit: "Modifier",
  },
  ar: {
    title: "هاذي حصتك",
    sub: "صفحة الحصة متاعك، كيف ما يشوفوها التلامذة.",
    ended: "الحصة هاذي وفات.",
    cancelled: "الحصة هاذي تلغات.",
    edit: "بدّل",
  },
});

export function OwnerPanel({ cls }: { cls: ClassItem }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const state = useStartState(cls);
  const editable = isOpenForBooking(cls); // scheduled and not started: the API's own reschedule rule
  const shareable = state !== "over" && Boolean(cls.tutor_slug);
  return (
    <div className="lf3-owner" data-e2e="owner-panel">
      <h2 className="lf3-owner-t">{c.title}</h2>
      <p className="lf3-owner-sub">
        {state !== "over" ? c.sub : cls.status === "cancelled" ? c.cancelled : c.ended}
      </p>
      <StartSessionLink cls={cls} block className="lf3-owner-start" />
      {(editable || shareable) && (
        <div className="lf3-owner-row">
          {editable && (
            <Link
              href={`/dashboard/classes?edit=${encodeURIComponent(cls.id)}`}
              className="btn btn-ghost btn-sm"
              data-e2e="owner-edit"
            >
              {c.edit}
            </Link>
          )}
          {shareable && (
            <ShareButton
              kind="class"
              slug={cls.tutor_slug}
              classId={cls.id}
              classTitle={cls.title}
              startsAt={cls.starts_at}
              onShared={() => void markLinkShared()}
            />
          )}
        </div>
      )}
    </div>
  );
}
