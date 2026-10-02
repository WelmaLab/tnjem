"use client";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { getDashboard } from "@/app/actions";
import { formatNumericDate, type DashboardClass } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · phase 6 — « Dupliquer une classe précédente »: pick one of your
   classes and the form takes its title, text, level, duration, price and seats. Never
   its date (the point is a new session) and never its room links. A native <dialog>
   (focus trap, Escape, focus returned) with one button per class. */

const copy = bilingual({
  fr: {
    title: "Dupliquer une classe précédente",
    lead: "La nouvelle classe reprend tout sauf la date.",
    empty: "Tu n'as pas encore de classe à dupliquer.",
    loading: "Chargement…",
    close: "Fermer",
  },
  ar: {
    title: "انسخ حصة قديمة",
    lead: "الحصة الجديدة تاخذ كل شي إلا التاريخ.",
    empty: "ما عندكش حصة باش تنسخها لتوّا.",
    loading: "قاعد يحمّل…",
    close: "سكّر",
  },
});

export function DuplicateDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const ref = useRef<HTMLDialogElement>(null);
  const [classes, setClasses] = useState<DashboardClass[] | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open && classes === null) {
      getDashboard()
        .then((r) => setClasses(r && !("wrongRole" in r) ? [...r.classes].sort((a, b) => b.starts_at.localeCompare(a.starts_at)).slice(0, 12) : []))
        .catch(() => setClasses([]));
    }
  }, [open, classes]);

  return (
    <dialog ref={ref} className="aps-dialog" aria-labelledby="dup-t" onClose={onClose} data-e2e="duplicate-dialog">
      <h2 id="dup-t" className="aps-dialog-t">{c.title}</h2>
      <p className="aps-dialog-b mb-3">{c.lead}</p>
      {classes === null ? (
        <p className="aps-dialog-b" role="status">{c.loading}</p>
      ) : classes.length === 0 ? (
        <p className="aps-dialog-b">{c.empty}</p>
      ) : (
        <ul className="nc-dup-list">
          {classes.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className="nc-dup-item"
                onClick={() => {
                  onPick(k.id);
                  onClose();
                }}
                data-e2e="duplicate-pick"
              >
                <UserText as="span" className="nc-dup-title">{k.title}</UserText>
                <span className="nc-dup-meta">
                  {formatNumericDate(k.starts_at)} · {k.time} · {k.price_tnd} TND
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="aps-dialog-btns">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} autoFocus>
          {c.close}
        </button>
      </div>
    </dialog>
  );
}
