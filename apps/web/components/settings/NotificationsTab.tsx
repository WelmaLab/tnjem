"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { Tag } from "@/components/ui";
import { Switch } from "@/components/app/Switch";
import { ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { getNotificationPrefs, saveNotificationPrefs, type NotificationPrefsResult } from "@/app/actions-growth";
import { bilingual } from "@/lib/i18n";

/* Réglages › Notifications — which e-mails the tutor gets (contract C5: the
   notification_prefs row, GET/PUT /me/notification-prefs, built by growth in
   phase 4). In-app notifications are not affected: the bell keeps everything.

   Each switch saves on its own, optimistically, and snaps back with a message if
   the server refused — a switch that says "off" must never mean "still on".

   TRUTH (the founder's rule), checked in the code: every Tnajem e-mail asks
   wantsEmail() (packages/db/src/notification-prefs.ts). What reaches a TUTOR today
   (apps/api/src/lib/booking-mail.ts, reminders — espace prof v2 · pro P7):
     « Réservations » → a booking or a cancellation in their class (with the .ics),
                        the confirmation when they cancel a class;
     « Rappels »      → 24 h and 1 h before each of their classes with a booking.
   « Messages » and « Abonnés » send a tutor NO e-mail (message e-mails are not built;
   the followers digest goes to the students who follow).

   live-fixes-1 · F1 — those two rows say « Bientôt » and their switch is DISABLED,
   rather than hidden: the tutor sees what is coming and that it is not on yet, and
   the switch still shows the choice that is stored (on by default) — the one that
   will apply the day those e-mails exist. Hiding them would make the list look
   complete; a working-looking switch that sends nothing was the confusion. */

const KEYS = ["bookings", "reminders", "messages", "followers"] as const;
type Key = (typeof KEYS)[number];
/** E-mails a tutor never receives today: shown « Bientôt », not switchable. */
const SOON: ReadonlySet<Key> = new Set<Key>(["messages", "followers"]);
type Prefs = Extract<NotificationPrefsResult, { ok: true }>["prefs"];

const copy = bilingual({
  fr: {
    title: "E-mails",
    lead: "Choisis les e-mails que tu reçois. La cloche reste toujours active.",
    soon: "Bientôt",
    rows: {
      bookings: ["Réservations", "Chaque réservation ou annulation dans tes séances, avec le fichier pour ton agenda."],
      reminders: ["Rappels", "24 h puis 1 h avant chacune de tes séances qui a un élève inscrit."],
      messages: ["Messages", "Pas encore envoyés par e-mail : les nouveaux messages sont dans la cloche."],
      followers: ["Abonnés", "Pas encore envoyés par e-mail : tes nouveaux abonnés sont dans la cloche."],
    } as Record<Key, [string, string]>,
    saved: "Préférence enregistrée.",
    failed: "Ça n'a pas marché. Le réglage n'a pas changé.",
  },
  ar: {
    title: "الإيمايلات",
    lead: "اختار الإيمايلات اللي توصلك. الجرس يقعد ديما خدّام.",
    soon: "قريب",
    rows: {
      bookings: ["الحجوزات", "كل حجز ولا إلغاء في حصصك، مع الملف متاع الأجندة."],
      reminders: ["التذكيرات", "24 ساعة ومن بعد ساعة قبل كل حصة من حصصك فيها تلميذ مسجّل."],
      messages: ["الرسائل", "ما تتبعثش بالإيمايل لتوّا : الرسائل الجديدة تلقاها في الجرس."],
      followers: ["المتابعين", "ما يتبعثوش بالإيمايل لتوّا : المتابعين الجدد تلقاهم في الجرس."],
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
  if (prefs === undefined) return <PageSkeleton rows={2} />;

  return (
    <section className="u-card st-card" aria-labelledby="st-mails" data-e2e="settings-notifications">
      <h2 id="st-mails" className="st-row-t">{c.title}</h2>
      <p className="st-row-b mb-1" data-e2e="prefs-not-yet">{c.lead}</p>
      {KEYS.map((k) => {
        const soon = SOON.has(k);
        return (
          <div key={k} className={`st-row${soon ? " st-row-soon" : ""}`} data-e2e={`pref-${k}`} data-soon={soon ? "true" : undefined}>
            <div className="min-w-0 flex-1">
              <div className="st-row-t st-row-t-tag">
                {c.rows[k][0]}
                {soon && <Tag kind="soon">{c.soon}</Tag>}
              </div>
              <p id={`pref-${k}-help`} className="st-row-b">{c.rows[k][1]}</p>
            </div>
            <Switch
              checked={prefs[k]}
              onChange={(v) => flip(k, v)}
              label={c.rows[k][0]}
              describedBy={`pref-${k}-help`}
              disabled={soon || busy === k}
            />
          </div>
        );
      })}
      {toast}
    </section>
  );
}
