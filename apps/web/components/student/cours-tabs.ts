/* The tabs of « Mes cours » (/student/cours?tab=…). A plain module, not "use client":
   the server page validates ?tab= against it. */
export const COURS_TABS = ["avenir", "passees", "annulees"] as const;
export type CoursTab = (typeof COURS_TABS)[number];

export function coursTab(raw: unknown): CoursTab {
  return typeof raw === "string" && (COURS_TABS as readonly string[]).includes(raw) ? (raw as CoursTab) : "avenir";
}
