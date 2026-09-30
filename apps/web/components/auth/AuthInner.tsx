"use client";
/* The SIGN-IN screen's interactive body. Rendered by app/[locale]/auth/page.tsx,
   which is a SERVER component (see the long note there about why ?next= is read on
   the server: the client search-params hook forced this form into a <Suspense>
   boundary, which Next bails to client-only rendering, which shipped a login page
   with no h1, no phone field and no submit button).

   THIS SCREEN NO LONGER PICKS A ROLE. It used to carry a tutor/student toggle that
   did nothing for anyone who already had an account — verifyOtp deliberately never
   overwrites an existing profile's role, so a returning student who tapped "Je suis
   prof" was signed in as a student and pushed to /student with no explanation. The
   toggle looked like a decision and was ignored.

   Signing in needs no role: the account already has one. Choosing a role is a
   SIGNUP act, and it now happens by choosing a page — /signup/prof or
   /signup/eleve. This screen sends no role at all, which is also what stops it
   from silently minting an account for a number that has never signed up (see the
   `no-account` branch in verifyOtp). */
import { useRef, useState } from "react";
import { Link, useLocalizedRouter } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, Mail } from "@/components/icons";
import { requestOtp, verifyOtp } from "@/app/actions";
import { SiteShell } from "@/components/SiteShell";
import { postAuthDestination } from "@/lib/auth-destination";
import { useCountdown, formatCountdown } from "@/components/useCountdown";
// Pure module — the SAME validity check the server runs, so the form and the action
// can never disagree about what a valid address is.
import { isValidEmail } from "@tnajem/shared";
import type { OtpChannel } from "@/lib/auth";

/* Page-local copy. The shared t.auth.pending string explains our SMS provider
   status ("une fois le fournisseur SMS branché… mode dev") — that is release
   plumbing, not something to greet a visitor with. Plain language instead. */
