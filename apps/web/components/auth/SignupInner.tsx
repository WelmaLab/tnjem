"use client";
/* The interactive body of BOTH signup screens: /signup/prof and /signup/eleve.

   WHY THE FUNNEL IS SPLIT. There used to be one /auth screen carrying a
   tutor/student toggle, and that toggle was a lie for anyone who already had an
   account: verifyOtp deliberately never overwrites an existing profile's role (it
   must not — otherwise re-authenticating as the other role would be a one-tap
   self-promotion), so a returning student who tapped "Je suis prof" was signed in
   as a student and pushed to /student with no explanation. Meanwhile the role
   actually got set somewhere else entirely, as a silent side effect of saving a
   name in createTutor().

   So: role is chosen by WHICH PAGE YOU ARE ON, and it is only ever applied to a
   brand-new account. /auth is sign-in and has no role picker at all, because there
   is nothing for it to pick — the account already knows. A number that already
   belongs to the other kind of account gets told so (roleMismatch), instead of
   being silently redirected somewhere that contradicts what it just tapped.

   Rendered by a SERVER page that reads ?next= and hands it down as a prop — the
   same arrangement app/[locale]/auth/page.tsx documents at length: reading the
   query string with the client hook forces the form into a Suspense boundary,
   which Next bails to client-only rendering, which ships a login page with no
   fields in the HTML.

   Layout (Option B): <AuthShell> draws the page chrome and the brand panel; this
   file owns the form side. Two steps share ONE card and ONE <form>: the identifier
   step (address + birth date), then the code step, which REPLACES it rather than
   being appended below.

   espace prof v2 · phase 2 — PASSWORDS. Continuer first asks the API whether the
   address already has an account; if so, signing up is the wrong door and the
   visitor goes to /auth, address prefilled, « Tu as déjà un compte — connecte-toi ».
   After the code, a new account gets a third step, « Crée ton mot de passe »
   (required: no skip), set with the grant the verify returned. */
import { useEffect, useRef, useState } from "react";
import { Link, useLocalizedRouter } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Phone, Calendar, Mail, Back, ChevronDown, Lock } from "@/components/icons";
import { requestOtp, verifyOtp } from "@/app/actions";
import { accountStatus, setPassword } from "@/app/actions-auth"; // espace prof v2 · auth
import { AuthShell } from "@/components/auth/AuthShell";
import { OtpInput, OTP_LENGTH } from "@/components/auth/OtpInput";
import { PasswordField, passwordHelp, weakPasswordMessage, clientPasswordProblem } from "@/components/auth/PasswordField";
import { postAuthDestination, type PostAuth } from "@/lib/auth-destination";
import { stashAuthPrefill } from "@/lib/auth-prefill";
import { useCountdown, formatCountdown } from "@/components/useCountdown";
// Pure module — the SAME validity check the server runs, so the form and the action
// can never disagree about what a valid address is.
import { isValidEmail } from "@tnajem/shared";
import { isAdult } from "@tnajem/shared"; // phase-a lane L2 (A24): the API's own rule
import type { OtpChannel } from "@/lib/auth";

export type SignupRole = "tutor" | "student";

/* Page-local copy. lib/i18n.ts is shared and read-only for these screens, and
   several of its strings are wrong here anyway — t.auth.title says "Connexion"
   (this is signup) and t.auth.pending describes our SMS-provider status. */
