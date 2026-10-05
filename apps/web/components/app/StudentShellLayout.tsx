import "server-only";
import type { ReactNode } from "react";
import type { PageGuard } from "@/lib/page-guard";
import { getStudentShell } from "@/app/actions-shell";
import { StudentShell } from "./StudentShell";

/* student-space-v1 · A — the server half of the StudentShell (contract C3), the
   sibling of TutorShellLayout. Role-aware: a STUDENT gets the shell; everybody else
   (guardian, guest, the build-time inert state) gets the page exactly as before. A
   tutor never reaches it — /student and /account send tutors to their own space, and
   /messages hands them the AppShell (app/[locale]/messages/layout.tsx).

   The shell's data is read here, on the server, so the first paint already carries
   the sidebar, the name and the « Mes cours » badge. */
export async function StudentShellLayout({ guard, children }: { guard: PageGuard; children: ReactNode }) {
  if (guard.kind !== "user" || guard.profile.role !== "student") return <>{children}</>;
  /* An API blip (or a 429) must not take the page down with it: the shell renders with
     what it knows (no name, no badge) and the page below still loads its own data. */
  const student = await getStudentShell().catch(() => null);
  return <StudentShell student={student}>{children}</StudentShell>;
}
