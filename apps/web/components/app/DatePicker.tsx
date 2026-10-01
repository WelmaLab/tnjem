"use client";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Calendar, Back, Forward } from "@/components/icons";
import { MONTHS_FR, monthLabel, tunisWallTime } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ══════════════════════════════════════════════════════════════════════════════
   espace prof v2 · shell — THE DATE AND TIME FIELDS OF THE PROF SPACE (rule 6).

   « Formats tunisiens : date JJ/MM/AAAA, heure 24 h. Fini le sélecteur natif
   mm/dd/yyyy. » A native date / datetime-local input renders in the BROWSER's
   locale — an English phone shows mm/dd/yyyy and a 12-hour clock — so a tutor in
   Sfax typing 08/10 could book the 10th of August. These never do:

     <DatePicker>    a JJ/MM/AAAA text field (typing works, slashes are added) and a
                     calendar button. The calendar is a real grid: arrow keys move a
                     day (mirrored in Arabic), Home/End the week, PageUp/PageDown a
                     month (+Shift: a year), Enter/Space picks, Escape closes and
                     returns focus. Days before `min` cannot be picked.
     <TimeInput>     HH:MM, 24 h. A spinbutton: ArrowUp/ArrowDown move by `step`.
     <DateTimeField> both, side by side, producing the WALL TIME the API expects
                     ("2026-10-08T18:00", read as Tunis time by parseScheduleInput).

   Values are plain strings: "YYYY-MM-DD", "HH:MM", "YYYY-MM-DDTHH:MM", or "" while
   incomplete or invalid. Nothing here converts a timezone — the wall time IS the
   value, exactly like the datetime-local it replaces.
   ══════════════════════════════════════════════════════════════════════════════ */

const copy = bilingual({
  fr: {
    open: "Ouvrir le calendrier",
    choose: "Choisir une date",
    prev: "Mois précédent",
    next: "Mois suivant",
    datePh: "jj/mm/aaaa",
    timePh: "hh:mm",
    date: "Date",
    time: "Heure",
    tz: "Heure de Tunisie, sur 24 h.",
    months: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
    days: ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
    daysShort: ["lu", "ma", "me", "je", "ve", "sa", "di"],
    today: "aujourd'hui",
  },
  ar: {
    open: "حلّ الرزنامة",
    choose: "اختار نهار",
    prev: "الشهر اللي فات",
    next: "الشهر الجاي",
    datePh: "نهار/شهر/عام",
    timePh: "ساعة:دقيقة",
    date: "النهار",
    time: "الوقت",
    tz: "بتوقيت تونس، على 24 ساعة.",
    months: MONTHS_FR.map((m) => monthLabel(m, "ar")),
    days: ["الإثنين", "الثلاثاء", "الإربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
    daysShort: ["إث", "ثل", "إر", "خم", "جم", "سب", "أح"],
    today: "اليوم",
  },
});

type YMD = { y: number; m: number; d: number }; // m: 1–12

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = ({ y, m, d }: YMD) => `${y}-${pad(m)}-${pad(d)}`;
const toDisplay = ({ y, m, d }: YMD) => `${pad(d)}/${pad(m)}/${y}`;

function fromIso(s: string | undefined | null): YMD | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!r) return null;
  return valid({ y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) });
}

/** A real calendar day, or null (30/02, 00/13…). */
function valid(v: YMD): YMD | null {
  if (v.y < 1900 || v.y > 2200 || v.m < 1 || v.m > 12 || v.d < 1) return null;
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d));
  return t.getUTCFullYear() === v.y && t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d ? v : null;
}

/** Calendar arithmetic in UTC: a day is a day, whatever the browser's zone. */
function addDays(v: YMD, n: number): YMD {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function addMonths(v: YMD, n: number): YMD {
  const first = new Date(Date.UTC(v.y, v.m - 1 + n, 1));
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: Math.min(v.d, last) };
}
/** 0 = Monday … 6 = Sunday (the Tunisian week starts on Monday). */
const weekday = (v: YMD) => (new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay() + 6) % 7;
const cmp = (a: YMD, b: YMD) => toIso(a).localeCompare(toIso(b));

/** Today in Tunis — the day a class is booked against. */
function todayTunis(): YMD {
  const w = tunisWallTime(Date.now());
  return { y: w.year, m: w.month, d: w.day };
}

/** "0810" → "08/10", "08102026" → "08/10/2026": slashes added as the digits arrive. */
function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
function parseDisplay(text: string): YMD | null {
  const r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  return r ? valid({ y: Number(r[3]), m: Number(r[2]), d: Number(r[1]) }) : null;
}

