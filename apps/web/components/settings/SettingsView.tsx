"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { getDashboard, getMe, getOnboardingState } from "@/app/actions";
import { AppPage, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import type { DashboardData, Me, OnboardingState } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { CompteTab } from "./CompteTab";
import { VitrineTab } from "./VitrineTab";
import { NotificationsTab } from "./NotificationsTab";
import { SecuriteTab } from "./SecuriteTab";
import { SETTINGS_TABS, type SettingsTab } from "./tabs";

/* espace prof v2 · shell (phase 6) — RÉGLAGES (/dashboard/settings), image 4.

   Four tabs, each addressable (?tab=compte|vitrine|notifications|securite) so a
   link can open the right one — the home checklist's « Ajouter ma photo » goes to
   ?tab=vitrine#photo, the new-class form's free-session link to ?tab=vitrine#free-first.

     Compte         who you are: name, address, language, role
     Vitrine        your public page: its address, photo, bio, « 1re séance offerte »
     Notifications  which e-mails you get (contract C5, growth phase 4)
     Sécurité       password and sessions (contract C8, auth phase 2), and closing the
                    account, with the legal detail folded into « Ce qui est effacé ▸ »

   A real tablist: arrow keys move between tabs (mirrored in Arabic), Home/End jump,
   and the selected tab is the only one in the tab order. /account sends a tutor here. */


const copy = bilingual({
  fr: {
    title: "Réglages",
    tabs: { compte: "Compte", vitrine: "Vitrine", notifications: "Notifications", securite: "Sécurité" } as Record<SettingsTab, string>,
    label: "Sections des réglages",
  },
  ar: {
    title: "الإعدادات",
    tabs: { compte: "الحساب", vitrine: "الواجهة", notifications: "الإشعارات", securite: "الأمان" } as Record<SettingsTab, string>,
    label: "أقسام الإعدادات",
  },
});

export type SettingsData = { me: Me | null; dash: DashboardData | null; state: OnboardingState | null };

export function SettingsView({ initialTab }: { initialTab: SettingsTab }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [data, setData] = useState<SettingsData | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([getMe(), getDashboard(), getOnboardingState()])
      .then(([me, dash, state]) => setData({ me, dash: dash && !("wrongRole" in dash) ? dash : null, state }))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // A deep link's #anchor (#photo, #free-first) lands once its tab has rendered.
  useEffect(() => {
    if (!data) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [data]);

  function select(next: SettingsTab, focus = false) {
    setTab(next);
    /* The URL follows the tab (shareable, survives a reload) without a server round
       trip: Next's router picks up history.replaceState. */
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
    if (focus) tabRefs.current[next]?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = SETTINGS_TABS.indexOf(tab);
    const fwd = locale === "ar" ? -1 : 1;
    const moves: Record<string, number> = {
      ArrowRight: i + fwd,
      ArrowLeft: i - fwd,
      Home: 0,
      End: SETTINGS_TABS.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const n = (moves[e.key] + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    select(SETTINGS_TABS[n], true);
  }

  return (
    <AppPage title={c.title} width="narrow">
      <div className="st-tabs" role="tablist" aria-label={c.label} onKeyDown={onKey} data-e2e="settings-tabs">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            id={`st-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`st-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className="st-tab"
            onClick={() => select(t)}
            data-e2e={`settings-tab-${t}`}
          >
            {c.tabs[t]}
          </button>
        ))}
      </div>

      <div id={`st-panel-${tab}`} role="tabpanel" aria-labelledby={`st-tab-${tab}`} className="st-panel" data-e2e={`settings-panel-${tab}`}>
        {failed ? (
          <ErrorState onRetry={load} />
        ) : !data ? (
          <PageSkeleton rows={3} />
        ) : tab === "compte" ? (
          <CompteTab data={data} />
        ) : tab === "vitrine" ? (
          <VitrineTab data={data} onChanged={load} />
        ) : tab === "notifications" ? (
          <NotificationsTab />
        ) : (
          <SecuriteTab />
        )}
      </div>
    </AppPage>
  );
}
