/* The tabs of the student's Profil (/account?tab=…). A plain module, not "use client":
   the server page validates ?tab= against it. */
export const PROFILE_TABS = ["moi", "notifications", "securite"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function profileTab(raw: unknown): ProfileTab {
  return typeof raw === "string" && (PROFILE_TABS as readonly string[]).includes(raw) ? (raw as ProfileTab) : "moi";
}
