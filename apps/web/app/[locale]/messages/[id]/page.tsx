"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Button, Spinner } from "@/components/ui";
import { SiteShell } from "@/components/SiteShell";
import { useShell } from "@/components/app/ShellContext"; // espace prof v2 · shell
import { Shield, Forward, Lock } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { getThread, sendMessage, reportMessage } from "@/app/actions";
import type { MessageThreadDetail } from "@tnajem/shared";
import { MESSAGE_MAX_LENGTH, THREAD_CLOSE_DAYS, formatShortDateTime } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ONE CONVERSATION.

   ⚠ EVERY MESSAGE BODY IS RENDERED AS A TEXT NODE. `messages.body` is the only
   user-authored string in this product that is stored and then shown to a
   DIFFERENT person, which is the exact shape of stored XSS. The row is stored
   ESCAPED (packages/shared/src/message-text.ts, phase-a A20) and the API sends
   back the text exactly as typed — "si x < 5 alors y > 2" — so React escaping
   here is the half that makes it safe to show. If anyone ever adds formatting, it
   renders from a parsed representation — never from this string through
   dangerouslySetInnerHTML. */

const copy = bilingual({
  fr: {
    back: "Toutes les conversations",
    crumb: "Messages", // espace prof v2 · shell: the top bar's breadcrumb
    loading: "Chargement…",
    gone: "Cette conversation n'existe pas, ou tu n'en fais pas partie.",
    backCta: "Retour aux messages",
    placeholder: "Écris ton message…",
    send: "Envoyer",
    sending: "Envoi…",
    empty: "Aucun message pour l'instant. Écris le premier.",
    masked: "Coordonnées retirées",
    maskedNotice:
      "Ton message est parti, sans les coordonnées : numéro, email et liens sont retirés automatiquement. Tout se passe ici.",
    errGeneric: "Le message n'est pas parti. Réessaie.",
    errEmpty: "Écris quelque chose d'abord.",
    errTooLong: "Message trop long.",
    errRate: "Tu as envoyé beaucoup de messages. Réessaie dans quelques minutes.",
    errCancelled: "Cette réservation a été annulée : la conversation est fermée. Les messages restent visibles.",
    report: "Signaler",
    reported: "Signalé",
    reportDone: "Merci. Ce message a été signalé à Tnajem.",
    privacy: "Les coordonnées (numéro, email, lien) sont retirées automatiquement des messages.",
    /* Updated in Step 14, when parent accounts made this TRUE. Step 8b said
       explicitly that guardian access was not built; saying it now that it is
       matters most to the CHILD — a monitored conversation nobody disclosed is
       surveillance, and a fifteen-year-old is owed this sentence before they
       type, not after. */
    minorNotice:
      "Cet élève a moins de 18 ans. Son parent ou tuteur peut lire cette conversation depuis son propre compte. Elle est conservée, et Tnajem peut la consulter si un message est signalé.",
    withTutor: "avec ton prof",
    withStudent: "avec ton élève",
    // phase-a lane L1 (A2) — a closed conversation: readable, reportable, no composer.
    closedTitle: "Conversation fermée",
    closedEnded: (days: number) =>
      `La séance est terminée depuis plus de ${days} jours : la conversation est fermée. Les messages restent visibles, et tu peux toujours en signaler un.`,
    closedCancelled:
      "Cette réservation a été annulée : la conversation est fermée. Les messages restent visibles, et tu peux toujours en signaler un.",
    closedOther: "Cette conversation est fermée. Les messages restent visibles, et tu peux toujours en signaler un.",
    closedComposer: "Conversation fermée : tu ne peux plus écrire ici.",
    // end phase-a lane L1
  },
  ar: {
    back: "المحادثات الكل",
    crumb: "الرسائل",
    loading: "قاعد يحمّل…",
    gone: "المحادثة هاذي ما موجودةش، ولا إنت ماكش فيها.",
    backCta: "ارجع للرسائل",
    placeholder: "اكتب رسالتك…",
    send: "ابعث",
    sending: "قاعد يبعث…",
    empty: "ما فمّاش رسائل لتوّا. اكتب الأولى.",
    masked: "معلومات الاتصال تنحّات",
    maskedNotice:
      "رسالتك مشات، بلا معلومات الاتصال: النمرة، الإيميل والروابط يتنحّاو آليًا. كل شي يصير هوني.",
    errGeneric: "الرسالة ما مشاتش. عاود حاول.",
    errEmpty: "اكتب حاجة الأول.",
    errTooLong: "الرسالة طويلة برشا.",
    errCancelled: "الحجز هذا تلغى: المحادثة تسكّرت. الرسائل القديمة تقعد تبان.",
    errRate: "بعثت برشا رسائل. عاود بعد شوية دقايق.",
    report: "بلّغ",
    reported: "تبلّغ",
    reportDone: "يعيشك. الرسالة هاذي تبلّغت لـ Tnajem.",
    privacy: "معلومات الاتصال (النمرة، الإيميل، الرابط) تتنحّى آليًا من الرسائل.",
    minorNotice:
      "التلميذ هذا عمرو أقلّ من 18 سنة. الولي متاعو ينجّم يقرا المحادثة هاذي من الحساب متاعو. وهي تتحفظ، وTnajem تنجّم تشوفها كان رسالة تتبلّغ.",
    withTutor: "مع أستاذك",
    withStudent: "مع تلميذك",
    // phase-a lane L1 (A2)
    closedTitle: "المحادثة تسكّرت",
    closedEnded: (days: number) =>
      `الحصة كمّلت من أكثر من ${days} أيّام: المحادثة تسكّرت. الرسائل تقعد تبان، وتنجّم ديما تبلّغ على رسالة.`,
    closedCancelled:
      "الحجز هذا تلغى: المحادثة تسكّرت. الرسائل تقعد تبان، وتنجّم ديما تبلّغ على رسالة.",
    closedOther: "المحادثة هاذي تسكّرت. الرسائل تقعد تبان، وتنجّم ديما تبلّغ على رسالة.",
    closedComposer: "المحادثة تسكّرت: ما عادش تنجّم تكتب هوني.",
    // end phase-a lane L1
  },
});

