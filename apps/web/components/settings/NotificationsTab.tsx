"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { Switch } from "@/components/app/Switch";
import { ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { getNotificationPrefs, saveNotificationPrefs, type NotificationPrefsResult } from "@/app/actions-growth";
import { bilingual } from "@/lib/i18n";

/* Réglages › Notifications — which e-mails the tutor gets (contract C5: the
   notification_prefs row, GET/PUT /me/notification-prefs, built by growth in
   phase 4). In-app notifications are not affected: the bell keeps everything.

   Each switch saves on its own, optimistically, and snaps back with a message if
   the server refused — a switch that says "off" must never mean "still on". */

const KEYS = ["bookings", "messages", "reminders", "followers"] as const;
type Key = (typeof KEYS)[number];
type Prefs = Extract<NotificationPrefsResult, { ok: true }>["prefs"];

/* TRUTH (the founder's rule): every switch is stored and every Tnajem e-mail must
   ask it (packages/db/src/notification-prefs.ts::wantsEmail) — but today none of the
   four kinds is e-mailed to a TUTOR (the followers digest and the subscription
   reminder go to students; booking, message and class-reminder e-mails are not built
   yet). So the rows say what each switch governs, and the note says it plainly. */
const copy = bilingual({
  fr: {
    title: "E-mails",
    lead: "Choisis les e-mails que tu veux recevoir. Les notifications dans Tnajem (la cloche) restent toutes.",
    notYet: "Pour l'instant, Tnajem n'envoie encore aucun de ces e-mails à un prof : ton choix est enregistré et s'appliquera dès qu'ils existeront.",
    rows: {
      bookings: ["Réservations", "Les réservations et les annulations dans tes séances."],
      messages: ["Messages", "Les nouveaux messages dans la conversation d'une séance."],
      reminders: ["Rappels", "Les rappels avant tes séances."],
      followers: ["Abonnés", "Ce qui concerne le suivi des pages (« Suivre »)."],
    } as Record<Key, [string, string]>,
    saved: "Préférence enregistrée.",
    failed: "Ça n'a pas marché. Le réglage n'a pas changé.",
  },
  ar: {
    title: "الإيمايلات",
    lead: "اختار الإيمايلات اللي تحب توصلك. التنبيهات في Tnajem (الجرس) يقعدو الكل.",
    notYet: "لتوّا، Tnajem ما تبعث حتى إيمايل من هاذوما للأستاذ: الاختيار متاعك تسجّل ويتطبّق أوّل ما يوليو موجودين.",
    rows: {
      bookings: ["الحجوزات", "الحجوزات والإلغاءات في حصصك."],
      messages: ["الرسائل", "الرسائل الجديدة في محادثة حصة."],
      reminders: ["التذكيرات", "التذكيرات قبل حصصك."],
      followers: ["المتابعين", "اللي يخصّ متابعة الصفحات (« تابِع »)."],
    } as Record<Key, [string, string]>,
    saved: "الإعداد تسجّل.",
    failed: "ما مشاتش. الإعداد ما تبدّلش.",
  },
});

export function NotificationsTab() {
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
    if (!prefs || busy) return;
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
  if (prefs === undefined) return <PageSkeleton rows={2} />;

  return (
    <section className="u-card st-card" aria-labelledby="st-mails" data-e2e="settings-notifications">
      <h2 id="st-mails" className="st-row-t">{c.title}</h2>
      <p className="st-row-b">{c.lead}</p>
      <p className="st-row-b mb-1" data-e2e="prefs-not-yet">{c.notYet}</p>
      {KEYS.map((k) => (
        <div key={k} className="st-row" data-e2e={`pref-${k}`}>
          <div className="min-w-0 flex-1">
            <div className="st-row-t">{c.rows[k][0]}</div>
            <p id={`pref-${k}-help`} className="st-row-b">{c.rows[k][1]}</p>
          </div>
          <Switch checked={prefs[k]} onChange={(v) => flip(k, v)} label={c.rows[k][0]} describedBy={`pref-${k}-help`} disabled={busy === k} />
        </div>
      ))}
      {toast}
    </section>
  );
}
