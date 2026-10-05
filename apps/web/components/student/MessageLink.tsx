"use client";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Chat } from "@/components/icons";
import { bilingual } from "@/lib/i18n";

/* « Message » — student-space-v1 · pages (contract C2).

   ONE conversation per prof: /messages/with/<tutors.id> (built by the messages lane).
   A plain link — no thread is opened from here, nothing is written — with IMMEDIATE
   feedback: while Next fetches the conversation the icon turns into a spinner and the
   link says it is busy (useLinkStatus), so a tap on a slow 3G link never looks dead. */

const copy = bilingual({
  fr: { label: "Message", aria: (n: string) => `Écrire à ${n}`, opening: "Ouverture de la conversation…" },
  ar: { label: "رسالة", aria: (n: string) => `اكتب لـ ${n}`, opening: "قاعد يحلّ المحادثة…" },
});

function Pending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  const { locale } = useLocale();
  return (
    <>
      {pending ? <span className="ssv-spin" aria-hidden="true" /> : <Chat />}
      <span>{children}</span>
      {pending ? <span className="sr-only" role="status">{copy[locale].opening}</span> : null}
    </>
  );
}

export function MessageLink({
  tutorId,
  tutorName,
  className = "btn btn-ghost btn-sm",
  label,
}: {
  tutorId: string;
  tutorName: string;
  className?: string;
  label?: string;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  return (
    <Link
      href={`/messages/with/${encodeURIComponent(tutorId)}`}
      className={`${className} ssv-msg`}
      aria-label={c.aria(tutorName)}
      data-e2e="message-prof"
      prefetch={false}
    >
      <Pending>{label ?? c.label}</Pending>
    </Link>
  );
}
