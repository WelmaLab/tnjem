import { pageGuard } from "@/lib/page-guard";
import { TutorShellLayout } from "@/components/app/TutorShellLayout";
import { StudentShellLayout } from "@/components/app/StudentShellLayout";

/* espace prof v2 · shell — /messages and everything under it are SHARED: a tutor
   reads them inside the AppShell, and (student-space-v1 · A) a student inside the
   StudentShell (ÉCHANGER › Messages). A guardian keeps the public frame. REQUEST-TIME
   ONLY: the choice depends on who is asking (the proxy already requires a session here). */
export const dynamic = "force-dynamic";

export default async function MessagesLayout(props: { children: React.ReactNode }) {
  const guard = await pageGuard();
  if (guard.kind === "user" && guard.profile.role === "student") {
    return <StudentShellLayout guard={guard}>{props.children}</StudentShellLayout>;
  }
  return <TutorShellLayout guard={guard}>{props.children}</TutorShellLayout>;
}
