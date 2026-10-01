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
   file owns the form side. The steps share ONE card and ONE <form>, and each
   REPLACES the previous one rather than being appended below.

   espace prof v2 · phase 2 — PASSWORDS. The address step now asks the API whether
   the address has an account and a password (POST /auth/account-status):
     password  → the password step, with « Mot de passe oublié ? » and « Recevoir un
                 code à la place »;
     no password → the code, exactly as before; after it, a password-less account
                 is offered « Crée un mot de passe (recommandé) » ONCE (the API
                 decides and remembers);
     no account → straight to « Aucun compte », without spending a code.
   « Mot de passe oublié » = a code + a new password on one step; the API ends every
   session and signs this device in. Every refusal is the API's, shown on its field. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocalizedRouter } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, Mail, Back, Lock, Info } from "@/components/icons";
import { requestOtp, verifyOtp } from "@/app/actions";
import { accountStatus, passwordLogin, resetPassword, setPassword } from "@/app/actions-auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput, OTP_LENGTH } from "@/components/auth/OtpInput";
import { PasswordField, passwordHelp, weakPasswordMessage, clientPasswordProblem } from "@/components/auth/PasswordField";
import { postAuthDestination, type PostAuth } from "@/lib/auth-destination";
import { takeAuthPrefill } from "@/lib/auth-prefill";
import { useCountdown, formatCountdown } from "@/components/useCountdown";
// Pure module — the SAME validity check the server runs, so the form and the action
// can never disagree about what a valid address is.
import { isValidEmail } from "@tnajem/shared";
import type { OtpChannel } from "@/lib/auth";

/* Page-local copy. The shared t.auth.pending string explains our SMS provider
   status ("une fois le fournisseur SMS branché… mode dev") — that is release
   plumbing, not something to greet a visitor with. Plain language instead.

   The PANEL states only what is true of every account today — a password or a
   single-use 6-digit code, no role to pick — and no testimonial, name, city or
   number: the no-fabrication rule applies to marketing copy too. */
