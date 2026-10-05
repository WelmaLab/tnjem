"use client";
import { useMemo, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { EmptyState } from "@/components/app/AppShell";
import { Chat, Search } from "@/components/icons";
import { conversationHref, type ConversationSummary } from "@tnajem/shared";
import { msgCopy } from "./copy";
import { listTime } from "./format";

/* student-space-v1 · G — the left column of /messages (mockup 3b): one row per
   prof (or per student, on the prof's side), the last message, its time, the
   unread count. A pair with a seat and no message yet is a row too
   (« Écris le premier message ») — the empty state no longer lies to someone
   who has bookings. */

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

export function ConversationList({
  items,
  selectedId,
  role,
}: {
  items: ConversationSummary[];
  selectedId: string | null;
  /** Who is reading — decides the empty state's way on. */
  role: "student" | "tutor";
}) {
  const { locale } = useLocale();
  const c = msgCopy[locale];
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = fold(q.trim());
    return needle ? items.filter((it) => fold(it.withName ?? "").includes(needle)) : items;
  }, [items, q]);

  if (items.length === 0) {
    return (
      <div className="msg-list-empty" data-e2e="conv-empty">
        <EmptyState
          icon={<Chat />}
          title={c.emptyTitle}
          action={
            role === "tutor" ? (
              <Link href="/dashboard/classes" className="btn btn-ghost btn-sm">{c.classesCta}</Link>
            ) : (
              <Link href="/explore" className="btn btn-primary btn-sm">{c.exploreCta}</Link>
            )
          }
        >
          {role === "tutor" ? c.emptyTutor : c.emptyStudent}
        </EmptyState>
      </div>
    );
  }

  return (
    <>
      <div className="msg-search">
        <label htmlFor="msg-search" className="sr-only">{c.searchLabel}</label>
        <Search className="msg-search-ic" />
        <input
          id="msg-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={c.search}
          autoComplete="off"
        />
      </div>
      <nav aria-label={c.listLabel}>
        <ul className="msg-items" role="list" data-e2e="conv-list">
          {shown.map((it) => {
            const current = it.withId === selectedId;
            return (
              <li key={it.withId}>
                <Link
                  href={conversationHref(it.withId)}
                  className={`msg-item${current ? " is-current" : ""}`}
                  aria-current={current ? "page" : undefined}
                  data-e2e="conv-item"
                  data-with={it.withId}
                >
                  <span className="avatar msg-av" aria-hidden="true">{it.initials}</span>
                  <span className="msg-item-main">
                    <span className="msg-item-top">
                      <UserText className="msg-item-name">{it.withName ?? ""}</UserText>
                      {it.studentIsMinor && it.iAm === "tutor" ? <span className="msg-item-tag">{c.minor}</span> : null}
                    </span>
                    <span className={`msg-item-last${it.last ? "" : " is-first"}`}>
                      {it.last ? (
                        <>
                          {it.last.mine ? <span>{c.you} </span> : null}
                          <UserText>{it.last.body}</UserText>
                        </>
                      ) : (
                        c.firstMessage
                      )}
                    </span>
                  </span>
                  <span className="msg-item-end">
                    {it.last ? (
                      <time className="msg-item-time" dateTime={it.last.at}>{listTime(it.last.at, locale)}</time>
                    ) : null}
                    {it.unread > 0 ? (
                      <span className="msg-unread" data-e2e="conv-unread">
                        <span aria-hidden="true">{it.unread}</span>
                        <span className="sr-only">{c.unread(it.unread)}</span>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {shown.length === 0 ? <p className="msg-nomatch">{c.noMatch}</p> : null}
      </nav>
    </>
  );
}
