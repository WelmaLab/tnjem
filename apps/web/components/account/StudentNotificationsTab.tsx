"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { Tag } from "@/components/ui";
import { Switch } from "@/components/app/Switch";
import { ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { getNotificationPrefs, saveNotificationPrefs, type NotificationPrefsResult } from "@/app/actions-growth";
import { bilingual } from "@/lib/i18n";

/* Profil › NOTIFICATIONS — student-space-v1 · F.

   Only the e-mails a STUDENT really receives today, each one checked in the code that
   sends it (every sender asks wantsEmail(), packages/db/src/notification-prefs.ts):
     « Réservations »  booking confirmed / cancelled / moved, with the .ics
                       (apps/api/src/lib/booking-mail.ts → "bookings")
     « Rappels »       24 h and 1 h before each class, the review prompt, the monthly
                       renewal reminder (reminders.ts, subscription-cron.ts → "reminders")
     « Profs suivis »  the daily digest of new classes and fiches from the profs the
                       student follows (follow-digest.ts → "followers")
   « Messages » is NOT sent by e-mail yet: « Bientôt », disabled and drawn OFF (the
   stored choice is never written from here). The bell is always on — prefs govern
   e-mail only — so it is shown on, and cannot be switched off. Each switch saves on its
   own and snaps back, with a message, if the server refused. */

const KEYS = ["bookings", "reminders", "followers", "messages"] as const;
type Key = (typeof KEYS)[number];
const SOON: ReadonlySet<Key> = new Set<Key>(["messages"]);
type Prefs = Extract<NotificationPrefsResult, { ok: true }>["prefs"];

const copy = bilingual({
  fr: {
    title: "E-mails",
    lead: "Choisis les e-mails que tu reçois.",
    soon: "Bientôt",
    rows: {
      bookings: ["Réservations", "La confirmation de chaque réservation (avec le fichier pour ton agenda), une annulation, une séance déplacée."],
      reminders: ["Rappels", "24 h puis 1 h avant chacune de tes séances, l'invitation à noter ton prof, le renouvellement de ton abonnement."],
      followers: ["Profs que tu suis", "Leurs nouvelles séances et fiches : un seul e-mail récapitulatif, au plus une fois par jour."],
      messages: ["Messages", "Pas encore envoyés par e-mail : tes nouveaux messages sont dans la cloche."],
    } as Record<Key, [string, string]>,
    bell: "La cloche",
    bellB: "Toujours active : tout ce qui te concerne y arrive, quels que soient tes e-mails.",
    saved: "Préférence enregistrée.",
    failed: "Ça n'a pas marché. Le réglage n'a pas changé.",
  },
  ar: {
    title: "الإيمايلات",
    lead: "اختار الإيمايلات اللي توصلك.",
    soon: "قريب",
    rows: {
      bookings: ["الحجوزات", "تأكيد كل حجز (مع الملف متاع الأجندة)، الإلغاء، والحصة كي يتبدّل وقتها."],
      reminders: ["التذكيرات", "24 ساعة ومن بعد ساعة قبل كل حصة، الدعوة باش تقيّم أستاذك، وتجديد الاشتراك متاعك."],
      followers: ["الأساتذة اللي تتابعهم", "حصصهم وملفاتهم الجديدة : إيمايل واحد يجمعهم، مرّة في النهار على الأكثر."],
      messages: ["الرسائل", "ما تتبعثش بالإيمايل لتوّا : الرسائل الجديدة تلقاها في الجرس."],
    } as Record<Key, [string, string]>,
    bell: "الجرس",
    bellB: "ديما خدّام : كل شي يهمّك يوصلو، مهما كانت الإيمايلات متاعك.",
    saved: "الإعداد تسجّل.",
    failed: "ما مشاتش. الإعداد ما تبدّلش.",
  },
});

export function StudentNotificationsTab() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
  const [prefs, setPrefs] = useState<Prefs | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<Key | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    getNotificationPrefs()
      .then((r) => setPrefs(r && r.ok ? r.prefs : null))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function flip(key: Key, next: boolean) {
    if (!prefs || busy || SOON.has(key)) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: next });
    setBusy(key);
    const res = await saveNotificationPrefs({ [key]: next }).catch(() => null);
    setBusy(null);
    if (!res?.ok) {
      setPrefs(before);
      showToast(c.failed);
      return;
    }
    setPrefs(res.prefs);
    showToast(c.saved);
  }

  if (failed || prefs === null) return <ErrorState onRetry={load} />;
  if (prefs === undefined) return <PageSkeleton rows={3} />;

  return (
    <section className="u-card st-card" aria-labelledby="ssv-mails" data-e2e="profile-notifications">
      <h2 id="ssv-mails" className="st-row-t">{c.title}</h2>
      <p className="st-row-b mb-1">{c.lead}</p>
      {KEYS.map((k) => {
        const soon = SOON.has(k);
        return (
          <div key={k} className={soon ? "st-row st-row-soon" : "st-row"} data-e2e={`pref-${k}`} data-soon={soon ? "true" : undefined}>
            <div className="min-w-0 flex-1">
              <div className="st-row-t st-row-t-tag">
                {c.rows[k][0]}
                {soon && <Tag kind="soon">{c.soon}</Tag>}
              </div>
              <p id={`ssv-pref-${k}-help`} className="st-row-b">{c.rows[k][1]}</p>
            </div>
            <Switch
              checked={soon ? false : prefs[k]}
              onChange={(v) => flip(k, v)}
              label={c.rows[k][0]}
              describedBy={`ssv-pref-${k}-help`}
              disabled={soon || busy === k}
            />
          </div>
        );
      })}
      <div className="st-row" data-e2e="pref-bell">
        <div className="min-w-0 flex-1">
          <div className="st-row-t">{c.bell}</div>
          <p id="ssv-pref-bell-help" className="st-row-b">{c.bellB}</p>
        </div>
        <Switch checked onChange={() => undefined} label={c.bell} describedBy="ssv-pref-bell-help" disabled />
      </div>
      {toast}
    </section>
  );
}
