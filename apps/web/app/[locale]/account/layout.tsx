import { pageGuard } from "@/lib/page-guard";
import { TutorShellLayout } from "@/components/app/TutorShellLayout";

/* espace prof v2 · shell — /account is SHARED: it is « Réglages » in the AppShell
   for a tutor (until phase 6 moves tutors to /dashboard/settings), and the same
   page as before for a student or a parent. REQUEST-TIME ONLY: the choice depends
   on who is asking (the proxy already requires a session here). */
export const dynamic = "force-dynamic";

export default async function AccountLayout(props: { children: React.ReactNode }) {
  return <TutorShellLayout guard={await pageGuard()}>{props.children}</TutorShellLayout>;
}
