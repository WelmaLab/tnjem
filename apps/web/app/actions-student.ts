"use server";
/* Server actions — student-space-v1 · pages: the student's own space (Accueil,
   Mes cours, Mes profs, Mes fiches, Profil).

   Thin proxies to apps/api/src/routes/student-space.ts through lib/api.ts, under
   its five rules: every rule (session, the student role, the budget, what the
   student may see) is the API's, this file decides nothing, and nothing is retried.
   Demo mode (no API, dev only) answers with the empty state — never invented data. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { StudentClassDetail, StudentClasses, StudentHome, StudentProfs } from "@tnajem/shared";

/** A refusal from the student space: no session, not a student, or the budget. */
export type StudentSpaceError = { ok: false; error: string };

export type StudentHomeResult = ({ ok: true } & StudentHome) | StudentSpaceError;

const EMPTY_HOME: StudentHome = {
  firstName: "", next: null, week: [], profs: [], profsTotal: 0, newFiches: [], suggestions: [], suggestionsMatched: false,
};

/** Accueil (/student). */
export async function getStudentHome(): Promise<StudentHomeResult> {
  if (demoFallback) return { ok: true, ...EMPTY_HOME };
  return call<StudentHomeResult>("/student/home", undefined, "GET");
}

export type StudentClassesResult = ({ ok: true } & StudentClasses) | StudentSpaceError;
export type StudentClassDetailResult = ({ ok: true } & StudentClassDetail) | StudentSpaceError;

export type StudentProfsResult = ({ ok: true } & StudentProfs) | StudentSpaceError;

/** Mes profs (/student/profs): followed ∪ had-a-class, + the monthly subscriptions. */
export async function getStudentProfs(): Promise<StudentProfsResult> {
  if (demoFallback) return { ok: true, profs: [], subscriptions: [] };
  return call<StudentProfsResult>("/student/profs", undefined, "GET");
}

/** Mes cours (/student/cours): every booking, by tab. */
export async function getStudentClasses(): Promise<StudentClassesResult> {
  if (demoFallback) return { ok: true, ahead: [], past: [], cancelled: [] };
  return call<StudentClassesResult>("/student/classes", undefined, "GET");
}

/** One booking of the student: its fiches, their review, the prof's next class. */
export async function getStudentClass(bookingId: string): Promise<StudentClassDetailResult> {
  if (demoFallback || typeof bookingId !== "string" || !/^[0-9a-f-]{36}$/i.test(bookingId)) return { ok: false, error: "not-found" };
  return call<StudentClassDetailResult>(`/student/classes/${encodeURIComponent(bookingId)}`, undefined, "GET");
}