export default function ThreadPage() {
  const params = useParams<{ id: string }>();
  const threadId = String(params?.id ?? "");
  const { locale } = useLocale();
  const c = copy[locale];

  const [thread, setThread] = useState<MessageThreadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const t = await getThread(threadId).catch(() => null);
    setThread(t);
    setLoading(false);
  }, [threadId]);

  useEffect(() => { void load(); }, [load]);

  /* espace prof v2 · shell — inside the AppShell (a tutor), the top bar reads
     « Messages › <the class> ». Opening the thread read it (GET /threads/:id moves
     this side's read mark), so the messages badge is refreshed too. */
  const shell = useShell();
  const setCrumbs = shell?.setCrumbs;
  const refreshCounts = shell?.refreshCounts;
  const threadTitle = thread?.classTitle ?? null;
  useEffect(() => {
    if (!setCrumbs || !threadTitle) return;
    setCrumbs([{ label: c.crumb, href: "/messages" }, { label: threadTitle }]);
    refreshCounts?.();
    return () => setCrumbs(null);
  }, [setCrumbs, refreshCounts, threadTitle, c.crumb]);

  /* Scroll to the newest message. `behavior:"auto"` rather than "smooth": the
     reduced-motion backstop in globals.css exempts only the spinner, and a
     conversation jumping under someone who asked for less motion is exactly what
     that preference is about. */
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.messages.length]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = draft.trim();
    if (!body) { setFlash({ kind: "err", text: c.errEmpty }); return; }

    setBusy(true);
    setFlash(null);
    const res = await sendMessage({ threadId, body }).catch(() => null);
    setBusy(false);

    if (!res?.ok) {
      const e2 = res?.error;
      setFlash({
        kind: "err",
        text: e2 === "message-too-long" ? c.errTooLong
          : e2 === "message-empty" ? c.errEmpty
          : e2 === "too-many-requests" ? c.errRate
          : e2 === "booking-cancelled" ? c.errCancelled
          : e2 === "thread-closed" ? c.closedOther
          : c.errGeneric,
      });
      // Closed while the page was open: reload so the banner replaces the composer.
      if (e2 === "booking-cancelled" || e2 === "thread-closed") await load();
      return;
    }
    setDraft("");
    /* Tell the sender when their own words were edited. Delivering a silently
       altered message is how a filter becomes a trust problem. */
    if (res.masked) setFlash({ kind: "ok", text: c.maskedNotice });
    await load();
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

  if (loading) {
    return (
      <SiteShell>
        <section className="web-section">
          <div className="container container-narrow">
            <div className="panel panel-pad grid place-items-center min-h-[200px]">
              <Spinner />
              <span className="sr-only">{c.loading}</span>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }

  if (!thread) {
    return (
      <SiteShell>
        <section className="web-section">
          <div className="container container-narrow">
            <div className="panel panel-pad text-center">
              <p className="text-[14px] mb-3.5">{c.gone}</p>
              <Link href="/messages" className="btn btn-primary btn-sm">{c.backCta}</Link>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }

  const who = thread.withName ?? (thread.iAm === "tutor" ? c.withStudent : c.withTutor);
  /* phase-a A2: the SERVER decides (threadState); this only shows it. A missing
     state (an older API) reads as open, and the server still refuses the send. */
  const closed = thread.state !== undefined && thread.state !== "open";
  const closedText =
    thread.state === "closed:class-ended" ? c.closedEnded(THREAD_CLOSE_DAYS)
    : thread.state === "closed:booking-cancelled" ? c.closedCancelled
    : c.closedOther;

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow">
          {/* A 44px tap target that takes the same room as before: -14px on top, 44px tall,
              -2px below (was 16px of text + a 12px margin). */}
          <Link href="/messages" className="text-[13px] text-muted inline-flex items-center gap-1.5 min-h-[44px] -mt-[14px] -mb-[2px]">
            <Forward className="w-3 h-3 rotate-180" aria-hidden="true" />
            {c.back}
          </Link>

          <div className="mb-[clamp(14px,2vw,22px)]">
            <UserText as="h1" className="web-h1 text-[22px]">{thread.classTitle}</UserText>
            <UserText as="p" className="text-[14px] text-muted mt-1">{who}</UserText>
          </div>

          <div className="panel panel-pad mb-3 flex items-start gap-2.5">
            <Shield className="w-4 h-4 flex-none mt-0.5" aria-hidden="true" />
            <p className="text-[13px] text-muted leading-[1.6]">
              {c.privacy}
              {thread.studentIsMinor && <> {c.minorNotice}</>}
            </p>
          </div>

          <div className="panel panel-pad mb-3">
            {thread.messages.length === 0 ? (
              <p className="text-[13px] text-muted text-center py-6">{c.empty}</p>
            ) : (
              <ul className="flex flex-col gap-2.5 list-none" role="list">
                {thread.messages.map((m) => (
                  <li
                    key={m.id}
                    className="max-w-[85%] rounded-[14px] px-3.5 py-2.5"
                    style={{
                      marginInlineStart: m.mine ? "auto" : 0,
                      background: m.mine ? "var(--blue50)" : "var(--cream)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    {/* TEXT NODE. Never dangerouslySetInnerHTML — see the file header. */}
                    <UserText as="p" className="text-[14px] leading-[1.6] whitespace-pre-wrap break-words">{m.body}</UserText>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span className="text-[13px] text-muted">
                        {formatShortDateTime(m.at, locale) /* Tunis time */}
                      </span>
                      {m.masked && (
                        <span className="text-[13px] font-bold" style={{ color: "var(--ochre-ink)" }}>
                          {c.masked}
                        </span>
                      )}
                      {!m.mine && (
                        <button
                          type="button"
                          onClick={() => handleReport(m.id)}
                          disabled={reported.has(m.id)}
                          className="text-[13px] underline"
                          style={{
                            /* 44px to tap (the house target), no extra room: padding + the same negative
                               margin; and 44px wide, which the short Arabic « بلّغ » is not on its own. */
                            background: "none", border: 0, paddingInline: 0, paddingBlock: 14, marginBlock: -14, minInlineSize: 44,
                            color: "var(--muted)",
                            cursor: reported.has(m.id) ? "default" : "pointer",
                          }}
                        >
                          {reported.has(m.id) ? c.reported : c.report}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={endRef} />
          </div>

          {flash && (
            <div
              role={flash.kind === "err" ? "alert" : "status"}
              className="panel panel-pad mb-3 text-[13px] leading-[1.6]"
              style={{ color: flash.kind === "err" ? "var(--rose)" : "var(--ink2)" }}
            >
              {flash.text}
            </div>
          )}

          {closed && (
            <div
              role="status"
              data-testid="thread-closed"
              className="panel panel-pad mb-3 flex items-start gap-2.5"
              style={{ background: "var(--cream)" }}
            >
              <Lock className="w-4 h-4 flex-none mt-0.5" aria-hidden="true" />
              <div className="text-[13px] leading-[1.6]">
                <p className="font-bold text-ink">{c.closedTitle}</p>
                <p className="text-muted mt-0.5">{closedText}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSend} className="panel panel-pad">
            <label htmlFor="msg" className="sr-only">{closed ? c.closedComposer : c.placeholder}</label>
            <textarea
              id="msg"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={closed ? c.closedComposer : c.placeholder}
              maxLength={MESSAGE_MAX_LENGTH}
              rows={3}
              disabled={closed}
              // The brand font (a bare textarea falls back to the UA's monospace), and the
              // direction from what is typed — a message is French or Arabic either way;
              // empty, it keeps the page's (dir="auto" would left-align an Arabic placeholder).
              dir={draft.trim() ? "auto" : undefined}
              className="w-full text-[14px] leading-[1.6] rounded-[12px] p-3"
              style={{ border: "1px solid var(--line)", background: "var(--paper)", resize: "vertical", fontFamily: "inherit" }}
            />
            <div className="mt-2.5 flex justify-end">
              <Button type="submit" disabled={busy || closed}>{busy ? c.sending : c.send}</Button>
            </div>
          </form>
        </div>
      </section>
    </SiteShell>
  );
}
