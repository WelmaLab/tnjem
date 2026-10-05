import { MessagesView } from "@/components/messages/MessagesView";
import { messagesRole } from "@/components/messages/role";

/* student-space-v1 · G — ONE CONVERSATION WITH ONE PERSON (contract C2).
   <id> is the other person: tutors.id when a student reads, the student's
   profiles.id when a prof reads. apps/api decides whether the caller may open it
   (GET /conversations/:withId); anything else reads as « n'existe pas ». */
export default async function ConversationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const role = await messagesRole();
  return <MessagesView withId={id} role={role} />;
}
