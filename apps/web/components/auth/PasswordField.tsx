"use client";
/* espace prof v2 · auth (phase 2) — the password field, used by /auth, both signup
   pages and Réglages › Sécurité (components/settings/SecurityPanel.tsx).

   NOT <Field>. Field wraps its control in a <label>, and a show/hide button inside a
   label lends its own name to the input ("Mot de passe Afficher le mot de passe") —
   so this renders the same .field / .field-label / .inp / .help markup with a
   <label htmlFor> beside the box instead, and wires aria-describedby/aria-invalid
   itself, the way Field does.

   The toggle is a real 44×44 button (aria-pressed, a name that says what it will
   do) and never submits the form. The meter is a heuristic from
   @tnajem/shared/password-policy — the API's refusal is the authority, and when it
   refuses, its reason is the `error` shown here. The 10k list never reaches this
   bundle (apps/api/test/ep2-password-policy.test.ts checks the imports). */
import { useId, useState } from "react";
import type { Ref } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Lock, Eye } from "@/components/icons";
import { passwordStrength, passwordLengthProblem, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@tnajem/shared";

const COPY = {
  fr: {
    show: "Afficher le mot de passe",
    hide: "Masquer le mot de passe",
    strength: "Force du mot de passe",
    levels: ["Trop court", "Faible", "Moyen", "Bon", "Excellent"],
  },
  ar: {
    show: "ورّي كلمة السرّ",
    hide: "خبّي كلمة السرّ",
    strength: "قوّة كلمة السرّ",
    levels: ["قصيرة برشا", "ضعيفة", "متوسّطة", "باهية", "ممتازة"],
  },
} as const;

/* The eye with a stroke through it. Local, in the icons.tsx line style, so this
   feature does not grow a file four teams append to. */
function EyeOff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`ic ${className ?? ""}`} aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .4 4.3 1.1M21.5 12s-1.2 2.2-3.4 4.1M12 18.5c-6 0-9.5-6.5-9.5-6.5s.9-1.7 2.6-3.4" />
      <path d="M9.9 9.9a2.6 2.6 0 0 0 3.7 3.7" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </svg>
  );
}

export type PasswordFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** "current-password" on sign-in and "change"; "new-password" everywhere a password is chosen. */
  autoComplete: "current-password" | "new-password";
  error?: string;
  help?: string;
  /** Show the strength meter under the box (new passwords only). */
  meter?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  name?: string;
  /** data-e2e hook on the input. */
  e2e?: string;
};

export function PasswordField({ label, value, onChange, autoComplete, error, help, meter, inputRef, autoFocus, name, e2e }: PasswordFieldProps) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const [shown, setShown] = useState(false);
  const uid = useId();
  const id = `${uid}-pw`;
  const errorId = error ? `${uid}-error` : undefined;
  const helpId = help ? `${uid}-help` : undefined;
  const meterId = meter ? `${uid}-meter` : undefined;
  const describedBy = [errorId, helpId, meterId].filter(Boolean).join(" ") || undefined;

  const score = passwordStrength(value);
  const filled = value ? Math.max(1, score) : 0;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="inp pw-inp">
        <Lock />
        <input
          id={id}
          ref={inputRef}
          name={name}
          type={shown ? "text" : "password"}
          /* A password may hold Arabic as well as Latin: let the browser decide. */
          dir="auto"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          data-e2e={e2e}
          className="min-w-0"
        />
        <button
          type="button"
          className="pw-toggle"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-controls={id}
          aria-label={shown ? c.hide : c.show}
          data-e2e="password-toggle"
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {meter && (
        <div id={meterId} className="pw-meter" data-e2e="password-meter" data-score={value ? score : ""}>
          {/* The colour comes from data-score in CSS: no class name is built at runtime
              (Tailwind keeps only the class names it can read in the source). */}
          <div className="pw-meter-bars" data-score={score} aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= filled ? "on" : undefined} />
            ))}
          </div>
          {/* A word, not a colour alone (WCAG 1.4.1). Polite: it changes as they type. */}
          <span className="pw-meter-label" aria-live="polite">
            {value ? `${c.strength} : ${c.levels[score]}` : ""}
          </span>
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="help text-rose font-semibold" data-e2e="password-error">
          {error}
        </div>
      )}
      {help && <div id={helpId} className="help">{help}</div>}
    </div>
  );
}

/* The rules and the API's refusals, in words. Shared by every screen that asks for
   a new password, so the same refusal never reads two ways. */
const MESSAGES = {
  fr: {
    help: `${PASSWORD_MIN_LENGTH} caractères minimum. Une courte phrase facile à retenir vaut mieux qu'un mot compliqué.`,
    empty: "Choisis un mot de passe.",
    tooShort: `Trop court : ${PASSWORD_MIN_LENGTH} caractères minimum.`,
    tooLong: `Trop long : ${PASSWORD_MAX_LENGTH} caractères maximum.`,
    tooCommon: "Ce mot de passe est trop courant. Choisis-en un moins facile à deviner.",
  },
  ar: {
    help: `${PASSWORD_MIN_LENGTH} حروف على الأقل. جملة قصيرة تتفكّرها خير من كلمة معقّدة.`,
    empty: "اختار كلمة سرّ.",
    tooShort: `قصيرة برشا : ${PASSWORD_MIN_LENGTH} حروف على الأقل.`,
    tooLong: `طويلة برشا : ${PASSWORD_MAX_LENGTH} حرف على الأكثر.`,
    tooCommon: "كلمة السرّ هاذي معروفة برشا. اختار وحدة أصعب في التخمين.",
  },
} as const;

/** The length rule in words, for a `help` line. The API enforces it. */
export function passwordHelp(locale: "fr" | "ar"): string {
  return MESSAGES[locale].help;
}

/** The API's refusal reason (or the client's own length check), for the field's `error`. */
export function weakPasswordMessage(locale: "fr" | "ar", reason: string | undefined): string {
  const m = MESSAGES[locale];
  if (reason === "empty") return m.empty;
  if (reason === "too-short") return m.tooShort;
  if (reason === "too-long") return m.tooLong;
  return m.tooCommon;
}

/** The client's courtesy check before a round trip: the same length rule the API runs. */
export function clientPasswordProblem(password: string): "empty" | "too-short" | "too-long" | null {
  if (!password) return "empty";
  return passwordLengthProblem(password);
}