const COPY = {
  fr: {
    lead: "Entre ton email : on t'envoie un code. Pas de mot de passe.",
    leadSms: "Entre ton numéro : on t'envoie un code par SMS. Pas de mot de passe.",
    email: "Ton email",
    emailPh: "prenom@exemple.com",
    spam: "Le code arrive en moins d'une minute. Pense à regarder dans les spams.",
    errNeedEmail: "Entre ton adresse email.",
    errBadEmail: "Cette adresse email n'est pas valide.",
    errSend: "Envoi du code impossible. Réessaie.",
    /* Wrong and expired are deliberately one message: verifyOtp will not tell us
       which, because saying "expired" would confirm the account exists. So name
       both and give the two actions that resolve either. */
    errBadCode: "Code incorrect ou expiré. Vérifie les 6 chiffres, ou demande un nouveau code.",
    errTooManyAttempts: (secs: number) =>
      `Trop d'essais. Réessaie dans ${Math.max(1, Math.ceil(secs / 60))} minutes.`,
    errBlocked: "Ce compte a été suspendu par l'équipe Tnajem. Tu ne peux pas te connecter.",
    alreadySent: "Un code t'a déjà été envoyé et il est encore valable — saisis-le ci-dessous.",
    haveCode: "J'ai déjà un code",
    sentTo: (p: string) => `Code envoyé au ${p}`,
    changeNumber: "Changer de numéro",
    changeEmail: "Changer d'email",
    devCodeNote: "Code de test — aucun message n'est envoyé pour l'instant",
    codeHelp: "6 chiffres.",
    /* t.auth.code is hardcoded to "Code reçu par SMS", which contradicted the
       line directly above it asking for an email. The channel is an env flag, so
       the label has to follow it. */
    codeLabelEmail: "Code reçu par email",
    codeLabelSms: "Code reçu par SMS",
    resend: "Renvoyer le code",
    resendReady: "Tu peux redemander un code.",
    expiresIn: (t: string) => `Ce code expire dans ${t}.`,
    expired: "Ce code a expiré — demande-en un nouveau.",
    noAccountTitleEmail: "Aucun compte avec cet email",
    noAccountTitleSms: "Aucun compte avec ce numéro",
    noAccountBodyEmail: "Cette adresse n'est pas encore inscrite. Choisis le compte qu'il te faut — il faudra un nouveau code, on ne réutilise jamais le précédent.",
    noAccountBodySms: "Ce numéro n'est pas encore inscrit. Choisis le compte qu'il te faut — il faudra un nouveau code, on ne réutilise jamais le précédent.",
    newTutor: "Je suis prof",
    newStudent: "Je suis élève / parent",
    noAccountHint: "Pas encore de compte ?",
    errNeedPhone: "Entre ton numéro de téléphone.",
    // phase-a lane L2 (A24): no parent path while ALLOW_MINORS is off (parents come with Dm1).
    newStudentAdult: "Je suis élève",
    // end phase-a lane L2
  },
  ar: {
    lead: "حطّ الإيميل متاعك : نبعثولك كود. بلا كلمة سرّ.",
    leadSms: "حطّ نمرتك : نبعثولك كود بالـSMS. بلا كلمة سرّ.",
    email: "الإيميل متاعك",
    emailPh: "esm@exemple.com",
    spam: "الكود يوصل في أقل من دقيقة. شوف زادة في الـspam.",
    errNeedEmail: "حطّ الإيميل متاعك.",
    errBadEmail: "هذا الإيميل موش صحيح.",
    errSend: "تعذّر إرسال الكود. عاود المحاولة.",
    errBadCode: "الكود موش صحيح ولا سالا. شوف الـ 6 أرقام، ولا اطلب كود جديد.",
    errTooManyAttempts: (secs: number) =>
      `برشا محاولات. عاود بعد ${Math.max(1, Math.ceil(secs / 60))} دقايق.`,
    errBlocked: "الحساب هذا وقّفو فريق Tnajem. ما تنجّمش تدخل.",
    alreadySent: "فما كود تبعثلك وما زال صالح — حطّو تحت.",
    haveCode: "عندي كود",
    sentTo: (p: string) => `الكود تبعث لـ ${p}`,
    changeNumber: "بدّل النمرة",
    changeEmail: "بدّل الإيميل",
    devCodeNote: "كود للتجربة — توّا ما تتبعث حتى رسالة",
    codeHelp: "6 أرقام.",
    codeLabelEmail: "الكود اللي وصلك في الإيميل",
    codeLabelSms: "الكود اللي وصلك بالـ SMS",
    resend: "عاود ابعث الكود",
    resendReady: "تنجم تطلب كود جديد.",
    expiresIn: (t: string) => `هذا الكود يسالي في ${t}.`,
    expired: "هذا الكود سالا — اطلب واحد جديد.",
    noAccountTitleEmail: "ما فماش حساب بهذا الإيميل",
    noAccountTitleSms: "ما فماش حساب بهذي النمرة",
    noAccountBodyEmail: "هذا الإيميل ما زال ما تسجّلش. اختار الحساب اللي يلزمك — باش تحتاج كود جديد، ما نعاودوش نستعملو القديم.",
    noAccountBodySms: "هذي النمرة ما زالت ما تسجّلتش. اختار الحساب اللي يلزمك — باش تحتاج كود جديد، ما نعاودوش نستعملو القديم.",
    newTutor: "أنا أستاذ",
    newStudent: "أنا تلميذ / ولي",
    noAccountHint: "ما عندكش حساب ؟",
    errNeedPhone: "حطّ نمرة تليفونك.",
    // phase-a lane L2 (A24): no parent path while ALLOW_MINORS is off (parents come with Dm1).
    newStudentAdult: "أنا تلميذ",
    // end phase-a lane L2
  },
} as const;

/* `channel` comes from the SERVER shell (otpChannel()), so flipping OTP_CHANNEL
   back to sms swaps this form to a phone field on the next restart — no rebuild,
   no code change. Everything below is written against a neutral "identifier" for
   the same reason. */
