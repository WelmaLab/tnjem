import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { profiles, notifications } from "./schema";
import { smsEnabled, sendSms } from "@tnajem/shared/sms";
import { logEvent } from "@tnajem/shared/observability";
import {
  NOTIFICATION_KIND_OF, renderMessage, type NotificationKey, type NotificationParams,
} from "@tnajem/shared/notification-messages";

/* Lives in @tnajem/db, not in either app, because BOTH need it during the Step 4
   transition: reserveSeat and cancelBooking already run in apps/api, while
   createReview and the admin decisions still run in apps/web. A copy in each was
   the obvious move and the wrong one -- two implementations of a side-effecting
   function that nothing forces to agree is how the admin allowlist ended up
   tested in one place and running in another.

   It takes a db handle, exactly like retention.ts, so it belongs to whichever
   process calls it. No `server-only` marker: Fastify and tsx both load this. */

/** Any drizzle handle. Generic on purpose -- the schema type differs between the
    web client and the standalone one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type NotifyDb = PostgresJsDatabase<any>;

/* Notification dispatcher.

   In-app is the ALWAYS-ON channel: every notify() writes a `notifications` row,
   which the bell/list reads back. SMS is an optional second channel — only sent
   when an SMS provider is configured AND the caller supplies a short `sms` body
   (SMS costs money, so we don't text people for everything).

   Hard rule: notify() NEVER throws into its caller. A failed notification must
   not roll back a booking or a verification decision — we log and move on. */

/* A notification is a message KEY and its PARAMETERS (@tnajem/shared/
   notification-messages), never rendered text: the bell renders it in the reader's
   language, an SMS in the recipient's. The kind (what the UI files it under) follows
   from the key. */
export type NotifyInput<K extends NotificationKey = NotificationKey> = {
  key: K;
  params: NotificationParams[K];
  href?: string | null;
  /** The profile the parameters NAME (`who`), when that is not the recipient — so
      erasing that person can rewrite this row (packages/db/src/erasure.ts). */
  aboutProfileId?: string | null;
  /** Also text it, in the recipient's language, when an SMS provider is configured
      and the message has an SMS form. */
  sms?: boolean;
};

export async function notify<K extends NotificationKey>(
  db: NotifyDb,
  profileId: string,
  input: NotifyInput<K>,
): Promise<{ ok: boolean }> {
  if (!profileId) return { ok: false };
  const kind = NOTIFICATION_KIND_OF[input.key];
  if ((input.params as { who?: unknown }).who && !input.aboutProfileId) {
    // A name with no about_profile_id is a name erasure can never take back out.
    logEvent("warn", "notify_name_without_about", { kind });
  }
  try {
    await db.insert(notifications).values({
      profileId,
      kind,
      msgKey: input.key,
      msgParams: input.params,
      href: input.href ?? null,
      aboutProfileId: input.aboutProfileId ?? null,
    });

    if (input.sms && smsEnabled()) {
      const [p] = await db.select({ phone: profiles.phone, locale: profiles.locale }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
      const text = renderMessage(input.key, input.params, p?.locale === "ar" ? "ar" : "fr").sms;
      if (p?.phone && text) await sendSms(p.phone, text); // sendSms already swallows its own errors
    }
    return { ok: true };
  } catch (e) {
    // The kind and the error code: never the recipient, never the driver message.
    logEvent("error", "notify_failed", { kind, detail: (e as { code?: string }).code ?? (e as Error).name });
    return { ok: false };
  }
}

/* ---------- Phase 2: WhatsApp class reminders ----------
   Cadence (10-live-class-playbook.md): on-booking → T-24h → T-1h → T-5min.
   Still a stub — needs WHATSAPP_TOKEN + WHATSAPP_PHONE_ID and approved utility
   templates. The in-app "class_reminder" kind above is the channel that works today. */

export type ReminderStep = "booking" | "t24h" | "t1h" | "t5min";
export const REMINDER_CADENCE: ReminderStep[] = ["booking", "t24h", "t1h", "t5min"];

export type ReminderPayload = {
  toPhone: string;
  studentName: string;
  className: string;
  whenISO: string;
  joinUrl?: string;
  step: ReminderStep;
};

export async function sendClassReminder(payload: ReminderPayload): Promise<{ ok: boolean; stubbed: boolean }> {
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log("[Tnajem reminder — STUB]", payload.step); // never the phone number
  }
  return { ok: true, stubbed: true };
}
