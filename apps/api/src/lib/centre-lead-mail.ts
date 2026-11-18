import { CONTACT_EMAIL, LEVEL_LABELS, sortLevels } from "@tnajem/shared";
import { mailEnabled, sendMail } from "@tnajem/shared/mail";
import { logEvent } from "@tnajem/shared/observability";

/* december-sprint · B (D13) — the one notification mail per stored centre lead.

   Plain text, in French (it goes to the team's own mailbox, CONTACT_EMAIL), sent
   AFTER the lead is committed and never awaited by the request: the lead is the
   record, the mail is only a nudge. A mail failure is logged (what failed, never to
   whom) and loses nothing. With no mail provider configured sendMail() answers false
   at once and the lead is still stored.

   Tests swap the transport with setCentreLeadMailForTests() and wait for the
   fire-and-forget job with settleCentreLeadMail(), the booking-mail.ts pattern. */

export type CentreLeadMail = {
  id: string;
  name: string;
  centreName: string;
  city: string;
  phone: string;
  teachersCount: number | null;
  levels: readonly string[];
  message: string | null;
  locale: "fr" | "ar";
  page: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrer: string | null;
};

type Deliver = (to: string, subject: string, text: string) => Promise<boolean>;
let testDelivery: Deliver | null = null;
export function setCentreLeadMailForTests(fn: Deliver | null): void {
  testDelivery = fn;
}

/** A header must stay one line, whatever a visitor typed. */
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

export function centreLeadMailText(lead: CentreLeadMail): { subject: string; text: string } {
  const levels = sortLevels(lead.levels).map((c) => LEVEL_LABELS[c].fr).join(", ");
  const lines = [
    "Un centre a demandé une démo sur Tnajem.",
    "",
    `Nom : ${lead.name}`,
    `Centre : ${lead.centreName}`,
    `Ville : ${lead.city}`,
    `Téléphone / WhatsApp : ${lead.phone}`,
    `Nombre de profs : ${lead.teachersCount ?? "non indiqué"}`,
    `Niveaux : ${levels || "non indiqués"}`,
    `Langue de la page : ${lead.locale === "ar" ? "arabe" : "français"}`,
    "",
    "Message :",
    lead.message ?? "(aucun)",
    "",
    `Page : ${lead.page}`,
    `Source : ${[lead.utmSource, lead.utmMedium, lead.utmCampaign].filter(Boolean).join(" / ") || "directe"}`,
    `Référent : ${lead.referrer ?? "aucun"}`,
    "",
    "Répondre sous 24 heures. La liste complète : /fr/admin/leads",
    `Référence : ${lead.id}`,
  ];
  return { subject: oneLine(`Nouveau centre : ${lead.centreName} (${lead.city})`).slice(0, 180), text: lines.join("\n") };
}

const inflight = new Set<Promise<void>>();

/** Fire-and-forget. Never throws, never blocks the request. */
export function sendCentreLeadMail(lead: CentreLeadMail): void {
  const p = (async () => {
    try {
      const { subject, text } = centreLeadMailText(lead);
      const ok = await (testDelivery ?? sendMail)(CONTACT_EMAIL, subject, text);
      // false with no provider is the expected "not configured"; false with one is a failure.
      if (!ok && (testDelivery || mailEnabled())) logEvent("warn", "centre_lead_mail_failed", { lead: lead.id });
    } catch (e) {
      logEvent("error", "centre_lead_mail_failed", { lead: lead.id, detail: (e as { code?: string }).code ?? (e as Error).name });
    }
  })();
  inflight.add(p);
  void p.finally(() => inflight.delete(p));
}

/** Resolves once every dispatched lead mail has finished. */
export async function settleCentreLeadMail(): Promise<void> {
  while (inflight.size) await Promise.allSettled([...inflight]);
}
