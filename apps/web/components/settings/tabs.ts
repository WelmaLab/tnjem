/* The tabs of Réglages (/dashboard/settings?tab=…). A plain module, not "use client":
   the server page validates ?tab= against it. */
export const SETTINGS_TABS = ["compte", "vitrine", "notifications", "securite"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];
