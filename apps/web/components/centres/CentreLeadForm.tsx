"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CENTRE_LEAD_CONSENT_TEXT, CENTRE_LEAD_LIMITS as LIM, LEVEL_CODES, LEVEL_LABELS } from "@tnajem/shared";
import { Field } from "@/components/ui";
import { IconCheck } from "@/components/landing/landing-icons";
import { submitCentreLead, type CentreLeadForm as Payload } from "@/app/actions-centres";
import type { AppLocale } from "@/lib/locale";
import { formCopy, PAGE_PATH } from "./centres-copy";
import { attributionFrom, STORE_KEY, type Attribution } from "./attribution";

/* december-sprint · B (D13) — the centre lead form. Client component, posting through
   the server action in app/actions-centres.ts to the API's POST /centre-leads.

   ATTRIBUTION, FIRST-PARTY ONLY. On landing, utm_source / utm_medium / utm_campaign
   and document.referrer (origin + path: a query string can carry anything) are kept
   in sessionStorage until the form is sent, so a visitor who reads the page, follows
   a link and comes back still carries the campaign that brought them. No cookie, no
   third party. sessionStorage can throw (private mode, blocked storage): every access
   is wrapped and the form works without it.

   ERRORS. noValidate: the API is the one validator, and it answers a machine code and
   the field. That field is marked (aria-invalid + aria-describedby via <Field>) and
   focused, the e2e/form-a11y.spec.ts contract. No control is nested in another. */

function readStored(): Attribution {
  try {
    const raw = window.sessionStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : {};
  } catch {
    return {};
  }
}

const FIELDS = ["name", "centreName", "city", "phone", "teachersCount", "levels", "message"] as const;
type FieldName = (typeof FIELDS)[number];

