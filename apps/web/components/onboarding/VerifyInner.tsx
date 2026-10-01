"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Shield, Check, Upload, User, Eye, Bulb } from "@/components/icons";
import { SiteShell } from "@/components/SiteShell";
import { getMyVerification, submitVerification } from "@/app/actions";
import { PUBLIC_TEACHER_DECLARATION } from "@tnajem/shared";
import { OnboardingProgress } from "@/components/OnboardingProgress";
import { UserText } from "@/components/UserText";
import type { TutorVerification, Locale, OnboardingState } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ------------------------------------------------------------------ */
/* Self-contained bilingual copy (FR + Tunisian Derija). Do NOT edit   */
/* shared i18n — this page owns all its strings.                       */
/* ------------------------------------------------------------------ */
const copy = bilingual({
  fr: {
    eyebrow: "VÉRIFICATION",
    h2: "Vérifie ton compte de prof",
    lead:
      "La pièce d'identité est obligatoire. Tes diplômes, ton expérience et tes liens sont optionnels — mais ils renforcent la confiance et débloquent des badges. Une fois approuvé, ta page devient publique et listée dans l'Explorer.",
    // sections
    s1Title: "Identité",
    s1Req: "obligatoire",
    s1Sub: "On vérifie que tu es bien toi.",
    s2Title: "Diplômes & expérience",
    s2Opt: "optionnel",
    s2Sub: "Plus tu en mets, plus tu inspires confiance.",
    s3Title: "Liens & réseaux",
    s3Sub: "Montre ton travail et ta présence en ligne.",
    // file fields
    idFront: "Pièce d'identité (CIN ou passeport) — recto",
    idBack: "CIN — verso",
    selfie: "Selfie en tenant ta pièce d'identité",
    selfieHelp: "Anti-usurpation : ton visage + ta pièce, bien lisibles.",
    diploma: "Diplôme / relevé de notes",
    certificate: "Certificat / attestation d'enseignement",
    roleProof: "Carte d'étudiant ou attestation d'emploi",
    // dropzone
    dzPick: "Choisir un fichier",
    dzHint: (mb: number) => `Image ou PDF — max ${mb} Mo`,
    errPickTooLarge: (size: string) =>
      `Ce fichier fait ${size} — la limite est de ${MAX_DOC_MB} Mo. Reprends la photo, ou choisis-en une autre.`,
    errPickBadType: "Format non accepté. Choisis une image (JPG, PNG, WEBP, HEIC) ou un PDF.",
    dzChange: "Changer",
    dzRemove: "Retirer",
    // text fields
    experienceYears: "Années d'expérience",
    experiencePh: "ex. 5",
    institution: "Établissement / université actuelle",
    institutionPh: "ex. Faculté des Sciences de Tunis",
    languages: "Langues parlées",
    languagesPh: "ex. Arabe, Français, Anglais",
    pitch: "Ton approche / pourquoi toi",
    pitchPh: "En quelques mots : ta méthode, ce qui te rend différent…",
    // links
    linkedin: "LinkedIn",
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    website: "Site / portfolio",
    introVideo: "Vidéo d'intro",
    urlPh: "https://…",
    // reassurance
    /* Everything a stranger needs to decide whether to hand over their national
       ID, stated BEFORE the upload rather than in a privacy page they will not
       open. The 90 days is not a nicety we invented: it is the retention period
       already documented in /privacy, and it is the single fact most likely to
       change the decision. */
    whyTitle: "Pourquoi on demande ça",
    whyBody:
      "Pour vérifier que tu es bien la personne que tu dis être — c'est ce qui permet aux parents de faire confiance aux profs de Tnajem.",
    whoSees: "Une seule personne de notre équipe la regarde.",
    neverPublic: "Ton document n'apparaît jamais sur ta page et n'est jamais partagé.",
    deleted90: "Il est supprimé de nos serveurs au bout de 90 jours.",
    inpdp:
      "Tes documents servent uniquement à la vérification — stockés en sécurité, jamais publiés.",
    // actions
    submit: "Envoyer pour vérification",
    declarationTitle: "Déclaration",
    declarationHelp: "Obligatoire (décret n° 2015-1619). Une personne qui enseigne dans un établissement public ne peut pas proposer ses cours ici.",
    errDeclaration: "Coche la déclaration pour envoyer ton dossier.",
    submitting: "Envoi…",
    loadingStatus: "Chargement de ton dossier…",
    uploadingLive: "Envoi de tes documents en cours. Ne ferme pas cette page.",
    needId: "La pièce d'identité (recto) est obligatoire pour continuer.",
    demoNote: "Mode démo — rien n'est enregistré.",
    // errors
    errFileSize: "Fichier trop lourd — 8 Mo maximum par fichier.",
    errFileType: "Format non accepté — images (JPG, PNG, WEBP, HEIC) ou PDF uniquement.",
    errGeneric: "Une erreur est survenue. Réessaie.",
    errAuthLine: "Tu dois être connecté pour envoyer ta vérification.",
    errAuthLink: "Se connecter",
    errStoreLine: "Crée d'abord ta page de prof.",
    errStoreLink: "Créer ma page",
    // pending state
    pendingTitle: "Vérification envoyée",
    pendingBody:
      "Merci ! Ton dossier est en cours d'examen. On regarde chaque demande à la main, une par une — on te répond dès que la tienne est passée. Une fois approuvé, ta page sera publiée et listée dans l'Explorer.",
    pendingNote: "Tu peux fermer cette page — on te tiendra au courant.",
    // verified state
    verifiedTitle: "Déjà vérifié",
    verifiedBody: "Ton compte est vérifié. Ta page est publique et listée dans l'Explorer.",
    // rejected state
    rejectedTitle: "Dossier à compléter",
    rejectedNote: "Note de l'équipe :",
    rejectedBody: "Corrige les points ci-dessus et renvoie ton dossier.",
    resubmitIntro: "Tu peux modifier et renvoyer ton dossier ci-dessous.",
    // links back
    backDash: "Retour au tableau de bord",
    // progress + required-summary
    afterThis: "Après ça, tu publies ta 1ʳᵉ classe.",
    reqTitle: "Ce qu'il faut, au minimum",
    reqBody: "Une photo de ta pièce d'identité (recto). Tout le reste est optionnel.",
    reqDone: "Pièce d'identité ajoutée — tu peux envoyer.",
  },
  ar: {
    eyebrow: "تأكيد الحساب",
    h2: "أكّد حسابك كمعلّم",
    lead:
      "بطاقة التعريف ضرورية. الشهائد، الخبرة و الروابط متاع وسائل التواصل اختيارية — أما يزيدوك ثقة و يفتحولك شارات. كي يتقبل ملفك، صفحتك تولّي ظاهرة و موجودة في Explorer.",
    s1Title: "الهوية",
    s1Req: "ضروري",
    s1Sub: "نتأكدو اللي إنتي بيدك.", // phase-a lane L5 (Derija): the old wording was Algerian, see phase-a-logs/l5.md
    s2Title: "الشهائد و الخبرة",
    s2Opt: "اختياري",
    s2Sub: "كل ما تزيد، كل ما تزيد الثقة فيك.",
    s3Title: "الروابط و وسائل التواصل",
    s3Sub: "ورّي خدمتك و حضورك على الأنترنت.",
    idFront: "بطاقة التعريف (CIN ولا جواز سفر) — الوجه",
    idBack: "بطاقة التعريف — الخلف",
    selfie: "صورة سيلفي و إنت ماسك بطاقة التعريف",
    selfieHelp: "باش ما حدّش يتصنّع بهويتك: وجهك + البطاقة، يتقراو مليح.",
    diploma: "الشهادة / كشف الأعداد",
    certificate: "شهادة / إفادة تدريس",
    roleProof: "بطاقة طالب ولا إفادة شغل",
    dzPick: "اختار ملف",
    dzHint: (mb: number) => `صورة ولا PDF — أقصى حد ${mb} ميغا`,
    errPickTooLarge: (size: string) =>
      `هذا الملف ${size} — الحد ${MAX_DOC_MB} ميغا. عاود التصويرة، ولا اختار وحدة أخرى.`,
    errPickBadType: "الصيغة موش مقبولة. اختار صورة (JPG, PNG, WEBP, HEIC) ولا PDF.",
    dzChange: "بدّل",
    dzRemove: "نحّي",
    experienceYears: "سنوات الخبرة",
    experiencePh: "مثال: 5",
    institution: "المؤسسة / الجامعة الحالية",
    institutionPh: "مثال: كلية العلوم بتونس",
    languages: "اللغات اللي تحكيهم",
    languagesPh: "مثال: عربي، فرنساوي، إنڨليزي",
    pitch: "طريقتك / علاش إنت",
    pitchPh: "في كلمات قليلة: منهجك، شنوّة يميّزك…",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    website: "موقع / portfolio",
    introVideo: "فيديو تعريفي",
    urlPh: "https://…",
    whyTitle: "علاش نطلبو هذا",
    whyBody:
      "باش نتثبّتو بلّي إنتي فعلاً اللي تقول — هذا اللي يخلّي الأولياء يوثقو في أساتذة تنجّم.",
    whoSees: "وحيد من الفريق متاعنا هو اللي يشوفها.",
    neverPublic: "وثيقتك عمرها ما تبان في صفحتك وعمرها ما تتشارك.",
    deleted90: "تتمسح من السرفرات متاعنا بعد 90 يوم.",
    inpdp:
      "وثائقك يخدمو كان للتأكيد — محفوظين في الأمان، عمرهم ما يتنشرو.",
    submit: "ابعث للتأكيد",
    declarationTitle: "تصريح",
    declarationHelp: "إجباري (الأمر عدد 1619 لسنة 2015). اللي يقرّي في مؤسسة عمومية ما ينجّمش يعرض دروسو هوني.",
    errDeclaration: "علّم على التصريح باش تبعث ملفك.",
    submitting: "قاعد يتبعث…",
    loadingStatus: "ملفك قاعد يتحمّل…",
    uploadingLive: "وثائقك قاعدة تتبعث. ما تسكّرش الصفحة هاذي.",
    needId: "بطاقة التعريف (الوجه) ضرورية باش تكمّل.",
    demoNote: "وضع التجربة — ما يتسجّل حتى شيء.",
    errFileSize: "الملف ثقيل برشة — أقصى حد 8 ميغا للملف.",
    errFileType: "الصيغة موش مقبولة — كان صور (JPG, PNG, WEBP, HEIC) ولا PDF.",
    errGeneric: "صار مشكل. عاود من جديد.",
    errAuthLine: "لازمك تكون متصل باش تبعث التأكيد.",
    errAuthLink: "اتصل بحسابك",
    errStoreLine: "أعمل صفحتك كمعلّم الأول.",
    errStoreLink: "أعمل صفحتي",
    pendingTitle: "التأكيد اتبعث",
    pendingBody:
      "يعيشك! ملفك تحت الدراسة. نشوفو كل طلب بيدينا، واحد واحد — نجاوبوك كي يجي دورك. كي يتقبل، صفحتك باش تتنشر و تولّي في Explorer.",
    pendingNote: "تنجم تسكّر الصفحة هاذي — باش نعلموك.",
    verifiedTitle: "متأكّد من قبل",
    verifiedBody: "حسابك متأكّد. صفحتك ظاهرة و موجودة في Explorer.",
    rejectedTitle: "الملف يلزمو تكملة",
    rejectedNote: "ملاحظة الفريق:",
    rejectedBody: "صلّح النقاط اللي فوق و عاود ابعث ملفك.",
    resubmitIntro: "تنجم تبدّل و تعاود تبعث ملفك تحت.",
    backDash: "ارجع للوحة",
    afterThis: "من بعدها تنشر أول حصة متاعك.",
    reqTitle: "شنوّة يلزم، على الأقل",
    reqBody: "تصويرة متاع بطاقة تعريفك (الوجه). الباقي الكل اختياري.",
    reqDone: "بطاقة التعريف تزادت — تنجم تبعث.",
  },
});

