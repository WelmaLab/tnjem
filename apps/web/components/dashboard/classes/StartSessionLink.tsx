"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { startState, type StartState } from "@tnajem/shared/live";
import { bilingual } from "@/lib/i18n";

/* live-fixes-3 · A1 — « Démarrer la séance »: the tutor's one-click way into the
   class they teach (/live/<id>, the lobby with « Entrer dans la classe »). Mes
   classes, Accueil › Prochaines séances and the owner's own class page all mount
   this, so the three can never disagree on when it shows.

   The window is startState() (@tnajem/shared/live): from 30 min before the start
   until the real end it is THE main action — the ochre button, with a pulsing dot
   (still, under prefers-reduced-motion); before that, a secondary button; after
   the end, or for a cancelled class, nothing. A clock re-checks every 20 s, so a
   page left open turns the button ochre on its own.

   ONE <Link> styled as a button — never a <button> inside an <a>. */

const copy = bilingual({
  fr: { start: "Démarrer la séance" },
  ar: { start: "ابدا الحصة" },
});

/** Re-render on a slow tick; the start window is measured in minutes. */
function useClock(everyMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

type Cls = { id: string; starts_at: string; duration_min?: number | null; status?: string | null };

/** The state the button is in right now (for a view that must know, e.g. to keep one ochre). */
export function useStartState(cls: Cls): StartState {
  return startState(cls, useClock());
}

export function StartSessionLink({ cls, block = false, className }: { cls: Cls; block?: boolean; className?: string }) {
  const { locale } = useLocale();
  const state = useStartState(cls);
  if (state === "over") return null;
  const open = state === "open";
  return (
    <Link
      href={`/live/${cls.id}`}
      className={`btn ${open ? "btn-primary" : "btn-outline"}${block ? "" : " btn-sm"} lf3-start${className ? ` ${className}` : ""}`}
      data-e2e="class-start"
      data-state={state}
    >
      {open && <span className="lf3-live-dot" aria-hidden="true" />}
      {copy[locale].start}
    </Link>
  );
}
