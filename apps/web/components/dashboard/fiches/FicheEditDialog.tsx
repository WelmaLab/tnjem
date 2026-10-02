"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Field } from "@/components/ui";
import { Select } from "@/components/app/Select";
import { updateMaterial, updatePack } from "@/app/actions-pages";
import { formatNumericDate, tunisClock, type FicheClassOption, type FicheVisibility, type TutorFiche } from "@tnajem/shared";
import { fichesCopy, ficheError } from "./copy";

/* live-fixes-1 · B — « Modifier la fiche ». A native <dialog> (focus trapped, Escape
   closes, focus returns to the row's pencil), with a real <form>: Enter saves.

     a listed fiche (pack)   title · detail · price  (+ the class of its file, if it has one)
     a library item          title · description · class · who may open it

   The API checks everything again (POST /packs/:id/update, /materials/:id/update):
   the same validators and contact rule as on creation, and ownership. */

const VIS: FicheVisibility[] = ["students", "public", "private"];

export function classOptionLabel(k: FicheClassOption): string {
  return `${k.title} · ${formatNumericDate(k.startsAt)} · ${tunisClock(k.startsAt)}`;
}

export function FicheEditDialog({
  fiche,
  classes,
  onClose,
  onSaved,
}: {
  fiche: TutorFiche | null;
  classes: FicheClassOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, locale } = useLocale();
  const c = fichesCopy[locale];
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [price, setPrice] = useState("");
  const [classId, setClassId] = useState("");
  const [vis, setVis] = useState<FicheVisibility>("students");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPack = Boolean(fiche?.packId);
  const hasSource = Boolean(fiche?.materialId);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (fiche) {
      setTitle(fiche.title);
      setDetail(fiche.detail ?? "");
      setPrice(fiche.priceTnd === null ? "" : String(fiche.priceTnd));
      setClassId(fiche.classId ?? "");
      setVis(fiche.visibility ?? "students");
      setErr(null);
      if (!d.open) d.showModal();
      requestAnimationFrame(() => titleRef.current?.focus());
    } else if (d.open) {
      d.close();
    }
  }, [fiche]);

  // The current class stays choosable even when it is cancelled; other cancelled ones do not.
  const options = [
    { value: "", label: c.fClassNone },
    ...classes
      .filter((k) => !k.cancelled || k.id === fiche?.classId)
      .map((k) => ({ value: k.id, label: classOptionLabel(k) })),
  ];

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!fiche || busy) return;
    setErr(null);
    if (title.trim().length < 3) {
      setErr(c.errTitle);
      titleRef.current?.focus();
      return;
    }
    let res: Awaited<ReturnType<typeof updatePack>> | null;
    setBusy(true);
    if (isPack) {
      const n = Number(price);
      if (price.trim() === "" || !Number.isFinite(n) || n < 0 || n > 5000) {
        setBusy(false);
        setErr(c.errPrice);
        return;
      }
      res = await updatePack({
        id: fiche.packId!,
        title,
        meta: detail,
        priceTnd: n,
        ...(hasSource ? { classId: classId || null } : {}),
      }).catch(() => null);
    } else {
      res = await updateMaterial({
        id: fiche.materialId!,
        title,
        description: detail,
        visibility: vis,
        classId: classId || null,
      }).catch(() => null);
    }
    setBusy(false);
    if (!res?.ok) {
      setErr(ficheError(c, res?.error));
      return;
    }
    onSaved();
  }

  const classLabelId = `${uid}-class`;
  const visLabelId = `${uid}-vis`;
  return (
    <dialog
      ref={ref}
      className="aps-dialog lf-edit"
      aria-labelledby={`${uid}-t`}
      onClose={onClose}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
      data-e2e="fiche-edit-dialog"
    >
      <form onSubmit={save} noValidate>
        <h2 id={`${uid}-t`} className="aps-dialog-t">{c.editT}</h2>
        <Field label={c.fTitle}>
          <div className="inp">
            <input ref={titleRef} value={title} maxLength={120} dir={title.trim() ? "auto" : undefined} onChange={(e) => setTitle(e.target.value)} data-e2e="fiche-edit-title" />
          </div>
        </Field>
        <Field label={isPack ? c.fMeta : c.fDesc}>
          <div className="inp">
            <input value={detail} maxLength={isPack ? 200 : 1000} dir={detail.trim() ? "auto" : undefined} onChange={(e) => setDetail(e.target.value)} data-e2e="fiche-edit-detail" />
          </div>
        </Field>
        {isPack && (
          <Field label={c.fPrice} help={c.priceHelp}>
            <div className="inp">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={5000}
                step={0.5}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                data-e2e="fiche-edit-price"
              />
              <span className="pre">{t.common.tnd}</span>
            </div>
          </Field>
        )}
        {(!isPack || hasSource) && (
          <div className="field">
            <span className="field-label" id={classLabelId}>{c.fClass}</span>
            <Select value={classId} onChange={setClassId} options={options} labelledBy={classLabelId} e2e="fiche-edit-class" />
          </div>
        )}
        {!isPack && (
          <fieldset className="field nc-fieldset">
            <legend className="field-label" id={visLabelId}>{c.fVis}</legend>
            <div className="nc-chips" data-e2e="fiche-edit-visibility">
              {VIS.map((v) => (
                <label key={v} className="nc-chip" data-value={v}>
                  <input type="radio" name={`${uid}-vis`} value={v} checked={vis === v} onChange={() => setVis(v)} className="sr-only" />
                  {v === "public" ? c.visPublic : v === "private" ? c.visPrivate : classId ? c.visThisClass : c.visStudents}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {err && <p role="alert" className="help text-rose font-semibold" data-e2e="fiche-edit-error">{err}</p>}
        <div className="aps-dialog-btns">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>{c.cancel}</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} data-e2e="fiche-edit-save">{c.save}</button>
        </div>
      </form>
    </dialog>
  );
}
