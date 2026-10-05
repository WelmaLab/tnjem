import "server-only";
import { pageGuard } from "@/lib/page-guard";

/* student-space-v1 · G — who reads /messages, for the empty state's way on (a
   student → Explore, a prof → Mes classes). Every decision about WHAT they may
   read stays in apps/api; this only picks the copy. Request-time (the messages
   layout is force-dynamic); the build-time inert render reads as a student. */
export async function messagesRole(): Promise<"student" | "tutor"> {
  const g = await pageGuard();
  return g.kind === "user" && g.profile.role === "tutor" ? "tutor" : "student";
}
