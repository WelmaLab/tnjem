"use client";
/* The one-time-code field of the sign-up and sign-in pages: six boxes
   (UI_AUTH_OPTION_B.md §1.3). The exported names and prop types are the contract
   SignupInner and AuthInner compile against — do not change them.

   THE VALUE MODEL. `value` is a digits-only string filled left to right: box i
   shows value[i], and there are never holes. So focus is confined to the filled
   boxes plus the FIRST EMPTY one — clicking or focusing a box further along lands
   on the first empty box — and only that box is in the tab order (roving
   tabindex). Without that, Tab from the first box of an empty code would land on
   box 2, be sent back to box 1, and never leave: a keyboard trap.

   NO maxLength, anywhere. SMS autofill (iOS QuickType, Android) and Playwright's
   fill() put the WHOLE code into the first box in one go; a maxLength of 1 would
   silently keep the first digit and drop five. Whatever arrives is read here and
   distributed across the boxes.

   onComplete fires when a user action COMPLETES the code — typing the sixth
   digit, pasting or autofilling six — which replaces the old "submit on the
   sixth". It does not fire when one digit of an already-complete code is
   replaced: that is someone correcting a code, and they press Vérifier. */
import { useId, useLayoutEffect, useRef } from "react";
import type { ChangeEvent, ClipboardEvent, FocusEvent, KeyboardEvent, MouseEvent, Ref } from "react";
import { useLocale } from "@/components/LocaleProvider";

export const OTP_LENGTH = 6;

/* Each box's accessible name. The group itself is named by the page (`label`). */
const COPY = {
  fr: {
    digit: (n: number, of: number) => `Chiffre ${n} sur ${of}`,
  },
  ar: {
    digit: (n: number, of: number) => `الرقم ${n} من ${of}`,
  },
} as const;

export type OtpInputProps = {
  /** Digits only, filled left to right, 0–6 characters. Controlled by the form. */
  value: string;
  /** Every edit, with the new digits-only value. */
  onChange: (value: string) => void;
  /** Fires when a user action completes the 6th digit (typing, paste, SMS autofill). */
  onComplete?: (code: string) => void;
  /** Accessible name of the group of boxes (from the page's copy object). */
  label: string;
  /** Set → every box gets the rose border + aria-invalid, and the message is rendered
      under the boxes (role="alert") and referenced by each box's aria-describedby. */
  error?: string;
  /** Ref to the FIRST box, so the form can move focus there. */
  inputRef?: Ref<HTMLInputElement>;
  /** Focus the first empty box when the component mounts. */
  autoFocus?: boolean;
  disabled?: boolean;
};

const onlyDigits = (s: string) => s.replace(/\D/g, "");

function assignRef<T>(ref: Ref<T> | undefined, el: T | null) {
  if (typeof ref === "function") ref(el);
  else if (ref) (ref as { current: T | null }).current = el;
}

/** What the keystroke ADDED to a box that already held `prev`. Focus selects the
    box's digit so a typed one replaces it, but a click can collapse that selection;
    then the box briefly holds two characters and the caret says which one is new. */
