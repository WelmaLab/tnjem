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

/* TRUTH (the founder's rule): every switch is stored and every Tnajem e-mail asks
   it (packages/db/src/notification-prefs.ts::wantsEmail). What reaches a TUTOR today
   (espace prof v2 · pro P7 — apps/api/src/lib/booking-mail.ts and reminders.ts):
     « Réservations » → a new booking in their class (with the .ics), a student's
                        cancellation, the confirmation when they cancel a class;
     « Rappels »      → 24 h and 1 h before each of their classes with a booking.
   « Messages » and « Abonnés » send a tutor no e-mail yet (message e-mails are not
   built; the followers digest goes to students) — the rows and the note say so. */
const copy = bilingual({
  fr: {
    title: "E-mails",
    lead: "Choisis les e-mails que tu veux recevoir. Les notifications dans Tnajem (la cloche) restent toutes.",
    notYet: "« Réservations » et « Rappels » t'envoient déjà des e-mails. « Messages » et « Abonnés » n'en envoient pas encore à un prof : ton choix est enregistré et s'appliquera s'ils arrivent.",
    rows: {
      bookings: ["Réservations", "Un e-mail à chaque réservation et à chaque annulation dans tes séances, et quand tu annules une séance (avec le fichier pour ton calendrier)."],
      messages: ["Messages", "Les nouveaux messages dans la conversation d'une séance. Pas encore envoyés par e-mail : ils sont dans la cloche."],
      reminders: ["Rappels", "Un e-mail 24 h puis 1 h avant chacune de tes séances qui a au moins un élève inscrit."],
      followers: ["Abonnés", "Le suivi de ta page (« Suivre »). Pas encore d'e-mail pour un prof : tes nouveaux abonnés sont dans la cloche."],
    } as Record<Key, [string, string]>,
    saved: "Préférence enregistrée.",
    failed: "Ça n'a pas marché. Le réglage n'a pas changé.",
  },
  ar: {
    title: "الإيمايلات",
    lead: "اختار الإيمايلات اللي تحب توصلك. التنبيهات في Tnajem (الجرس) يقعدو الكل.",
    notYet: "« الحجوزات » و« التذكيرات » يبعثولك إيمايلات من توّا. « الرسائل » و« المتابعين » ما يبعثو حتى إيمايل للأستاذ لتوّا : الاختيار متاعك تسجّل ويتطبّق كان يوليو موجودين.",
    rows: {
      bookings: ["الحجوزات", "إيمايل مع كل حجز وكل إلغاء في حصصك، وكي تلغي إنت حصة (مع الملف متاع الأجندة)."],
      messages: ["الرسائل", "الرسائل الجديدة في محادثة حصة. ما تتبعثش بالإيمايل لتوّا : تلقاها في الجرس."],
      reminders: ["التذكيرات", "إيمايل 24 ساعة ومن بعد ساعة قبل كل حصة من حصصك فيها على الأقل تلميذ مسجّل."],
      followers: ["المتابعين", "متابعة صفحتك (« تابِع »). ما فماش إيمايل للأستاذ لتوّا : المتابعين الجدد تلقاهم في الجرس."],
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
