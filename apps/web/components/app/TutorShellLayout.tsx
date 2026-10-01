import "server-only";
import type { ReactNode } from "react";
import type { PageGuard } from "@/lib/page-guard";
import { getTutorShell } from "@/app/actions-shell";
import { AppShell } from "./AppShell";

/* espace prof v2 · shell — the server half of the AppShell, used by every layout of
   the prof space (dashboard, onboarding, messages, account). Role-aware: a TUTOR
   gets the shell, everybody else (student, guardian, guest, the build-time inert
   state) gets the page exactly as it was — /messages and /account are shared with
   students. The shell's data is read here, on the server, so the first paint already
   carries the sidebar, the name and the verification badge. */
export async function TutorShellLayout({ guard, children }: { guard: PageGuard; children: ReactNode }) {
  if (guard.kind !== "user" || guard.profile.role !== "tutor") return <>{children}</>;
  /* An API blip must not take the page down with it: the shell renders with what it
     knows (no name, no badge) and the page below still loads its own data. */
  const shell = await getTutorShell().catch(() => null);
  return <AppShell shell={shell}>{children}</AppShell>;
}