export function AuthInner({
  next,
  channel,
  minorsAllowed = false,
}: {
  next: string | null;
  channel: OtpChannel;
  /** phase-a lane L2 (A24): ALLOW_MINORS, read per request by the server shell. */
  minorsAllowed?: boolean;
}) {
  const { t, locale } = useLocale();
  const c = COPY[locale];
  // phase-a lane L2 (A24): "Je suis élève / parent" only while minors (and so parents) are in.
  const studentCta = minorsAllowed ? c.newStudent : c.newStudentAdult;
  const router = useLocalizedRouter();
  const isEmail = channel === "email";

  const [identifier, setIdentifier] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A problem with ONE field (an empty or malformed address, a wrong code) is shown
     ON that field: Field sets aria-invalid and points aria-describedby at the
     message, and invalid() moves focus there — a keyboard or screen-reader user
     lands on the thing to fix instead of staying on the submit button. `error`
     above is for everything that is not about a field (network, rate limits). */
  const [fieldError, setFieldError] = useState<{ field: "identifier" | "code"; message: string } | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  function invalid(field: "identifier" | "code", message: string) {
    setError(null);
    setFieldError({ field, message });
    (field === "identifier" ? identifierRef : codeRef).current?.focus();
  }
  /* Neutral information, not a failure — e.g. "a code is already on its way".
     Kept separate from `error` so it can be styled and announced as guidance
     rather than painted red. */
  const [notice, setNotice] = useState<string | null>(null);
  // Only true once a send actually reported a TTL — without it the "expired" state
  // would fire immediately, before any code has been requested.
  const [hadExpiry, setHadExpiry] = useState(false);

  /* Two countdowns, both driven by numbers the SERVER returns:
       cooldown — the 60s gap between sends (OTP_RESEND_COOLDOWN_SEC)
       expiry   — how long this code stays valid (OTP_TTL_SEC)
     Neither duration is hardcoded here; see the note on those constants. */
  const cooldown = useCountdown();
  const expiry = useCountdown();
  const expired = codeSent && hadExpiry && expiry.done;
  /* Resend is available once the cooldown ends — and unconditionally once the code
     has expired, because the 5-minute life always outlasts the 60s gap, so being
     blocked at that point could only ever be the UI lagging the server. */
  const canResend = cooldown.done || expired;
  // The number proved out but has no account. We say so and point at signup
  // rather than quietly creating a profile the visitor never asked for.
  const [noAccount, setNoAccount] = useState(false);

  const ar = locale === "ar";
  // Carry ?next= into signup so someone bounced off /checkout who turns out to be
  // new still lands back on the class they wanted.
  const signupHref = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

  /* One send path for the first code and every resend. `resend` only changes how
     the result is presented: a resend keeps the user on the code step, and a
     "too-soon" answer arms the countdown instead of showing a red error — the
     server is simply telling us a rule the UI had not drawn yet (which is exactly
     what happens after a page reload, when the client has no timer but the server
     still has the cooldown). */
  async function send(resend: boolean) {
    if (loading) return;
    const id = identifier.trim();
    if (!id) { invalid("identifier", isEmail ? c.errNeedEmail : c.errNeedPhone); return; }
    // Same check the server runs, so a typo is caught before we spend a send.
    if (isEmail && !isValidEmail(id.toLowerCase())) { invalid("identifier", c.errBadEmail); return; }
    setLoading(true);
    setError(null);
    setFieldError(null);
    setNotice(null);
    let res: Awaited<ReturnType<typeof requestOtp>>;
    try {
      // `id`, not `identifier`: the raw value carries the leading/trailing space a
      // phone keyboard adds, and only the display copy was being trimmed before.
      res = await requestOtp({ identifier: id, locale });
    } catch {
      // Network hiccup on 3G — never leave the button stuck on "Chargement…".
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (res.ok) {
      setCodeSent(true);
      setDevCode(res.devCode ?? null);
      if (resend) setCode("");   // the previous code is dead — createOtp replaced it
      armTimers(res.resendAfter, res.expiresIn);
      return;
    }
    if (res.error === "too-soon") {
      // Arm from the server's own answer rather than scolding the user.
      if (res.retryAfter) cooldown.start(res.retryAfter);
      if (!resend) {
        /* A cooldown on a FIRST send means a code was already sent to this address
           moments ago and is still alive — almost always because the user reloaded
           mid-flow and lost the client's timers. Advancing to the code step is the
           whole fix for that dead end: previously we left them on the address step
           with a red error, so the valid code sitting in their inbox was unusable
           and they had to wait out a cooldown to reach a field they could already
           have typed into. */
        setCodeSent(true);
        setError(null);
        setNotice(c.alreadySent);
      }
    } else if (res.error === "send-failed") {
      setError(c.errSend);
    } else if (res.error === "invalid-email") {
      invalid("identifier", c.errBadEmail);
    } else if (res.error === "invalid-phone") {
      invalid("identifier", ar ? "رقم الهاتف موش صحيح." : "Numéro de téléphone invalide.");
    } else {
      setError(t.extra.error);
    }
  }

  /* A missing duration means "no rule known" → leave the timer at zero so the
     button stays available, and let a "too-soon" answer arm it. Never invent a
     local default: a wrong guess would disable a button the server would allow. */
  function armTimers(resendAfter?: number, expiresIn?: number) {
    cooldown.start(resendAfter ?? 0);
    expiry.start(expiresIn ?? 0);
    setHadExpiry(Boolean(expiresIn));
  }

  const handleSendCode = () => send(false);
  const handleResend = () => send(true);

  /* Strip everything that isn't a digit, then submit the moment six of them are
     present. The field accepted letters before, which the server could only ever
     reject — and it required a separate tap on a button that is below the fold on
     a 320px phone. Android's SMS/email autofill delivers all six at once, so in
     the common case the user now types nothing and taps nothing. */
  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (fieldError?.field === "code") setFieldError(null);
    if (digits.length === 6 && !loading) void verifyWith(digits);
  }
  const handleVerify = () => verifyWith(code);

  /* Takes the code as an argument rather than reading state: the auto-submit above
     fires from inside the same change handler that calls setCode, so `code` is
     still the previous value at that point. Passing it explicitly is what makes
     autofill work on the first try instead of submitting five digits. */
  async function verifyWith(submitted: string) {
    if (loading) return;
    if (!submitted.trim()) { invalid("code", c.codeHelp); return; }
    setLoading(true);
    setError(null);
    setFieldError(null);
    setNotice(null);
    let res: Awaited<ReturnType<typeof verifyOtp>>;
    try {
      // No `role`: this is sign in. See the header comment.
      res = await verifyOtp({ identifier, code: submitted, locale });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (!res.ok) {
      if (res.error === "no-account") { setNoAccount(true); return; }
      /* Throttling is reported separately because it is a fact about the caller,
         not about the account — see verifyOtp. Wrong and expired stay merged on
         purpose (distinguishing them would confirm a code had been issued, i.e.
         that the account exists), so the message has to name BOTH possibilities
         and say what to do about either. "Une erreur s'est produite." told a user
         with a mistyped digit nothing at all. */
      if (res.error === "too-many-attempts") {
        setError(c.errTooManyAttempts(res.retryAfter ?? 900));
        return;
      }
      if (res.error === "invalid-code") { invalid("code", c.errBadCode); return; }
      // Only ever reaches the owner of the address: the API checks it after the code is proven.
      if (res.error === "account-blocked") { setError(c.errBlocked); return; }
      setError(t.extra.error);
      return;
    }
    // Destination priority (consent → welcome → ?next= → role home) lives in
    // lib/auth-destination.ts, shared with both signup screens.
    router.push(postAuthDestination(res, next));
  }

  /* ── Verified, but there is no account for this number ── */
  if (noAccount) {
    return (
      <SiteShell>
        <section className="web-section">
          <div className="container container-narrow flex justify-center">
            <div className="panel panel-pad rise w-full max-w-[460px] min-w-0">
              <h1 className="font-display text-[clamp(22px,_4vw,_28px)] tracking-[-0.6px] mb-1.5 text-ink">
                {isEmail ? c.noAccountTitleEmail : c.noAccountTitleSms}
              </h1>
              <p className="text-[13.5px] text-muted mb-6 leading-[1.55]">
                {isEmail ? c.noAccountBodyEmail : c.noAccountBodySms}
              </p>
              <div className="flex flex-col gap-2.5">
                <Link href={signupHref("/signup/prof")} className="btn btn-primary">
                  {c.newTutor}
                </Link>
                <Link href={signupHref("/signup/eleve")} className="btn btn-ghost">
                  {studentCta}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow flex justify-center">
          <div className="panel panel-pad rise w-full max-w-[460px] min-w-0">
            <h1 className="font-display text-[clamp(22px,_4vw,_28px)] tracking-[-0.6px] mb-1.5 text-ink">
              {t.auth.title}
            </h1>
            <p className="text-[13.5px] text-muted mb-6 leading-[1.55]">
              {isEmail ? c.lead : c.leadSms}
            </p>

            {/* A real <form>: this was loose divs with onClick handlers, so pressing
                Enter after typing an address or a code did nothing at all — the
                single most reflexive action on a login screen. onSubmit dispatches
                to whichever step is on screen. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (codeSent) handleVerify();
                else handleSendCode();
              }}
              noValidate
            >
            <Field
              label={isEmail ? c.email : t.auth.phone}
              error={fieldError?.field === "identifier" ? fieldError.message : undefined}
            >
              <div className="inp">
                {isEmail ? <Mail className="" /> : <Phone className="" />}
                {/* Tunisia's country code as a real affix rather than placeholder
                    text that vanishes the moment you type — the same `.pre` slot
                    the slug field uses for "tnajem.com/". */}
                {!isEmail && (
                  <span className="pre whitespace-nowrap shrink-0" dir="ltr">+216</span>
                )}
                <input
                  /* dir="ltr" in both modes: an address and a phone number are both
                     left-to-right even on the Arabic (RTL) page. */
                  type={isEmail ? "email" : "tel"}
                  dir="ltr"
                  placeholder={isEmail ? c.emailPh : t.auth.phonePh}
                  ref={identifierRef}
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    if (fieldError?.field === "identifier") setFieldError(null);
                  }}
                  inputMode={isEmail ? "email" : "tel"}
                  autoComplete={isEmail ? "email" : "tel"}
                  autoCapitalize="off"
                  spellCheck={false}
                  disabled={codeSent}
                  className="min-w-0"
                />
              </div>
            </Field>

            {/* role="alert" so screen readers announce it on change */}
            {error && (
              <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start">
                {error}
              </p>
            )}
            {notice && !error && (
              <p role="status" className="text-[13px] text-ink2 font-semibold leading-[1.5] mb-3 text-start">
                {notice}
              </p>
            )}

            {!codeSent ? (
              <>
                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? t.common.loading : t.auth.sendCode}
                </Button>
                {/* For someone who reloaded mid-flow: jump straight to the code they
                    already have, without spending a send or waiting out a cooldown. */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => { setError(null); setFieldError(null); setNotice(null); setCodeSent(true); }}
                    className="linklike bg-transparent border-0 text-[13px] min-h-[44px] min-w-[44px] font-[inherit]"
                  >
                    {c.haveCode}
                  </button>
                </div>
              </>
            ) : (
              <div className="rise">
                {/* Where the code went + an escape hatch if the number is wrong. */}
                <div className="flex items-center justify-between gap-2.5 flex-wrap mb-3.5">
                  <span className="text-[13px] text-ink2 min-w-0">{c.sentTo(identifier.trim())}</span>
                  <button
                    type="button"
                    className="linklike bg-transparent border-0 text-[13px] min-h-[44px] min-w-[44px] flex-none font-[inherit]"
                    onClick={() => {
                      setCodeSent(false); setCode(""); setDevCode(null); setError(null); setFieldError(null);
                      // The timers describe a code that is no longer on screen.
                      cooldown.start(0); expiry.start(0); setHadExpiry(false);
                    }}
                  >
                    {isEmail ? c.changeEmail : c.changeNumber}
                  </button>
                </div>

                {/* Local development only. requestOtp() returns the code ONLY when
                    NODE_ENV is not "production" AND no provider is configured; a
                    production deploy with no mail or SMS credentials now fails the
                    send outright rather than printing a stranger's code here. (The
                    previous note claimed production was safe because a provider
                    would be set — precisely the assumption that failed.) */}
                {devCode && (
                  <div className="bg-sand border-[1.4px] border-dashed border-ochre-btn rounded-brand py-2.5 px-3 mb-3.5 text-center text-[13px] text-ink2 leading-[1.5]">
                    <b className="font-display text-[18px] tracking-[3px] text-ink block" dir="ltr">
                      {devCode}
                    </b>
                    {c.devCodeNote}
                  </div>
                )}

                {/* Email's one genuinely new failure mode, and by far the most
                    common support question an OTP-by-mail flow produces. */}
                {isEmail && (
                  <p className="text-[13px] text-muted leading-[1.5] mb-3.5">{c.spam}</p>
                )}

                <Field
                  label={isEmail ? c.codeLabelEmail : c.codeLabelSms}
                  help={c.codeHelp}
                  error={fieldError?.field === "code" ? fieldError.message : undefined}
                >
                  <div className="inp">
                    <input
                      type="text"
                      dir="ltr"
                      placeholder="000000"
                      ref={codeRef}
                      value={code}
                      onChange={(e) => onCodeChange(e.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                      className="min-w-0 tracking-[3px] font-display"
                    />
                  </div>
                </Field>

                <Button type="submit" variant="primary" disabled={loading}>
                  {loading ? t.common.loading : t.auth.verify}
                </Button>

                {/* ── Resend + the two countdowns ──
                    Before this there was no way to ask for another code at all: the
                    only control here reset the whole form. A code that lands in spam,
                    or arrives after the user has looked away, had no recovery.

                    Both durations come from the server (requestOtp returns them), so
                    the button can never re-enable while the server still refuses. ── */}
                <div className="mt-3.5 text-center">
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={loading || !canResend}
                    className="linklike bg-transparent border-0 text-[13px] min-h-[44px] min-w-[44px] font-[inherit] disabled:opacity-60 disabled:cursor-default"
                  >
                    {c.resend}
                    {/* aria-hidden: a value that changes every second would be read
                       aloud every second. The button's disabled state carries the
                       meaning; the live region below announces the one transition
                       that matters. */}
                    {!canResend && (
                      <span aria-hidden="true"> ({formatCountdown(cooldown.left)})</span>
                    )}
                  </button>

                  {/* Ticking reassurance, decorative for the same reason. */}
                  {!expired && expiry.left > 0 && (
                    <p aria-hidden="true" className="text-[13px] text-muted leading-[1.5] mt-1">
                      {c.expiresIn(formatCountdown(expiry.left))}
                    </p>
                  )}

                  {/* The only live region: it changes at most twice (cooldown ends,
                     then the code expires), never once per second.

                     Rendered even while empty, deliberately — a live region has to be
                     in the DOM BEFORE its content changes or the change is not
                     announced at all. Do not "simplify" this to render only when
                     there is a message. */}
                  <p role="status" className="text-[13px] text-muted leading-[1.5] mt-1">
                    {expired ? c.expired : canResend ? c.resendReady : ""}
                  </p>
                </div>
              </div>
            )}
            </form>

            {/* Signup is a different page now, one per audience. */}
            <div className="mt-6 pt-5 border-t border-line text-[13px] text-muted leading-[1.6]">
              <p className="mb-1.5">{c.noAccountHint}</p>
              <div className="flex gap-4 flex-wrap">
                <Link
                  href={signupHref("/signup/prof")}
                  className="linklike inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
                >
                  {c.newTutor}
                </Link>
                <Link
                  href={signupHref("/signup/eleve")}
                  className="linklike inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
                >
                  {studentCta}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