type CopyT = (typeof copy)[Locale];

/* file field keys → label key (exact FormData keys) */
const FILE_FIELDS = [
  { key: "idFront", labelKey: "idFront", required: true },
  { key: "idBack", labelKey: "idBack", required: false },
  { key: "selfie", labelKey: "selfie", required: false, helpKey: "selfieHelp" },
  { key: "diploma", labelKey: "diploma", required: false },
  { key: "certificate", labelKey: "certificate", required: false },
  { key: "roleProof", labelKey: "roleProof", required: false },
] as const;

const ACCEPT = "image/*,application/pdf";

/* Mirrors MAX_DOC_BYTES in app/actions.ts. Duplicated deliberately — actions.ts is
   "use server" and importing it here would pull the server module into the client
   bundle — but the number now lives in ONE place on this side, instead of being
   retyped inside two prose strings that could drift from the real limit. */
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_DOC_MB = 8;

/* Same allow-list the server sniffs for. Checked on PICK, not on submit: the old
   flow let someone choose a 40 MB video, fill in eleven text fields, upload the
   whole body over 3G and only then be told the file was wrong. */
const OK_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;

/* Which camera the OS should open. Without `capture` the picker lands in the file
   manager, and "photograph your ID" becomes "go find a photo of your ID" — the
   single biggest source of friction on the hardest screen in the product. */