export function CentreLeadForm({ locale }: { locale: AppLocale }) {
  const c = formCopy[locale];
  const [values, setValues] = useState({ name: "", centreName: "", city: "", phone: "", teachers: "", message: "", website: "" });
  const [levels, setLevels] = useState<string[]>([]);
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const refs = useRef<Partial<Record<FieldName, HTMLElement | null>>>({});
  const successRef = useRef<HTMLDivElement>(null);

  // Keep the first campaign that brought this visitor; a later tagged landing replaces it.
  useEffect(() => {
    const now = attributionFrom(window.location.search, document.referrer, window.location.origin);
    if (!now) return;
    const hasUtm = Boolean(now.utmSource || now.utmMedium || now.utmCampaign);
    try {
      if (hasUtm || !window.sessionStorage.getItem(STORE_KEY)) window.sessionStorage.setItem(STORE_KEY, JSON.stringify(now));
    } catch {
      /* storage blocked: the form still works, without attribution */
    }
  }, []);

  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    // Corrected: the field stops being marked invalid (aria-invalid goes with the message).
    const field = k === "teachers" ? "teachersCount" : k;
    setErrors((er) => (field in er ? { ...er, [field]: undefined } : er));
  };

  function toggleLevel(code: string) {
    setLevels((cur) => (cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code]));
    setErrors((er) => ({ ...er, levels: undefined }));
  }

  function messageFor(code: string | undefined): string {
    switch (code) {
      case "invalid-name": return c.errName;
      case "invalid-centre": return c.errCentre;
      case "invalid-city": return c.errCity;
      case "invalid-phone": return c.errPhone;
      case "invalid-teachers": return c.errTeachers;
      case "invalid-levels": return c.errLevels;
      case "too-long": return c.errTooLong;
      case "rate-limited": return c.errRate;
      default: return c.errGeneric;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setErrors({});
    const teachers = values.teachers.trim();
    const payload: Payload = {
      name: values.name,
      centreName: values.centreName,
      city: values.city,
      phone: values.phone,
      teachersCount: teachers ? Number(teachers.replace(",", ".")) : null,
      levels,
      message: values.message,
      locale,
      page: `/${locale}${PAGE_PATH}`,
      ...readStored(),
      website: values.website,
    };
    try {
      const res = await submitCentreLead(payload);
      if (res.ok) {
        setDone(true);
        try {
          window.sessionStorage.removeItem(STORE_KEY);
        } catch {
          /* nothing to clear */
        }
        return;
      }
      const field = (FIELDS as readonly string[]).includes(res.field ?? "") ? (res.field as FieldName) : null;
      if (field) {
        setErrors({ [field]: messageFor(res.error) });
        // After the render that marks it invalid.
        requestAnimationFrame(() => refs.current[field]?.focus());
      } else {
        setFormError(messageFor(res.error));
      }
    } catch {
      setFormError(c.errGeneric);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div ref={successRef} tabIndex={-1} role="status" className="ce-success" data-e2e="centre-lead-success">
        <span className="ce-success-ic" aria-hidden="true">
          <IconCheck />
        </span>
        {c.success}
      </div>
    );
  }

  const levelsErrId = errors.levels ? "ce-levels-error" : undefined;

  return (
    <form className="ce-form" onSubmit={onSubmit} noValidate data-e2e="centre-lead-form" aria-labelledby="ce-form-title">
      <h2 id="ce-form-title" className="web-h2 ce-h2">{c.title}</h2>
      <div className="ce-form-row">
        <Field label={c.name} error={errors.name}>
          <span className="inp">
            <input ref={(el) => { refs.current.name = el; }} name="name" autoComplete="name" required aria-required="true"
              maxLength={LIM.name} value={values.name} onChange={set("name")} data-e2e="lead-name" />
          </span>
        </Field>
        <Field label={c.centreName} error={errors.centreName}>
          <span className="inp">
            <input ref={(el) => { refs.current.centreName = el; }} name="centreName" autoComplete="organization" required aria-required="true"
              maxLength={LIM.centreName} value={values.centreName} onChange={set("centreName")} data-e2e="lead-centre" />
          </span>
        </Field>
      </div>
      <div className="ce-form-row">
        <Field label={c.city} error={errors.city}>
          <span className="inp">
            <input ref={(el) => { refs.current.city = el; }} name="city" autoComplete="address-level2" required aria-required="true"
              maxLength={LIM.city} value={values.city} onChange={set("city")} data-e2e="lead-city" />
          </span>
        </Field>
        <Field label={c.phone} error={errors.phone}>
          <span className="inp">
            <input ref={(el) => { refs.current.phone = el; }} name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr"
              required aria-required="true" maxLength={LIM.phoneMax + 8} value={values.phone} onChange={set("phone")} data-e2e="lead-phone" />
          </span>
        </Field>
      </div>
      <div className="ce-form-row">
        <Field label={c.teachers} error={errors.teachersCount}>
          <span className="inp">
            <input ref={(el) => { refs.current.teachersCount = el; }} name="teachersCount" type="number" inputMode="numeric"
              min={1} max={LIM.teachersMax} step={1} value={values.teachers} onChange={set("teachers")} data-e2e="lead-teachers" />
          </span>
        </Field>
      </div>

      <fieldset
        className="ce-levels"
        aria-describedby={levelsErrId}
        aria-invalid={errors.levels ? true : undefined}
        ref={(el) => { refs.current.levels = el; }}
        tabIndex={errors.levels ? -1 : undefined}
        data-e2e="lead-levels"
      >
        <legend className="field-label">{c.levels}</legend>
        <div className="ce-level-list">
          {LEVEL_CODES.map((code) => (
            <label key={code} className="ce-level">
              <input type="checkbox" name="levels" value={code} checked={levels.includes(code)} onChange={() => toggleLevel(code)} />
              {LEVEL_LABELS[code][locale]}
            </label>
          ))}
        </div>
        {errors.levels && <div id={levelsErrId} role="alert" className="help text-rose font-semibold">{errors.levels}</div>}
      </fieldset>

      <Field label={c.message} error={errors.message}>
        <span className="inp">
          <textarea ref={(el) => { refs.current.message = el; }} name="message" rows={3} maxLength={LIM.message}
            value={values.message} onChange={set("message")} data-e2e="lead-message" />
        </span>
      </Field>

      {/* The honeypot (see centres.css .ce-hp): never filled by a person. */}
      <div className="ce-hp" aria-hidden="true">
        <label>
          {c.honeypot}
          <input name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set("website")} />
        </label>
      </div>

      {formError && <p role="alert" className="ce-form-error" data-e2e="centre-lead-error">{formError}</p>}

      <button type="submit" className="btn btn-primary ce-submit" disabled={busy} data-e2e="centre-lead-submit">
        {busy ? c.sending : c.submit}
      </button>
      {/* LEGAL-REVIEW: the consent sentence lives in packages/shared/src/legal.ts. */}
      <p className="ce-consent" data-e2e="centre-lead-consent">{CENTRE_LEAD_CONSENT_TEXT[locale]}</p>
    </form>
  );
}
