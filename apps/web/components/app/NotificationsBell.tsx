"use client";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/components/Link";
import { Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Bell } from "@/components/icons";
import { getNotifications, markNotificationsRead } from "@/app/actions";
import type { NotificationItem } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the top bar's bell, on the existing `notifications`
   table (GET /notifications, POST /notifications/read). Moved here from the old
   dashboard header so every prof page has it.

   Opening the panel refreshes the list, then marks the unread ones read
   server-side. The per-item dots stay for THIS opening, so the tutor can still see
   what was new; the badge drops at once.

   A plain disclosure, not role="menu": a menu promises menuitem children and
   arrow-key roving focus, and this is a scrollable list of links. */

const copy = bilingual({
  fr: {
    title: "Notifications",
    empty: "Rien de neuf pour l'instant.",
    unread: (n: number) => (n === 1 ? "1 non lue" : `${n} non lues`),
    justNow: "à l'instant",
    minsAgo: (n: number) => `il y a ${n} min`,
    hoursAgo: (n: number) => `il y a ${n} h`,
    daysAgo: (n: number) => `il y a ${n} j`,
  },
  ar: {
    title: "الإشعارات",
    empty: "ما فماش جديد توّا.",
    unread: (n: number) => `${n} موش مقروية`,
    justNow: "توّا",
    minsAgo: (n: number) => `هاذي ${n} دقيقة`,
    hoursAgo: (n: number) => `هاذي ${n} ساعة`,
    daysAgo: (n: number) => `هاذي ${n} يوم`,
  },
});

type CopyDict = (typeof copy)["fr"] | (typeof copy)["ar"];

// Relative time. Client-only (the list arrives after a click) → no hydration risk.
function timeAgo(iso: string, c: CopyDict): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return c.justNow;
  if (mins < 60) return c.minsAgo(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return c.hoursAgo(hours);
  return c.daysAgo(Math.floor(hours / 24));
}

export function NotificationsBell({ unread, onRead }: { unread: number; onRead: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // The list is rendered in the page's language: switching FR/ع invalidates it.
  useEffect(() => {
    setItems(null);
    setOpen(false);
  }, [locale]);

  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const fresh = await getNotifications(locale).catch(() => [] as NotificationItem[]);
    setItems(fresh);
    if (fresh.some((n) => !n.read)) {
      await markNotificationsRead().catch(() => {});
      onRead();
    }
  }

  return (
    <div ref={wrapRef} className="aps-pop-wrap">
      <button
        ref={btnRef}
        type="button"
        className="aps-tool"
        aria-label={unread > 0 ? `${c.title} · ${c.unread(unread)}` : c.title}
        aria-expanded={open}
        aria-controls="aps-bell-panel"
        onClick={toggle}
        data-e2e="shell-bell"
      >
        <Bell />
        {unread > 0 && (
          <span className="aps-count" aria-hidden="true" data-e2e="shell-bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div id="aps-bell-panel" className="aps-pop aps-bell-panel" aria-label={c.title} role="region">
          <div className="aps-pop-title">{c.title}</div>
          {items === null ? (
            <div className="grid place-items-center p-6">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <p className="aps-pop-empty">{c.empty}</p>
          ) : (
            <ul className="aps-notes">
              {items.map((n) => {
                const inner = (
                  <>
                    <span className={`aps-note-dot${n.read ? "" : " is-new"}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      {/* Rendered by the API in this page's language. A row stored
                          before 0040 is still French (lang "fr"): its direction is set
                          from its language, so its punctuation and « » stay in place
                          inside the Arabic panel. */}
                      <span lang={n.lang} dir={n.lang === "ar" ? "rtl" : "ltr"} className="block text-[13.5px] font-bold text-ink">{n.title}</span>
                      <span lang={n.lang} dir={n.lang === "ar" ? "rtl" : "ltr"} className="block text-[13px] text-ink2 leading-[1.5] mt-0.5">{n.body}</span>
                      <span className="block text-[13px] text-muted mt-1">{timeAgo(n.createdAt, c)}</span>
                    </span>
                  </>
                );
                return (
                  <li key={n.id}>
                    {n.href ? (
                      <Link href={n.href} className={`aps-note${n.read ? "" : " is-new"}`} onClick={() => setOpen(false)}>
                        {inner}
                      </Link>
                    ) : (
                      <div className={`aps-note${n.read ? "" : " is-new"}`}>{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
