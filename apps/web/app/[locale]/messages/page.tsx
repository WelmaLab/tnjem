import { MessagesView } from "@/components/messages/MessagesView";
import { messagesRole } from "@/components/messages/role";

/* THE INBOX — student-space-v1 · G: one conversation per person, not per class.

   There is still no "new message" button anywhere, by design: a conversation
   exists only where a booking does (apps/api/src/routes/messages.ts). What changed
   is that EVERY booking pair is listed — with « Écris le premier message » until
   someone writes — so a student with seats is never told « pas encore de
   conversation ». The list and the conversation are components/messages/. */
export default async function MessagesPage() {
  const role = await messagesRole();
  return <MessagesView role={role} />;
}
