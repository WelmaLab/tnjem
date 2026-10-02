"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@/components/Link";
import { Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Shield, Check, Upload, User, Book, Clock, Info } from "@/components/icons";
import { getMyVerification, submitVerification } from "@/app/actions";
import { PUBLIC_TEACHER_DECLARATION } from "@tnajem/shared";
import { UserText } from "@/components/UserText";
import { AppPage, ActionBar, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import type { TutorVerification, Locale, OnboardingState } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ══════════════════════════════════════════════════════════════════════════════
   /onboarding/verify — espace prof v2 · phase 6 (image 3): VÉRIFICATION EN 3 ÉTAPES.

   Inside the shell. The long form is now three steps: 1 · Identité (the only
   required one), 2 · Ton parcours (optional, « Passer »), 3 · Déclaration. One
   reassurance line under the title instead of three boxes.

   The three panels stay MOUNTED (hidden, not unmounted), so a picked file or a typed
   answer survives going back and forth; the FormData is built from them at the end,
   exactly as before (same keys, same server action, same server-side checks).

   After sending, a status page that says where things stand: « En cours · 24–48 h »,
   « Refusée » with the team's reason (and the form to send again), or « Validée ».
   ══════════════════════════════════════════════════════════════════════════════ */
const copy = bilingual({
  fr: {
    title: "Vérification",
    reassure: "3 minutes · on vérifie à la main sous 24–48 h · tes documents ne sont jamais publiés",
    steps: ["Identité", "Ton parcours", "Déclaration"],
    stepsLabel: "Étapes de la vérification",
    stepDone: "terminée",
    stepSkipped: "passée",
    s1Req: "obligatoire",
    s2Tag: "optionnel · débloque des badges",
    // file cards
    idFront: "Pièce d'identité · recto",
    idFrontSub: "CIN ou passeport",
    idBack: "CIN · verso",
    selfie: "Selfie avec ta pièce",
    selfieSub: "Ton visage et ta pièce, bien lisibles",
    diploma: "Diplôme",
    diplomaSub: "ou relevé de notes",
    certificate: "Attestation d'enseignement",
    roleProof: "Carte d'étudiant ou attestation de travail",
    dzHint: (mb: number) => `Photo ou PDF · ${mb}\u00a0Mo`,
    dzChange: "Changer",
    dzRemove: "Retirer",
    errPickTooLarge: (size: string) =>
      `Ce fichier fait ${size} : la limite est de ${MAX_DOC_MB} Mo. Reprends la photo, ou choisis-en une autre.`,
    errPickBadType: "Format non accepté. Choisis une image (JPG, PNG, WEBP, HEIC) ou un PDF.",
    idFine: "Une seule personne de notre équipe les regarde, et ils sont supprimés de nos serveurs au bout de 90 jours.",
    // parcours
    experienceYears: "Années d'expérience",
    experiencePh: "ex. 5",
    institution: "Établissement / université actuelle",
    institutionPh: "ex. Faculté des Sciences de Tunis",
    languages: "Langues",
    langs: { Arabe: "Arabe", Français: "Français", Anglais: "Anglais" } as Record<string, string>,
    pitch: "Ton approche, en quelques mots",
    pitchPh: "Ta méthode, ce qui te rend différent…",
    links: "Liens et réseaux",
    linksHint: "optionnel",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    website: "Site / portfolio",
    introVideo: "Vidéo d'intro",
    urlPh: "https://…",
    // declaration
    declarationHelp: "Obligatoire (décret n° 2015-1619). Une personne qui enseigne dans un établissement public ne peut pas proposer ses cours ici.",
    recap: (n: number, m: number) =>
      `Ton dossier : ${n === 1 ? "1 document d'identité" : `${n} documents d'identité`}${m ? ` · ${m === 1 ? "1 justificatif" : `${m} justificatifs`}` : ""}.`,
    // actions
    next: "Continuer",
    skip: "Passer",
    back: (s: string) => `← ${s}`,
    submit: "Envoyer pour vérification",
    submitting: "Envoi…",
    uploadingLive: "Envoi de tes documents en cours. Ne ferme pas cette page.",
    // errors
    needId: "La pièce d'identité (recto) est obligatoire pour continuer.",
    errDeclaration: "Coche la déclaration pour envoyer ton dossier.",
    errFileSize: "Fichier trop lourd : 8 Mo maximum par fichier.",
    errFileType: "Format non accepté : images (JPG, PNG, WEBP, HEIC) ou PDF uniquement.",
    errGeneric: "Une erreur est survenue. Réessaie.",
    errAuthLine: "Tu dois être connecté pour envoyer ta vérification.",
    errAuthLink: "Se connecter",
    errStoreLine: "Crée d'abord ta page de prof.",
    errStoreLink: "Créer ma page",
    demoNote: "Mode démo : rien n'est enregistré.",
    loadingStatus: "Chargement de ton dossier…",
    // status pages
    tagPending: "En cours · 24–48 h",
    tagVerified: "Validée",
    tagRejected: "Refusée",
    pendingTitle: "Vérification envoyée",
    pendingBody:
      "Merci ! On regarde chaque dossier à la main, un par un. En attendant, prépare ta première classe : tu la publies dès que c'est validé.",
    pendingNote: "Tu peux fermer cette page, on te tiendra au courant.",
    received: "Reçu :",
    verifiedTitle: "Ton compte est vérifié",
    verifiedBody: "Ta page est publique et listée dans l'Explorer. Tu peux publier tes classes.",
    rejectedTitle: "Dossier à compléter",
    rejectedReason: "Motif :",
    rejectedBody: "Corrige ce qui est indiqué et renvoie ton dossier ci-dessous.",
    ctaClass: "Préparer une classe",
    ctaPublish: "Publier une classe",
    ctaHome: "Retour à l'accueil",
    docs: {
      id_front: "pièce d'identité (recto)",
      id_back: "verso",
      selfie: "selfie",
      diploma: "diplôme",
      certificate: "attestation",
      role_proof: "justificatif",
      other: "autre document",
    } as Record<string, string>,
  },
  ar: {
    title: "التثبّت",
    reassure: "3 دقايق · نثبّتو بيدينا في 24–48 ساعة · وثائقك عمرها ما تتنشر",
    steps: ["الهوية", "المسيرة متاعك", "التصريح"],
    stepsLabel: "مراحل التثبّت",
    stepDone: "كملت",
    stepSkipped: "تعدّات",
    s1Req: "ضروري",
    s2Tag: "اختياري · يفتحلك شارات",
    idFront: "بطاقة التعريف · الوجه",
    idFrontSub: "CIN ولا جواز سفر",
    idBack: "بطاقة التعريف · الخلف",
    selfie: "سيلفي مع البطاقة",
    selfieSub: "وجهك والبطاقة، يتقراو مليح",
    diploma: "الشهادة",
    diplomaSub: "ولا كشف الأعداد",
    certificate: "إفادة تدريس",
    roleProof: "بطاقة طالب ولا إفادة شغل",
    dzHint: (mb: number) => `تصويرة ولا PDF · ${mb}\u00a0ميغا`,
    dzChange: "بدّل",
    dzRemove: "نحّي",
    errPickTooLarge: (size: string) =>
      `هذا الملف ${size}: الحد ${MAX_DOC_MB} ميغا. عاود التصويرة، ولا اختار وحدة أخرى.`,
    errPickBadType: "الصيغة موش مقبولة. اختار صورة (JPG, PNG, WEBP, HEIC) ولا PDF.",
    idFine: "وحيد من الفريق متاعنا هو اللي يشوفهم، ويتمسحو من السرفرات متاعنا بعد 90 يوم.",
    experienceYears: "سنوات الخبرة",
    experiencePh: "مثال: 5",
    institution: "المؤسسة / الجامعة الحالية",
    institutionPh: "مثال: كلية العلوم بتونس",
    languages: "اللغات",
    langs: { Arabe: "عربي", Français: "فرنساوي", Anglais: "إنڨليزي" } as Record<string, string>,
    pitch: "طريقتك، في كلمات قليلة",
    pitchPh: "منهجك، شنوّة يميّزك…",
    links: "الروابط ووسائل التواصل",
    linksHint: "اختياري",
    linkedin: "LinkedIn",
    instagram: "Instagram",
    tiktok: "TikTok",
    youtube: "YouTube",
    facebook: "Facebook",
    website: "موقع / portfolio",
    introVideo: "فيديو تعريفي",
    urlPh: "https://…",
    declarationHelp: "إجباري (الأمر عدد 1619 لسنة 2015). اللي يقرّي في مؤسسة عمومية ما ينجّمش يعرض دروسو هوني.",
    recap: (n: number, m: number) => `ملفك: ${n} وثيقة هوية${m ? ` · ${m} إثبات` : ""}.`,
    next: "كمّل",
    skip: "فوّت",
    back: (s: string) => `→ ${s}`,
    submit: "ابعث للتأكيد",
    submitting: "قاعد يتبعث…",
    uploadingLive: "وثائقك قاعدة تتبعث. ما تسكّرش الصفحة هاذي.",
    needId: "بطاقة التعريف (الوجه) ضرورية باش تكمّل.",
    errDeclaration: "علّم على التصريح باش تبعث ملفك.",
    errFileSize: "الملف ثقيل برشة: أقصى حد 8 ميغا للملف.",
    errFileType: "الصيغة موش مقبولة: كان صور (JPG, PNG, WEBP, HEIC) ولا PDF.",
    errGeneric: "صار مشكل. عاود من جديد.",
    errAuthLine: "لازمك تكون متصل باش تبعث التأكيد.",
    errAuthLink: "اتصل بحسابك",
    errStoreLine: "أعمل صفحتك كمعلّم الأول.",
    errStoreLink: "أعمل صفحتي",
    demoNote: "وضع التجربة: ما يتسجّل حتى شيء.",
    loadingStatus: "ملفك قاعد يتحمّل…",
    tagPending: "في الطريق · 24–48 ساعة",
    tagVerified: "متقبّل",
    tagRejected: "مرفوض",
    pendingTitle: "التأكيد اتبعث",
    pendingBody: "يعيشك! نشوفو كل ملف بيدينا، واحد واحد. في الأثناء، حضّر أول حصة متاعك: تنشرها أوّل ما يتقبل.",
    pendingNote: "تنجم تسكّر الصفحة هاذي، باش نعلموك.",
    received: "وصلنا:",
    verifiedTitle: "حسابك متأكّد",
    verifiedBody: "صفحتك ظاهرة و موجودة في Explorer. تنجّم تنشر حصصك.",
    rejectedTitle: "الملف يلزمو تكملة",
    rejectedReason: "السبب:",
    rejectedBody: "صلّح اللي مكتوب وعاود ابعث ملفك لتحت.",
    ctaClass: "حضّر حصة",
    ctaPublish: "انشر حصة",
    ctaHome: "ارجع للبداية",
    docs: {
      id_front: "بطاقة التعريف (الوجه)",
      id_back: "الخلف",
      selfie: "سيلفي",
      diploma: "شهادة",
      certificate: "إفادة",
      role_proof: "إثبات",
      other: "وثيقة أخرى",
    } as Record<string, string>,
  },
});

type CopyT = (typeof copy)[Locale];

/* Mirrors MAX_DOC_BYTES in app/actions.ts ("use server": not importable here). */
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const MAX_DOC_MB = 8;
/* Same allow-list the server sniffs for, checked on PICK, not on submit. */
const OK_MIME = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/i;
const ACCEPT = "image/*,application/pdf";

type FileKey = "idFront" | "idBack" | "selfie" | "diploma" | "certificate" | "roleProof";
/* The FormData keys, the copy keys, and which camera a phone opens. Without
   `capture` the picker lands in the file manager, and "photograph your ID" becomes
   "go find a photo of your ID". The proofs of step 2 have none on purpose: they are
   often PDFs already on the phone, and `capture` would hide the file picker. */
const STEP1: { key: FileKey; sub?: "idFrontSub" | "selfieSub"; capture: "environment" | "user"; icon: ReactNode }[] = [
  { key: "idFront", sub: "idFrontSub", capture: "environment", icon: <User /> },
  { key: "idBack", capture: "environment", icon: <User /> },
  { key: "selfie", sub: "selfieSub", capture: "user", icon: <User /> },
];
const STEP2: { key: FileKey; sub?: "diplomaSub" }[] = [
  { key: "diploma", sub: "diplomaSub" },
  { key: "certificate" },
  { key: "roleProof" },
];
/* Stored as French names (the reviewer reads them), shown in the tutor's language. */
const LANGS = ["Arabe", "Français", "Anglais"] as const;
const LINKS = [
  ["linkedinUrl", "linkedin"],
  ["instagramUrl", "instagram"],
  ["tiktokUrl", "tiktok"],
  ["youtubeUrl", "youtube"],
  ["facebookUrl", "facebook"],
  ["websiteUrl", "website"],
  ["introVideoUrl", "introVideo"],
] as const;

type Err = null | "id" | "size" | "type" | "auth" | "store" | "declaration" | "generic";

export function VerifyInner({ state }: { state: OnboardingState | null }) {
  const { locale } = useLocale();
  const c: CopyT = copy[locale];

  const [loading, setLoading] = useState(true);
  const [verif, setVerif] = useState<TutorVerification | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<Err>(null);
  const [declared, setDeclared] = useState(false);
  const [step, setStep] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const [langs, setLangs] = useState<string[]>([]);

  const [files, setFiles] = useState<Partial<Record<FileKey, File | null>>>({});
  const fileInputs = useRef<Partial<Record<FileKey, HTMLInputElement | null>>>({});
  const [fileErrors, setFileErrors] = useState<Partial<Record<FileKey, string | null>>>({});
  /* Object URLs for the thumbnails, held so they can be revoked: each one pins the
     whole file in memory, and this form can hold six 8 MB photos. */
  const [previews, setPreviews] = useState<Partial<Record<FileKey, string | null>>>({});
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useEffect(
    () => () => {
      for (const url of Object.values(previewsRef.current)) if (url) URL.revokeObjectURL(url);
    },
    [],
  );

  const stepHeads = useRef<(HTMLHeadingElement | null)[]>([]);
  /** The status heading; focused after a submit so focus follows the view. */
  const doneRef = useRef<HTMLHeadingElement | null>(null);

  /* espace prof v2 · pro (P7): a failed read is an error with a retry — it used to
     fall through to the upload form, so a tutor whose dossier is under review could
     be shown the form as if nothing had been sent. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    getMyVerification()
      .then((v) => {
        if (!alive) return;
        setLoadFailed(false);
        setVerif(v);
        // A refused dossier comes back with its languages ticked.
        if (v?.status === "rejected" && v.languages) {
          setLangs(v.languages.split(/\s*,\s*/).filter(Boolean));
        }
      })
      .catch(() => {
        if (alive) setLoadFailed(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const pre = verif && verif.status === "rejected" ? verif : null;
  const status = verif?.status ?? state?.status ?? null;

  function pickFile(key: FileKey, f: File | null) {
    if (f) {
      if (f.size > MAX_DOC_BYTES) {
        setFileErrors((p) => ({ ...p, [key]: c.errPickTooLarge(fmtMb(f.size, locale)) }));
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
      const old = prev[key];
      if (old) URL.revokeObjectURL(old);
      // PDFs get no thumbnail: there is no bitmap for an image tag to render.
      const url = f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null;
      return { ...prev, [key]: url };
    });
    setFiles((prev) => ({ ...prev, [key]: f }));
    if (error === "id" && key === "idFront" && f) setError(null);
  }

  function goTo(next: number) {
    if (next > 0 && !files.idFront) {
      setStep(0);
      setError("id");
      requestAnimationFrame(() => fileInputs.current.idFront?.focus());
      return;
    }
    setError((e) => (e === "id" ? null : e));
    setStep(next);
    window.scrollTo({ top: 0 });
    // Focus follows the step: its heading is announced, and Tab continues from there.
    requestAnimationFrame(() => stepHeads.current[next]?.focus());
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    // Enter in a field of steps 1–2 moves on; only step 3 sends.
    if (step < 2) {
      goTo(step + 1);
      return;
    }
    if (!files.idFront) {
      goTo(0);
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
    const textKeys = ["experienceYears", "institution", "pitch", ...LINKS.map(([k]) => k)];
    for (const k of textKeys) {
      const el = form.elements.namedItem(k) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el && el.value.trim()) fd.append(k, el.value.trim());
    }
    if (langs.length) fd.append("languages", langs.join(", "));
    for (const f of [...STEP1, ...STEP2]) {
      const file = files[f.key];
      if (file) fd.append(f.key, file);
    }

    try {
      const res = await submitVerification(fd);
      if (res.ok) {
        if (res.demo) setDemo(true);
        setDone(true);
        window.scrollTo({ top: 0 });
        requestAnimationFrame(() => doneRef.current?.focus());
      } else {
        switch (res.error) {
          case "id-required": goTo(0); break;
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
      <AppPage title={c.title} subtitle={c.reassure} width="narrow">
        <PageSkeleton rows={2} />
        <span className="sr-only">{c.loadingStatus}</span>
      </AppPage>
    );
  }

  /* ---------- the dossier could not be read (espace prof v2 · pro P7) ---------- */
  if (loadFailed) {
    return (
      <AppPage title={c.title} subtitle={c.reassure} width="narrow">
        <ErrorState
          onRetry={() => {
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
        />
      </AppPage>
    );
  }

  /* ---------- status pages ---------- */
  if (done || status === "pending") {
    const kinds = done ? [] : verif?.docKinds ?? [];
    return (
      <AppPage title={c.title} width="narrow">
        <StatusCard
          kind="pending"
          tag={c.tagPending}
          title={c.pendingTitle}
          titleRef={doneRef}
          actions={
            <>
              <Link href="/dashboard/new-class" className="btn btn-primary btn-sm">{c.ctaClass}</Link>
              <Link href="/dashboard" className="btn btn-ghost btn-sm">{c.ctaHome}</Link>
            </>
          }
        >
          <p>{c.pendingBody}</p>
          {kinds.length > 0 && (
            <p className="vf-docs" data-e2e="verify-received">
              {c.received} {Array.from(new Set(kinds)).map((k) => c.docs[k] ?? k).join(" · ")}
            </p>
          )}
          <p className="vf-fine">{demo ? c.demoNote : c.pendingNote}</p>
        </StatusCard>
      </AppPage>
    );
  }
  if (status === "verified") {
    return (
      <AppPage title={c.title} width="narrow">
        <StatusCard
          kind="verified"
          tag={c.tagVerified}
          title={c.verifiedTitle}
          actions={
            <>
              <Link href="/dashboard/new-class" className="btn btn-primary btn-sm">{c.ctaPublish}</Link>
              <Link href="/dashboard" className="btn btn-ghost btn-sm">{c.ctaHome}</Link>
            </>
          }
        >
          <p>{c.verifiedBody}</p>
        </StatusCard>
      </AppPage>
    );
  }

  /* ---------- the form (draft / none / rejected) ---------- */
  const stepState = (i: number): "done" | "skipped" | "current" | "todo" =>
    i === step ? "current" : i < step ? (i === 1 && skipped ? "skipped" : "done") : "todo";
  const reachable = (i: number) => i <= step || Boolean(files.idFront);
  const nId = STEP1.filter((f) => files[f.key]).length;
  const nProof = STEP2.filter((f) => files[f.key]).length;

  const back =
    step > 0 ? (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => goTo(step - 1)} data-e2e="verify-back">
        {c.back(c.steps[step - 1])}
      </button>
    ) : null;

  return (
    <AppPage title={c.title} subtitle={c.reassure} width="narrow">
      {pre && (
        <StatusCard kind="rejected" tag={c.tagRejected} title={c.rejectedTitle}>
          {pre.reviewNote && (
            <p className="vf-reason">
              <b>{c.rejectedReason}</b> <UserText>{pre.reviewNote}</UserText>
            </p>
          )}
          <p>{c.rejectedBody}</p>
        </StatusCard>
      )}

      <ol className="vf-steps" aria-label={c.stepsLabel} data-e2e="verify-steps">
        {c.steps.map((label, i) => {
          const st = stepState(i);
          return (
            <li key={label}>
              <button
                type="button"
                className="vf-step"
                data-state={st}
                aria-current={st === "current" ? "step" : undefined}
                disabled={!reachable(i) || submitting}
                onClick={() => goTo(i)}
                data-e2e={`verify-step-tab-${i + 1}`}
              >
                <span className="hp-num">{i + 1}</span> · {label}
                {st === "done" && (
                  <>
                    <Check className="vf-step-ic" />
                    <span className="sr-only">({c.stepDone})</span>
                  </>
                )}
                {st === "skipped" && <span className="sr-only">({c.stepSkipped})</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit} noValidate>
        {/* ── 1 · Identité ── */}
        <section className="aps-section" hidden={step !== 0} aria-labelledby="vf-s1-t" data-e2e="verify-step-1">
          <h2 className="aps-section-t" id="vf-s1-t" tabIndex={-1} ref={(el) => { stepHeads.current[0] = el; }}>
            <span className="aps-section-n" aria-hidden="true">1</span>
            {c.steps[0]}
            <span className="chip chip-rose">{c.s1Req}</span>
          </h2>
          <div className="vf-cards">
            {STEP1.map((f) => (
              <FileCard
                key={f.key}
                c={c}
                locale={locale}
                fieldKey={f.key}
                title={c[f.key]}
                sub={f.sub ? c[f.sub] : undefined}
                required={f.key === "idFront"}
                capture={f.capture}
                icon={f.icon}
                file={files[f.key] ?? null}
                preview={previews[f.key] ?? null}
                fileError={fileErrors[f.key] ?? null}
                invalid={error === "id" && f.key === "idFront"}
                onPick={(file) => pickFile(f.key, file)}
                inputRef={(el) => { fileInputs.current[f.key] = el; }}
              />
            ))}
          </div>
          {error === "id" && <p role="alert" className="vf-err">{c.needId}</p>}
          <p className="vf-fine">
            <Shield />
            <span>{c.idFine}</span>
          </p>
        </section>

        {/* ── 2 · Ton parcours (optional) ── */}
        <section className="aps-section" hidden={step !== 1} aria-labelledby="vf-s2-t" data-e2e="verify-step-2">
          <h2 className="aps-section-t" id="vf-s2-t" tabIndex={-1} ref={(el) => { stepHeads.current[1] = el; }}>
            <span className="aps-section-n" aria-hidden="true">2</span>
            {c.steps[1]}
            <span className="tag tag-neutral">{c.s2Tag}</span>
          </h2>
          <div className="vf-cards">
            {STEP2.map((f) => (
              <FileCard
                key={f.key}
                c={c}
                locale={locale}
                fieldKey={f.key}
                title={c[f.key]}
                sub={f.sub ? c[f.sub] : undefined}
                required={false}
                icon={<Book />}
                file={files[f.key] ?? null}
                preview={previews[f.key] ?? null}
                fileError={fileErrors[f.key] ?? null}
                onPick={(file) => pickFile(f.key, file)}
                inputRef={(el) => { fileInputs.current[f.key] = el; }}
              />
            ))}
          </div>
          <div className="nc-two mt-4">
            <div className="field">
              <label className="field-label" htmlFor="experienceYears">{c.experienceYears}</label>
              <div className="inp">
                <input
                  id="experienceYears" name="experienceYears" type="number"
                  min={0} max={60} step={1} placeholder={c.experiencePh}
                  defaultValue={pre?.experienceYears ?? undefined}
                  inputMode="numeric"
                />
              </div>
            </div>
            <fieldset className="field nc-fieldset">
              <legend className="field-label">{c.languages}</legend>
              <div className="nc-chips" data-e2e="verify-langs">
                {Array.from(new Set([...LANGS, ...langs])).map((l) => (
                  <label key={l} className="nc-chip">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={langs.includes(l)}
                      onChange={(e) => setLangs((p) => (e.target.checked ? [...p, l] : p.filter((x) => x !== l)))}
                    />
                    {c.langs[l] ?? l}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="institution">{c.institution}</label>
            <div className="inp">
              <input
                id="institution" name="institution" type="text"
                placeholder={c.institutionPh} maxLength={120}
                defaultValue={pre?.institution ?? undefined}
              />
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="pitch">{c.pitch}</label>
            <div className="inp">
              <textarea
                id="pitch" name="pitch" rows={3}
                placeholder={c.pitchPh} maxLength={600}
                defaultValue={pre?.pitch ?? undefined}
                style={{ resize: "vertical", minHeight: 80 }}
              />
            </div>
          </div>
          <details className="nc-tools vf-links" open={Boolean(pre && Object.values(pre.links).some(Boolean))}>
            <summary className="aps-section-t nc-tools-sum">
              {c.links}
              <span className="nc-tools-hint">{c.linksHint}</span>
            </summary>
            <div className="vf-linkgrid">
              {LINKS.map(([id, k]) => (
                <div key={id} className="field mb-0">
                  <label className="field-label" htmlFor={id}>{c[k]}</label>
                  <div className="inp">
                    {/* dir="ltr": a Latin URL in an RTL field renders with its punctuation mirrored. */}
                    <input id={id} name={id} type="url" inputMode="url" dir="ltr" placeholder={c.urlPh} defaultValue={pre?.links[k] ?? undefined} />
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>

        {/* ── 3 · Déclaration (décret 2015-1619) ── */}
        <section className="aps-section" hidden={step !== 2} aria-labelledby="vf-s3-t" data-e2e="verify-step-3">
          <h2 className="aps-section-t" id="vf-s3-t" tabIndex={-1} ref={(el) => { stepHeads.current[2] = el; }}>
            <span className="aps-section-n" aria-hidden="true">3</span>
            {c.steps[2]}
          </h2>
          <label className="vf-declare">
            <input
              type="checkbox"
              name="notPublicTeacher"
              checked={declared}
              onChange={(e) => {
                setDeclared(e.target.checked);
                if (e.target.checked && error === "declaration") setError(null);
              }}
              aria-describedby="declaration-help"
              aria-invalid={error === "declaration" || undefined}
            />
            <span>{PUBLIC_TEACHER_DECLARATION[locale]}</span>
          </label>
          <p id="declaration-help" className="vf-fine">{c.declarationHelp}</p>
          <p className="vf-recap" data-e2e="verify-recap">{c.recap(nId, nProof)}</p>

          {error && error !== "id" && (
            <div role="alert" className="vf-alert">
              {error === "size" && c.errFileSize}
              {error === "type" && c.errFileType}
              {error === "generic" && c.errGeneric}
              {error === "declaration" && c.errDeclaration}
              {error === "auth" && (
                <>
                  {c.errAuthLine} <Link href="/auth" className="linklike linklike-inline">{c.errAuthLink}</Link>
                </>
              )}
              {error === "store" && (
                <>
                  {c.errStoreLine} <Link href="/onboarding" className="linklike linklike-inline">{c.errStoreLink}</Link>
                </>
              )}
            </div>
          )}
          {/* A server action gives no progress events, so this is deliberately
              indeterminate: it says the one thing that matters, which is don't leave.
              Always in the DOM so the live region announces the change. */}
          <p role="status" aria-live="polite" className="vf-fine">{submitting ? c.uploadingLive : ""}</p>
        </section>

        <ActionBar status={back}>
          {step === 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSkipped(true);
                goTo(2);
              }}
              data-e2e="verify-skip"
            >
              {c.skip}
            </button>
          )}
          {step < 2 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (step === 1) setSkipped(false);
                goTo(step + 1);
              }}
              data-e2e="verify-next"
            >
              {c.next}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting} data-e2e="verify-submit">
              {submitting ? (
                <>
                  <Spinner label={c.submitting} />
                  {c.submitting}
                </>
              ) : (
                c.submit
              )}
            </button>
          )}
        </ActionBar>
      </form>
    </AppPage>
  );
}

/* ================================================================== */

function StatusCard({
  kind,
  tag,
  title,
  titleRef,
  actions,
  children,
}: {
  kind: "pending" | "verified" | "rejected";
  tag: string;
  title: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const icon = kind === "verified" ? <Check /> : kind === "pending" ? <Clock /> : <Info />;
  const tagClass = kind === "verified" ? "tag tag-success" : kind === "pending" ? "tag tag-soon" : "chip chip-rose";
  return (
    <section className={`u-card vf-status is-${kind}`} aria-labelledby="vf-status-t" data-e2e={`verify-status-${kind}`}>
      <div className="vf-status-head">
        <span className={`vf-status-ic is-${kind}`} aria-hidden="true">{icon}</span>
        <span className={tagClass}>{tag}</span>
      </div>
      {/* tabIndex={-1}: focusable from code (after a submit), not a tab stop. */}
      <h2 id="vf-status-t" ref={titleRef} tabIndex={-1} className="vf-status-t">{title}</h2>
      <div className="vf-status-b">{children}</div>
      {actions ? <div className="cluster mt-4">{actions}</div> : null}
    </section>
  );
}

function FileCard({
  c, locale, fieldKey, title, sub, required, capture, icon, file, preview, fileError, invalid, onPick, inputRef,
}: {
  c: CopyT;
  locale: Locale;
  fieldKey: FileKey;
  title: string;
  sub?: string;
  required: boolean;
  capture?: "environment" | "user";
  icon: ReactNode;
  file: File | null;
  /** Object URL for an image pick; null for a PDF or an empty card. */
  preview: string | null;
  fileError: string | null;
  invalid?: boolean;
  onPick: (f: File | null) => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const inputId = `file-${fieldKey}`;
  const errId = `${inputId}-err`;
  return (
    <div className="vf-card-wrap">
      <label
        htmlFor={inputId}
        className="dz vf-card"
        data-filled={file ? "true" : "false"}
        data-invalid={invalid || fileError ? "true" : undefined}
        data-e2e={`verify-card-${fieldKey}`}
      >
        <input
          id={inputId}
          name={fieldKey}
          type="file"
          accept={ACCEPT}
          /* Opens the camera directly on a phone; desktop browsers ignore it. */
          capture={capture}
          ref={inputRef}
          aria-required={required || undefined}
          aria-invalid={invalid || Boolean(fileError) || undefined}
          aria-describedby={fileError ? errId : undefined}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          className="sr-only"
        />
        {/* The thumbnail is a URL.createObjectURL blob that exists only in this tab:
            an identity document must not travel to an image optimiser to be shown
            back to the person who just picked it. Nothing is uploaded yet. */}
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob, never fetched
          <img src={preview} alt="" className="dz-thumb" />
        ) : (
          <span className="dz-ic" aria-hidden="true">{file ? <Check /> : icon}</span>
        )}
        <span className="dz-txt">
          <b>{title}</b>
          {file ? (
            <>
              <UserText as="span" className="dz-name">{file.name}</UserText>
              <span className="dz-hint">{fmtMb(file.size, locale)} · {c.dzChange}</span>
            </>
          ) : (
            <span className="dz-hint">{sub ? `${sub} · ` : ""}{c.dzHint(MAX_DOC_MB)}</span>
          )}
        </span>
        {!file && <Upload className="dz-up" />}
      </label>
      {fileError && (
        <p id={errId} role="alert" className="vf-err">{fileError}</p>
      )}
      {file && (
        <button
          type="button"
          className="linklike vf-remove"
          onClick={() => {
            onPick(null);
            const el = document.getElementById(inputId) as HTMLInputElement | null;
            if (el) el.value = "";
          }}
        >
          {c.dzRemove}
        </button>
      )}
    </div>
  );
}

/** Human file size, for the picked-file line and the too-large message. */
function fmtMb(bytes: number, locale: Locale): string {
  const mb = bytes / (1024 * 1024);
  const unitM = locale === "ar" ? "ميغا" : "Mo";
  const unitK = locale === "ar" ? "كيلو" : "Ko";
  return mb >= 1 ? `${mb.toFixed(1)} ${unitM}` : `${Math.max(1, Math.round(bytes / 1024))} ${unitK}`;
}
