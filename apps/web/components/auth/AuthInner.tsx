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
   `no-account` branch in verifyOtp).

   Layout (Option B): <AuthShell> draws the page chrome and the brand panel; this
   file owns the form side. Two steps share ONE card and ONE <form>: the identifier
   step, then the code step, which REPLACES it rather than being appended below. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocalizedRouter } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, Mail, Back } from "@/components/icons";
import { requestOtp, verifyOtp } from "@/app/actions";
import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput } from "@/components/auth/OtpInput";
import { postAuthDestination } from "@/lib/auth-destination";
import { useCountdown, formatCountdown } from "@/components/useCountdown";
// Pure module — the SAME validity check the server runs, so the form and the action
// can never disagree about what a valid address is.
import { isValidEmail } from "@tnajem/shared";
import type { OtpChannel } from "@/lib/auth";

/* Page-local copy. The shared t.auth.pending string explains our SMS provider
   status ("une fois le fournisseur SMS branché… mode dev") — that is release
   plumbing, not something to greet a visitor with. Plain language instead.

   The PANEL states only what is true of every account today — no password, a
   single-use 6-digit code, no role to pick — and no testimonial, name, city or
   number: the no-fabrication rule applies to marketing copy too. */
const COPY = {
  fr: {
    panelEyebrow: "Ton espace",
    panelTitle: "Content de te revoir",
    panelSummary: "Sans mot de passe · un code à 6 chiffres",
    panelPoints: [
      "Pas de mot de passe à retenir",
      "Un code à 6 chiffres, valable une seule fois",
      "Rien à choisir : ton compte sait si tu es prof ou élève",
    ],
    panelTrust: "Pilote · chaque prof est vérifié à la main par notre équipe",
    lead: "Entre ton email : on t'envoie un code. Pas de mot de passe.",
    leadSms: "Entre ton numéro : on t'envoie un code par SMS. Pas de mot de passe.",
    email: "Ton email",
    emailPh: "prenom@exemple.com",
    cta: "Continuer",
    errNeedEmail: "Entre ton adresse email.",
    errBadEmail: "Cette adresse email n'est pas valide.",
    errBadPhone: "Numéro de téléphone invalide.",
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
    checkTitleEmail: "Vérifie ta boîte mail",
    checkTitleSms: "Vérifie tes SMS",
    // Followed by the address / number in bold, isolated left-to-right.
    sentToEmail: "Code envoyé à",
    sentToSms: "Code envoyé au",
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
    // Followed by the ticking m:ss in bold.
    resendIn: "Renvoyer dans",
    resendReady: "Tu peux redemander un code.",
    /* Email's one genuinely new failure mode, and by far the most common support
       question an OTP-by-mail flow produces. */
    spamHint: "Pense aux spams",
    expiresInEmail: (t: string) => `le code expire dans ${t}`,
    expiresInSms: (t: string) => `Le code expire dans ${t}`,
    minutes: (n: number) => `${n} min`,
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
    panelEyebrow: "فضاءك",
    panelTitle: "مرحبا بيك من جديد",
    panelSummary: "بلا كلمة سرّ · كود بـ 6 أرقام",
    panelPoints: [
      "ما فماش كلمة سرّ تحفظها",
      "كود بـ 6 أرقام، يتستعمل مرّة وحدة",
      "ما تختار شي : حسابك يعرف إنتي أستاذ ولا تلميذ",
    ],
    panelTrust: "فترة التجربة · كل أستاذ نتثبّتو منّو بيدينا",
    lead: "حطّ الإيميل متاعك : نبعثولك كود. بلا كلمة سرّ.",
    leadSms: "حطّ نمرتك : نبعثولك كود بالـSMS. بلا كلمة سرّ.",
    email: "الإيميل متاعك",
    emailPh: "esm@exemple.com",
    cta: "كمّل",
    errNeedEmail: "حطّ الإيميل متاعك.",
    errBadEmail: "هذا الإيميل موش صحيح.",
    errBadPhone: "رقم الهاتف موش صحيح.",
    errSend: "تعذّر إرسال الكود. عاود المحاولة.",
    errBadCode: "الكود موش صحيح ولا سالا. شوف الـ 6 أرقام، ولا اطلب كود جديد.",
    errTooManyAttempts: (secs: number) =>
      `برشا محاولات. عاود بعد ${Math.max(1, Math.ceil(secs / 60))} دقايق.`,
    errBlocked: "الحساب هذا وقّفو فريق Tnajem. ما تنجّمش تدخل.",
    alreadySent: "فما كود تبعثلك وما زال صالح — حطّو تحت.",
    haveCode: "عندي كود",
    checkTitleEmail: "شوف الإيميل متاعك",
    checkTitleSms: "شوف الـSMS متاعك",
    sentToEmail: "الكود تبعث لـ",
    sentToSms: "الكود تبعث لـ",
    changeNumber: "بدّل النمرة",
    changeEmail: "بدّل الإيميل",
    devCodeNote: "كود للتجربة — توّا ما تتبعث حتى رسالة",
    codeHelp: "6 أرقام.",
    codeLabelEmail: "الكود اللي وصلك في الإيميل",
    codeLabelSms: "الكود اللي وصلك بالـ SMS",
    resend: "عاود ابعث الكود",
    resendIn: "عاود ابعث بعد",
    resendReady: "تنجم تطلب كود جديد.",
    spamHint: "شوف زادة في الـspam",
    expiresInEmail: (t: string) => `الكود يسالي في ${t}`,
    expiresInSms: (t: string) => `الكود يسالي في ${t}`,
    minutes: (n: number) =>
      n === 1 ? "دقيقة" : n === 2 ? "دقيقتين" : n <= 10 ? `${n} دقايق` : `${n} دقيقة`,
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
  /* The two steps REPLACE each other, so whatever had focus on the code step (the
     "Changer" link, the resend button) leaves the DOM when we go back — and focus
     would fall to <body>. Set before leaving the code step; the effect below puts
     focus on the identifier field once step 1 has rendered it again. (Going the
     other way needs nothing: OtpInput's autoFocus lands on the first box.) */
  const refocusIdentifier = useRef(false);
  useEffect(() => {
    if (!codeSent && refocusIdentifier.current) {
      refocusIdentifier.current = false;
      identifierRef.current?.focus();
    }
  }, [codeSent]);

  function invalid(field: "identifier" | "code", message: string) {
    setError(null);
    setFieldError({ field, message });
    /* The identifier field is not in the DOM while the code step is on screen. A
       server refusal of the address at that point (a resend answered with
       invalid-email / invalid-phone) would be set on a field nobody can see — so
       go back to step 1, where the message renders on the field and the effect
       above focuses it. */
    if (field === "identifier" && codeSent) { leaveCodeStep(); return; }
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

  // Carry ?next= into signup so someone bounced off /checkout who turns out to be
  // new still lands back on the class they wanted.
  const signupHref = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

  /* The client half of the identifier rules, shared by the send and by "J'ai déjà
     un code" — so both paths refuse exactly the same input, and the code step is
     never shown for an address the server would reject. */
  function identifierOk(): boolean {
    const id = identifier.trim();
    if (!id) { invalid("identifier", isEmail ? c.errNeedEmail : c.errNeedPhone); return false; }
    // Same check the server runs, so a typo is caught before we spend a send.
    if (isEmail && !isValidEmail(id.toLowerCase())) { invalid("identifier", c.errBadEmail); return false; }
    return true;
  }

  /* Back to step 1 with the same identifier. The code, the dev code and both
     timers describe a code that is no longer on screen, so they go too. */
  function leaveCodeStep() {
    setCodeSent(false); setCode(""); setDevCode(null);
    cooldown.start(0); expiry.start(0); setHadExpiry(false);
    refocusIdentifier.current = true;
  }

  /* One send path for the first code and every resend. `resend` only changes how
     the result is presented: a resend keeps the user on the code step, and a
     "too-soon" answer arms the countdown instead of showing a red error — the
     server is simply telling us a rule the UI had not drawn yet (which is exactly
     what happens after a page reload, when the client has no timer but the server
     still has the cooldown). */
  async function send(resend: boolean) {
    if (loading) return;
    if (!identifierOk()) return;
    const id = identifier.trim();
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
      invalid("identifier", c.errBadPhone);
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
  const handleVerify = () => verifyWith(code);

  /* Takes the code as an argument rather than reading state: OtpInput's onComplete
     fires from inside the same user action that calls onChange → setCode, so `code`
     is still the previous value at that point. Passing it explicitly is what makes
     SMS / email autofill work on the first try instead of submitting five digits —
     in the common case the user types nothing and taps nothing. */
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

  /* The panel is the same on every screen of this page, including "no account". */
  const panel = {
    eyebrow: c.panelEyebrow,
    title: c.panelTitle,
    summary: c.panelSummary,
    points: c.panelPoints,
    trust: c.panelTrust,
  };

  /* ── Verified, but there is no account for this number ── */
  if (noAccount) {
    return (
      <AuthShell {...panel}>
        <h1 className="auth-title mb-1.5">
          {isEmail ? c.noAccountTitleEmail : c.noAccountTitleSms}
        </h1>
        <p className="auth-lead">
          {isEmail ? c.noAccountBodyEmail : c.noAccountBodySms}
        </p>
        <div className="flex flex-col gap-2.5 mt-6">
          <Link href={signupHref("/signup/prof")} className="btn btn-primary">
            {c.newTutor}
          </Link>
          <Link href={signupHref("/signup/eleve")} className="btn btn-ghost">
            {studentCta}
          </Link>
        </div>
      </AuthShell>
    );
  }

  /* role="alert" so screen readers announce it on change. */
  const errorLine = error && (
    <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start">
      {error}
    </p>
  );
  const noticeLine = notice && !error && (
    <p role="status" className="text-[13px] text-ink2 font-semibold leading-[1.5] mb-3 text-start">
      {notice}
    </p>
  );
  // Whole minutes while there is at least one left, then the m:ss of the last one.
  const expiryText = expiry.left >= 60 ? c.minutes(Math.ceil(expiry.left / 60)) : formatCountdown(expiry.left);
  const showExpiry = !expired && expiry.left > 0;

  return (
    <AuthShell {...panel}>
      {/* A real <form>: this was loose divs with onClick handlers, so pressing
          Enter after typing an address or a code did nothing at all — the single
          most reflexive action on a login screen. ONE form for both steps;
          onSubmit dispatches to whichever step is on screen. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (codeSent) handleVerify();
          else handleSendCode();
        }}
        noValidate
      >
        {/* The two wrappers are KEYED. Unkeyed, React matched them by position
            (both are a <div>) and recycled step 1's nodes into step 2 — the
            "J'ai déjà un code" button became "Changer d'email" in place and kept
            focus, so OtpInput's autoFocus never won. Distinct keys make the swap
            a real unmount/mount. */}
        {!codeSent ? (
          /* ── Step 1: the address (or number) ── */
          <div key="identifier" data-e2e="auth-step-identifier">
            <h1 className="auth-title mb-1.5">{t.auth.title}</h1>
            <p className="auth-lead mb-6">{isEmail ? c.lead : c.leadSms}</p>

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
                  className="min-w-0"
                />
              </div>
            </Field>

            {errorLine}
            {noticeLine}

            <Button type="submit" variant="primary" disabled={loading} className="mt-1">
              {loading ? t.common.loading : c.cta}
            </Button>
            {/* For someone who reloaded mid-flow: jump straight to the code they
                already have, without spending a send or waiting out a cooldown.
                It still requires a valid identifier — the same checks as the send —
                because verifyOtp needs it and the code step displays it. */}
            <div className="mt-2 text-center">
              <button
                type="button"
                data-e2e="have-code"
                onClick={() => {
                  setError(null); setFieldError(null); setNotice(null);
                  if (!identifierOk()) return;
                  setCodeSent(true);
                }}
                className="auth-link auth-tap text-[14px]"
              >
                {c.haveCode}
              </button>
            </div>
          </div>
        ) : (
          /* ── Step 2: the code. Replaces step 1 in the same card. ── */
          <div key="code" data-e2e="auth-step-code" className="rise">
            <div className="auth-icon-tile mb-5">
              {isEmail ? <Mail /> : <Phone />}
            </div>
            <h1 className="auth-title mb-1.5">{isEmail ? c.checkTitleEmail : c.checkTitleSms}</h1>
            {/* Where the code went. The identifier is isolated left-to-right so an
                address or a number reads correctly inside the Arabic sentence. */}
            <p className="auth-lead mb-6 break-words">
              {isEmail ? c.sentToEmail : c.sentToSms}{" "}
              <b className="font-bold text-ink" dir="ltr">{identifier.trim()}</b>
            </p>

            {noticeLine}

            {/* Local development only. requestOtp() returns the code ONLY when
                NODE_ENV is not "production" AND no provider is configured; a
                production deploy with no mail or SMS credentials now fails the
                send outright rather than printing a stranger's code here. (The
                previous note claimed production was safe because a provider
                would be set — precisely the assumption that failed.) */}
            {devCode && (
              <div className="bg-sand border-[1.4px] border-dashed border-ochre-btn rounded-brand py-2.5 px-3 mb-3.5 text-center text-[13px] text-ink2 leading-[1.5]">
                <b className="font-display text-[18px] tracking-[3px] text-ink block" dir="ltr" data-e2e="dev-code">
                  {devCode}
                </b>
                {c.devCodeNote}
              </div>
            )}

            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (fieldError?.field === "code") setFieldError(null);
              }}
              /* Replaces "submit on the sixth digit": fires when a user action
                 (typing, paste, SMS autofill) completes the code. */
              onComplete={(v) => { if (!loading) void verifyWith(v); }}
              label={isEmail ? c.codeLabelEmail : c.codeLabelSms}
              error={fieldError?.field === "code" ? fieldError.message : undefined}
              inputRef={codeRef}
              autoFocus
            />

            {/* ── The escape hatch + resend ──
                Before resend existed there was no way to ask for another code at
                all: the only control here reset the whole form. A code that lands
                in spam, or arrives after the user has looked away, had no recovery.

                Both durations come from the server (requestOtp returns them), so
                the button can never re-enable while the server still refuses. ── */}
            <div className="auth-row mt-1 mb-3">
              <button
                type="button"
                data-e2e="change-identifier"
                className="auth-link auth-tap gap-1"
                onClick={() => {
                  setError(null); setFieldError(null);
                  // The notice ("saisis-le ci-dessous") is about the code step only.
                  setNotice(null);
                  leaveCodeStep();
                }}
              >
                <Back className="w-4 h-4" />
                {isEmail ? c.changeEmail : c.changeNumber}
              </button>
              <button
                type="button"
                data-e2e="resend"
                onClick={handleResend}
                disabled={loading || !canResend}
                className="auth-link auth-tap disabled:font-normal"
              >
                {canResend ? (
                  c.resend
                ) : (
                  <>
                    {/* aria-hidden: a value that changes every second would be read
                        aloud every second. The accessible name stays "Renvoyer le
                        code"; the button's disabled state carries the meaning and
                        the live region below announces the one transition that
                        matters. */}
                    <span aria-hidden="true">
                      {c.resendIn} <b className="font-bold text-ink" dir="ltr">{formatCountdown(cooldown.left)}</b>
                    </span>
                    <span className="sr-only">{c.resend}</span>
                  </>
                )}
              </button>
            </div>

            {errorLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : t.auth.verify}
            </Button>

            {/* Spam reminder (email) + ticking reassurance. The countdown half is
                aria-hidden for the same once-a-second reason as the resend timer;
                the spam reminder does not tick, so it stays readable. */}
            {(isEmail || showExpiry) && (
              <p className="auth-fine mt-4" aria-hidden={isEmail ? undefined : true}>
                {isEmail ? (
                  <>
                    {c.spamHint}
                    {showExpiry && <span aria-hidden="true"> · {c.expiresInEmail(expiryText)}</span>}
                  </>
                ) : (
                  c.expiresInSms(expiryText)
                )}
              </p>
            )}

            {/* The only live region: it changes at most twice (cooldown ends,
               then the code expires), never once per second.

               Rendered even while empty, deliberately — a live region has to be
               in the DOM BEFORE its content changes or the change is not
               announced at all. Do not "simplify" this to render only when
               there is a message. */}
            <p role="status" className="text-[13px] text-muted text-center leading-[1.5] mt-1">
              {/* "Tu peux redemander un code." is for screen readers only: on
                 screen the resend link turning active already says it. */}
              {expired ? c.expired : canResend ? <span className="sr-only">{c.resendReady}</span> : ""}
            </p>
          </div>
        )}
      </form>

      {/* Signup is a different page now, one per audience. Step 1 only: on the
          code step the only ways out are "Changer" and resend. */}
      {!codeSent && (
        <div className="auth-foot">
          <span>
            {c.noAccountHint}{" "}
            <Link href={signupHref("/signup/prof")} className="auth-link auth-tap">
              {c.newTutor}
            </Link>
          </span>
          <span>
            <Link href={signupHref("/signup/eleve")} className="auth-link auth-tap">
              {studentCta}
            </Link>
          </span>
        </div>
      )}
    </AuthShell>
  );
}