function insertedText(raw: string, prev: string, caret: number | null): string {
  if (prev && raw.length > prev.length) {
    const at = caret ?? raw.length;
    if (at === raw.length && raw.startsWith(prev)) return raw.slice(prev.length);
    if (at === raw.length - prev.length && raw.endsWith(prev)) return raw.slice(0, raw.length - prev.length);
  }
  return raw;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  error,
  inputRef,
  autoFocus,
  disabled,
}: OtpInputProps) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const errorId = `${useId()}-error`;
  const digits = onlyDigits(value).slice(0, OTP_LENGTH);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  /* The value as of the last edit made HERE. Focus moves inside the same event
     that calls onChange, before the parent has re-rendered with the new value — a
     handler reading the `value` prop there would still see the old one (and send
     the next box's focus back to the "first empty" box that was just filled). */
  const current = useRef(digits);
  useLayoutEffect(() => {
    current.current = digits;
  }, [digits]);

  /** The box that may hold focus: the first empty one (the last when full). */
  const active = Math.min(digits.length, OTP_LENGTH - 1);

  function focusBox(i: number) {
    const k = Math.max(0, Math.min(i, current.current.length, OTP_LENGTH - 1));
    const el = boxes.current[k];
    if (!el) return;
    el.focus();
    el.select();
  }

  function commit(next: string, focusAt: number, completes: boolean) {
    current.current = next;
    onChange(next);
    focusBox(focusAt);
    if (completes && next.length === OTP_LENGTH) onComplete?.(next);
  }

  /** Put `typed` (1+ digits) in at box `pos`. Six or more digits is a whole code —
      pasted, autofilled or fill()ed — and fills every box from the start; fewer
      overwrite from the current box on. */
  function place(pos: number, typed: string) {
    const cur = current.current;
    if (typed.length >= OTP_LENGTH) {
      commit(typed.slice(0, OTP_LENGTH), OTP_LENGTH - 1, true);
      return;
    }
    const next = (cur.slice(0, pos) + typed + cur.slice(pos + typed.length)).slice(0, OTP_LENGTH);
    commit(next, pos + typed.length, cur.length < OTP_LENGTH);
  }

  function handleChange(i: number, e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const raw = el.value;
    const cur = current.current;
    const pos = Math.min(i, cur.length);
    const prev = cur[i] ?? "";
    const rawDigits = onlyDigits(raw);
    const added = onlyDigits(insertedText(raw, prev, el.selectionStart));
    /* A whole code landed in this box at once. It REPLACED the box's content —
       unless the old digit is still stuck to it, in which case `added` has the
       six without it. */
    const typed = rawDigits.length >= OTP_LENGTH && added.length < OTP_LENGTH ? rawDigits : added;
    if (typed) {
      place(pos, typed);
      return;
    }
    // Emptied without a Backspace keydown (cut, or a keyboard that sends none).
    if (!raw && pos < cur.length) commit(cur.slice(0, pos) + cur.slice(pos + 1), pos, false);
    /* Otherwise a letter or a symbol: no onChange, so React puts the controlled
       box back to its digit. */
  }

  function handleKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    const cur = current.current;
    const pos = Math.min(i, cur.length);
    switch (e.key) {
      case "Backspace":
        e.preventDefault();
        // A filled box clears itself; an empty one goes back and clears the previous box.
        if (pos < cur.length) commit(cur.slice(0, pos) + cur.slice(pos + 1), pos, false);
        else if (pos > 0) commit(cur.slice(0, pos - 1), pos - 1, false);
        return;
      case "Delete":
        e.preventDefault();
        if (pos < cur.length) commit(cur.slice(0, pos) + cur.slice(pos + 1), pos, false);
        return;
      // The row is always dir="ltr", so left is always the previous box.
      case "ArrowLeft":
        e.preventDefault();
        focusBox(pos - 1);
        return;
      case "ArrowRight":
        e.preventDefault();
        focusBox(pos + 1);
        return;
      case "Home":
        e.preventDefault();
        focusBox(0);
        return;
      case "End":
        e.preventDefault();
        focusBox(cur.length);
        return;
    }
  }

  function handlePaste(i: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    // "Ton code : 482 913" pastes as 482913.
    const typed = onlyDigits(e.clipboardData.getData("text"));
    if (typed) place(Math.min(i, current.current.length), typed);
  }

  function handleFocus(i: number, e: FocusEvent<HTMLInputElement>) {
    const first = Math.min(current.current.length, OTP_LENGTH - 1);
    if (i > first) {
      boxes.current[first]?.focus();
      return;
    }
    // Selected, so the next digit typed REPLACES this one.
    e.currentTarget.select();
  }

  /* A click lands its caret after focus has selected the digit; select again, but
     only in the box that actually has focus (not one handleFocus redirected from). */
  function handleClick(e: MouseEvent<HTMLInputElement>) {
    if (document.activeElement === e.currentTarget) e.currentTarget.select();
  }

  return (
    <div role="group" aria-label={label} dir="ltr" data-e2e="otp" className="otp">
      <div className="otp-boxes">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el;
              if (i === 0) assignRef(inputRef, el);
            }}
            className="otp-box"
            data-e2e="otp-digit"
            type="text"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            spellCheck={false}
            aria-label={c.digit(i + 1, OTP_LENGTH)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            tabIndex={i === active ? 0 : -1}
            autoFocus={autoFocus && i === active}
            disabled={disabled}
            value={digits[i] ?? ""}
            onChange={(e) => handleChange(i, e)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={(e) => handlePaste(i, e)}
            onFocus={(e) => handleFocus(i, e)}
            onClick={handleClick}
          />
        ))}
      </div>
      {/* Inside the ltr group, so the message states its own direction. */}
      {error && (
        <p id={errorId} role="alert" data-e2e="otp-error" className="otp-error" dir={locale === "ar" ? "rtl" : "ltr"}>
          {error}
        </p>
      )}
    </div>
  );
}
