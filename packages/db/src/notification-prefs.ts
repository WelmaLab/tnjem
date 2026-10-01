import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import { notificationPrefs } from "./schema";
import { DEFAULT_NOTIFICATION_PREFS, type EmailPrefKind, type NotificationPrefs } from "@tnajem/shared";

/* E-MAIL PREFERENCES — the one reader and the one writer (Espace prof v2 · P4 ·
   contract C5). Lives in @tnajem/db, like notify.ts, because every process that
   sends mail needs it: the API's routes, the nightly jobs, and pro P7's booking
   and reminder e-mails. It takes a db handle so it belongs to whichever process
   calls it.

     if (await wantsEmail(db, profileId, "bookings")) await sendMail(...)

   NO ROW = EVERYTHING ON (DEFAULT_NOTIFICATION_PREFS). In-app notifications are
   not governed here — the bell is always on. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrefsDb = PostgresJsDatabase<any>;

export async function getNotificationPrefs(db: PrefsDb, profileId: string): Promise<NotificationPrefs> {
  const [row] = await db
    .select({
      followers: notificationPrefs.followers,
      bookings: notificationPrefs.bookings,
      messages: notificationPrefs.messages,
      reminders: notificationPrefs.reminders,
    })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.profileId, profileId))
    .limit(1);
  return row ? { ...row } : { ...DEFAULT_NOTIFICATION_PREFS };
}

/** Does this person want e-mail of this kind? A read failure answers NO: an e-mail
    we were not sure we were allowed to send is one we do not send. */
export async function wantsEmail(db: PrefsDb, profileId: string, kind: EmailPrefKind): Promise<boolean> {
  try {
    return (await getNotificationPrefs(db, profileId))[kind];
  } catch {
    return false;
  }
}

/** Upsert some kinds; the others keep their stored (or default) value. */
export async function setNotificationPrefs(
  db: PrefsDb,
  profileId: string,
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const next = { ...(await getNotificationPrefs(db, profileId)), ...patch };
  await db
    .insert(notificationPrefs)
    .values({ profileId, ...next, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: notificationPrefs.profileId, set: { ...patch, updatedAt: sql`now()` } });
  return next;
}
