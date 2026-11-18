/* THE SUPPORT CONTACT, IN ONE FILE (phase-a lane L1, A12 — decision D5; december-sprint · S, gate 2).

   WHATSAPP. The "Aide & support" row on /account shipped as a placeholder wa.me link
   to a number nobody owns (CEO report, finding 16). Support is InnoviaBurst's
   business number, and it is NEVER hard-coded: it comes from
   NEXT_PUBLIC_SUPPORT_WHATSAPP (the ONE source — founder decision at the december
   gate: no constant), written the way wa.me wants it — country code and number,
   DIGITS ONLY, no "+", no spaces. Anything else (unset, empty, a placeholder with
   letters, a stray "+") returns null and EVERY WhatsApp element is not rendered
   at all: a support link that opens a chat with nobody is worse than no link.

   The footer, /aide, /account and /pour-les-centres all go through
   supportWhatsAppHref(), so they appear and disappear together.

   THE E-MAIL ADDRESS and THE SUPPORT HOURS are plain constants: they are not
   secrets and do not change per environment. */

const WA_DIGITS = /^\d{8,15}$/; // E.164 allows at most 15 digits

/** `https://wa.me/<digits>` when the configured number is valid, otherwise null.
    With `message`, the chat opens with that text prefilled (`?text=`). */
export function supportWhatsAppHref(raw: string | null | undefined, message?: string): string | null {
  const digits = (raw ?? "").trim();
  if (!WA_DIGITS.test(digits)) return null;
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}

/** The public contact mailbox (footer, centre waitlist, lead notifications). It must exist. */
export const CONTACT_EMAIL = "contact@tnajem.com";

/** When a person answers on WhatsApp and by e-mail. */
export const SUPPORT_HOURS = {
  fr: "Lundi à samedi, 9h à 20h",
  ar: "من الاثنين للسبت، من 9 متاع الصباح لـ 8 متاع الليل",
} as const;

/** The text a WhatsApp chat opens with, in the page's language. */
export const SUPPORT_WHATSAPP_MESSAGE = {
  fr: "Bonjour Tnajem, j'ai une question.",
  ar: "عسلامة Tnajem، عندي سؤال.",
} as const;
