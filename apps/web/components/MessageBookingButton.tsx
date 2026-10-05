"use client";
import { useState, type CSSProperties } from "react";
import { useLocalizedRouter } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { openThread } from "@/app/actions";
import { conversationHref } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* « Message » FROM A BOOKING ROW.

   There is no compose screen and no user picker anywhere in the product, by
   design: a conversation exists only between two people a booking connects. That
   is what makes an inbox safe to point minors at, and it is why this button lives
   on a booking row rather than in the nav.

   It renders where the `tel:` link used to be on the tutor dashboard. Step 8 took
   the phone number away; this is what replaces it, and putting it in the same
   place is the point — otherwise the tutor just experiences a removal.

   student-space-v1 · G: it opens the PAIR's one conversation (/messages/with/<the
   other person>, contract C2), not this booking's thread. apps/api answers with
   the pair from the booking (POST /threads, idempotent against a UNIQUE
   booking_id, so a double-tap never forks anything). Immediate feedback: the
   button is disabled with a spinner from the first tap until the page changes.
   Where the other person's id is already known, a plain <MessageLink> (components/
   messages/MessageLink.tsx) does the same without the round trip. */

const copy = bilingual({
  fr: {
    label: "Message",
    opening: "Ouverture de la conversation…",
    /* A cancelled seat opens no NEW thread. Said plainly rather than shown as a
       generic failure, so the tutor understands it is a rule, not a bug. */
    errCancelled: "Cette réservation est annulée : on ne peut plus ouvrir de conversation.",
    errGeneric: "Impossible d'ouvrir la conversation. Réessaie.",
  },
  ar: {
    label: "راسل",
    opening: "قاعد يحلّ المحادثة…",
    errCancelled: "الحجز هذا تلغى: ما عادش تنجّم تحلّ محادثة.",
    errGeneric: "ما نجّمناش نحلّو المحادثة. عاود حاول.",
  },
});

export function MessageBookingButton({
  bookingId,
  className,
  style,
  ariaLabel,
}: {
  bookingId: string;
  className?: string;
  /* The student card sits on a dark panel where btn-ghost is invisible, so the
     caller supplies the same inline treatment its sibling Cancel button uses.
     Passed in rather than branched on here: this component should not have to
     know which surfaces are dark. */
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const router = useLocalizedRouter();
  const { locale } = useLocale();
  const c = copy[locale];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = (await openThread({ bookingId }).catch(() => null)) as
      | (Awaited<ReturnType<typeof openThread>> & { withId?: string })
      | null;
    if (res?.ok && res.withId) {
      router.push(conversationHref(res.withId));
      return; // leave `busy` set: the page is navigating away
    }
    setBusy(false);
    setErr(res?.error === "booking-cancelled" ? c.errCancelled : c.errGeneric);
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        aria-busy={busy}
        className={`${style ? (className ?? "") : (className ?? "btn btn-ghost btn-sm")} msg-link-btn`}
        style={style ? { ...style, display: "inline-flex", alignItems: "center", gap: 8 } : style}
        aria-label={ariaLabel ?? c.label}
        data-e2e="message-booking"
      >
        {busy ? <span className="msg-link-spin" aria-hidden="true" /> : null}
        <span>{c.label}</span>
      </button>
      {busy ? <span className="sr-only" role="status">{c.opening}</span> : null}
      {err && (
        <span role="alert" className="text-[12px]" style={{ color: "var(--rose)" }}>
          {err}
        </span>
      )}
    </>
  );
}
