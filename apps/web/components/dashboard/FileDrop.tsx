"use client";
import { useEffect, useId, useState, type DragEvent, type Ref } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Close, Upload } from "@/components/icons";
import { bilingual } from "@/lib/i18n";

/* live-fixes-1 · pages (B) — THE UPLOAD FIELD OF THE PROF SPACE (a fiche's file).

   Extracted from « Nouvelle fiche » (phase 6) so Mes fiches uses the same one: a
   drop zone with the page's own words in French or Arabic. The browser's file input
   is still there — it is what the keyboard, a screen reader and the phone's file
   picker use — but visually hidden INSIDE the labelled zone (.sr-only): its native
   « Choose File / No file chosen » rendered in the system's language, English on
   most machines, whatever the page said. The zone shows the focus ring of the
   hidden input (.np-drop:has(input:focus-visible)).

   The type and size are checked HERE, before anything is sent, with the same rules
   as the API (POST /materials: PDF, PNG, JPEG or WEBP, 8 MB) — the API sniffs the
   bytes again and stays the authority. */

export const FILE_MAX_BYTES = 8 * 1024 * 1024;
export const FILE_ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const OK_TYPE = /^(application\/pdf|image\/(png|jpeg|webp))$/;

const copy = bilingual({
  fr: {
    drop: "Choisis un fichier",
    dropOr: "ou glisse-le ici",
    dropHelp: "PDF ou image (PNG, JPEG, WEBP) · 8 Mo max",
    change: "Changer",
    remove: "Retirer le fichier",
    errType: "Format refusé. PDF, PNG, JPEG ou WEBP.",
    errSize: "Fichier trop lourd (8 Mo max).",
  },
  ar: {
    drop: "اختار ملف",
    dropOr: "ولا جرّو لهوني",
    dropHelp: "PDF ولا صورة (PNG، JPEG، WEBP) · 8 ميڨا أقصى",
    change: "بدّل",
    remove: "نحّي الملف",
    errType: "الصيغة مرفوضة. PDF، PNG، JPEG ولا WEBP.",
    errSize: "الملف ثقيل برشا (8 ميڨا أقصى).",
  },
});

export function sizeLabel(bytes: number, locale: "fr" | "ar"): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace(".", locale === "fr" ? "," : ".")} ${locale === "fr" ? "Mo" : "ميڨا"}`;
  return `${Math.max(1, Math.round(bytes / 1024))} ${locale === "fr" ? "Ko" : "كيلو"}`;
}

export function FileDrop({
  file,
  onPick,
  onRemove,
  error,
  inputRef,
  e2e = { drop: "file-drop", input: "file-input", file: "file-picked" },
}: {
  file: File | null;
  /** A file that passed the type and size checks. */
  onPick: (f: File) => void;
  onRemove: () => void;
  /** A refusal from the server (or the page), shown under the zone. */
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  e2e?: { drop: string; input: string; file: string };
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const uid = useId();
  const helpId = `${uid}-help`;
  const errId = `${uid}-err`;
  const [dragging, setDragging] = useState(false);
  const [thumb, setThumb] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const shownErr = localErr ?? error ?? null;

  // An image gets a real thumbnail; the object URL is released when it changes.
  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setThumb(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function take(next: File | null | undefined) {
    setLocalErr(null);
    if (!next) return;
    if (!OK_TYPE.test(next.type)) return setLocalErr(c.errType);
    if (next.size > FILE_MAX_BYTES) return setLocalErr(c.errSize);
    onPick(next);
  }
  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    take(e.dataTransfer.files?.[0]);
  }
  const describedBy = [shownErr ? errId : null, helpId].filter(Boolean).join(" ");

  /* ONE input for both states, so the ref the page focuses on a refusal always
     points at a live element, and « Changer » re-opens the same picker. */
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={FILE_ACCEPT}
      className="sr-only"
      aria-describedby={describedBy}
      aria-invalid={shownErr ? true : undefined}
      onChange={(e) => {
        take(e.target.files?.[0]);
        // Picking the same file again after « Retirer » must fire onChange again.
        e.target.value = "";
      }}
      data-e2e={e2e.input}
    />
  );

  return (
    <div className="lf-drop-wrap">
      {file ? (
        <div className="np-file" data-e2e={e2e.file}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local blob preview, never a remote image
            <img src={thumb} alt="" className="np-thumb" />
          ) : (
            <span className="np-thumb np-thumb-doc" aria-hidden="true">PDF</span>
          )}
          <div className="np-file-txt">
            <span className="np-file-name" dir="auto">{file.name}</span>
            <span className="np-file-meta">{sizeLabel(file.size, locale)}</span>
          </div>
          <label className="btn btn-ghost btn-sm np-change">
            {c.change}
            {input}
          </label>
          <button type="button" className="aps-tool" onClick={onRemove} aria-label={c.remove} title={c.remove}>
            <Close />
          </button>
          <span id={helpId} className="sr-only">{c.dropHelp}</span>
        </div>
      ) : (
        <label
          className={`np-drop${dragging ? " is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-e2e={e2e.drop}
        >
          <span className="np-drop-ic" aria-hidden="true"><Upload /></span>
          <span className="np-drop-t">
            <b>{c.drop}</b> {c.dropOr}
          </span>
          <span className="np-drop-h" id={helpId}>{c.dropHelp}</span>
          {input}
        </label>
      )}
      {shownErr && (
        <div id={errId} role="alert" className="help text-rose font-semibold">{shownErr}</div>
      )}
    </div>
  );
}
