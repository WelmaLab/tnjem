"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { SiteShell } from "@/components/SiteShell";
import { Spinner } from "@/components/ui";
import { ErrorState, useShell } from "@/components/app/AppShell";
import { getConversation, getConversations } from "@/app/actions-messages";
import type { ConversationDetail, ConversationSummary } from "@tnajem/shared";
import { ConversationList } from "./ConversationList";
import { ConversationPane } from "./ConversationPane";
import { msgCopy } from "./copy";

/* student-space-v1 · G — /messages and /messages/with/<id> (mockup 3b).

   ONE COMPONENT, TWO SCREENS ON A PHONE. On a computer the list and the open
   conversation sit side by side. Below 900px each is its own screen: /messages is
   the list, /messages/with/<id> the conversation with a back arrow — the CSS
   (.msg-page[data-open]) hides the other column, the URL decides which.

   Shared by both roles: a student reads one conversation per prof, a prof one per
   student. Inside a shell (the prof's AppShell, the student shell) the page sits in
   its main column; anywhere else in the public frame. */

const POLL_MS = 20_000;

export function MessagesView({ withId = null, role = "student" }: { withId?: string | null; role?: "student" | "tutor" }) {
  const { locale } = useLocale();
  const c = msgCopy[locale];
  const shell = useShell();
  const setCrumbs = shell?.setCrumbs;
  const refreshCounts = shell?.refreshCounts;

  const [items, setItems] = useState<ConversationSummary[] | null | undefined>(undefined);
  const [conv, setConv] = useState<ConversationDetail | null | undefined>(withId ? undefined : null);
  const [failed, setFailed] = useState(false);

  const loadList = useCallback(async () => {
    try {
      setItems((await getConversations()) ?? []);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  const loadConv = useCallback(async () => {
    if (!withId) return;
    const d = await getConversation(withId).catch(() => null);
    setConv(d);
    // Opening it read it: the list's count and the shell's badge drop with it.
    if (d) setItems((prev) => prev?.map((it) => (it.withId === withId ? { ...it, unread: 0 } : it)));
    refreshCounts?.();
  }, [withId, refreshCounts]);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    setConv(withId ? undefined : null);
    void loadConv();
  }, [withId, loadConv]);

  /* A light poll while the tab is visible, so a reply shows up without a reload.
     Reading moves the read mark — the person is looking at it. */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadList();
      void loadConv();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadList, loadConv]);

  // Inside a shell the top bar reads « Messages › Walid T. ».
  const withName = conv?.withName ?? null;
  useEffect(() => {
    if (!setCrumbs || !withName) return;
    setCrumbs([{ label: c.crumb, href: "/messages" }, { label: withName }]);
    return () => setCrumbs(null);
  }, [setCrumbs, withName, c.crumb]);

  const afterSend = useCallback(async () => {
    await Promise.all([loadConv(), loadList()]);
  }, [loadConv, loadList]);


  const page = (
    <div className="msg-page" data-open={withId ? "" : undefined} data-e2e="messages">
      <h1 className="sr-only">{c.title}</h1>
      <div className="msg-list">
        {failed && items === undefined ? (
          <ErrorState onRetry={() => void loadList()} />
        ) : items === undefined ? (
          <div className="msg-wait"><Spinner label={c.loading} /></div>
        ) : (
          <ConversationList items={items ?? []} selectedId={withId} role={role} />
        )}
      </div>
      <div className="msg-conv">
        {!withId ? (
          <p className="msg-pick">{c.pick}</p>
        ) : conv === undefined ? (
          <div className="msg-wait"><Spinner label={c.loading} /></div>
        ) : conv === null ? (
          <div className="msg-gone" data-e2e="conv-gone">
            <p>{c.gone}</p>
            <Link href="/messages" className="btn btn-primary btn-sm">{c.backCta}</Link>
          </div>
        ) : (
          <ConversationPane conv={conv} onSent={afterSend} />
        )}
      </div>
    </div>
  );

  // Inside a shell: the space's one frame (.aps-page, 1080px), like every other page of it.
  if (shell) return <div className="aps-page">{page}</div>;
  return (
    <SiteShell>
      <section className="web-section tight msg-section">
        <div className="container">{page}</div>
      </section>
    </SiteShell>
  );
}
