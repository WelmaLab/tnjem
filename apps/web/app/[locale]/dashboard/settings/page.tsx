import { SettingsView } from "@/components/settings/SettingsView";
import { SETTINGS_TABS, type SettingsTab } from "@/components/settings/tabs";

/* /dashboard/settings — « Réglages » (espace prof v2 · phase 6, image 4). The tab
   comes from ?tab= so every tab is linkable; an unknown value opens « Compte ». */
export default async function SettingsPage(props: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const raw = (await props.searchParams).tab;
  const tab = (SETTINGS_TABS as readonly string[]).includes(String(raw)) ? (raw as SettingsTab) : "compte";
  return <SettingsView initialTab={tab} />;
}
