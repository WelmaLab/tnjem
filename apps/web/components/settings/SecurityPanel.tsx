"use client";
/* espace prof v2 · auth (phase 2) — RÉGLAGES › SÉCURITÉ (contract C8).

   Self-contained: it loads its own state (getSecurityState → GET /auth/security),
   calls its own actions, and needs no props. Auth mounts it on /account today; the
   shell team moves it into Réglages › Sécurité (/dashboard/settings?tab=securite)
   in Phase 6 — drop it in as <SecurityPanel /> and it works unchanged.

     Props:  heading?: boolean   render the "Sécurité" H2 above the cards (default
                                 true). Pass false where a tab already names it.

   Two cards, matching espace-prof-4-settings-offer.png:
     • Mot de passe — set: "Défini le DD/MM/YYYY" + Changer (current + new). Not
       set: "Pas encore de mot de passe" + Créer, which first sends a code to the
       account's own address (the API refuses a first password without fresh proof
       of the mailbox). Either way the API signs every OTHER device out and e-mails
       the account; the success line says so.
     • Sessions — "Connecté sur N appareils", the list as stored (dates only: the
       sessions table holds no IP, user agent or device name, and this panel does
       not start collecting them), « Se déconnecter » (this device) and
       « Déconnecter partout » (every device, this one included).

   Every rule — the policy, the proof, the lockout — is enforced by the API; the
   errors shown are its answers. Loading shows a skeleton, a failed load says so
   with a retry. */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { Lock, Users } from "@/components/icons";
import { logout, logoutEverywhere } from "@/app/actions";
import { changePassword, getSecurityState, requestPasswordCode, setPassword, type SecurityState } from "@/app/actions-auth";
import { OtpInput, OTP_LENGTH } from "@/components/auth/OtpInput";
import { PasswordField, passwordHelp, weakPasswordMessage, clientPasswordProblem } from "@/components/auth/PasswordField";
import { useCountdown, formatCountdown } from "@/components/useCountdown";
import { formatNumericDate } from "@tnajem/shared";

