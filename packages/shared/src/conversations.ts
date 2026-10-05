/* student-space-v1 · G — ONE CONVERSATION PER PAIR (contract C2).

   The data model does not change: message_threads stays one row per BOOKING and
   the messaging gate stays booking-based (apps/api/src/routes/messages.ts). What
   changes is what a person READS: every thread between one student and one prof is
   shown as one conversation, in time order, with a small marker where each class's
   thread starts. Writing goes to the pair's most recent non-cancelled booking.

   The conversation's id in the URL (/messages/with/<id>) depends on who is reading:
     a STUDENT reads /messages/with/<tutors.id>
     a TUTOR   reads /messages/with/<the student's profiles.id>
   so each side addresses the OTHER person, never a booking or a thread.

   Names follow C8: a prof is « Walid T. », a student is first name + initial —
   both through publicTutorName on the API. No phone, no e-mail, anywhere. Pure. */

import type { ThreadStateShown } from "./types";

/** Who the caller is in the pair. */
export type ConversationRole = "student" | "tutor";

/** What the composer can do right now.
      open             the pair's most recent non-cancelled booking takes messages
      no-open-booking  nothing to write into: no seat, or the last class ended
                       THREAD_CLOSE_DAYS ago, or it was cancelled — book again to write
      closed           closed for a reason nobody is told (blocked, consent withdrawn) */
export type ConversationState = "open" | "no-open-booking" | "closed";

/** One row of /messages: one per pair, even with no message yet. */
export type ConversationSummary = {
  /** The OTHER person: tutors.id for a student reader, the student's profiles.id for a tutor reader. */
  withId: string;
  withName: string | null;
  initials: string;
  /** The prof's subject (stored code or text), shown to a student; null for a tutor reader. */
  subject: string | null;
  iAm: ConversationRole;
  studentIsMinor: boolean;
  /** The newest message of any thread of the pair; null = « Écris le premier message ». */
  last: { body: string; at: string; mine: boolean } | null;
  /** For ordering: the last message, or the newest booking of the pair. ISO. */
  activityAt: string;
  /** The other side's messages after this side last opened the conversation. */
  unread: number;
};

/** The class a conversation's header points at. */
export type ConversationClass = {
  classId: string;
  title: string;
  startsAt: string; // ISO
  /** true = the student holds a seat in it; false = the prof's next class on sale. */
  booked: boolean;
};

export type ConversationMessage = {
  id: string;
  threadId: string;
  mine: boolean;
  /** PLAIN TEXT, exactly as typed. Never render through dangerouslySetInnerHTML. */
  body: string;
  masked: boolean;
  at: string; // ISO
};

/** One booking's thread, for the « Séance « titre » · date » markers. */
export type ConversationThread = {
  threadId: string;
  classId: string;
  classTitle: string;
  classTs: number; // epoch ms of the class start
};

export type ConversationDetail = {
  withId: string;
  withName: string | null;
  initials: string;
  iAm: ConversationRole;
  /** The prof's subject (student reader); null for a tutor reader. */
  subject: string | null;
  /** The prof's public page (student reader), when it is public. */
  tutorSlug: string | null;
  studentIsMinor: boolean;
  /** Header « prochaine séance » — and, when nothing is open, the class to book. */
  nextClass: ConversationClass | null;
  state: ConversationState;
  /** Why the target thread is closed, as a participant may be told it (ThreadStateShown). */
  closedReason: ThreadStateShown | null;
  threads: ConversationThread[];
  /** Every message of every thread of the pair, oldest first. */
  messages: ConversationMessage[];
};

/** Where each class's thread starts in the merged flow: the index of every message
    whose thread differs from the one before it (the first message included). A
    thread whose messages are interleaved with another's gets a marker each time it
    comes back, so a message is never shown under the wrong class. */
export function threadMarkerIndexes(messages: Pick<ConversationMessage, "threadId">[]): Set<number> {
  const out = new Set<number>();
  messages.forEach((m, i) => {
    if (i === 0 || messages[i - 1].threadId !== m.threadId) out.add(i);
  });
  return out;
}

/** The conversation's URL for a reader. Locale-bare (the web prefixes it). */
export function conversationHref(withId: string): string {
  return `/messages/with/${encodeURIComponent(withId)}`;
}

/** A one-line preview of a message for the list. */
export function messagePreview(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}
