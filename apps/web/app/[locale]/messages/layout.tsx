import { pageGuard } from "@/lib/page-guard";
import { TutorShellLayout } from "@/components/app/TutorShellLayout";

/* espace prof v2 · shell — /messages and /messages/[id] are SHARED: a tutor reads
   them inside the AppShell, a student exactly as before. REQUEST-TIME ONLY: the
   choice depends on who is asking (the proxy already requires a session here). */
export const dynamic = "force-dynamic";

export default async function MessagesLayout(props: { children: React.ReactNode }) {
  return <TutorShellLayout guard={await pageGuard()}>{props.children}</TutorShellLayout>;
}
