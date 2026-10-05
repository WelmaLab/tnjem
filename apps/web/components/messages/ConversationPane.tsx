"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Back, Info, Lock } from "@/components/icons";
import { reportMessage } from "@/app/actions";
import { sendToConversation } from "@/app/actions-messages";
import {
  MESSAGE_MAX_LENGTH,
  displaySubject,
  threadMarkerIndexes,
  type ConversationDetail,
} from "@tnajem/shared";
import { msgCopy } from "./copy";
import { classWhenLabel, messageTime, shortDay } from "./format";

/* student-space-v1 · G — ONE CONVERSATION with one person (mockup 3b, right side):
   every message of every thread of the pair, oldest first, with a small
   « Séance « titre » · date » marker where each class's thread starts. Writing
   goes to the pair's most recent non-cancelled booking — the API decides which.

   ⚠ EVERY MESSAGE BODY IS RENDERED AS A TEXT NODE (<UserText>). messages.body is
   the product's only user-authored string shown to a DIFFERENT person: stored
   escaped (phase-a A20), sent back as typed, escaped again by React here. Never
   dangerouslySetInnerHTML. */

export function ConversationPane({
  conv,
  onSent,
}: {
  conv: ConversationDetail;
  /** Re-read the conversation (and the list) after a send. */
  onSent: () => Promise<void> | void;
}) {
  const { locale } = useLocale();
  const c = msgCopy[locale];
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement | null>(null);

  /* The newest message in view. The scroll box moves, not the page — and with no
     smooth behaviour: a conversation sliding under someone who asked for less
     motion is exactly what that preference is about. */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [conv.withId, conv.messages.length]);

  // Leaving for another conversation drops the half-typed message and the notices.
  useEffect(() => {
    setDraft("");
    setFlash(null);
  }, [conv.withId]);

  const markers = threadMarkerIndexes(conv.messages);
  const threadById = new Map(conv.threads.map((t) => [t.threadId, t]));
  const open = conv.state === "open";
  const isStudent = conv.iAm === "student";

  const subject = isStudent ? displaySubject(conv.subject, locale) : "";
  const next = conv.nextClass ? c.nextClass(classWhenLabel(conv.nextClass.startsAt, locale)) : c.noNextClass;
  const subline = [subject, !isStudent && conv.studentIsMinor ? c.minor : "", next].filter(Boolean).join(" · ");
  // C1: a student → their classes with this prof; a prof → « Mes élèves », where each student's sessions are listed.
  const seeHref = isStudent ? `/student/cours?prof=${encodeURIComponent(conv.withId)}` : "/dashboard/students";

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !open) return;
    const body = draft.trim();
    if (!body) {
      setFlash({ kind: "err", text: c.errEmpty });
      return;
    }
    setBusy(true);
    setFlash(null);
    const res = await sendToConversation({ withId: conv.withId, body }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const e2 = res?.error;
      setFlash({
        kind: "err",
        text: e2 === "message-too-long" ? c.errTooLong
          : e2 === "message-empty" ? c.errEmpty
          : e2 === "too-many-requests" ? c.errRate
          : e2 === "thread-closed" ? c.closedBody
          : c.errGeneric,
      });
      // Closed while the page was open: re-read, so the banner replaces the composer.
      if (e2 === "thread-closed" || e2 === "no-open-booking") await onSent();
      return;
    }
    setDraft("");
    if (res.masked) setFlash({ kind: "ok", text: c.maskedNotice });
    await onSent();
  }

  /* Enter sends, Shift+Enter is a new line — and never while an input method is
     composing (Arabic and other IMEs confirm with Enter). */
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  }

  async function handleReport(messageId: string) {
    const res = await reportMessage({ messageId }).catch(() => null);
    if (res?.ok) {
      setReported((prev) => new Set(prev).add(messageId));
      setFlash({ kind: "ok", text: c.reportDone });
    } else {
      setFlash({ kind: "err", text: c.errGeneric });
    }
  }

  return (
    <section className="msg-conv-in" aria-labelledby="msg-with" data-e2e="conv">
      <header className="msg-head">
        <Link href="/messages" className="msg-back" aria-label={c.back} data-e2e="conv-back">
          <Back />
        </Link>
        <span className="avatar msg-av" aria-hidden="true">{conv.initials}</span>
        <div className="msg-head-txt">
          <UserText as="h2" id="msg-with" className="msg-head-name">{conv.withName ?? ""}</UserText>
          <p className="msg-head-sub">{subline}</p>
        </div>
        <Link href={seeHref} className="btn btn-ghost btn-sm msg-head-cta" data-e2e="conv-see-classes">
          {c.seeClasses}
        </Link>
      </header>

      <div className="msg-scroll" ref={scroller}>
        <p className="msg-note">
          <Info />
          <span>
            {c.privacy}
            {conv.studentIsMinor ? <> {c.minorNotice}</> : null}
          </span>
        </p>

        {conv.messages.length === 0 ? (
          <p className="msg-none">{open ? c.empty : c.emptyClosed}</p>
        ) : (
          <ol className="msg-flow" role="list">
            {conv.messages.map((m, i) => {
              const t = markers.has(i) ? threadById.get(m.threadId) : undefined;
              return (
                <li key={m.id} className="msg-row">
                  {t ? (
                    <p className="msg-marker" data-e2e="conv-marker">
                      <UserText>{c.marker(t.classTitle, shortDay(t.classTs, locale))}</UserText>
                    </p>
                  ) : null}
                  <div className={`msg-bubble${m.mine ? " is-mine" : ""}`}>
                    {/* TEXT NODE. Never dangerouslySetInnerHTML — see the file header. */}
                    <UserText as="p" className="msg-text">{m.body}</UserText>
                  </div>
                  <div className={`msg-meta${m.mine ? " is-mine" : ""}`}>
                    <time dateTime={m.at}>{messageTime(m.at, locale)}</time>
                    {m.masked ? <span className="msg-masked">{c.masked}</span> : null}
                    {!m.mine ? (
                      <button
                        type="button"
                        className="msg-report"
                        onClick={() => handleReport(m.id)}
                        disabled={reported.has(m.id)}
                      >
                        {reported.has(m.id) ? c.reported : c.report}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {flash ? (
        <p role={flash.kind === "err" ? "alert" : "status"} className={`msg-flash${flash.kind === "err" ? " is-err" : ""}`}>
          {flash.text}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={handleSend} className="msg-compose" data-e2e="conv-compose">
          <label htmlFor="msg" className="sr-only">{c.composerLabel}</label>
          <textarea
            id="msg"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            placeholder={c.placeholder}
            maxLength={MESSAGE_MAX_LENGTH}
            rows={1}
            // Direction from what is typed; empty, the page's (dir="auto" would left-align an Arabic placeholder).
            dir={draft.trim() ? "auto" : undefined}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy}>
            {busy ? c.sending : c.send}
          </button>
        </form>
      ) : conv.state === "no-open-booking" ? (
        <BookToWrite conv={conv} />
      ) : (
        <div role="status" className="msg-closed" data-testid="thread-closed" data-e2e="conv-closed">
          <Lock />
          <div>
            <p className="msg-closed-t">{c.closedTitle}</p>
            <p className="msg-closed-b">{c.closedBody}</p>
          </div>
        </div>
      )}
    </section>
  );
}

/** Nothing open to write into: say why, and offer the one way back — his next class. */
function BookToWrite({ conv }: { conv: ConversationDetail }) {
  const { locale } = useLocale();
  const c = msgCopy[locale];
  if (conv.iAm === "tutor") {
    return (
      <div role="status" className="msg-closed" data-testid="thread-closed" data-e2e="conv-book">
        <Lock />
        <div>
          <p className="msg-closed-t">{c.tutorNoneTitle}</p>
          <p className="msg-closed-b">{c.tutorNoneBody}</p>
        </div>
      </div>
    );
  }
  const why =
    conv.closedReason === "closed:class-ended" ? c.bookEnded
    : conv.closedReason === "closed:booking-cancelled" ? c.bookCancelled
    : c.bookNone;
  const next = conv.nextClass && !conv.nextClass.booked ? conv.nextClass : null;
  return (
    <div role="status" className="msg-closed msg-book" data-testid="thread-closed" data-e2e="conv-book">
      <Lock />
      <div className="min-w-0 flex-1">
        <p className="msg-closed-t">{c.bookTitle}</p>
        <p className="msg-closed-b">{why}</p>
        {next ? (
          <div className="msg-book-next">
            <div className="min-w-0">
              <p className="msg-book-k">{c.bookNext}</p>
              <UserText as="p" className="msg-book-title">{next.title}</UserText>
              <p className="msg-book-when">{classWhenLabel(next.startsAt, locale)}</p>
            </div>
            <Link href={`/class/${next.classId}`} className="btn btn-primary btn-sm" data-e2e="conv-book-cta">
              {c.bookCta}
            </Link>
          </div>
        ) : (
          <p className="msg-closed-b">
            {c.bookNoClass}{" "}
            {conv.tutorSlug ? (
              <Link href={`/${conv.tutorSlug}`} className="msg-link">{c.bookPage}</Link>
            ) : null}
          </p>
        )}
      </div>
    </div>
  );
}
