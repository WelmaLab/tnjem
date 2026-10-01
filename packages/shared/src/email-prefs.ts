/* E-MAIL PREFERENCES — the vocabulary (Espace prof v2 · Phase 4 · contract C5).
   Pure, client-safe, in the barrel: Réglages › Notifications (shell P6) renders a
   switch per kind from this list, apps/api stores them (notification_prefs), and
   every mail sender asks packages/db/src/notification-prefs.ts::wantsEmail().

     followers  the daily digest of new classes and fiches from tutors you follow
     bookings   booking confirmations and cancellations (pro P7)
     messages   new messages in a booking thread
     reminders  class reminders (pro P7) and the monthly-subscription renewal reminder

   Only E-MAIL is governed here. In-app notifications (the bell) are always on.
   The default is ON for every kind — the behaviour every account had before the
   table existed; "no row" must never read as "unsubscribed". */
export const EMAIL_PREF_KINDS = ["followers", "bookings", "messages", "reminders"] as const;
export type EmailPrefKind = (typeof EMAIL_PREF_KINDS)[number];
export type NotificationPrefs = Record<EmailPrefKind, boolean>;

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  followers: true,
  bookings: true,
  messages: true,
  reminders: true,
};

export function isEmailPrefKind(raw: unknown): raw is EmailPrefKind {
  return typeof raw === "string" && (EMAIL_PREF_KINDS as readonly string[]).includes(raw);
}