const CAPTURE: Record<string, "environment" | "user" | undefined> = {
  idFront: "environment",
  idBack: "environment",
  selfie: "user",
};

/* ------------------------------------------------------------------ */

/* Rendered by the SERVER shell at app/[locale]/onboarding/verify/page.tsx, which
   owns the role guard and reads `state` (see getOnboardingState). `state` is null
   in demo mode / the UI audit harness, where the bar falls back to the honest
   first-step-only position. */
export function VerifyInner({ state }: { state: OnboardingState | null }) {
  const { locale } = useLocale();
  const c: CopyT = copy[locale];

  const [loading, setLoading] = useState(true);
  const [verif, setVerif] = useState<TutorVerification | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<null | "id" | "size" | "type" | "auth" | "store" | "declaration" | "generic">(null);
  const [declared, setDeclared] = useState(false);

  // chosen file names, keyed by FormData field
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  // prefill (rejected → resubmit)
  const pre = verif && verif.status === "rejected" ? verif : null;

  useEffect(() => {
    let alive = true;
    getMyVerification()
      .then((v) => { if (alive) setVerif(v); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  /* Per-field rejection message, so a bad file is reported next to the field that
     caused it rather than as one global error at the bottom of a long form. */
  const [fileErrors, setFileErrors] = useState<Record<string, string | null>>({});

  /* Object URLs for the thumbnails. Held in state (not derived during render) so we
     can revoke them: each createObjectURL pins the whole file in memory until it is
     released, and this form can hold six 8 MB photos. */
  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  /** Heading of the success panel; focused after submit so focus follows the view. */
  const doneRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    // Release every outstanding object URL when the form unmounts.
    return () => {
      for (const url of Object.values(previewsRef.current)) if (url) URL.revokeObjectURL(url);
    };
  }, []);
  const previewsRef = useRef<Record<string, string | null>>({});
  previewsRef.current = previews;

  function pickFile(key: string, f: File | null) {
    /* Validate on PICK. The limits are the server's, checked here only so the
       failure arrives in the moment the file is chosen — the server still enforces
       them, including a magic-byte sniff this cannot do. */
    if (f) {
      if (f.size > MAX_DOC_BYTES) {
        setFileErrors((p) => ({ ...p, [key]: c.errPickTooLarge(fmtMb(f.size)) }));
        return;
      }
      // An empty type is possible on some Android pickers; let the server sniff decide.
      if (f.type && !OK_MIME.test(f.type)) {
        setFileErrors((p) => ({ ...p, [key]: c.errPickBadType }));
        return;
      }
    }
    setFileErrors((p) => ({ ...p, [key]: null }));

    setPreviews((prev) => {
      if (prev[key]) URL.revokeObjectURL(prev[key] as string);
      // PDFs get no thumbnail: there is no bitmap for an image tag to render.
      const url = f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
      return { ...prev, [key]: url };
    });
    setFiles((prev) => ({ ...prev, [key]: f }));
    if (error === "id" && key === "idFront" && f) setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    // client-side guard: idFront required
    if (!files.idFront) {
      setError("id");
      fileInputs.current.idFront?.focus();
      return;
    }
    if (!declared) {
      setError("declaration");
      return;
    }
    setError(null);
    setSubmitting(true);

    const form = e.currentTarget;
    const fd = new FormData();
    fd.append("notPublicTeacher", "yes");

    // text / number / url fields (append as strings; FormData picks current values)
    const textKeys = [
      "experienceYears", "institution", "languages", "pitch",
      "linkedinUrl", "instagramUrl", "tiktokUrl", "youtubeUrl",
      "facebookUrl", "websiteUrl", "introVideoUrl",
    ];
    for (const k of textKeys) {
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && el.value.trim()) fd.append(k, el.value.trim());
    }

    // files — append only if chosen
    for (const f of FILE_FIELDS) {
      const file = files[f.key];
      if (file) fd.append(f.key, file);
    }

    try {
      const res = await submitVerification(fd);
      if (res.ok) {
        if (res.demo) setDemo(true);
        setDone(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
        /* Scrolling moves the viewport but not the focus, so a keyboard or screen
           reader user was left on a submit button inside a form that no longer
           exists. Move focus to the new panel's heading instead. */
        requestAnimationFrame(() => doneRef.current?.focus());
      } else {
        switch (res.error) {
          case "id-required": setError("id"); break;
          case "file-too-large": setError("size"); break;
          case "bad-file-type": setError("type"); break;
          case "not-authenticated": setError("auth"); break;
          case "no-storefront": setError("store"); break;
          case "declaration-required": setError("declaration"); break;
          default: setError("generic");
        }
      }
    } catch {
      setError("generic");
    } finally {
      setSubmitting(false);
    }
  }

  /* ---------- loading ---------- */
  if (loading) {
    return (
      <Shell>
        {/* Labelled: an unlabelled role="status" announces an empty string, so a
            screen-reader user got silence during the whole status fetch. */}
        <Spinner label={c.loadingStatus} />
      </Shell>
    );
  }

  /* ---------- status: pending ---------- */
  if (!done && verif && verif.status === "pending") {
    return (
      <Shell>
        <StatusPanel
          tone="blue"
          icon={<Shield className="w-[30px] h-[30px]" />}
          title={c.pendingTitle}
          body={c.pendingBody}
          note={c.pendingNote}
          backLabel={c.backDash}
        />
      </Shell>
    );
  }

  /* ---------- status: verified ---------- */
  if (!done && verif && verif.status === "verified") {
    return (
      <Shell>
        <StatusPanel
          tone="green"
          icon={<Check className="w-[30px] h-[30px]" />}
          title={`${c.verifiedTitle} ✓`}
          body={c.verifiedBody}
          backLabel={c.backDash}
        />
      </Shell>
    );
  }

  /* ---------- success (just submitted) ---------- */
  if (done) {
    return (
      <Shell>
        <StatusPanel
          tone="blue"
          icon={<Shield className="w-[30px] h-[30px]" />}
          title={c.pendingTitle}
          body={c.pendingBody}
          note={demo ? c.demoNote : c.pendingNote}
          backLabel={c.backDash}
          titleRef={doneRef}
        />
      </Shell>
    );
  }

  /* ---------- form (draft / null / rejected) ---------- */
  const rejected = verif && verif.status === "rejected";

  return (
    <Shell>
      {/* heading */}
      <div className="rise mb-[clamp(20px,3vw,30px)]">
        <div className="web-eyebrow flex items-center gap-2 flex-wrap">
          <Shield className="w-4 h-4" />
          {c.eyebrow}
        </div>
        <h1 className="web-h2 mt-2">{c.h2}</h1>
        {/* Was the hardcoded string "Étape 2 sur 3". The funnel has four steps and
            the dashboard already said so — this bar is the same one the dashboard
            and /onboarding render (lib/onboarding-steps.ts). */}
        <div className="mt-3">
          <OnboardingProgress
            progress={{
              hasStorefront: state?.hasStorefront ?? true,
              status: state?.status ?? "draft",
              hasClass: state?.hasClass ?? false,
              hasSlug: state?.hasSlug ?? true,
              photo: state?.avatarStatus ?? null, // espace prof v2 · shell: the 5-step ladder
              linkShared: Boolean(state?.linkShared),
            }}
          />
        </div>
        <p className="text-[13px] font-bold text-ochre-ink">{c.afterThis}</p>
        <p className="web-lead mt-3 max-w-[620px]">{c.lead}</p>
      </div>

      {/* What is actually required — one file. Everything else is a bonus. */}
      <div
        className="rise"
        style={{
          display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap",
          padding: "14px 16px", marginBottom: 18, borderRadius: "var(--r)",
          background: files.idFront ? "var(--green50)" : "var(--blue50)",
          border: `1px solid ${files.idFront ? "var(--green)" : "transparent"}`,
        }}
      >
        <span
          aria-hidden="true"
          style={{ display: "inline-flex", flex: "none", marginTop: 1, color: files.idFront ? "var(--green)" : "var(--blue)" }}
        >
          {files.idFront ? <Check className="w-5 h-5" /> : <User className="w-5 h-5" />}
        </span>
        <div className="flex-[1_1_220px] min-w-0">
          <div style={{ fontSize: 13.5, fontWeight: 700, color: files.idFront ? "var(--green-ink)" : "var(--blue)" }}>
            {c.reqTitle}
          </div>
          <p className="text-[13px] text-ink2 mt-[3px] leading-[1.55]">
            {files.idFront ? c.reqDone : c.reqBody}
          </p>
        </div>
      </div>

      {/* rejected note */}
      {rejected && (
        <div
          className="rise flex gap-3 items-start py-3.5 px-4 mb-5 bg-rose50 rounded-brand"
        >
          <Bulb className="w-[22px] h-[22px] text-rose flex-none mt-[1px]" />
          <div>
            <div className="text-[13.5px] font-bold text-rose">
              {c.rejectedTitle}
            </div>
            {verif?.reviewNote && (
              <p className="text-[13px] text-ink2 mt-1 leading-[1.55]">
                <b>{c.rejectedNote} </b><UserText>{verif.reviewNote}</UserText>
              </p>
            )}
            <p className="text-[13px] text-muted mt-1.5 leading-[1.55]">
              {c.resubmitIntro}
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* ============ SECTION 1 — IDENTITY ============ */}
        <SectionPanel
          icon={<User className="w-5 h-5" />}
          title={c.s1Title}
          chip={c.s1Req}
          chipKind="rose"
          sub={c.s1Sub}
        >
          {/* Explain BEFORE asking. This is the moment a stranger decides whether
              to photograph their national ID for a brand they met 90 seconds ago;
              the reassurance used to sit only UNDER the upload, where it argues
              with a decision already made. */}
          <div className="note-info mb-4">{/* Phase A+ (U1): information, in blue */}
            <Shield />
            <div className="min-w-0">
              <b className="block text-[13px] font-bold mb-1">{c.whyTitle}</b>
              <p className="mb-1.5">{c.whyBody}</p>
              <ul className="flex flex-col gap-1 list-none">
                <li className="flex gap-2 items-start">
                  <Check className="w-4 h-4 flex-none mt-0.5" />
                  <span className="min-w-0">{c.whoSees}</span>
                </li>
                <li className="flex gap-2 items-start">
                  <Check className="w-4 h-4 flex-none mt-0.5" />
                  <span className="min-w-0">{c.neverPublic}</span>
                </li>
                <li className="flex gap-2 items-start">
                  <Check className="w-4 h-4 flex-none mt-0.5" />
                  <span className="min-w-0">{c.deleted90}</span>
                </li>
              </ul>
            </div>
          </div>

          {FILE_FIELDS.slice(0, 3).map((f) => (
            <FileDrop
              key={f.key}
              c={c}
              fieldKey={f.key}
              label={c[f.labelKey as keyof CopyT] as string}
              required={f.required}
              help={"helpKey" in f && f.helpKey ? (c[f.helpKey as keyof CopyT] as string) : undefined}
              file={files[f.key] ?? null}
              preview={previews[f.key] ?? null}
              fileError={fileErrors[f.key] ?? null}
              onPick={(file) => pickFile(f.key, file)}
              inputRef={(el) => { fileInputs.current[f.key] = el; }}
              invalid={error === "id" && f.key === "idFront"}
            />
          ))}

          {/* INPDP reassurance */}
          <div className="note-info mt-1">
            <Lock />
            <p>{c.inpdp}</p>
          </div>

          {error === "id" && (
            <p role="alert" style={errStyle}>{c.needId}</p>
          )}
        </SectionPanel>

        {/* ============ SECTION 2 — DIPLOMAS & EXPERIENCE ============ */}
        <SectionPanel
          icon={<Bulb className="w-5 h-5" />}
          title={c.s2Title}
          chip={c.s2Opt}
          chipKind="soft"
          sub={c.s2Sub}
        >
          {FILE_FIELDS.slice(3).map((f) => (
            <FileDrop
              key={f.key}
              c={c}
              fieldKey={f.key}
              label={c[f.labelKey as keyof CopyT] as string}
              required={false}
              file={files[f.key] ?? null}
              preview={previews[f.key] ?? null}
              fileError={fileErrors[f.key] ?? null}
              onPick={(file) => pickFile(f.key, file)}
              inputRef={(el) => { fileInputs.current[f.key] = el; }}
            />
          ))}

          <TextField id="experienceYears" label={c.experienceYears}>
            <div className="inp">
              <input
                id="experienceYears" name="experienceYears" type="number"
                min={0} max={60} step={1} placeholder={c.experiencePh}
                defaultValue={pre?.experienceYears ?? undefined}
                inputMode="numeric"
              />
            </div>
          </TextField>

          <TextField id="institution" label={c.institution}>
            <div className="inp">
              <input
                id="institution" name="institution" type="text"
                placeholder={c.institutionPh} maxLength={120}
                defaultValue={pre?.institution ?? undefined}
              />
            </div>
          </TextField>

          <TextField id="languages" label={c.languages}>
            <div className="inp">
              <input
                id="languages" name="languages" type="text"
                placeholder={c.languagesPh} maxLength={120}
                defaultValue={pre?.languages ?? undefined}
              />
            </div>
          </TextField>

          <TextField id="pitch" label={c.pitch}>
            <div className="inp">
              <textarea
                id="pitch" name="pitch" rows={4}
                placeholder={c.pitchPh} maxLength={600}
                defaultValue={pre?.pitch ?? undefined}
                style={{ resize: "vertical", minHeight: 86 }}
              />
            </div>
          </TextField>
        </SectionPanel>

        {/* ============ SECTION 3 — LINKS & SOCIALS ============ */}
        <SectionPanel
          icon={<Eye className="w-5 h-5" />}
          title={c.s3Title}
          chip={c.s2Opt}
          chipKind="soft"
          sub={c.s3Sub}
        >
          <div className="vlinks">
            <UrlField id="linkedinUrl" label={c.linkedin} ph={c.urlPh} def={pre?.links.linkedin} />
            <UrlField id="instagramUrl" label={c.instagram} ph={c.urlPh} def={pre?.links.instagram} />
            <UrlField id="tiktokUrl" label={c.tiktok} ph={c.urlPh} def={pre?.links.tiktok} />
            <UrlField id="youtubeUrl" label={c.youtube} ph={c.urlPh} def={pre?.links.youtube} />
            <UrlField id="facebookUrl" label={c.facebook} ph={c.urlPh} def={pre?.links.facebook} />
            <UrlField id="websiteUrl" label={c.website} ph={c.urlPh} def={pre?.links.website} />
            <UrlField id="introVideoUrl" label={c.introVideo} ph={c.urlPh} def={pre?.links.introVideo} />
          </div>
        </SectionPanel>

        {/* ============ DÉCRET 2015-1619 ============ */}
        <div className="panel panel-pad mb-4">
          <h2 className="font-display text-[16px] font-bold mb-2">{c.declarationTitle}</h2>
          <label className="flex gap-2.5 items-start text-[14px] leading-[1.6] min-h-11">
            <input
              type="checkbox"
              name="notPublicTeacher"
              className="mt-1 w-5 h-5 flex-none"
              checked={declared}
              onChange={(e) => { setDeclared(e.target.checked); if (e.target.checked && error === "declaration") setError(null); }}
              aria-describedby="declaration-help"
              aria-invalid={error === "declaration" || undefined}
            />
            <span>{PUBLIC_TEACHER_DECLARATION[locale]}</span>
          </label>
          {/* 13px is the a11y audit's floor (tools/ui-audit/a11y.mjs); 12.5px failed it.
              This line explains a legal declaration a tutor is about to sign. */}
          <p id="declaration-help" className="text-[13px] text-muted leading-[1.6] mt-1.5 mb-0">{c.declarationHelp}</p>
        </div>

        {/* ============ ERRORS (non-id) ============ */}
        {error && error !== "id" && (
          <div role="alert" className="rise py-[13px] px-4 mb-4 bg-rose50 rounded-brand text-rose text-[13.5px] font-semibold leading-[1.55]">
            {error === "size" && c.errFileSize}
            {error === "type" && c.errFileType}
            {error === "generic" && c.errGeneric}
            {error === "declaration" && c.errDeclaration}
            {error === "auth" && (
              <>
                {c.errAuthLine}{" "}
                <Link href="/auth" className="linklike">{c.errAuthLink}</Link>
              </>
            )}
            {error === "store" && (
              <>
                {c.errStoreLine}{" "}
                <Link href="/onboarding" className="linklike">{c.errStoreLink}</Link>
              </>
            )}
          </div>
        )}

        {/* ============ SUBMIT ============ */}
        <div className="max-w-[360px]">
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting
              ? <><Spinner label={c.submitting} />{c.submitting}</>
              : <><Shield className="w-[18px] h-[18px]" />{c.submit}</>}
          </Button>

          {/* Six photos over Tunisian 3G is a multi-minute wait, and the only
              previous feedback was a disabled button — which reads as "broken", so
              people reload and lose everything. A server action gives no progress
              events, so this is deliberately indeterminate rather than a fake
              percentage: it says the one thing that matters, which is don't leave.
              Always in the DOM so the live region can announce the change. */}
          <p role="status" aria-live="polite" className="text-[13px] text-ink2 leading-[1.5] mt-2 text-center">
            {submitting ? c.uploadingLive : ""}
          </p>
          <div className="mt-3 text-center">
            <Link href="/dashboard" className="linklike text-[13px]">{c.backDash}</Link>
          </div>
        </div>
      </form>
    </Shell>
  );
}

/* ================================================================== */
/* Sub-components                                                      */
/* ================================================================== */

/* Stable module-level shell (defining it inside the page component would
   remount the whole subtree on every state change, resetting the form). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: scoped }} />
      <section className="web-section">
        <div className="container container-narrow">{children}</div>
      </section>
    </SiteShell>
  );
}

function SectionPanel({
  icon, title, chip, chipKind, sub, children,
}: {
  icon: React.ReactNode;
  title: string;
  chip: string;
  chipKind: "rose" | "soft";
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel panel-pad rise mb-[18px]">
      <div className="flex items-center gap-[11px] mb-1">
        <div className="w-10 h-10 min-w-10 rounded-[12px] bg-blue50 text-blue grid place-items-center">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-[clamp(17px,2vw,20px)] tracking-[-0.4px]">
              {title}
            </h2>
            <span className={`chip chip-${chipKind}`}>{chip}</span>
          </div>
          <p className="text-[13px] text-muted mt-0.5">{sub}</p>
        </div>
      </div>
      <div className="divider" style={{ margin: "12px 0 16px" }} />
      {children}
    </div>
  );
}

function FileDrop({
  c, fieldKey, label, required, help, file, preview, fileError, onPick, inputRef, invalid,
}: {
  c: CopyT;
  fieldKey: string;
  label: string;
  required: boolean;
  help?: string;
  file: File | null;
  /** Object URL for an image pick; null for a PDF or an empty field. */
  preview: string | null;
  /** Rejected on pick (too large / wrong type) — shown against this field. */
  fileError: string | null;
  onPick: (f: File | null) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  invalid?: boolean;
}) {
  const inputId = `file-${fieldKey}`;
  const errId = `${inputId}-err`;
  const helpId = help ? `${inputId}-help` : undefined;
  const describedBy = [fileError ? errId : null, helpId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-2 mb-[7px] flex-wrap">
        <label htmlFor={inputId} className="text-[13px] font-bold">{label}</label>
        <span className={required ? "chip chip-rose" : "tag tag-neutral"}>
          {required ? c.s1Req : c.s2Opt}
        </span>
      </div>

      <label
        htmlFor={inputId}
        className="dz"
        data-filled={file ? "true" : "false"}
        style={invalid || fileError ? { borderColor: "var(--rose)" } : undefined}
      >
        <input
          id={inputId}
          name={fieldKey}
          type="file"
          accept={ACCEPT}
          /* Opens the camera directly on a phone instead of the file manager.
             Rear camera for the ID card, front for the selfie. Desktop browsers
             ignore the attribute, so this costs nothing there. */
          capture={CAPTURE[fieldKey]}
          ref={inputRef}
          aria-required={required || undefined}
          aria-invalid={invalid || Boolean(fileError) || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {/* Thumbnail once an image is chosen: the filename alone never told a tutor
            whether they had picked the sharp photo or the blurry one — and a blurry
            scan is the most common reason a review comes back rejected.

            THE ONE RAW <img> IN THE PRODUCT, and it stays raw. `preview` is a
            URL.createObjectURL blob that exists only in this tab; /_next/image
            fetches its source server-side and cannot see it, so next/image would
            render a broken box. It would also be wrong in principle — this is an
            identity document, and it must not travel to an image optimiser to be
            shown back to the person who just picked it. Nothing is uploaded yet.
            Every other image in the app goes through next/image. */}
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- see above: local blob, never fetched
          <img src={preview} alt="" className="dz-thumb" />
        ) : (
          <span className="dz-ic">
            {file ? <Check className="w-5 h-5" /> : <Upload className="w-5 h-5" />}
          </span>
        )}
        <span className="dz-txt">
          {file ? (
            <>
              <UserText as="b" className="break-words">{file.name}</UserText>
              <span className="dz-hint">{fmtMb(file.size)}</span>
            </>
          ) : (
            <>
              <b>{c.dzPick}</b>
              <span className="dz-hint">{c.dzHint(MAX_DOC_MB)}</span>
            </>
          )}
        </span>
        <span className="dz-act">{file ? c.dzChange : ""}</span>
      </label>

      {fileError && (
        <p id={errId} role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mt-1.5">
          {fileError}
        </p>
      )}

      {file && (
        <button
          type="button"
          /* .linklike carries the 44px floor. This was `.dz-remove`, a 13px label
             with 2px of padding — a ~21px target, and the only way to undo a wrong
             file on the screen where picking the wrong file is most likely. */
          className="linklike bg-transparent border-0 text-[13px] text-rose min-h-[44px] min-w-[44px] font-[inherit]"
          onClick={(ev) => {
            ev.preventDefault();
            onPick(null);
            const el = document.getElementById(inputId) as HTMLInputElement | null;
            if (el) el.value = "";
          }}
        >
          {c.dzRemove}
        </button>
      )}

      {help && <div id={helpId} className="help">{help}</div>}
    </div>
  );
}