const COPY = {
  fr: {
    heading: "Sécurité",
    pwTitle: "Mot de passe",
    pwSet: (d: string) => `Défini le ${d}.`,
    pwNone: "Pas encore de mot de passe : tu te connectes avec un code par email.",
    pwChange: "Changer",
    pwCreate: "Créer un mot de passe",
    current: "Mot de passe actuel",
    fresh: "Nouveau mot de passe",
    save: "Enregistrer",
    cancel: "Annuler",
    createIntro: "Pour vérifier que c'est bien toi, on t'envoie d'abord un code par email.",
    sendCode: "Recevoir un code",
    codeLabel: "Code reçu par email",
    codeHelp: "6 chiffres.",
    resend: "Renvoyer le code",
    resendIn: "Renvoyer dans",
    devCodeNote: "Code de test — aucun message n'est envoyé pour l'instant",
    createCta: "Créer mon mot de passe",
    doneChange: "Mot de passe modifié. Tes autres appareils ont été déconnectés.",
    doneCreate: "Mot de passe créé. Tes autres appareils ont été déconnectés.",
    errWrongCurrent: "Mot de passe actuel incorrect.",
    errNeedCurrent: "Entre ton mot de passe actuel.",
    errBadCode: "Code incorrect ou expiré. Vérifie les 6 chiffres, ou demande un nouveau code.",
    errTooMany: (secs: number) => `Trop d'essais. Réessaie dans ${Math.max(1, Math.ceil(secs / 60))} minutes.`,
    errSend: "Envoi du code impossible. Réessaie.",
    errGeneric: "Une erreur s'est produite. Réessaie.",
    sessionsTitle: "Sessions",
    connectedOn: (n: number) => (n <= 1 ? "Connecté sur 1 appareil" : `Connecté sur ${n} appareils`),
    thisDevice: "Cet appareil",
    otherDevice: "Autre appareil",
    since: (d: string) => `connecté le ${d}`,
    lastSeen: (d: string) => `dernière activité le ${d}`,
    logout: "Se déconnecter",
    logoutAll: "Déconnecter partout",
    logoutAllHint: "Un téléphone perdu ou prêté ? « Déconnecter partout » arrête toutes tes connexions, celle-ci comprise.",
    loadFailed: "Impossible de charger ces informations.",
    retry: "Réessayer",
    loading: "Chargement…",
  },
  ar: {
    heading: "الأمان",
    pwTitle: "كلمة السرّ",
    pwSet: (d: string) => `تعملت نهار ${d}.`,
    pwNone: "ما عندكش كلمة سرّ : تدخل بكود يوصلك في الإيميل.",
    pwChange: "بدّل",
    pwCreate: "اعمل كلمة سرّ",
    current: "كلمة السرّ الحالية",
    fresh: "كلمة السرّ الجديدة",
    save: "سجّل",
    cancel: "بطّل",
    createIntro: "باش نتثبّتو إلّي إنتي، نبعثولك قبل كود في الإيميل.",
    sendCode: "ابعثلي كود",
    codeLabel: "الكود اللي وصلك في الإيميل",
    codeHelp: "6 أرقام.",
    resend: "عاود ابعث الكود",
    resendIn: "عاود ابعث بعد",
    devCodeNote: "كود للتجربة — توّا ما تتبعث حتى رسالة",
    createCta: "اعمل كلمة السرّ",
    doneChange: "كلمة السرّ تبدّلت. خرّجناك من الأجهزة الأخرى.",
    doneCreate: "كلمة السرّ تعملت. خرّجناك من الأجهزة الأخرى.",
    errWrongCurrent: "كلمة السرّ الحالية موش صحيحة.",
    errNeedCurrent: "حطّ كلمة السرّ الحالية.",
    errBadCode: "الكود موش صحيح ولا سالا. شوف الـ 6 أرقام، ولا اطلب كود جديد.",
    errTooMany: (secs: number) => `برشا محاولات. عاود بعد ${Math.max(1, Math.ceil(secs / 60))} دقايق.`,
    errSend: "تعذّر إرسال الكود. عاود المحاولة.",
    errGeneric: "صارت مشكلة. عاود جرّب.",
    sessionsTitle: "الجلسات",
    connectedOn: (n: number) => (n <= 1 ? "داخل من جهاز واحد" : n === 2 ? "داخل من جهازين" : `داخل من ${n} أجهزة`),
    thisDevice: "الجهاز هذا",
    otherDevice: "جهاز آخر",
    since: (d: string) => `دخلت نهار ${d}`,
    lastSeen: (d: string) => `آخر نشاط نهار ${d}`,
    logout: "اخرج",
    logoutAll: "اخرج من الأجهزة الكل",
    logoutAllHint: "تليفون ضاع ولا سلّفتو؟ « اخرج من الأجهزة الكل » يسكّر الدخول في الأجهزة الكل، حتى هذا.",
    loadFailed: "ما نجّمناش نحمّلو المعلومات هاذي.",
    retry: "عاود جرّب",
    loading: "قاعد يحمّل…",
  },
} as const;

type PwMode = "closed" | "change" | "create";

