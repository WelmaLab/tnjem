"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { AppPage, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { getMe, getStudentPrefill } from "@/app/actions";
import { displayName, formatPhone, initialsOfName, type Me } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { ProfileMoiTab, type MoiInitial } from "./ProfileMoiTab";
import { StudentNotificationsTab } from "./StudentNotificationsTab";
import { AccountSecurityTab } from "./AccountSecurityTab";
import { PROFILE_TABS, type ProfileTab } from "./profile-tabs";

/* PROFIL (/account) — student-space-v1 · F (mockup 4a).

   A student gets three tabs, each addressable (?tab=moi|notifications|securite, C1):
     Moi            name, level, subjects, phone — editable (ProfileMoiTab)
     Notifications  the e-mails a student really receives; the bell, always on
     Sécurité       language, role, password, sessions, « Déconnecter partout »,
                    closing the account (AccountSecurityTab)
   A real tablist (arrows mirrored in Arabic, Home/End). Above the tabs, who is signed
   in: the initials, the name and the login address — never shown to a prof.
   A parent (guardian) has no student profile: they get the Sécurité content alone.
   A tutor never sees this page: account/layout.tsx sends them to Réglages. */

const copy = bilingual({
  fr: {
    title: "Mon profil",
    titleGuardian: "Mon compte",
    tabs: { moi: "Moi", notifications: "Notifications", securite: "Sécurité" } as Record<ProfileTab, string>,
    label: "Sections du profil",
    seen: "Ton prof voit ton prénom seulement.",
  },
  ar: {
    title: "البروفايل متاعي",
    titleGuardian: "حسابي",
    tabs: { moi: "أنا", notifications: "الإشعارات", securite: "الأمان" } as Record<ProfileTab, string>,
    label: "أقسام البروفايل",
    seen: "أستاذك يشوف إسمك الأول برك.",
  },
});

export function ProfileView({ initialTab }: { initialTab: ProfileTab }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [prefill, setPrefill] = useState<MoiInitial | null>(null);
  const [failed, setFailed] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([getMe(), getStudentPrefill().catch(() => null)])
      .then(([m, p]) => {
        setMe(m);
        setPrefill(p ?? { fullName: m?.name ?? null, level: null, subjects: null, phone: m?.phone ?? null });
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  function select(next: ProfileTab, focus = false) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url.toString());
    if (focus) tabRefs.current[next]?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const i = PROFILE_TABS.indexOf(tab);
    const fwd = locale === "ar" ? -1 : 1;
    const moves: Record<string, number> = { ArrowRight: i + fwd, ArrowLeft: i - fwd, Home: 0, End: PROFILE_TABS.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(PROFILE_TABS[(moves[e.key] + PROFILE_TABS.length) % PROFILE_TABS.length], true);
  }

  const student = me?.role === "student";
  const name = displayName(me?.name) || "—";

  const identity = me ? (
    <div className="ssv-id" data-e2e="profile-identity">
      <span className="ssv-id-av" aria-hidden="true">{initialsOfName(me.name) || "·"}</span>
      <div className="min-w-0">
        <div className="st-id-name"><UserText>{name}</UserText></div>
        {/* The login identity — what they type to get back in. The phone is optional.
            Isolated left-to-right, but aligned with the page (start). */}
        {me.email ? <div className="st-id-contact"><span dir="ltr">{me.email}</span></div> : null}
        {me.phone ? <div className="st-id-contact"><span dir="ltr">{formatPhone(me.phone)}</span></div> : null}
        {student ? <div className="ssv-muted">{c.seen}</div> : null}
      </div>
    </div>
  ) : null;

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (me === undefined) body = <PageSkeleton rows={3} />;
  else if (!student) {
    body = (
      <div className="st-stack">
        {identity}
        <AccountSecurityTab me={me} tabbed={false} />
      </div>
    );
  } else {
    body = (
      <>
        {identity}
        <div className="st-tabs ssv-tabs" role="tablist" aria-label={c.label} onKeyDown={onKey} data-e2e="profile-tabs">
          {PROFILE_TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              id={`ssv-ptab-${t}`}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={`ssv-ppanel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className="st-tab"
              onClick={() => select(t)}
              data-e2e={`profile-tab-${t}`}
            >
              {c.tabs[t]}
            </button>
          ))}
        </div>
        <div id={`ssv-ppanel-${tab}`} role="tabpanel" aria-labelledby={`ssv-ptab-${tab}`} className="st-panel">
          {tab === "moi" && prefill ? (
            <ProfileMoiTab initial={prefill} onSaved={(fullName) => setMe((m) => (m ? { ...m, name: fullName } : m))} />
          ) : tab === "notifications" ? (
            <StudentNotificationsTab />
          ) : (
            <AccountSecurityTab me={me} />
          )}
        </div>
      </>
    );
  }

  return (
    <AppPage title={me && !student ? c.titleGuardian : c.title} width="narrow">
      {body}
    </AppPage>
  );
}
