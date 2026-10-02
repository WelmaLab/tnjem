"use client";
import { useId, useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Field } from "@/components/ui";
import { Select } from "@/components/app/Select";
import { FormMode } from "@/components/app/AppShell";
import { FileDrop } from "@/components/dashboard/FileDrop";
import { createMaterial } from "@/app/actions";
import type { FicheClassOption, FicheVisibility } from "@tnajem/shared";
import { fichesCopy, ficheError } from "./copy";
import { classOptionLabel } from "./FicheEditDialog";

/* live-fixes-1 · B — « Pour tes élèves seulement »: a file or a YouTube video with no
   price, not listed on the page (the library of Step 10, redesigned into the shell).

   Two ways to add something and they are mutually exclusive on purpose: a file OR a
   YouTube link, never both — the « Le contenu » choice shows one field at a time, and
   the API refuses the combination too (`one-source-only`).

   VISIBILITY DEFAULTS TO "students", matching the column default: a tutor uploading a
   worksheet almost certainly means "for the people in my class", and a mis-set
   "public" puts their corrected exam paper on the open internet. Attached to a class,
   "students" means the students booked in THAT class (canRead() in apps/api). */

const VIS: FicheVisibility[] = ["students", "public", "private"];

export function LibraryForm({ classes, onAdded }: { classes: FicheClassOption[]; onAdded: (message: string) => void }) {
  const { locale } = useLocale();
  const c = fichesCopy[locale];
  const uid = useId();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [source, setSource] = useState<"file" | "youtube">("file");
  const [file, setFile] = useState<File | null>(null);
  const [yt, setYt] = useState("");
  const [classId, setClassId] = useState("");
  const [vis, setVis] = useState<FicheVisibility>("students");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: "title" | "file" | "youtube" | "form"; text: string } | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ytRef = useRef<HTMLInputElement>(null);

  const options = [
    { value: "", label: c.fClassNone },
    ...classes.filter((k) => !k.cancelled).map((k) => ({ value: k.id, label: classOptionLabel(k) })),
  ];

  function refuse(field: "title" | "file" | "youtube" | "form", text: string) {
    setErr({ field, text });
    requestAnimationFrame(() => (field === "title" ? titleRef : field === "file" ? fileRef : field === "youtube" ? ytRef : null)?.current?.focus());
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr(null);
    if (title.trim().length < 3) return refuse("title", c.errTitle);
    /* Client-side pre-checks for the cases the SERVER also refuses — not a
       substitute for it, but a round trip to learn "pick one" is a bad way to learn it. */
    if (source === "file" && !file) return refuse("file", c.errSource);
    if (source === "youtube" && !yt.trim()) return refuse("youtube", c.errSource);

    const form = new FormData();
    form.set("title", title.trim());
    if (desc.trim()) form.set("description", desc.trim());
    if (source === "file" && file) form.set("file", file);
    if (source === "youtube") form.set("youtubeUrl", yt.trim());
    if (classId) form.set("classId", classId);
    form.set("visibility", vis);

    setBusy(true);
    const res = await createMaterial(form).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const code = res?.error;
      const text = ficheError(c, code);
      if (code === "invalid-youtube-url") return refuse("youtube", text);
      if (code === "bad-file-type" || code === "file-too-large" || code === "storage-quota-reached") return refuse("file", text);
      if (code === "contact-info-not-allowed" || code?.startsWith("title") || code === "invalid-title") return refuse("title", text);
      return refuse("form", text);
    }
    setTitle("");
    setDesc("");
    setFile(null);
    setYt("");
    setClassId("");
    setVis("students");
    onAdded(c.okAdded);
  }

  const classLabelId = `${uid}-class`;
  return (
    <form onSubmit={submit} className="lf-lib-form" noValidate data-e2e="library-form">
      <Field label={c.fTitle} error={err?.field === "title" ? err.text : undefined}>
        <div className="inp">
          <input
            id="m-title"
            ref={titleRef}
            value={title}
            minLength={3}
            maxLength={120}
            placeholder={c.fTitlePh}
            dir={title.trim() ? "auto" : undefined}
            onChange={(e) => { setTitle(e.target.value); if (err?.field === "title") setErr(null); }}
          />
        </div>
      </Field>
      <Field label={c.fDesc}>
        <div className="inp">
          <input id="m-desc" value={desc} maxLength={1000} placeholder={c.fDescPh} dir={desc.trim() ? "auto" : undefined} onChange={(e) => setDesc(e.target.value)} />
        </div>
      </Field>

      <fieldset className="field nc-fieldset">
        <legend className="field-label">{c.fSource}</legend>
        <div className="nc-chips" data-e2e="material-source">
          {(["file", "youtube"] as const).map((s) => (
            <label key={s} className="nc-chip" data-value={s}>
              <input
                type="radio"
                name={`${uid}-src`}
                value={s}
                checked={source === s}
                onChange={() => { setSource(s); setErr(null); }}
                className="sr-only"
              />
              {s === "file" ? c.srcFile : c.srcVideo}
            </label>
          ))}
        </div>
      </fieldset>

      {source === "file" ? (
        <div className="lf-field">
          <FileDrop
            file={file}
            onPick={(f) => { setFile(f); if (err?.field === "file") setErr(null); }}
            onRemove={() => setFile(null)}
            error={err?.field === "file" ? err.text : undefined}
            inputRef={fileRef}
            e2e={{ drop: "material-drop", input: "material-file-input", file: "material-file" }}
          />
        </div>
      ) : (
        <Field label={c.fYoutube} help={c.fYoutubeHelp} error={err?.field === "youtube" ? err.text : undefined}>
          <div className="inp">
            <input
              id="m-yt"
              ref={ytRef}
              type="url"
              inputMode="url"
              /* dir="ltr": a Latin URL inside an RTL field renders with its punctuation
                 mirrored. Same rule as the phone, e-mail and OTP fields. */
              dir="ltr"
              value={yt}
              placeholder={c.fYoutubePh}
              onChange={(e) => { setYt(e.target.value); if (err?.field === "youtube") setErr(null); }}
            />
          </div>
        </Field>
      )}

      <div className="field">
        <span className="field-label" id={classLabelId}>{c.fClass}</span>
        <Select value={classId} onChange={setClassId} options={options} labelledBy={classLabelId} e2e="material-class" />
      </div>

      <fieldset className="field nc-fieldset" aria-describedby={`${uid}-vis-h`}>
        <legend className="field-label">{c.fVis}</legend>
        <div className="nc-chips" data-e2e="material-visibility">
          {VIS.map((v) => (
            <label key={v} className="nc-chip" data-value={v}>
              <input type="radio" name={`${uid}-vis`} value={v} checked={vis === v} onChange={() => setVis(v)} className="sr-only" />
              {v === "public" ? c.visPublic : v === "private" ? c.visPrivate : classId ? c.visThisClass : c.visStudents}
            </label>
          ))}
        </div>
        <div id={`${uid}-vis-h`} className="help">{c.visHelp}</div>
      </fieldset>

      {err?.field === "form" && <p role="alert" className="help text-rose font-semibold">{err.text}</p>}
      <div>
        <button type="submit" className="btn btn-outline btn-sm" disabled={busy} data-e2e="material-submit">
          {busy ? c.submitting : c.submit}
        </button>
      </div>
      {/* While it is open, a form on screen: on a phone the tab bar steps aside (live-fixes-1 · A2). */}
      <FormMode />
    </form>
  );
}