export function SecurityPanel({ heading = true }: { heading?: boolean } = {}) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const { toast, showToast } = useToast();
  const headingId = useId();

  const [state, setState] = useState<SecurityState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await getSecurityState();
      if (res.ok) setState(res);
      else setLoadError(true);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── the password card ──
  const [mode, setMode] = useState<PwMode>("closed");
  const [current, setCurrent] = useState("");
  const [fresh, setFresh] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: "current" | "fresh" | "code"; message: string } | null>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const freshRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const cooldown = useCountdown();

  function resetForm(next: PwMode) {
    setMode(next);
    setCurrent(""); setFresh(""); setCode(""); setCodeSent(false); setDevCode(null);
    setError(null); setFieldError(null);
  }

  function invalid(field: "current" | "fresh" | "code", message: string) {
    setError(null);
    setFieldError({ field, message });
    (field === "current" ? currentRef : field === "fresh" ? freshRef : codeRef).current?.focus();
  }

  async function sendCode() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await requestPasswordCode({ locale });
      if (res.ok) {
        setCodeSent(true);
        setDevCode(res.devCode ?? null);
        cooldown.start(res.resendAfter ?? 0);
      } else if (res.error === "too-soon") {
        setCodeSent(true); // a live code is already on its way
        cooldown.start(res.retryAfter ?? 0);
      } else if (res.error === "has-password") {
        await load();
        resetForm("closed");
      } else {
        setError(c.errSend);
      }
    } catch {
      setError(c.errGeneric);
    }
    setBusy(false);
  }

  async function submit() {
    if (busy) return;
    if (mode === "change" && !current) { invalid("current", c.errNeedCurrent); return; }
    if (mode === "create" && code.length !== OTP_LENGTH) { invalid("code", c.codeHelp); return; }
    const problem = clientPasswordProblem(fresh);
    if (problem) { invalid("fresh", weakPasswordMessage(locale, problem)); return; }
    setBusy(true);
    setError(null);
    setFieldError(null);
    let res: Awaited<ReturnType<typeof changePassword>>;
    try {
      res = mode === "change"
        ? await changePassword({ currentPassword: current, newPassword: fresh })
        : await setPassword({ password: fresh, code });
    } catch {
      setBusy(false);
      setError(c.errGeneric);
      return;
    }
    setBusy(false);
    if (res.ok) {
      showToast(mode === "change" ? c.doneChange : c.doneCreate);
      resetForm("closed");
      await load();
      return;
    }
    if (res.error === "weak-password") { invalid("fresh", weakPasswordMessage(locale, res.reason)); return; }
    if (res.error === "wrong-password") { invalid("current", c.errWrongCurrent); return; }
    if (res.error === "invalid-code") { invalid("code", c.errBadCode); return; }
    if (res.error === "too-many-attempts") { setError(c.errTooMany(res.retryAfter ?? 900)); return; }
    if (res.error === "has-password" || res.error === "no-password" || res.error === "conflict") {
      // The account changed under us (another tab): show what is true now.
      resetForm("closed");
      await load();
      return;
    }
    setError(c.errGeneric);
  }

  // ── the sessions card ──
  async function handleLogout() {
    await logout();
    // Hard navigation, as on /account: a full reload drops every client cache of the signed-in user.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/${locale}`;
  }
  async function handleLogoutEverywhere() {
    await logoutEverywhere();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/${locale}`;
  }

  const sessions = state?.sessions ?? [];

  return (
    <section className="sec-panel" aria-labelledby={heading ? headingId : undefined} aria-label={heading ? undefined : c.heading} data-e2e="security-panel">
      {heading && <h2 id={headingId} className="sec-heading">{c.heading}</h2>}

      {!state && !loadError && (
        <div className="sec-skel" aria-busy="true" aria-live="polite">
          <span className="sr-only">{c.loading}</span>
          <div className="sec-skel-card" />
          <div className="sec-skel-card" />
        </div>
      )}

      {loadError && (
        <Card className="sec-card">
          <p className="sec-text" role="alert">{c.loadFailed}</p>
          <div className="sec-actions">
            <Button variant="outline" sm onClick={() => void load()}>{c.retry}</Button>
          </div>
        </Card>
      )}

      {state && (
        <>
          {/* ── Mot de passe ── */}
          <Card className="sec-card">
            <div className="sec-row">
              <div className="sec-icon" aria-hidden="true"><Lock /></div>
              <div className="sec-body">
                <h3 className="sec-title">{c.pwTitle}</h3>
                <p className="sec-text" data-e2e="password-state">
                  {state.password.set && state.password.setAt ? c.pwSet(formatNumericDate(state.password.setAt)) : c.pwNone}
                </p>
              </div>
              {mode === "closed" && (
                <div className="sec-actions">
                  <Button variant="outline" sm onClick={() => resetForm(state.password.set ? "change" : "create")}>
                    {state.password.set ? c.pwChange : c.pwCreate}
                  </Button>
                </div>
              )}
            </div>

            {mode !== "closed" && (
              <form
                className="sec-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (mode === "create" && !codeSent) void sendCode();
                  else void submit();
                }}
                noValidate
                data-e2e={`password-${mode}-form`}
              >
                {mode === "change" && (
                  <PasswordField
                    label={c.current}
                    value={current}
                    onChange={(v) => { setCurrent(v); if (fieldError?.field === "current") setFieldError(null); }}
                    autoComplete="current-password"
                    error={fieldError?.field === "current" ? fieldError.message : undefined}
                    inputRef={currentRef}
                    autoFocus
                    name="current-password"
                    e2e="current-password"
                  />
                )}

                {mode === "create" && !codeSent && <p className="sec-text mb-3">{c.createIntro}</p>}

                {mode === "create" && codeSent && (
                  <>
                    {devCode && (
                      /* Local development only — see AuthInner: the API returns the code
                         only when no mail provider is configured, and never in production. */
                      <div className="bg-sand border-[1.4px] border-dashed border-ochre-btn rounded-brand py-2.5 px-3 mb-3.5 text-center text-[13px] text-ink2 leading-[1.5]">
                        <b className="font-display text-[18px] tracking-[3px] text-ink block" dir="ltr" data-e2e="dev-code">{devCode}</b>
                        {c.devCodeNote}
                      </div>
                    )}
                    <OtpInput
                      value={code}
                      onChange={(v) => { setCode(v); if (fieldError?.field === "code") setFieldError(null); }}
                      onComplete={() => freshRef.current?.focus()}
                      label={c.codeLabel}
                      error={fieldError?.field === "code" ? fieldError.message : undefined}
                      inputRef={codeRef}
                      autoFocus
                    />
                    <div className="auth-row mb-2">
                      <span />
                      <button
                        type="button"
                        className="auth-link auth-tap disabled:font-normal"
                        onClick={() => void sendCode()}
                        disabled={busy || !cooldown.done}
                      >
                        {cooldown.done ? c.resend : (
                          <>
                            <span aria-hidden="true">{c.resendIn} <b className="font-bold text-ink" dir="ltr">{formatCountdown(cooldown.left)}</b></span>
                            <span className="sr-only">{c.resend}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}

                {(mode === "change" || codeSent) && (
                  <PasswordField
                    label={c.fresh}
                    value={fresh}
                    onChange={(v) => { setFresh(v); if (fieldError?.field === "fresh") setFieldError(null); }}
                    autoComplete="new-password"
                    meter
                    help={passwordHelp(locale)}
                    error={fieldError?.field === "fresh" ? fieldError.message : undefined}
                    inputRef={freshRef}
                    name="new-password"
                    e2e="new-password"
                  />
                )}

                {error && <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start">{error}</p>}

                <div className="sec-form-actions">
                  <Button type="submit" variant="primary" sm disabled={busy}>
                    {mode === "create" && !codeSent ? c.sendCode : mode === "create" ? c.createCta : c.save}
                  </Button>
                  <Button variant="ghost" sm onClick={() => resetForm("closed")} disabled={busy}>{c.cancel}</Button>
                </div>
              </form>
            )}
          </Card>

          {/* ── Sessions ── */}
          <Card className="sec-card">
            <div className="sec-row">
              <div className="sec-icon" aria-hidden="true"><Users /></div>
              <div className="sec-body">
                <h3 className="sec-title">{c.sessionsTitle}</h3>
                <p className="sec-text" data-e2e="sessions-count">{c.connectedOn(sessions.length)}</p>
              </div>
              <div className="sec-actions">
                <Button variant="outline" sm onClick={() => void handleLogout()}>{c.logout}</Button>
                <Button variant="outline" sm onClick={() => void handleLogoutEverywhere()}>{c.logoutAll}</Button>
              </div>
            </div>
            {sessions.length > 0 && (
              <ul className="sec-sessions" data-e2e="sessions-list">
                {sessions.map((s, i) => (
                  <li key={`${s.createdAt}-${i}`} className="sec-session">
                    <span className={s.current ? "sec-pill sec-pill-current" : "sec-pill"}>{s.current ? c.thisDevice : c.otherDevice}</span>
                    <span className="sec-meta">
                      {c.since(formatNumericDate(s.createdAt))} · {c.lastSeen(formatNumericDate(s.lastSeenAt))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="sec-hint">{c.logoutAllHint}</p>
          </Card>
        </>
      )}
      {toast}
    </section>
  );
}
