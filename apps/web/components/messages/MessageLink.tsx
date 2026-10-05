"use client";
import { useLinkStatus } from "next/link";
import type { CSSProperties } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Chat } from "@/components/icons";
import { conversationHref } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* student-space-v1 · G — « Message » as ONE plain link to the pair's conversation
   (contract C2: /messages/with/<tutors.id> for a student, /messages/with/<the
   student's profiles.id> for a prof). Immediate feedback: while the next page is
   on its way the label gives way to a spinner and the link reads as busy — a tap
   that seems to do nothing gets tapped again. Any page may mount it. */

const copy = bilingual({
  fr: { label: "Message", opening: "Ouverture de la conversation…", to: (name: string) => `Écrire à ${name}` },
  ar: { label: "راسل", opening: "قاعد يحلّ المحادثة…", to: (name: string) => `اكتب لـ ${name}` },
});

function Inner({ label, opening }: { label: string; opening: string }) {
  const { pending } = useLinkStatus();
  return (
    <>
      {pending ? <span className="msg-link-spin" aria-hidden="true" /> : <Chat />}
      <span>{label}</span>
      {pending ? <span className="sr-only" role="status">{opening}</span> : null}
    </>
  );
}

export function MessageLink({
  withId,
  name,
  className = "btn btn-ghost btn-sm",
  style,
}: {
  withId: string;
  /** The other person's shown name (« Walid T. »), for the accessible name. */
  name?: string | null;
  className?: string;
  style?: CSSProperties;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  return (
    <Link
      href={conversationHref(withId)}
      className={`${className} msg-link-btn`}
      style={style}
      aria-label={name ? c.to(name) : undefined}
      data-e2e="message-link"
    >
      <Inner label={c.label} opening={c.opening} />
    </Link>
  );
}