/** Human file size, for both the picked-file line and the too-large message. */
function fmtMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

function TextField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function UrlField({ id, label, ph, def }: { id: string; label: string; ph: string; def?: string | null }) {
  return (
    <div className="field mb-0">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="inp">
        {/* dir="ltr" — these are LinkedIn/Instagram/site URLs, and a Latin URL
            typed into an RTL field renders with its punctuation mirrored. */}
        <input id={id} name={id} type="url" inputMode="url" dir="ltr" placeholder={ph} defaultValue={def ?? undefined} />
      </div>
    </div>
  );
}

function StatusPanel({
  tone, icon, title, body, note, backLabel, titleRef,
}: {
  tone: "blue" | "green";
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string;
  backLabel: string;
  /** Focus target after a submit swaps this panel in — see handleSubmit. */
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  const bg = tone === "green" ? "var(--green)" : "var(--blue)";
  return (
    <div className="panel panel-pad rise text-center max-w-[520px] mx-auto">
      <div style={{
        width: 64, height: 64, borderRadius: 20, marginInline: "auto", marginBottom: 16,
        background: bg, color: "#fff", display: "grid", placeItems: "center",
        boxShadow: "var(--sh)",
      }}>
        {icon}
      </div>
      {/* tabIndex={-1}: programmatically focusable, but not a tab stop. */}
      <h1 ref={titleRef} tabIndex={-1} className="font-display text-[clamp(22px,3vw,30px)] tracking-[-0.8px]">
        {title}
      </h1>
      <p className="web-lead mt-3">{body}</p>
      {note && (
        <p className="text-[13px] text-muted mt-2.5 leading-[1.55]">{note}</p>
      )}
      <div className="mt-[22px] flex justify-center">
        <Link href="/dashboard">
          <span className="btn btn-primary w-auto py-[13px] px-[22px]">{backLabel}</span>
        </Link>
      </div>
    </div>
  );
}

/* small inline Lock matches the .trust icon convention (icons.tsx has Lock,
   but it is imported here to keep .trust styling) */
function Lock() {
  return (
    <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  );
}

const errStyle: React.CSSProperties = {
  color: "var(--rose)", fontSize: 13, fontWeight: 600, marginTop: 8, lineHeight: 1.5,
};

/* Page-scoped CSS (dropzone visuals + url grid). UNLAYERED, so it also fixes the
   shared .spin inside the submit button: globals gives it `margin:30px auto`,
   which inflated the button by 60px while submitting. */
const scoped = `
form .btn .spin{margin:0;width:18px;height:18px;border-width:2.5px;
  border-color:rgba(255,255,255,.45);border-top-color:#fff}
/* a .chip is inline-flex: beside a shrinking label it deforms */
.chip{flex:none}
.dz{position:relative;display:flex;align-items:center;gap:12px;width:100%;
  background:var(--paper);border:1.8px dashed var(--line);border-radius:14px;
  padding:13px 14px;cursor:pointer;transition:.15s;text-align:start}
.dz:hover{border-color:var(--blue);background:var(--blue50)}
.dz[data-filled="true"]{border-style:solid;border-color:var(--green);background:var(--green50)}
.dz .dz-ic{width:38px;height:38px;min-width:38px;border-radius:11px;display:grid;place-items:center;
  background:var(--sand);color:var(--ink2)}
.dz[data-filled="true"] .dz-ic{background:var(--green-btn);color:#fff}
.dz .dz-txt{display:flex;flex-direction:column;gap:2px;font-size:13.5px;min-width:0;flex:1}
.dz .dz-txt b{font-weight:700;font-size:13.5px}
.dz .dz-hint{font-size:13px;color:var(--muted);font-weight:600}
.dz .dz-act{font-size:13px;font-weight:700;color:var(--blue);margin-inline-start:auto;white-space:nowrap}
/* Thumbnail of the picked image, in the slot the icon tile used to occupy. */
.dz .dz-thumb{width:38px;height:38px;min-width:38px;border-radius:11px;object-fit:cover;
  border:1px solid var(--green)}
.vlinks{display:grid;gap:14px;grid-template-columns:1fr}
@media (min-width:620px){.vlinks{grid-template-columns:1fr 1fr}}
`;