const COPY = {
  fr: {
    panelEyebrow: "Ton espace",
    panelTitle: "Content de te revoir",
    panelSummary: "Mot de passe ou code à 6 chiffres",
    panelPoints: [
      "Connecte-toi avec ton mot de passe, ou avec un code",
      "Un code à 6 chiffres, valable une seule fois",
      "Rien à choisir : ton compte sait si tu es prof ou élève",
    ],
    panelTrust: "Pilote · chaque prof est vérifié à la main par notre équipe",
    lead: "Entre ton email. Ensuite : ton mot de passe, ou un code reçu par email.",
    leadSms: "Entre ton numéro. Ensuite : ton mot de passe, ou un code reçu par SMS.",
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
    // espace prof v2 · auth (phase 2) ─────────────────────────────────────────
    existingNotice: "Tu as déjà un compte — connecte-toi.",
    noAccountDirectEmail: "Cette adresse n'est pas encore inscrite. Choisis le compte qu'il te faut.",
    noAccountDirectSms: "Ce numéro n'est pas encore inscrit. Choisis le compte qu'il te faut.",
    pwTitle: "Entre ton mot de passe",
    pwFor: "Pour",
    pwLabel: "Mot de passe",
    pwCta: "Se connecter",
    forgot: "Mot de passe oublié ?",
    useCode: "Recevoir un code à la place",
    errNeedPassword: "Entre ton mot de passe.",
    // THE generic refusal: an unknown address, an account without a password and a wrong password all read this.
    errCredentials: "Email ou mot de passe incorrect.",
    errCredentialsSms: "Numéro ou mot de passe incorrect.",
    errLocked: (secs: number) =>
      `Trop d'essais avec un mot de passe. Réessaie dans ${Math.max(1, Math.ceil(secs / 60))} minutes, ou reçois un code à la place.`,
    resetTitle: "Choisis un nouveau mot de passe",
    resetLead: "Le code envoyé à",
    resetLeadAfter: "prouve que l'adresse est à toi.",
    newPwLabel: "Nouveau mot de passe",
    resetCta: "Changer mon mot de passe",
    resetNote: "Tous tes appareils seront déconnectés, sauf celui-ci.",
    backToPassword: "Retour",
    promptTitle: "Crée un mot de passe (recommandé)",
    promptLead: "La prochaine fois, connecte-toi avec ton email et ce mot de passe. Tu pourras toujours recevoir un code par email.",
    promptLeadSms: "La prochaine fois, connecte-toi avec ton numéro et ce mot de passe. Tu pourras toujours recevoir un code par SMS.",
    promptCta: "Créer mon mot de passe",
    promptSkip: "Plus tard",
    errGrantExpired: "Ce délai a expiré. Tu peux créer ton mot de passe plus tard, depuis ton profil.",
    // end espace prof v2 · auth
  },
  ar: {
    panelEyebrow: "فضاءك",
    panelTitle: "مرحبا بيك من جديد",
    panelSummary: "كلمة سرّ ولا كود بـ 6 أرقام",
    panelPoints: [
      "ادخل بكلمة السرّ متاعك، ولا بكود",
      "كود بـ 6 أرقام، يتستعمل مرّة وحدة",
      "ما تختار شي : حسابك يعرف إنتي أستاذ ولا تلميذ",
    ],
    panelTrust: "فترة التجربة · كل أستاذ نتثبّتو منّو بيدينا",
    lead: "حطّ الإيميل متاعك. من بعد : كلمة السرّ، ولا كود يوصلك في الإيميل.",
    leadSms: "حطّ نمرتك. من بعد : كلمة السرّ، ولا كود يوصلك بالـSMS.",
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
    // espace prof v2 · auth (phase 2) ─────────────────────────────────────────
    existingNotice: "عندك حساب قبل — ادخل.",
    noAccountDirectEmail: "هذا الإيميل ما زال ما تسجّلش. اختار الحساب اللي يلزمك.",
    noAccountDirectSms: "هذي النمرة ما زالت ما تسجّلتش. اختار الحساب اللي يلزمك.",
    pwTitle: "حطّ كلمة السرّ متاعك",
    pwFor: "لـ",
    pwLabel: "كلمة السرّ",
    pwCta: "ادخل",
    forgot: "نسيت كلمة السرّ ؟",
    useCode: "ابعثلي كود في بلاصتها",
    errNeedPassword: "حطّ كلمة السرّ متاعك.",
    errCredentials: "الإيميل ولا كلمة السرّ موش صحاح.",
    errCredentialsSms: "النمرة ولا كلمة السرّ موش صحاح.",
    errLocked: (secs: number) =>
      `برشا محاولات بكلمة السرّ. عاود بعد ${Math.max(1, Math.ceil(secs / 60))} دقايق، ولا اطلب كود في بلاصتها.`,
    resetTitle: "اختار كلمة سرّ جديدة",
    resetLead: "الكود اللي تبعث لـ",
    resetLeadAfter: "يثبّت إلّي العنوان متاعك.",
    newPwLabel: "كلمة السرّ الجديدة",
    resetCta: "بدّل كلمة السرّ",
    resetNote: "الأجهزة الكل باش يخرجو، كان هذا.",
    backToPassword: "ارجع",
    promptTitle: "اعمل كلمة سرّ (ننصحوك)",
    promptLead: "المرّة الجاية، ادخل بالإيميل متاعك وكلمة السرّ هاذي. ديما تنجّم تطلب كود في الإيميل.",
    promptLeadSms: "المرّة الجاية، ادخل بنمرتك وكلمة السرّ هاذي. ديما تنجّم تطلب كود بالـSMS.",
    promptCta: "اعمل كلمة السرّ",
    promptSkip: "من بعد",
    errGrantExpired: "الوقت فات. تنجّم تعمل كلمة السرّ من بعد، من حسابك.",
    // end espace prof v2 · auth
  },
} as const;

/* Which step is on screen. Each replaces the previous one in the same card. */
type Step = "identifier" | "password" | "code" | "reset" | "prompt";
type FieldName = "identifier" | "code" | "password" | "newPassword";