/* ══ DatePicker ═════════════════════════════════════════════════════════════ */
export function DatePicker({
  value,
  onChange,
  min,
  id,
  inputRef,
  invalid,
  describedBy,
  required,
}: {
  /** "YYYY-MM-DD", or "" when empty/invalid. */
  value: string;
  onChange: (iso: string) => void;
  /** Earliest pickable day, "YYYY-MM-DD". Defaults to today in Tunis. Pass null for none. */
  min?: string | null;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const rtl = locale === "ar";
  const autoId = useId();
  const inputId = id ?? `${autoId}-date`;
  const gridLabelId = `${autoId}-month`;

  const minYmd = useMemo<YMD | null>(() => (min === null ? null : fromIso(min ?? "") ?? todayTunis()), [min]);
  const [text, setText] = useState(() => {
    const v = fromIso(value);
    return v ? toDisplay(v) : "";
  });
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<YMD>(() => fromIso(value) ?? minYmd ?? todayTunis());

  // A value set from outside (a prefill, a reset) shows up in the field.
  useEffect(() => {
    const v = fromIso(value);
    const shown = parseDisplay(text);
    if (v && (!shown || toIso(shown) !== value)) setText(toDisplay(v));
    if (!value && shown) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLTableElement>(null);

  // Click outside closes; focus goes nowhere surprising.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // The focused day follows the keyboard.
  useEffect(() => {
    if (!open) return;
    const btn = gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${toIso(focus)}"]`);
    btn?.focus();
  }, [open, focus]);

  function commitText(next: string) {
    setText(next);
    const v = parseDisplay(next);
    onChange(v ? toIso(v) : "");
    if (v) setFocus(v);
  }

  function pick(v: YMD) {
    if (minYmd && cmp(v, minYmd) < 0) return;
    setText(toDisplay(v));
    onChange(toIso(v));
    setOpen(false);
    toggleRef.current?.focus();
  }

  function openCalendar() {
    const v = fromIso(value);
    setFocus(v ?? (minYmd && cmp(todayTunis(), minYmd) < 0 ? minYmd : todayTunis()));
    setOpen(true);
  }

  function onGridKey(e: KeyboardEvent<HTMLTableElement>) {
    const fwd = rtl ? -1 : 1; // the grid is mirrored in Arabic: "left" is the next day
    const moves: Record<string, () => YMD> = {
      ArrowRight: () => addDays(focus, fwd),
      ArrowLeft: () => addDays(focus, -fwd),
      ArrowDown: () => addDays(focus, 7),
      ArrowUp: () => addDays(focus, -7),
      Home: () => addDays(focus, -weekday(focus)),
      End: () => addDays(focus, 6 - weekday(focus)),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
    };
    if (moves[e.key]) {
      e.preventDefault();
      setFocus(moves[e.key]());
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    }
  }

  // The month on screen: the focused day's, Monday-first, padded to whole weeks.
  const first: YMD = { y: focus.y, m: focus.m, d: 1 };
  const start = addDays(first, -weekday(first));
  const weeks: YMD[][] = [];
  for (let w = 0, day = start; w < 6; w++) {
    const row: YMD[] = [];
    for (let i = 0; i < 7; i++, day = addDays(day, 1)) row.push(day);
    if (w > 3 && row[0].m !== focus.m) break;
    weeks.push(row);
  }
  const today = todayTunis();
  const selected = fromIso(value);
  const title = `${c.months[focus.m - 1]} ${focus.y}`;

  return (
    <div ref={wrapRef} className="aps-dp">
      <div className="inp aps-dp-inp">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          placeholder={c.datePh}
          value={text}
          onChange={(e) => commitText(maskDate(e.target.value))}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required={required}
          maxLength={10}
          data-e2e="date-input"
        />
        <button
          ref={toggleRef}
          type="button"
          className="aps-dp-btn"
          aria-label={c.open}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => (open ? setOpen(false) : openCalendar())}
          data-e2e="date-open"
        >
          <Calendar />
        </button>
      </div>

      {open && (
        <div className="aps-pop aps-dp-pop" role="dialog" aria-modal="false" aria-label={c.choose} data-e2e="date-calendar">
          <div className="aps-dp-head">
            <button type="button" className="aps-tool" aria-label={c.prev} onClick={() => setFocus(addMonths(focus, -1))}>
              <Back />
            </button>
            <p id={gridLabelId} className="aps-dp-title" aria-live="polite">{title}</p>
            <button type="button" className="aps-tool" aria-label={c.next} onClick={() => setFocus(addMonths(focus, 1))}>
              <Forward />
            </button>
          </div>
          <table ref={gridRef} className="aps-dp-grid" role="grid" aria-labelledby={gridLabelId} onKeyDown={onGridKey}>
            <thead>
              <tr>
                {c.daysShort.map((d, i) => (
                  <th key={d} scope="col" aria-label={c.days[i]}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((row) => (
                <tr key={toIso(row[0])}>
                  {row.map((day) => {
                    const iso = toIso(day);
                    const out = day.m !== focus.m;
                    const disabled = Boolean(minYmd && cmp(day, minYmd) < 0);
                    const isSel = Boolean(selected && cmp(day, selected) === 0);
                    const isToday = cmp(day, today) === 0;
                    const isFocus = cmp(day, focus) === 0;
                    return (
                      <td key={iso} role="gridcell" aria-selected={isSel}>
                        <button
                          type="button"
                          data-date={iso}
                          tabIndex={isFocus ? 0 : -1}
                          className={`aps-dp-day${out ? " is-out" : ""}${isSel ? " is-sel" : ""}${isToday ? " is-today" : ""}`}
                          aria-disabled={disabled || undefined}
                          aria-current={isToday ? "date" : undefined}
                          aria-label={`${c.days[weekday(day)]} ${day.d} ${c.months[day.m - 1]} ${day.y}${isToday ? `, ${c.today}` : ""}`}
                          onClick={() => (disabled ? undefined : pick(day))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (!disabled) pick(day);
                            }
                          }}
                        >
                          {day.d}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ══ TimeInput ══════════════════════════════════════════════════════════════ */
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
function parseTime(text: string): number | null {
  const r = /^(\d{2}):(\d{2})$/.exec(text);
  if (!r) return null;
  const h = Number(r[1]);
  const m = Number(r[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}
const fmtTime = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

export function TimeInput({
  value,
  onChange,
  step = 15,
  id,
  inputRef,
  invalid,
  describedBy,
  required,
}: {
  /** "HH:MM" (24 h), or "" when empty/invalid. */
  value: string;
  onChange: (hhmm: string) => void;
  /** Minutes per ArrowUp/ArrowDown. */
  step?: number;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [text, setText] = useState(value);
  useEffect(() => {
    if (value && value !== text) setText(value);
    if (!value && parseTime(text) !== null) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(next: string) {
    setText(next);
    const mins = parseTime(next);
    onChange(mins === null ? "" : fmtTime(mins));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const now = parseTime(text) ?? 12 * 60;
    // Snap to the step grid, then move: 18:07 ↑ → 18:15, not 18:22.
    const snapped = e.key === "ArrowUp" ? Math.floor(now / step) * step + step : Math.ceil(now / step) * step - step;
    commit(fmtTime(((snapped % 1440) + 1440) % 1440));
  }

  const mins = parseTime(text);
  return (
    <div className="inp aps-time">
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        dir="ltr"
        role="spinbutton"
        aria-valuemin={0}
        aria-valuemax={1439}
        aria-valuenow={mins ?? undefined}
        aria-valuetext={mins === null ? undefined : fmtTime(mins)}
        placeholder={c.timePh}
        value={text}
        onChange={(e) => commit(maskTime(e.target.value))}
        onKeyDown={onKey}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required={required}
        maxLength={5}
        data-e2e="time-input"
      />
    </div>
  );
}

/* ══ DateTimeField ══════════════════════════════════════════════════════════ */
/** Split a wall time "YYYY-MM-DDTHH:MM" into its two halves. */
export function splitWall(wall: string): { date: string; time: string } {
  const r = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(wall ?? "");
  return r ? { date: r[1], time: r[2] } : { date: "", time: "" };
}

export function DateTimeField({
  value,
  onChange,
  min,
  error,
  help,
  dateRef,
  dateLabel,
  timeLabel,
  required,
}: {
  /** The wall time "YYYY-MM-DDTHH:MM" (Tunis), or "" while incomplete. */
  value: string;
  onChange: (wall: string) => void;
  min?: string | null;
  error?: string;
  /** Under the fields. Defaults to "Heure de Tunisie, sur 24 h." */
  help?: string;
  /** For focusing the field after a refusal. */
  dateRef?: Ref<HTMLInputElement>;
  dateLabel?: string;
  timeLabel?: string;
  required?: boolean;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const uid = useId();
  const [parts, setParts] = useState(() => splitWall(value));

  // A value set from outside (prefill, reset) reaches both halves.
  useEffect(() => {
    const p = splitWall(value);
    if (value && (p.date !== parts.date || p.time !== parts.time)) setParts(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function update(next: { date: string; time: string }) {
    setParts(next);
    onChange(next.date && next.time ? `${next.date}T${next.time}` : "");
  }

  const helpId = `${uid}-help`;
  const errId = `${uid}-err`;
  const describedBy = [error ? errId : null, helpId].filter(Boolean).join(" ");
  return (
    <div className="aps-dt" data-e2e="datetime-field" data-value={value}>
      <div className="aps-dt-row">
        <div className="aps-dt-date">
          <label htmlFor={`${uid}-d`} className="field-label">{dateLabel ?? c.date}</label>
          <DatePicker
            id={`${uid}-d`}
            value={parts.date}
            onChange={(date) => update({ ...parts, date })}
            min={min}
            inputRef={dateRef}
            invalid={Boolean(error)}
            describedBy={describedBy}
            required={required}
          />
        </div>
        <div className="aps-dt-time">
          <label htmlFor={`${uid}-t`} className="field-label">{timeLabel ?? c.time}</label>
          <TimeInput
            id={`${uid}-t`}
            value={parts.time}
            onChange={(time) => update({ ...parts, time })}
            invalid={Boolean(error)}
            describedBy={describedBy}
            required={required}
          />
        </div>
      </div>
      {error && (
        <div id={errId} role="alert" className="help text-rose font-semibold">
          {error}
        </div>
      )}
      <div id={helpId} className="help">{help ?? c.tz}</div>
    </div>
  );
}
