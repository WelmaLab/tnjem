"use server";
/* espace prof v2 · shell — the server actions of the tutor's own space (phase 1).
   Same rules as app/actions.ts (lib/api.ts's five rules): every decision lives in
   apps/api, these only forward the session; demo mode (no API, dev only) answers
   with the empty state, never with invented data. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { Storefront, TutorShell, TutorStudent, TutorVerifStatus } from "@tnajem/shared";
import type { StudentShellCounts, StudentShellInfo } from "@tnajem/shared"; // student-space-v1 · A

/** The AppShell's data (sidebar avatar card, plan label, verification badge). null = not a tutor / no session. */
export async function getTutorShell(): Promise<TutorShell | null> {
  if (demoFallback) return null;
  return call<TutorShell | null>("/tutor/shell", undefined, "GET");
}

/** CONTRACT C2 — the owner copied, shared or scanned their own link. Idempotent:
    the first call stamps tutors.link_shared_at, every later one is a no-op success.
    Growth's ShareSheet calls this on any share/copy/QR by the owner. Never throws:
    a failed stamp must not turn a successful copy into an error for the tutor. */
export async function markLinkShared(): Promise<{ ok: boolean; already?: boolean; error?: string }> {
  if (demoFallback) return { ok: true };
  try {
    return await call<{ ok: boolean; already?: boolean; error?: string }>("/tutor/link-shared", {});
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/** The two badges of the top bar. Never throws: a badge that cannot be read shows nothing. */
export async function getShellCounts(): Promise<{ notifications: number; messages: number }> {
  if (demoFallback) return { notifications: 0, messages: 0 };
  const [notes, msgs] = await Promise.all([
    call<{ read: boolean }[] | null>("/notifications", undefined, "GET").catch(() => null),
    call<{ count: number }>("/messages/unread-count", undefined, "GET").catch(() => null),
  ]);
  return {
    notifications: (notes ?? []).filter((n) => !n.read).length,
    messages: msgs?.count ?? 0,
  };
}

/** « Mes élèves ». null = not a tutor. */
export async function getMyStudents(): Promise<TutorStudent[] | null> {
  if (demoFallback) return [];
  return call<TutorStudent[] | null>("/tutor/students", undefined, "GET");
}

/** The owner preview of the caller's own page, whatever its status. null = no page / not a tutor. */
export async function getOwnerPreview(): Promise<{ storefront: Storefront; status: TutorVerifStatus; suspended: boolean } | null> {
  if (demoFallback) return null;
  return call("/tutor/preview", undefined, "GET");
}

/** Is `slug` the signed-in tutor's own page? For the « arrive bientôt » screen's owner check. */
export async function isMyPage(slug: string): Promise<boolean> {
  if (demoFallback || typeof slug !== "string" || !slug.trim()) return false;
  try {
    const shell = await getTutorShell();
    return Boolean(shell?.slug && shell.slug === slug.trim());
  } catch {
    return false;
  }
}

/* ── student-space-v1 · A — the StudentShell ──────────────────────────────────── */

/** The StudentShell's data (avatar card, « Mes cours » badge). null = not a student / no session. */
export async function getStudentShell(): Promise<StudentShellInfo | null> {
  if (demoFallback) return null;
  return call<StudentShellInfo | null>("/student/shell", undefined, "GET");
}

/** A `{ count }` answer as a count; anything else (an error, a route not deployed yet) is 0. */
function countOf(x: unknown): number {
  const n = (x as { count?: unknown } | null)?.count;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** CONTRACT C4 — every badge of the student shell. Never throws: a read that fails (an API
    blip, a 429, a route not deployed yet) shows no badge rather than a made-up number. */
export async function getStudentShellCounts(): Promise<StudentShellCounts> {
  if (demoFallback) return { notifications: 0, messages: 0, fiches: 0, upcoming: 0 };
  const [shell, fiches, notes, msgs] = await Promise.all([
    call<StudentShellInfo | null>("/student/shell", undefined, "GET").catch(() => null),
    call<{ count: number }>("/student/fiches/new-count", undefined, "GET").catch(() => null),
    call<{ read: boolean }[] | null>("/notifications", undefined, "GET").catch(() => null),
    call<{ count: number }>("/messages/unread-count", undefined, "GET").catch(() => null),
  ]);
  return {
    notifications: (Array.isArray(notes) ? notes : []).filter((n) => !n.read).length,
    messages: countOf(msgs),
    fiches: countOf(fiches),
    upcoming: countOf({ count: shell?.upcoming }),
  };
}
