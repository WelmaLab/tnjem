"use server";
/* Server actions — student-space-v1 · pages: the student's own space (Accueil,
   Mes cours, Mes profs, Mes fiches, Profil).

   Thin proxies to apps/api/src/routes/student-space.ts through lib/api.ts, under
   its five rules: every rule (session, the student role, the budget, what the
   student may see) is the API's, this file decides nothing, and nothing is retried.
   Demo mode (no API, dev only) answers with the empty state — never invented data. */
import { call } from "@/lib/api";
import { demoFallback } from "@/lib/backend";
import type { StudentHome } from "@tnajem/shared";

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