/* `channel` comes from the SERVER shell (otpChannel()), so flipping OTP_CHANNEL
   back to sms swaps this form to a phone field on the next restart — no rebuild,
   no code change. Everything below is written against a neutral "identifier" for
   the same reason. */
export function AuthInner({
  next,
  channel,
  minorsAllowed = false,
  existingAccount = false,
}: {
  next: string | null;
  channel: OtpChannel;
  /** phase-a lane L2 (A24): ALLOW_MINORS, read per request by the server shell. */
  minorsAllowed?: boolean;
  /** espace prof v2 · auth: arrived from a signup page whose address already has an account. */
  existingAccount?: boolean;
}) {
  const { t, locale } = useLocale();
  const c = COPY[locale];
  // phase-a lane L2 (A24): "Je suis élève / parent" only while minors (and so parents) are in.
  const studentCta = minorsAllowed ? c.newStudent : c.newStudentAdult;
  const router = useLocalizedRouter();
  const isEmail = channel === "email";

  const [identifier, setIdentifier] = useState("");
  const [step, setStep] = useState<Step>("identifier");
  const [code, setCode] = useState("");
  const [password, setPasswordValue] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* A problem with ONE field (an empty or malformed address, a wrong code) is shown
     ON that field: Field sets aria-invalid and points aria-describedby at the
     message, and invalid() moves focus there — a keyboard or screen-reader user
     lands on the thing to fix instead of staying on the submit button. `error`
     above is for everything that is not about a field (network, rate limits). */
  const [fieldError, setFieldError] = useState<{ field: FieldName; message: string } | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  /* The steps REPLACE each other, so whatever had focus on a later step (the
     "Changer" link, the resend button) leaves the DOM when we go back — and focus
     would fall to <body>. Set before leaving; the effect below puts focus on the
     identifier field once step 1 has rendered it again. (Going forward needs
     nothing: each later step autofocuses its first field.) */
  const refocusIdentifier = useRef(false);
  useEffect(() => {
    if (step === "identifier" && refocusIdentifier.current) {
      refocusIdentifier.current = false;
      identifierRef.current?.focus();
    }
  }, [step]);

  /* espace prof v2 · auth: a signup page sent us here because the address already
     has an account. It handed the address over in sessionStorage (never the URL,
     which would put it in proxy logs and browser history) — take it once. */
  useEffect(() => {
    const prefill = takeAuthPrefill();
    if (prefill) setIdentifier(prefill);
  }, []);

  /* What verifyOtp answered, kept while the one-time password offer is on screen,
     so "Plus tard" and "Créer" both land exactly where the sign-in would have. */
  const [after, setAfter] = useState<(PostAuth & { passwordGrant?: string }) | null>(null);

  function refs(field: FieldName) {
    return field === "identifier" ? identifierRef : field === "code" ? codeRef : field === "password" ? passwordRef : newPasswordRef;
  }

  function invalid(field: FieldName, message: string) {
    setError(null);
    setFieldError({ field, message });
    /* The identifier field is not in the DOM on a later step. A server refusal of
       the address at that point (a resend answered with invalid-email /
       invalid-phone) would be set on a field nobody can see — so go back to step 1,
       where the message renders on the field and the effect above focuses it. */
    if (field === "identifier" && step !== "identifier") { leaveCodeStep(); return; }
    refs(field).current?.focus();
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
  const onCodeStep = step === "code" || step === "reset";
  const expired = onCodeStep && hadExpiry && expiry.done;
  /* Resend is available once the cooldown ends — and unconditionally once the code
     has expired, because the 5-minute life always outlasts the 60s gap, so being
     blocked at that point could only ever be the UI lagging the server. */
  const canResend = cooldown.done || expired;
  /* No account for this address: after a code proved it ("verified"), or straight
     from the account-status answer ("direct", no code spent). We say so and point
     at signup rather than quietly creating a profile the visitor never asked for. */
  const [noAccount, setNoAccount] = useState<"verified" | "direct" | null>(null);

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

  /* Back to step 1 with the same identifier. The code, the passwords, the dev code
     and both timers describe a step that is no longer on screen, so they go too. */
  function leaveCodeStep() {
    setStep("identifier"); setCode(""); setDevCode(null);
    setPasswordValue(""); setNewPassword("");
    cooldown.start(0); expiry.start(0); setHadExpiry(false);
    refocusIdentifier.current = true;
  }

  function clearMessages() {
    setError(null);
    setFieldError(null);
    setNotice(null);
  }

  /* espace prof v2 · auth — step 1's Continuer. Ask the API what this address is
     before deciding which step comes next. Throttled, or the call failing, falls
     back to the code path: it works for every account, so nobody is stranded. */
  async function handleContinue() {
    if (loading) return;
    if (!identifierOk()) return;
    clearMessages();
    setLoading(true);
    let status: Awaited<ReturnType<typeof accountStatus>> | null = null;
    try {
      status = await accountStatus(identifier.trim());
    } catch {
      status = null;
    }
    setLoading(false);
    if (status?.ok) {
      if (!status.exists) { setNoAccount("direct"); return; }
      if (status.hasPassword) { setStep("password"); return; }
    } else if (status && status.error === "invalid-email") {
      invalid("identifier", c.errBadEmail);
      return;
    } else if (status && status.error === "invalid-phone") {
      invalid("identifier", c.errBadPhone);
      return;
    }
    await send(false, "login");
  }

  /* One send path for the first code and every resend, for signing in and for a
     forgotten password alike — only the e-mail's wording and the step it lands on
     differ. `resend` only changes how the result is presented: a resend keeps the
     user on the step, and a "too-soon" answer arms the countdown instead of showing
     a red error — the server is simply telling us a rule the UI had not drawn yet
     (which is exactly what happens after a page reload, when the client has no
     timer but the server still has the cooldown). */
  async function send(resend: boolean, purpose: "login" | "password") {
    if (loading) return;
    if (!identifierOk()) return;
    const id = identifier.trim();
    const target: Step = purpose === "password" ? "reset" : "code";
    setLoading(true);
    clearMessages();
    let res: Awaited<ReturnType<typeof requestOtp>>;
    try {
      // `id`, not `identifier`: the raw value carries the leading/trailing space a
      // phone keyboard adds, and only the display copy was being trimmed before.
      res = await requestOtp({ identifier: id, locale, purpose });
    } catch {
      // Network hiccup on 3G — never leave the button stuck on "Chargement…".
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (res.ok) {
      setStep(target);
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
           have typed into. (The same live code also proves the mailbox for a reset.) */
        setStep(target);
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
    clearMessages();
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
      if (res.error === "no-account") { setNoAccount("verified"); return; }
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
    /* espace prof v2 · auth: the API offers a password-less account a password
       ONCE. Signed in already; the offer only decides where they land next. */
    if (res.promptPassword && res.passwordGrant) {
      setAfter(res);
      setStep("prompt");
      return;
    }
    // Destination priority (consent → welcome → ?next= → role home) lives in
    // lib/auth-destination.ts, shared with both signup screens.
    router.push(postAuthDestination(res, next));
  }

  /* ── espace prof v2 · auth: the password sign-in ── */
  async function handlePasswordLogin() {
    if (loading) return;
    if (!password) { invalid("password", c.errNeedPassword); return; }
    setLoading(true);
    clearMessages();
    let res: Awaited<ReturnType<typeof passwordLogin>>;
    try {
      res = await passwordLogin({ identifier: identifier.trim(), password, locale });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (res.ok) { router.push(postAuthDestination(res, next)); return; }
    if (res.error === "invalid-credentials") { invalid("password", isEmail ? c.errCredentials : c.errCredentialsSms); return; }
    if (res.error === "too-many-attempts") { setError(c.errLocked(res.retryAfter ?? 900)); return; }
    if (res.error === "account-blocked") { setError(c.errBlocked); return; }
    setError(t.extra.error);
  }

  /* ── « Mot de passe oublié » : the code and the new password, on one step ── */
  async function handleReset() {
    if (loading) return;
    if (code.length !== OTP_LENGTH) { invalid("code", c.codeHelp); return; }
    const problem = clientPasswordProblem(newPassword);
    if (problem) { invalid("newPassword", weakPasswordMessage(locale, problem)); return; }
    setLoading(true);
    clearMessages();
    let res: Awaited<ReturnType<typeof resetPassword>>;
    try {
      res = await resetPassword({ identifier: identifier.trim(), code, password: newPassword, locale });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (res.ok) { router.push(postAuthDestination(res, next)); return; }
    if (res.error === "weak-password") { invalid("newPassword", weakPasswordMessage(locale, res.reason)); return; }
    if (res.error === "invalid-code") { invalid("code", c.errBadCode); return; }
    if (res.error === "too-many-attempts") { setError(c.errTooManyAttempts(res.retryAfter ?? 900)); return; }
    if (res.error === "no-account") { setNoAccount("verified"); return; }
    if (res.error === "account-blocked") { setError(c.errBlocked); return; }
    setError(t.extra.error);
  }

  /* ── The one-time offer after a code sign-in ── */
  function leaveAfterPrompt() {
    router.push(postAuthDestination(after ?? {}, next));
  }

  async function handleCreateFromPrompt() {
    if (loading) return;
    const problem = clientPasswordProblem(newPassword);
    if (problem) { invalid("newPassword", weakPasswordMessage(locale, problem)); return; }
    setLoading(true);
    clearMessages();
    let res: Awaited<ReturnType<typeof setPassword>>;
    try {
      res = await setPassword({ password: newPassword, grant: after?.passwordGrant });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (res.ok) { leaveAfterPrompt(); return; }
    if (res.error === "weak-password") { invalid("newPassword", weakPasswordMessage(locale, res.reason)); return; }
    if (res.error === "grant-expired" || res.error === "proof-required") { setError(c.errGrantExpired); return; }
    if (res.error === "has-password") { leaveAfterPrompt(); return; }
    setError(t.extra.error);
  }

  /* The panel is the same on every screen of this page, including "no account". */
  const panel = {
    eyebrow: c.panelEyebrow,
    title: c.panelTitle,
    summary: c.panelSummary,
    points: c.panelPoints,
    trust: c.panelTrust,
  };

  /* ── There is no account for this address ── */
  if (noAccount) {
    const body = noAccount === "direct"
      ? (isEmail ? c.noAccountDirectEmail : c.noAccountDirectSms)
      : (isEmail ? c.noAccountBodyEmail : c.noAccountBodySms);
    return (
      <AuthShell {...panel}>
        <h1 className="auth-title mb-1.5">
          {isEmail ? c.noAccountTitleEmail : c.noAccountTitleSms}
        </h1>
        <p className="auth-lead">{body}</p>
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
    <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start" data-e2e="auth-error">
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

  /* The address, isolated left-to-right inside a sentence of either language. */
  const who = <b className="font-bold text-ink break-words" dir="ltr">{identifier.trim()}</b>;
  /* Password managers file a password under the username next to it: give them
     the address on the steps that ask for a password, where the email field is gone. */
  const usernameForManagers = (
    <input type="text" name="username" autoComplete="username" value={identifier.trim()} readOnly hidden />
  );

  /* The dev code box, the six boxes, "Changer" + resend, the timers: the code step
     and the reset step share all of it. */
  const resendButton = (purpose: "login" | "password") => (
    <button
      type="button"
      data-e2e="resend"
      onClick={() => send(true, purpose)}
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
  );
  const devCodeBox = devCode && (
    /* Local development only. requestOtp() returns the code ONLY when NODE_ENV is
       not "production" AND no provider is configured; a production deploy with no
       mail or SMS credentials fails the send outright rather than printing a
       stranger's code here. */
    <div className="bg-sand border-[1.4px] border-dashed border-ochre-btn rounded-brand py-2.5 px-3 mb-3.5 text-center text-[13px] text-ink2 leading-[1.5]">
      <b className="font-display text-[18px] tracking-[3px] text-ink block" dir="ltr" data-e2e="dev-code">
        {devCode}
      </b>
      {c.devCodeNote}
    </div>
  );
  const codeTimers = (
    <>
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
    </>
  );

  return (
    <AuthShell {...panel}>
      {/* A real <form>: this was loose divs with onClick handlers, so pressing
          Enter after typing an address or a code did nothing at all — the single
          most reflexive action on a login screen. ONE form for every step;
          onSubmit dispatches to whichever step is on screen. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step === "code") handleVerify();
          else if (step === "password") void handlePasswordLogin();
          else if (step === "reset") void handleReset();
          else if (step === "prompt") void handleCreateFromPrompt();
          else void handleContinue();
        }}
        noValidate
      >
        {/* The wrappers are KEYED. Unkeyed, React matched them by position (all are
            a <div>) and recycled one step's nodes into the next — the "J'ai déjà un
            code" button became "Changer d'email" in place and kept focus, so
            OtpInput's autoFocus never won. Distinct keys make each swap a real
            unmount/mount. */}
        {step === "identifier" && (
          /* ── Step 1: the address (or number) ── */
          <div key="identifier" data-e2e="auth-step-identifier">
            <h1 className="auth-title mb-1.5">{t.auth.title}</h1>
            <p className="auth-lead mb-6">{isEmail ? c.lead : c.leadSms}</p>

            {/* espace prof v2 · auth: sent here by a signup page — the address has an account. */}
            {existingAccount && (
              <div className="note-info mb-4" role="status" data-e2e="existing-account-notice">
                <Info />
                <p>{c.existingNotice}</p>
              </div>
            )}

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
                  clearMessages();
                  if (!identifierOk()) return;
                  setStep("code");
                }}
                className="auth-link auth-tap text-[14px]"
              >
                {c.haveCode}
              </button>
            </div>
          </div>
        )}

        {step === "password" && (
          /* ── espace prof v2 · auth: the account has a password ── */
          <div key="password" data-e2e="auth-step-password" className="rise">
            <div className="auth-icon-tile mb-5" aria-hidden="true"><Lock /></div>
            <h1 className="auth-title mb-1.5">{c.pwTitle}</h1>
            <p className="auth-lead mb-6 break-words">{c.pwFor} {who}</p>
            {usernameForManagers}

            <PasswordField
              label={c.pwLabel}
              value={password}
              onChange={(v) => {
                setPasswordValue(v);
                if (fieldError?.field === "password") setFieldError(null);
              }}
              autoComplete="current-password"
              error={fieldError?.field === "password" ? fieldError.message : undefined}
              inputRef={passwordRef}
              autoFocus
              name="password"
              e2e="password"
            />

            <div className="auth-row -mt-1 mb-3">
              <button
                type="button"
                data-e2e="change-identifier"
                className="auth-link auth-tap gap-1"
                onClick={() => { clearMessages(); leaveCodeStep(); }}
              >
                <Back className="w-4 h-4" />
                {isEmail ? c.changeEmail : c.changeNumber}
              </button>
              <button type="button" data-e2e="forgot-password" className="auth-link auth-tap" onClick={() => send(false, "password")} disabled={loading}>
                {c.forgot}
              </button>
            </div>

            {errorLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : c.pwCta}
            </Button>

            <div className="auth-alt">
              <button type="button" data-e2e="use-code" className="auth-link auth-tap text-[14px]" onClick={() => send(false, "login")} disabled={loading}>
                {c.useCode}
              </button>
            </div>
          </div>
        )}

        {step === "code" && (
          /* ── The code. Replaces step 1 in the same card. ── */
          <div key="code" data-e2e="auth-step-code" className="rise">
            <div className="auth-icon-tile mb-5">
              {isEmail ? <Mail /> : <Phone />}
            </div>
            <h1 className="auth-title mb-1.5">{isEmail ? c.checkTitleEmail : c.checkTitleSms}</h1>
            {/* Where the code went. The identifier is isolated left-to-right so an
                address or a number reads correctly inside the Arabic sentence. */}
            <p className="auth-lead mb-6 break-words">
              {isEmail ? c.sentToEmail : c.sentToSms} {who}
            </p>

            {noticeLine}
            {devCodeBox}

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
                onClick={() => { clearMessages(); leaveCodeStep(); }}
              >
                <Back className="w-4 h-4" />
                {isEmail ? c.changeEmail : c.changeNumber}
              </button>
              {resendButton("login")}
            </div>

            {errorLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : t.auth.verify}
            </Button>

            {codeTimers}
          </div>
        )}

        {step === "reset" && (
          /* ── espace prof v2 · auth: « Mot de passe oublié » — the code + a new password ── */
          <div key="reset" data-e2e="auth-step-reset" className="rise">
            <div className="auth-icon-tile mb-5" aria-hidden="true"><Lock /></div>
            <h1 className="auth-title mb-1.5">{c.resetTitle}</h1>
            <p className="auth-lead mb-6 break-words">{c.resetLead} {who} {c.resetLeadAfter}</p>
            {usernameForManagers}

            {noticeLine}
            {devCodeBox}

            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (fieldError?.field === "code") setFieldError(null);
              }}
              /* Six digits are not the whole answer here: move on to the password. */
              onComplete={() => newPasswordRef.current?.focus()}
              label={isEmail ? c.codeLabelEmail : c.codeLabelSms}
              error={fieldError?.field === "code" ? fieldError.message : undefined}
              inputRef={codeRef}
              autoFocus
            />

            <div className="mt-5">
              <PasswordField
                label={c.newPwLabel}
                value={newPassword}
                onChange={(v) => {
                  setNewPassword(v);
                  if (fieldError?.field === "newPassword") setFieldError(null);
                }}
                autoComplete="new-password"
                meter
                help={passwordHelp(locale)}
                error={fieldError?.field === "newPassword" ? fieldError.message : undefined}
                inputRef={newPasswordRef}
                name="new-password"
                e2e="new-password"
              />
            </div>

            <div className="auth-row mb-3">
              <button
                type="button"
                data-e2e="back-to-password"
                className="auth-link auth-tap gap-1"
                onClick={() => { clearMessages(); setCode(""); setNewPassword(""); setStep("password"); }}
              >
                <Back className="w-4 h-4" />
                {c.backToPassword}
              </button>
              {resendButton("password")}
            </div>

            {errorLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : c.resetCta}
            </Button>
            <p className="auth-fine mt-3">{c.resetNote}</p>

            {codeTimers}
          </div>
        )}

        {step === "prompt" && (
          /* ── espace prof v2 · auth: the one-time offer after a code sign-in ── */
          <div key="prompt" data-e2e="auth-step-prompt" className="rise">
            <div className="auth-icon-tile mb-5" aria-hidden="true"><Lock /></div>
            <h1 className="auth-title mb-1.5">{c.promptTitle}</h1>
            <p className="auth-lead mb-6">{isEmail ? c.promptLead : c.promptLeadSms}</p>
            {usernameForManagers}

            <PasswordField
              label={c.pwLabel}
              value={newPassword}
              onChange={(v) => {
                setNewPassword(v);
                if (fieldError?.field === "newPassword") setFieldError(null);
              }}
              autoComplete="new-password"
              meter
              help={passwordHelp(locale)}
              error={fieldError?.field === "newPassword" ? fieldError.message : undefined}
              inputRef={newPasswordRef}
              autoFocus
              name="new-password"
              e2e="new-password"
            />

            {errorLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : c.promptCta}
            </Button>
            <div className="auth-alt">
              <button type="button" data-e2e="prompt-skip" className="auth-link auth-tap text-[14px]" onClick={leaveAfterPrompt} disabled={loading}>
                {c.promptSkip}
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Signup is a different page now, one per audience. Step 1 only: on the
          later steps the only ways out are the step's own links. */}
      {step === "identifier" && (
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
