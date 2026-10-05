import { redirect } from "next/navigation";
import { conversationHref } from "@tnajem/shared";
import { conversationOfThread } from "@/app/actions-messages";
import { localeOf, localePath } from "@/lib/page-guard";
import { MessagesView } from "@/components/messages/MessagesView";
import { messagesRole } from "@/components/messages/role";

/* /messages/<threadId> — student-space-v1 · G. A thread is one booking of a pair;
   it is READ as the pair's one conversation now. Old links (the « Message »
   buttons, every bell item and e-mail sent before) land here and are sent on to
   /messages/with/<the other person>. Someone who is not in the thread gets the
   same « n'existe pas » as before — the API never says which ids exist. */
export default async function ThreadRedirect(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const conv = await conversationOfThread(id).catch(() => null);
  if (conv?.withId) redirect(localePath(localeOf(locale), conversationHref(conv.withId)));
  const role = await messagesRole();
  return <MessagesView withId={id} role={role} />;
}