const COPY = {
  fr: {
    /* The brand panel. What this account actually gets you — three facts,
       role-specific. This is the whole reason the funnel is split: the two
       audiences want different things and a shared toggle could speak to neither.
       Every line is true of the product today: no testimonial, name, city or
       number (the no-fabrication rule applies to marketing copy too). */
    tutorEyebrow: "Pour les profs",
    tutorPanelTitle: "Ta page de prof en 2 minutes.",
    tutorSummary: "Prix libre · vérification à la main",
    tutorPoints: [
      "Tu fixes ton prix — 100 % pour toi pendant le pilote",
      "Vérification à la main par notre équipe",
      "Tes classes et tes élèves au même endroit",
    ],
    studentEyebrow: "Pour les élèves",
    studentPanelTitle: "Trouve le bon prof, en ligne.",
    studentSummary: "Tarif affiché · profs vérifiés à la main",
    studentPerks: [
      "Le tarif est affiché avant que tu réserves",
      "Uniquement des profs vérifiés à la main",
      "Annulation gratuite jusqu'à 48h avant",
    ],
    panelTrust: "Pilote · chaque prof est vérifié à la main par notre équipe",

    title: "Crée ton compte",
    // espace prof v2 · auth: was "Sans mot de passe." — a password is now created at sign-up.
    leadEmail: "Un code par email pour vérifier ton adresse, puis ton mot de passe.",
    leadSms: "Un code par SMS pour vérifier ton numéro, puis ton mot de passe.",
    cta: "Continuer",
    email: "Ton email",
    emailPh: "prenom@exemple.com",
    changeEmail: "Changer d'email",
    errNeedEmail: "Entre ton adresse email.",
    errBadEmail: "Cette adresse email n'est pas valide.",
    errBadPhone: "Numéro de téléphone invalide.",
    errSend: "Envoi du code impossible. Réessaie.",
    errBadCode: "Code incorrect ou expiré. Vérifie les 6 chiffres, ou demande un nouveau code.",
    errTooManyAttempts: (secs: number) =>
      `Trop d'essais. Réessaie dans ${Math.max(1, Math.ceil(secs / 60))} minutes.`,
    errBlocked: "Ce compte a été suspendu par l'équipe Tnajem. Tu ne peux pas te connecter.",
    alreadySent: "Un code t'a déjà été envoyé et il est encore valable — saisis-le ci-dessous.",
    haveCode: "J'ai déjà un code",

    byNote: "Pour un élève de moins de 18 ans, l'accord d'un parent ou tuteur est demandé avant la 1ʳᵉ séance.",
    termsBefore: "En créant ton compte, tu acceptes les ",
    termsLink: "conditions d'utilisation",
    termsAnd: " et la ",
    privacyLink: "politique de confidentialité",
    termsAfter: ".",

    checkTitleEmail: "Vérifie ta boîte mail",
    checkTitleSms: "Vérifie tes SMS",
    // Followed by the address / number in bold, isolated left-to-right.
    sentToEmail: "Code envoyé à",
    sentToSms: "Code envoyé au",
    changeNumber: "Changer de numéro",
    devCodeNote: "Code de test — aucun message n'est envoyé pour l'instant",
    codeHelp: "6 chiffres.",
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

    errNeedPhone: "Entre ton numéro de téléphone.",
    // The two exits: I already have an account, or I'm the other audience.
    haveAccount: "Déjà inscrit ?",
    signIn: "Se connecter",
    askTutor: "Prof ?",
    askStudent: "Élève ?",
    thisWay: "Par ici",

    mismatchTitle: "Ce compte existe déjà",
    mismatchTutor: "C'est déjà un compte prof. Tu es connecté — voici ton tableau de bord.",
    mismatchStudent: "C'est déjà un compte élève. Tu es connecté — voici tes cours.",
    mismatchNote: "Un compte par personne. Pour enseigner avec un compte élève, passe par « Devenir prof » depuis ton espace.",
    goDashboard: "Aller à mon tableau de bord",
    goStudent: "Voir mes cours",

    // phase-a lane L2 (A24) — birth month + year; the adult-only pilot
    bdLabel: "Date de naissance de l'élève",
    bdLabelSelf: "Ta date de naissance",
    bdMonth: "Mois de naissance",
    bdYear: "Année de naissance",
    bdMonthPh: "Mois",
    bdYearPh: "Année",
    bdMonths: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"],
    // LEGAL-REVIEW: why the date is asked (adult-only pilot, D6).
    bdAdultsNote: "Le pilote est réservé aux 18 ans et plus.",
    errNeedBirthDate: "Choisis le mois et l'année de naissance.",
    errAdultsOnly: "Le pilote est réservé aux 18 ans et plus. Merci de ton intérêt pour Tnajem !",
    // A14 — a tutor must be 18+, whatever ALLOW_MINORS says
    bdTutorNote: "18 ans minimum pour enseigner. Jamais affichée publiquement.",
    errTutorMinor: "Il faut avoir 18 ans ou plus pour enseigner sur Tnajem.",
    // end phase-a lane L2
    // espace prof v2 · auth (phase 2) — the password step
    pwCreateTitle: "Crée ton mot de passe",
    pwCreateLeadEmail: "Tu pourras aussi te connecter avec un code par email.",
    pwCreateLeadSms: "Tu pourras aussi te connecter avec un code par SMS.",
    pwPromptTitle: "Crée un mot de passe (recommandé)",
    pwLabel: "Mot de passe",
    pwCreateCta: "Continuer",
    pwPromptCta: "Créer mon mot de passe",
    pwPromptSkip: "Plus tard",
    errGrantExpired: "Ce délai a expiré. Tu pourras créer ton mot de passe depuis ton profil.",
    goOn: "Continuer",
    // end espace prof v2 · auth
  },
  ar: {
    tutorEyebrow: "للأساتذة",
    tutorPanelTitle: "صفحتك متاع أستاذ في دقيقتين.",
    tutorSummary: "الثمن على كيفك · التثبّت بيدينا",
    tutorPoints: [
      "إنتي تحدّد ثمنك — \u2066100 %\u2069 متاعك في فترة التجربة",
      "التثبّت يتعمل بيدينا",
      "كلاساتك وتلامذتك في بلاصة وحدة",
    ],
    studentEyebrow: "للتلامذة",
    studentPanelTitle: "لقّي الأستاذ اللي يلزمك، أونلاين.",
    studentSummary: "الثمن يبان · أساتذة متثبّت منهم بيدينا",
    studentPerks: [
      "الثمن يبان قبل ما تحجز",
      "كان أساتذة متثبّت منهم بيدينا",
      "الإلغاء مجاني حتى 48 ساعة قبل",
    ],
    panelTrust: "فترة التجربة · كل أستاذ نتثبّتو منّو بيدينا",

    title: "اعمل حسابك",
    // espace prof v2 · auth: كان "بلا كلمة سرّ." — توّا كلمة السرّ تتعمل كي تسجّل.
    leadEmail: "كود في الإيميل باش نتثبّتو من العنوان متاعك، ومن بعد كلمة السرّ.",
    leadSms: "كود بالـSMS باش نتثبّتو من نمرتك، ومن بعد كلمة السرّ.",
    cta: "كمّل",
    email: "الإيميل متاعك",
    emailPh: "esm@exemple.com",
    changeEmail: "بدّل الإيميل",
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

    byNote: "للتلميذ اللي عمرو أقلّ من 18 سنة، تتطلب موافقة الولي قبل الحصة الأولى.",
    termsBefore: "كي تعمل حسابك، تقبل ",
    termsLink: "شروط الاستعمال",
    termsAnd: " و",
    privacyLink: "سياسة الخصوصية",
    termsAfter: ".",

    checkTitleEmail: "شوف الإيميل متاعك",
    checkTitleSms: "شوف الـSMS متاعك",
    sentToEmail: "الكود تبعث لـ",
    sentToSms: "الكود تبعث لـ",
    changeNumber: "بدّل النمرة",
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

    errNeedPhone: "حطّ نمرة تليفونك.",
    haveAccount: "عندك حساب قبل ؟",
    signIn: "دخول",
    askTutor: "أستاذ ؟",
    askStudent: "تلميذ ؟",
    thisWay: "من هنا",

    mismatchTitle: "هذا الحساب موجود",
    mismatchTutor: "هذا حساب أستاذ. إنتي داخل — هاذي لوحتك.",
    mismatchStudent: "هذا حساب تلميذ. إنتي داخل — هاذي حصصك.",
    mismatchNote: "حساب واحد للشخص. باش تقرّي بحساب تلميذ، عدّي من «ولّي أستاذ» من فضاءك.",
    goDashboard: "امشي للوحتي",
    goStudent: "شوف حصصي",

    // phase-a lane L2 (A24) — birth month + year; the adult-only pilot
    bdLabel: "تاريخ ولادة التلميذ",
    bdLabelSelf: "تاريخ ولادتك",
    bdMonth: "شهر الولادة",
    bdYear: "عام الولادة",
    bdMonthPh: "الشهر",
    bdYearPh: "العام",
    bdMonths: ["جانفي", "فيفري", "مارس", "أفريل", "ماي", "جوان", "جويلية", "أوت", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    // LEGAL-REVIEW: why the date is asked (adult-only pilot, D6).
    bdAdultsNote: "فترة التجربة كان للي عندهم 18 سنة ولا أكثر.",
    errNeedBirthDate: "اختار الشهر والعام متاع الولادة.",
    errAdultsOnly: "فترة التجربة كان للي عندهم 18 سنة ولا أكثر. يعيشك على اهتمامك بـ Tnajem !",
    // A14 — a tutor must be 18+, whatever ALLOW_MINORS says
    bdTutorNote: "18 سنة على الأقل باش تقرّي. التاريخ ما يبان لحتّى حد.",
    errTutorMinor: "لازمك 18 سنة ولا أكثر باش تقرّي في Tnajem.",
    // end phase-a lane L2
    // espace prof v2 · auth (phase 2) — the password step
    pwCreateTitle: "اعمل كلمة السرّ متاعك",
    pwCreateLeadEmail: "تنجّم زادة تدخل بكود يوصلك في الإيميل.",
    pwCreateLeadSms: "تنجّم زادة تدخل بكود يوصلك بالـSMS.",
    pwPromptTitle: "اعمل كلمة سرّ (ننصحوك)",
    pwLabel: "كلمة السرّ",
    pwCreateCta: "كمّل",
    pwPromptCta: "اعمل كلمة السرّ",
    pwPromptSkip: "من بعد",
    errGrantExpired: "الوقت فات. تنجّم تعمل كلمة السرّ من حسابك.",
    goOn: "كمّل",
    // end espace prof v2 · auth
  },
} as const;

type FieldName = "identifier" | "code" | "birth";

/* `channel` comes from the SERVER shell (otpChannel()), so flipping OTP_CHANNEL
   back to sms swaps this form to a phone field on the next restart — no rebuild, no
   code change. Everything below is written against a neutral "identifier". */
export function SignupInner({
  role,
  next,
  channel,
  minorsAllowed = false,
}: {
  role: SignupRole;
  next: string | null;
  channel: OtpChannel;
  /* phase-a lane L2 (A24). ALLOW_MINORS, read by the SERVER shell per request —
     never baked into the bundle. Off (the default): the pilot is adults only. The
     API enforces it either way; this only decides the copy and the early refusal. */
  minorsAllowed?: boolean;
}) {
  const { t, locale } = useLocale();
  const c = COPY[locale];
  const router = useLocalizedRouter();
  const isStudent = role === "student";
  const isEmail = channel === "email";
  // phase-a lane L2 (A24, A14): who is asked a birth date, and whether a minor may continue.
  // Everyone is asked; a TUTOR must be 18+ whatever ALLOW_MINORS says (A14).
  const asksBirthDate = true;
  const adultsOnly = !isStudent || !minorsAllowed;

  const [identifier, setIdentifier] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState(""); // phase-a lane L2 (A24)
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* Field-level problems go ON the field, with focus moved there — the same split
     as AuthInner, which explains it. `error` is for everything else. */
  const [fieldError, setFieldError] = useState<{ field: FieldName; message: string } | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const birthMonthRef = useRef<HTMLSelectElement>(null); // phase-a lane L2 (A24)
  /* Neutral guidance, not a failure — styled and announced as information. */
  const [notice, setNotice] = useState<string | null>(null);

  /* THE TWO STEPS REPLACE EACH OTHER, so a field of step 1 does not exist while the
     code step is on screen — and two things on the code step can still fail one:
     the birth date (verifyWith re-checks it, see A24 below) and, rarely, the
     number (a resend the server calls invalid). Either way we go back to step 1
     with the error on the field, and focus it once step 1 has rendered it again:
     the ref is null until then, so the focus is parked here and taken by the
     effect below.

     `resumeFor` is the address whose code step we just left because of the birth
     date. The code in their inbox (and the digits they typed) is still good, so
     pressing Continuer again with the SAME address must not request another one —
     createOtp would replace it and the digits they typed would die. It returns to
     the code step instead (see send()). A different address, or "Changer
     d'email", forgets it. */
  const focusOnStep1 = useRef<"identifier" | "birth" | null>(null);
  const [resumeFor, setResumeFor] = useState<string | null>(null);
  useEffect(() => {
    if (codeSent || !focusOnStep1.current) return;
    const field = focusOnStep1.current;
    focusOnStep1.current = null;
    (field === "identifier" ? identifierRef : birthMonthRef).current?.focus();
  }, [codeSent]);

  /* Which step is on screen is read from the REFS, not from `codeSent`: verifyWith
     can start in a step-1 render (the resume path in send()) and answer after the
     code step has replaced it, and that render's `codeSent` would be stale.

     `codeStillValid` is false only when the server refused the birth date: it
     checks the date AFTER proving the code, and proving it consumed it. */
  function invalid(field: FieldName, message: string, codeStillValid = true) {
    setError(null);
    setFieldError({ field, message });
    const ref = field === "identifier" ? identifierRef : field === "birth" ? birthMonthRef : codeRef;
    if (ref.current || field === "code") { ref.current?.focus(); return; }
    focusOnStep1.current = field;
    setResumeFor(field === "birth" && codeStillValid ? identifier.trim() : null);
    setNotice(null);
    setCodeSent(false);
  }

  /* phase-a lane L2 (A24). The birth date is checked BEFORE a code is spent — on
     the send, and on the verify, which is what the "J'ai déjà un code" path goes
     through (it used to skip the date entirely). The same isAdult() the API runs,
     so the two cannot disagree; the API is still the one that refuses. Returns
     true when the form may go on. */
  function birthDateOk(): boolean {
    if (!asksBirthDate) return true;
    if (!birthYear || !birthMonth) { invalid("birth", c.errNeedBirthDate); return false; }
    if (adultsOnly && !isAdult(Number(birthYear), Number(birthMonth))) {
      invalid("birth", isStudent ? c.errAdultsOnly : c.errTutorMinor);
      return false;
    }
    return true;
  }

  /* The address checks shared by the send and by "J'ai déjà un code". Returns the
     trimmed identifier, or null once the problem is on the field. */
  function identifierOk(): string | null {
    const id = identifier.trim();
    if (!id) { invalid("identifier", isEmail ? c.errNeedEmail : c.errNeedPhone); return null; }
    // Same check the server runs, so a typo is caught before we spend a send.
    if (isEmail && !isValidEmail(id.toLowerCase())) { invalid("identifier", c.errBadEmail); return null; }
    return id;
  }

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
  /* Set when the phone already belongs to an account of the OTHER role. We stay on
     this page and explain, rather than redirecting somewhere that contradicts the
     page they deliberately opened. */
  const [existingRole, setExistingRole] = useState<string | null>(null);

  /* Everything that belongs to one code: the digits typed, the dev code, and the
     two timers — which describe a code that is no longer on screen. */
  function forgetCode() {
    setCode("");
    setDevCode(null);
    cooldown.start(0);
    expiry.start(0);
    setHadExpiry(false);
    setResumeFor(null);
  }

  /* One send path for the first code and every resend. `resend` only changes how
     the result is presented: a resend keeps the user on the code step, and a
     "too-soon" answer arms the countdown instead of showing a red error — the
     server is simply telling us a rule the UI had not drawn yet (which is exactly
     what happens after a page reload, when the client has no timer but the server
     still has the cooldown). */
  async function send(resend: boolean) {
    if (loading) return;
    const id = identifierOk();
    if (!id) return;
    if (!birthDateOk()) return; // phase-a lane L2 (A24)
    if (!resend) {
      if (resumeFor === id) {
        /* Back from the code step to fix the birth date, same address: the code
           they hold is still the live one, so go back to it rather than spending a
           send that would kill it. Six digits already typed → verify them now. */
        setError(null);
        setFieldError(null);
        setCodeSent(true);
        if (code.length === OTP_LENGTH) void verifyWith(code);
        return;
      }
      // A first send for this address: nothing from an earlier code step applies.
      forgetCode();
    }
    setLoading(true);
    setError(null);
    setFieldError(null);
    setNotice(null);
    /* espace prof v2 · auth — « Tu as déjà un compte ». Before spending a code, ask
       whether the address already has an account (POST /auth/account-status, the
       spec's accepted trade-off — see the API route). If it does, signing up is the
       wrong door: go to /auth with the address prefilled (sessionStorage, never the
       URL) and the notice. A failed or throttled check falls through to the code,
       where verifyOtp still tells an existing account apart (roleMismatch below). */
    if (!resend) {
      let status: Awaited<ReturnType<typeof accountStatus>> | null = null;
      try {
        status = await accountStatus(id);
      } catch {
        status = null;
      }
      if (status?.ok && status.exists) {
        stashAuthPrefill(id);
        const params = new URLSearchParams({ existing: "1" });
        if (next) params.set("next", next);
        router.push(`/auth?${params.toString()}`);
        return; // stays "loading" while the next page loads: no double submit
      }
    }
    let res: Awaited<ReturnType<typeof requestOtp>>;
    try {
      // `id`, not `identifier`: only the display copy was trimmed before.
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
        /* A cooldown on a FIRST send means a live code was already sent to this
           address — almost always a mid-flow reload. Advance to the code step so
           the code sitting in their inbox is usable, instead of stranding them on
           the address step behind a red error. */
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

  /* Carry ?next= across every exit from this screen. Without it, a visitor bounced
     off /checkout who turns out to already have an account — or who taps through to
     the other audience — loses the booking they came for even though they end up
     signed in. Same helper AuthInner uses. */
  const withNext = (path: string) => (next ? `${path}?next=${encodeURIComponent(next)}` : path);

  const handleSendCode = () => send(false);
  const handleResend = () => send(true);

  /* For someone who reloaded mid-flow: reach the code they already have without
     spending a send or waiting out a cooldown. It needs a valid address and
     NOTHING ELSE. It used to run the birth-date check first, so the one person this
     link exists for — someone holding a code — got "choose your birth month"
     instead of the boxes to type it into. The date is not skipped: verifyWith
     checks it before the code is spent (A24) and brings them back to the field. */
  function handleHaveCode() {
    setError(null); setFieldError(null); setNotice(null);
    const id = identifierOk();
    if (!id) return;
    if (resumeFor !== id) forgetCode();
    setCodeSent(true);
  }

  /* Back to the address step. The code on screen belongs to the old address. */
  function handleChangeIdentifier() {
    forgetCode();
    setError(null); setFieldError(null); setNotice(null);
    // The link that had focus leaves the DOM with the code step; land in the field.
    focusOnStep1.current = "identifier";
    setCodeSent(false);
  }

  const handleVerify = () => verifyWith(code);

  async function verifyWith(submitted: string) {
    if (loading) return;
    if (!submitted.trim()) { invalid("code", c.codeHelp); return; }
    if (!birthDateOk()) return; // phase-a lane L2 (A24): the "J'ai déjà un code" path too
    setLoading(true);
    setError(null);
    setFieldError(null);
    setNotice(null);
    let res: Awaited<ReturnType<typeof verifyOtp>>;
    try {
      res = await verifyOtp({
        identifier: identifier.trim(),
        code: submitted,
        role,
        locale,
        birthYear: birthYear ? Number(birthYear) : undefined,
        birthMonth: birthMonth ? Number(birthMonth) : undefined, // phase-a lane L2 (A24)
      });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    setLoading(false);
    if (!res.ok) {
      /* This screen had NO branching at all: every failure, including a single
         mistyped digit, rendered "Une erreur s'est produite." Same split as
         AuthInner — throttling is distinct, wrong and expired stay merged because
         separating them would leak whether the account exists. */
      if (res.error === "too-many-attempts") {
        setError(c.errTooManyAttempts(res.retryAfter ?? 900));
        return;
      }
      if (res.error === "invalid-code") { invalid("code", c.errBadCode); return; }
      // Only ever reaches the owner of the address: the API checks it after the code is proven.
      if (res.error === "account-blocked") { setError(c.errBlocked); return; }
      /* phase-a lane L2 (A24): the server's refusals, in the same words as the form's
         own. The API checks the date AFTER proving the code, and proving it deleted
         it — so this code is spent: back to the birth field WITHOUT it, and the
         next Continuer mints a fresh one (a consumed code holds no cooldown). */
      if (res.error === "adults-only") { forgetCode(); invalid("birth", c.errAdultsOnly, false); return; }
      if (res.error === "birth-date-required") { forgetCode(); invalid("birth", c.errNeedBirthDate, false); return; }
      if (res.error === "minor-cannot-teach") { forgetCode(); invalid("birth", c.errTutorMinor, false); return; } // A14
      setError(t.extra.error);
      return;
    }
    if (res.roleMismatch) {
      setExistingRole(res.role ?? null);
      return;
    }
    /* espace prof v2 · auth — the account exists now (or already did, via "J'ai déjà
       un code"). A new one owes « Crée ton mot de passe »; an older one without a
       password is offered one ONCE (the API decides). The grant lets that step set
       it without a second code. */
    if ((res.needsPassword || res.promptPassword) && res.passwordGrant) {
      setAfter(res);
      setPwStep(res.needsPassword ? "create" : "prompt");
      return;
    }
    router.push(postAuthDestination(res, next));
  }

  /* ── espace prof v2 · auth: the password step ─────────────────────────────── */
  const [pwStep, setPwStep] = useState<"create" | "prompt" | null>(null);
  const [after, setAfter] = useState<(PostAuth & { passwordGrant?: string }) | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [grantGone, setGrantGone] = useState(false);
  const newPasswordRef = useRef<HTMLInputElement>(null);

  const leaveToDestination = () => router.push(postAuthDestination(after ?? {}, next));

  async function handleCreatePassword() {
    if (loading) return;
    const problem = clientPasswordProblem(newPassword);
    if (problem) {
      setError(null);
      setPwError(weakPasswordMessage(locale, problem));
      newPasswordRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    setPwError(null);
    let res: Awaited<ReturnType<typeof setPassword>>;
    try {
      res = await setPassword({ password: newPassword, grant: after?.passwordGrant });
    } catch {
      setLoading(false);
      setError(t.extra.error);
      return;
    }
    if (res.ok || res.error === "has-password") { leaveToDestination(); return; }
    setLoading(false);
    if (res.error === "weak-password") {
      setPwError(weakPasswordMessage(locale, res.reason));
      newPasswordRef.current?.focus();
      return;
    }
    if (res.error === "grant-expired" || res.error === "proof-required") {
      /* Rare (half an hour on this step): the account exists and is signed in, so
         let them through — Réglages › Sécurité creates the password with a code. */
      setGrantGone(true);
      setError(c.errGrantExpired);
      return;
    }
    if (res.error === "too-many-attempts") { setError(c.errTooManyAttempts(res.retryAfter ?? 900)); return; }
    setError(t.extra.error);
  }

  // A ~5-year-old pupil down to a ~85-year-old learner. Inside vBirthYear's
  // accepted range; the server re-validates and fails safe either way.
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 81 }, (_, i) => currentYear - 5 - i)
    // phase-a lane L2 (A24): an adults-only form does not offer years that cannot be 18.
    .filter((y) => !adultsOnly || y <= currentYear - 18);

  /* The brand panel — the same on every screen of this page, including roleMismatch. */
  const panel = isStudent
    ? { eyebrow: c.studentEyebrow, title: c.studentPanelTitle, summary: c.studentSummary, points: c.studentPerks, trust: c.panelTrust }
    : { eyebrow: c.tutorEyebrow, title: c.tutorPanelTitle, summary: c.tutorSummary, points: c.tutorPoints, trust: c.panelTrust };

  /* ── The number already has an account of the other kind ── */
  if (existingRole) {
    const asTutor = existingRole === "tutor";
    return (
      <AuthShell {...panel}>
        <h1 className="auth-title">{c.mismatchTitle}</h1>
        <p className="text-[13.5px] text-ink2 mt-2 mb-4 leading-[1.55]">
          {asTutor ? c.mismatchTutor : c.mismatchStudent}
        </p>
        <p className="text-[13px] text-muted mb-5 leading-[1.6]">{c.mismatchNote}</p>
        <Link href={withNext(asTutor ? "/dashboard" : "/student")} className="btn btn-primary">
          {asTutor ? c.goDashboard : c.goStudent}
        </Link>
      </AuthShell>
    );
  }

  // Whole minutes while there is at least one left, then the m:ss of the last one.
  const expiryText = expiry.left >= 60 ? c.minutes(Math.ceil(expiry.left / 60)) : formatCountdown(expiry.left);
  const showExpiry = !expired && expiry.left > 0;

  /* role="alert" so screen readers announce it on change */
  const errorLine = error && (
    <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start" data-e2e="auth-error">
      {error}
    </p>
  );

  /* ── espace prof v2 · auth: « Crée ton mot de passe » (sign-up, required) or the
     one-time offer (an older account that came in through "J'ai déjà un code").
     Its own card state: the code step is done and gone. ── */
  if (pwStep) {
    const creating = pwStep === "create";
    return (
      <AuthShell {...panel}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreatePassword();
          }}
          noValidate
        >
          <div key={`pw-${pwStep}`} data-e2e="auth-step-password-create" className="rise">
            <div className="auth-icon-tile mb-4" aria-hidden="true"><Lock /></div>
            <h1 className="auth-title">{creating ? c.pwCreateTitle : c.pwPromptTitle}</h1>
            <p className="auth-lead mt-1.5 mb-5">{isEmail ? c.pwCreateLeadEmail : c.pwCreateLeadSms}</p>
            {/* Password managers file the new password under the address next to it. */}
            <input type="text" name="username" autoComplete="username" value={identifier.trim()} readOnly hidden />

            <PasswordField
              label={c.pwLabel}
              value={newPassword}
              onChange={(v) => {
                setNewPassword(v);
                if (pwError) setPwError(null);
              }}
              autoComplete="new-password"
              meter
              help={passwordHelp(locale)}
              error={pwError ?? undefined}
              inputRef={newPasswordRef}
              autoFocus
              name="new-password"
              e2e="new-password"
            />

            {errorLine}

            {grantGone ? (
              <Button type="button" variant="primary" onClick={leaveToDestination}>{c.goOn}</Button>
            ) : (
              <Button type="submit" variant="primary" disabled={loading}>
                {loading ? t.common.loading : creating ? c.pwCreateCta : c.pwPromptCta}
              </Button>
            )}
            {/* Only the offer can be put off. At sign-up the password is part of the account. */}
            {!creating && !grantGone && (
              <div className="auth-alt">
                <button type="button" data-e2e="prompt-skip" className="auth-link auth-tap text-[14px]" onClick={leaveToDestination} disabled={loading}>
                  {c.pwPromptSkip}
                </button>
              </div>
            )}
          </div>
        </form>
      </AuthShell>
    );
  }
  const noticeLine = notice && !error && (
    <p role="status" className="text-[13px] text-ink2 font-semibold leading-[1.5] mb-3 text-start">
      {notice}
    </p>
  );

  return (
    <AuthShell {...panel}>
      {/* A real <form> so Enter submits — this was loose divs with onClick. ONE form
          for both steps: the submit sends on step 1 and verifies on step 2. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (codeSent) handleVerify();
          else handleSendCode();
        }}
        noValidate
      >
        {/* KEYED wrappers: unkeyed, React matches the two <div>s by position and
            recycles step 1's nodes into step 2, and a recycled focused node keeps
            focus — OtpInput's autoFocus then loses to it (seen on /auth). */}
        {!codeSent ? (
          <div key="identifier" data-e2e="auth-step-identifier">
            <h1 className="auth-title">{c.title}</h1>
            <p className="auth-lead mb-6">{isEmail ? c.leadEmail : c.leadSms}</p>

            <Field
              label={isEmail ? c.email : t.auth.phone}
              error={fieldError?.field === "identifier" ? fieldError.message : undefined}
            >
              <div className="inp">
                {isEmail ? <Mail /> : <Phone />}
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

            {/* phase-a lane L2 (A24) — birth MONTH + year. A year alone passed a
                December-born 17-year-old as 18 all year. Drives the adult-only pilot
                (ALLOW_MINORS off) and, when minors are allowed, the consent gate.
                ONE field: a single .inp holding both selects. Field wires the hint
                and the error onto the FIRST control (the month); the year carries its
                own aria-invalid. */}
            {asksBirthDate && (
              <Field
                label={minorsAllowed && isStudent ? c.bdLabel : c.bdLabelSelf}
                help={!isStudent ? c.bdTutorNote : adultsOnly ? c.bdAdultsNote : c.byNote}
                error={fieldError?.field === "birth" ? fieldError.message : undefined}
              >
                <div className="inp" data-e2e="birth-date">
                  <Calendar />
                  <select
                    ref={birthMonthRef}
                    value={birthMonth}
                    onChange={(e) => {
                      setBirthMonth(e.target.value);
                      if (fieldError?.field === "birth") setFieldError(null);
                    }}
                    required
                    aria-required="true"
                    aria-label={c.bdMonth}
                    className="flex-1 min-w-0"
                    style={{ color: birthMonth ? "var(--ink)" : "var(--muted)" }}
                  >
                    <option value="" disabled>{c.bdMonthPh}</option>
                    {c.bdMonths.map((m, i) => (
                      <option key={m} value={i + 1} className="text-ink">{m}</option>
                    ))}
                  </select>
                  <ChevronDown className="inp-chev" />
                  <span className="inp-divider" aria-hidden="true" />
                  <select
                    value={birthYear}
                    onChange={(e) => {
                      setBirthYear(e.target.value);
                      if (fieldError?.field === "birth") setFieldError(null);
                    }}
                    required
                    aria-required="true"
                    aria-label={c.bdYear}
                    aria-invalid={fieldError?.field === "birth" ? true : undefined}
                    className="flex-1 min-w-0"
                    style={{ color: birthYear ? "var(--ink)" : "var(--muted)" }}
                  >
                    <option value="" disabled>{c.bdYearPh}</option>
                    {years.map((y) => (
                      <option key={y} value={y} className="text-ink">{y}</option>
                    ))}
                  </select>
                  <ChevronDown className="inp-chev" />
                </div>
              </Field>
            )}

            {errorLine}
            {noticeLine}

            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? t.common.loading : c.cta}
            </Button>

            {/* What creating the account accepts, before it is created: the API records
                the terms version with the account (profiles.terms_version). */}
            {/* 13px, not 12px: the a11y audit's floor (tools/ui-audit/a11y.mjs). This is
                the sentence that records what someone agreed to — the last place to
                shrink text on a cheap Android in bright sun. The two links inherit it,
                and stay inline so the sentence flows as one line where it fits. */}
            <p className="auth-terms mt-3" data-e2e="signup-terms">
              {c.termsBefore}
              <Link href="/terms" className="auth-link">{c.termsLink}</Link>
              {c.termsAnd}
              <Link href="/privacy" className="auth-link">{c.privacyLink}</Link>
              {c.termsAfter}
            </p>

            <div className="text-center mt-1">
              <button type="button" data-e2e="have-code" onClick={handleHaveCode} className="auth-link auth-tap text-[14px]">
                {c.haveCode}
              </button>
            </div>

            {/* The two exits: I already have an account, or I'm the other audience. */}
            <div className="auth-foot">
              <span>
                {c.haveAccount}{" "}
                <Link href={withNext("/auth")} className="auth-link auth-tap">{c.signIn}</Link>
              </span>
              <span>
                {isStudent ? c.askTutor : c.askStudent}{" "}
                <Link href={withNext(isStudent ? "/signup/prof" : "/signup/eleve")} className="auth-link auth-tap">
                  {c.thisWay}
                </Link>
              </span>
            </div>
          </div>
        ) : (
          <div key="code" data-e2e="auth-step-code" className="rise">
            <div className="auth-icon-tile mb-4" aria-hidden="true">
              {isEmail ? <Mail /> : <Phone />}
            </div>
            <h1 className="auth-title">{isEmail ? c.checkTitleEmail : c.checkTitleSms}</h1>
            <p className="auth-lead mb-5">
              {isEmail ? c.sentToEmail : c.sentToSms}{" "}
              <b className="font-bold text-ink break-words" dir="ltr">{identifier.trim()}</b>
            </p>

            {noticeLine}

            {/* Local development only. requestOtp() returns the code ONLY when
                NODE_ENV is not "production" AND no provider is configured; a
                production deploy with no mail or SMS credentials now fails the
                send outright rather than printing a stranger's code here. */}
            {devCode && (
              <div className="bg-sand border-[1.4px] border-dashed border-ochre-btn rounded-brand py-2.5 px-3 mb-3.5 text-center text-[13px] text-ink2 leading-[1.5]">
                <b className="font-display text-[18px] tracking-[3px] text-ink block" dir="ltr" data-e2e="dev-code">
                  {devCode}
                </b>
                {c.devCodeNote}
              </div>
            )}

            {/* Six boxes. Completing the sixth digit verifies straight away (it
                replaces the old "submit on the sixth" of the single input); the code
                is passed explicitly because setCode has not landed yet when it fires. */}
            <OtpInput
              value={code}
              onChange={(v) => {
                setCode(v);
                if (fieldError?.field === "code") setFieldError(null);
              }}
              onComplete={(v) => { if (!loading) void verifyWith(v); }}
              label={isEmail ? c.codeLabelEmail : c.codeLabelSms}
              error={fieldError?.field === "code" ? fieldError.message : undefined}
              inputRef={codeRef}
              autoFocus
            />

            {/* ── Change the address + resend ──
                Before this there was no way to ask for another code at all: the
                only control here reset the whole form. A code that lands in spam,
                or arrives after the user has looked away, had no recovery.

                Both durations come from the server (requestOtp returns them), so
                the button can never re-enable while the server still refuses. ── */}
            <div className="auth-row mt-2 mb-4">
              <button type="button" data-e2e="change-identifier" onClick={handleChangeIdentifier} className="auth-link auth-tap gap-1">
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
                {canResend ? c.resend : (
                  <>
                    {/* aria-hidden: a value that changes every second would be read
                       aloud every second. The accessible name stays "Renvoyer le
                       code", the disabled state carries the meaning, and the live
                       region below announces the one transition that matters. */}
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
    </AuthShell>
  );
}
