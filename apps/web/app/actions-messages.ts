"use server";
/* student-space-v1 · G — the server actions of the merged conversations (one per
   student–prof pair, contract C2). Same rules as app/actions.ts: every decision lives
   in apps/api (routes/messages.ts → lib/conversations.ts); these only forward the
   session. Demo mode (no API, dev only) answers with the empty state, never with
   invented data. Message bodies come back as PLAIN TEXT: render them as text. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import { isUuid, type ConversationDetail, type ConversationSummary } from "@tnajem/shared";

/** /messages — one row per pair, a pair with no message included. null = no session / not a student or tutor. */
export async function getConversations(): Promise<ConversationSummary[] | null> {
  if (demoFallback) return [];
  return call<ConversationSummary[] | null>("/conversations", undefined, "GET");
}

/** /messages/with/<withId> — reading it marks it read. null = not a conversation this caller may open. */
export async function getConversation(withId: string): Promise<ConversationDetail | null> {
  if (demoFallback || !isUuid(withId)) return null;
  return call<ConversationDetail | null>(`/conversations/${encodeURIComponent(withId)}`, undefined, "GET");
}

export type ConversationSendResult = {
  ok: boolean;
  error?: string;
  demo?: boolean;
  id?: string;
  threadId?: string;
  body?: string;
  at?: string;
  /** True when contact details were removed — the UI must SAY so. */
  masked?: boolean;
};

/** Write to the pair: the API picks the booking (its most recent non-cancelled one). */
export async function sendToConversation(input: { withId: string; body: string }): Promise<ConversationSendResult> {
  if (demoFallback) return { ok: true, demo: true };
  if (!isUuid(input.withId) || typeof input.body !== "string") return { ok: false, error: "not-found" };
  return call<ConversationSendResult>(`/conversations/${encodeURIComponent(input.withId)}/messages`, { body: input.body });
}

/** /messages/<threadId> (old links, old bell items) → the pair's conversation id, or null. */
export async function conversationOfThread(threadId: string): Promise<{ withId: string } | null> {
  if (demoFallback || !isUuid(threadId)) return null;
  return call<{ withId: string } | null>(`/threads/${encodeURIComponent(threadId)}/conversation`, undefined, "GET");
}
