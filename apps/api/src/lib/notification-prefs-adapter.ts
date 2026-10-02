/* THE BOOKING EMAILS ⇄ EMAIL PREFERENCES — one seam (espace prof v2 · phase 7).

   Contract C5 (growth, 0033): notification_prefs read through wantsEmail() in
   @tnajem/db, and the signed one-click unsubscribe link + RFC 8058 headers from
   @tnajem/shared/unsubscribe. Every booking email asks THIS file:
     • confirmations, cancellations, moves → "bookings"
     • the 24 h / 1 h reminders and the after-class review prompt → "reminders" */

import { wantsEmail } from "@tnajem/db";
import type { MailExtras } from "@tnajem/shared/mail";
import { listUnsubscribeHeaders, unsubscribeUrl } from "@tnajem/shared/unsubscribe";
import { db } from "../db";

export type MailPref = "bookings" | "reminders";

/** May this profile be emailed about `kind`? No stored row = yes (the C5 default);
    a failed read = no, wantsEmail's own rule: an email we were not sure we were
    allowed to send is one we do not send. */
export async function mayEmail(profileId: string, kind: MailPref): Promise<boolean> {
  return wantsEmail(db, profileId, kind);
}

/** The one-click unsubscribe link (footer) and List-Unsubscribe headers for this profile and kind. */
export async function unsubscribeFor(
  profileId: string,
  kind: MailPref,
): Promise<{ url: string; headers: NonNullable<MailExtras["headers"]> } | null> {
  return { url: unsubscribeUrl(profileId, kind), headers: listUnsubscribeHeaders(profileId, kind) };
}
