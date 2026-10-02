"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Video, Board, Quiz, Copy as CopyIcon, Check } from "@/components/icons";
import { createClass, getClass, getOnboardingState } from "@/app/actions";
import { useToast } from "@/components/useToast";
import { AppPage, Blocker, ActionBar, FormSection, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { DateTimeField } from "@/components/app/DatePicker";
import { Switch } from "@/components/app/Switch"; // live-fixes-1 · D1
import { classUrl } from "@/components/app/links";
import { useShell } from "@/components/app/ShellContext";
import { ShareButton } from "@/components/share/ShareButton"; // espace prof v2 · growth (P3), contract C3
import { ShareSheet } from "@/components/share/ShareSheet";
import { markLinkShared } from "@/app/actions-shell";
import { getMyPromotions } from "@/app/actions-growth";
import { bilingual } from "@/lib/i18n";
import {
  LEVEL_CODES, LEVEL_LABELS, isLevelCode, sortLevels, subjectLabel, formatNumericDate, parseScheduleInput, priceWithPromotion,
  type LevelCode, type TutorVerifStatus, type TutorPromotionRow,
} from "@tnajem/shared";
/* phase-a lane L5 (A18.16): the SAME limits schema POST /classes enforces. */
import { CLASS_LIMITS, checkClassLimits } from "@tnajem/shared/class-input";
import { ClassPreview } from "./ClassPreview";
import { DuplicateDialog } from "./DuplicateDialog";

/* ══════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 6 — NOUVELLE CLASSE (image 2).

   The verification blocker on top; three numbered sections — L'essentiel · Date,
   durée, prix · Outils (folded: most tutors use the built-in room); the student's
   view of the class on the side, live; « Publier la classe » in the sticky bar.

   CHIPS, NOT SELECTS, where the choice is small: the level (« Tous » or one code)
   and the duration (60 / 90 / 120 — a class copied with another length keeps it as
   a fourth chip). Native radio inputs under the chips, so the keyboard and screen
   readers get a real radio group. Seats stay a number: classes.seats is a real
   limit (1–200, @tnajem/shared/class-input), enforced by POST /classes.

   NO « MATIÈRE » FIELD: a class has no subject of its own in the data model — it is
   the tutor's (spec: "use the teacher's subject and don't add a field"). It is shown,
   read-only, and changed on the page editor.

   THE DRAFT is kept in this browser (localStorage, per page address, every access in
   try/catch — private mode and full storage must never break the form), restored on
   return, and cleared once the class is published.
   ══════════════════════════════════════════════════════════════════════════════ */

/* A tutor must be verified before publishing (enforced server-side in createClass). */
const NOT_VERIFIED_MSG = {
  fr: "Ton profil doit d'abord être vérifié. Va dans « Vérification » pour envoyer tes documents.",
  ar: "لازم بروفايلك يتثبّت الأول. امشي لـ « التثبّت » وابعث وثائقك.",
} as const;

/* Step 8. A class title and description are PUBLIC storefront copy: refused, not masked. */
const CONTACT_INFO_MSG = {
  fr: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées dans une séance. Tes élèves passent par Tnajem.",
  ar: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة في الحصة. تلامذتك يعدّو عبر Tnajem.",
} as const;

/* Step 16. The plan limit refusal NAMES THE NUMBER, inline, with a link (never a toast). */
const PLAN_LIMIT_MSG = {
  fr: (n: number, plan: string) =>
    `Ton offre ${plan} te permet ${n === 1 ? "1 séance publiée" : `${n} séances publiées`} à la fois. Annule une séance à venir, attends qu'elle ait lieu, ou passe à une offre supérieure.`,
  ar: (n: number, plan: string) =>
    `عرضك ${plan} يسمحلك بـ ${n === 1 ? "حصة وحدة منشورة" : `${n} حصص منشورة`} في نفس الوقت. ألغي حصة جاية، ولا استنّاها تكمّل، ولا اطلع لعرض أكبر.`,
} as const;
const PLAN_LIMIT_CTA = { fr: "Voir les offres", ar: "شوف العروض" } as const;

const copy = bilingual({
  fr: {
    title: "Nouvelle classe en direct",
    priceHelp: "Tu gardes 100 % pendant le pilote : Tnajem ne prend rien.",
    descPh: "ex. Méthodes + annales. On fait 3 exercices types ensemble.",
    errTitle: "Le titre doit faire au moins 3 caractères.",
    errDescription: "La description ne peut pas dépasser 1000 caractères.",
    errDate: "Choisis une date et une heure valides.",
    errDatePast: "Choisis une date à venir.",
    errDuration: `Choisis une durée entre ${CLASS_LIMITS.durationMin} et ${CLASS_LIMITS.durationMax} minutes.`,
    errPrice: "Le prix doit être entre 0 et 5000 TND.",
    errSeats: `Choisis entre ${CLASS_LIMITS.seatsMin} et ${CLASS_LIMITS.seatsMax} places.`,
    errUrl: "Ce lien n'est pas valide : il doit commencer par https://",
    // live-fixes-1 · D1: one muted line while the option is off; a toggle when it is on.
    ffOffLine: "1re séance offerte : désactivée",
    ffOffCta: "Activer dans Réglages ›",
    ffOnHelp: "Pour cette classe : la première séance d'un nouvel élève avec toi est offerte.",
    ffOffErr: "La 1ʳᵉ séance offerte est désactivée dans tes réglages. Active-la d'abord, ou décoche la case.",
    errLevel: "Choisis un niveau de la liste.",
    s1: "L'essentiel",
    s2: "Date, durée, prix",
    s3: "Outils de la séance",
    s3Hint: "optionnel · sinon, Tnajem ouvre une salle vidéo pour ta classe",
    subject: "Matière",
    subjectHelp: "La matière de ta page.",
    level: "Niveau",
    levelAll: "Tous",
    duration: "Durée",
    durationUnit: (n: number) => `${n} min`,
    pricePer: "Prix par élève",
    seats: "Places",
    bVerifyT: "Tu peux préparer ta classe maintenant",
    bVerifyB: "ton brouillon est gardé sur cet appareil, et tu la publies dès que ton compte est vérifié.",
    bVerifyCta: "Vérifier mon compte",
    bPendingT: "Vérification en cours",
    bPendingB: "prépare ta classe : tu pourras la publier dès que ton compte est validé, en général sous 24–48 h.",
    cancel: "Annuler",
    duplicate: "Dupliquer une classe précédente",
    duplicated: (t: string) => `Copie de « ${t} » : choisis la date de la nouvelle séance.`,
    draftSaved: "Brouillon enregistré",
    draftRestored: "Brouillon repris",
    draftClear: "Repartir de zéro",
    publishedT: "Ta classe est publiée",
    publishedB: "Elle apparaît sur ta page. Partage-la pour remplir les places.",
    shareClass: "Partager cette classe",
    promo: (pct: number, final: number, base: number, until: string) =>
      `Ta promotion −${pct} % est en cours : l'élève paie ${final} TND au lieu de ${base} TND, jusqu'au ${until}.`,
    seeClasses: "Voir mes classes",
    another: "Créer une autre classe",
  },
  ar: {
    title: "حصة دايركت جديدة",
    priceHelp: "تحتفظ بـ \u2066100 %\u2069 في فترة التجربة : Tnajem ما تاخذ والو.",
    descPh: "مثال: مناهج + امتحانات. نعملو 3 تمارين نموذجية مع بعضنا.",
    errTitle: "العنوان لازم يكون فيه 3 حروف على الأقل.",
    errDescription: "الوصف ما ينجّمش يفوت 1000 حرف.",
    errDate: "اختار تاريخ ووقت صحاح.",
    errDatePast: "اختار تاريخ جاي.",
    errDuration: `اختار مدّة بين ${CLASS_LIMITS.durationMin} و ${CLASS_LIMITS.durationMax} دقيقة.`,
    errPrice: "الثمن لازم يكون بين 0 و 5000 د.ت.",
    errSeats: `اختار بين ${CLASS_LIMITS.seatsMin} و ${CLASS_LIMITS.seatsMax} بلاصة.`,
    errUrl: "الرابط هذا موش صحيح : لازم يبدا بـ https://",
    ffOffLine: "الحصة الأولى فابور: مطفية",
    ffOffCta: "فعّلها في الإعدادات ‹",
    ffOnHelp: "في الحصة هاذي: أول حصة لتلميذ جديد معاك فابور.",
    ffOffErr: "الحصة الأولى فابور مطفية في الإعدادات متاعك. فعّلها الأول، ولا نحّي العلامة.",
    errLevel: "اختار مستوى من الليستة.",
    s1: "الأساسي",
    s2: "الوقت، المدّة، الثمن",
    s3: "أدوات الحصة",
    s3Hint: "اختياري · وإلا Tnajem تحلّ غرفة فيديو لحصتك",
    subject: "المادة",
    subjectHelp: "المادة متاع صفحتك.",
    level: "المستوى",
    levelAll: "الكل",
    duration: "المدّة",
    durationUnit: (n: number) => `${n} دقيقة`,
    pricePer: "الثمن للتلميذ",
    seats: "البلايص",
    bVerifyT: "تنجّم تحضّر حصتك توّا",
    bVerifyB: "المسودة تتحفظ في الجهاز هذا، وتنشرها أوّل ما حسابك يتثبّت.",
    bVerifyCta: "ثبّت حسابي",
    bPendingT: "التثبّت في الطريق",
    bPendingB: "حضّر حصتك: تنجّم تنشرها أوّل ما حسابك يتقبل، عادةً في 24–48 ساعة.",
    cancel: "ارجع",
    duplicate: "انسخ حصة قديمة",
    duplicated: (t: string) => `نسخة من « ${t} »: اختار وقت الحصة الجديدة.`,
    draftSaved: "المسودة تسجّلت",
    draftRestored: "رجّعنا المسودة",
    draftClear: "ابدا من جديد",
    publishedT: "الحصة متاعك تنشرت",
    publishedB: "تبان في صفحتك. شاركها باش تتعمّر البلايص.",
    shareClass: "شارك الحصة هاذي",
    promo: (pct: number, final: number, base: number, until: string) =>
      `التخفيض متاعك \u2066−${pct} %\u2069 ماشي: التلميذ يخلّص ${final} د.ت عوض ${base} د.ت، حتى لـ ${until}.`,
    seeClasses: "شوف حصصي",
    another: "اعمل حصة أخرى",
  },
});

const CLASS_FIELDS = ["title", "description", "date", "duration", "price", "seats", "meet-url", "whiteboard-url", "quiz-url", "level"] as const;
type ClassField = (typeof CLASS_FIELDS)[number];
const TOOL_FIELDS: ClassField[] = ["meet-url", "whiteboard-url", "quiz-url"];

/** The field a createClass refusal names, or null when it is not about one field. */
function fieldOf(code: string | undefined): ClassField | null {
  if (!code) return null;
  const name = code.replace(/^(invalid|negative)-/, "").replace(/-(too-long|too-high|in-past)$/, "");
  return (CLASS_FIELDS as readonly string[]).includes(name) ? (name as ClassField) : null;
}

const DURATIONS = [60, 90, 120] as const;

type Draft = {
  title: string; desc: string; datetime: string; duration: string; price: string; seats: string;
  level: string; videoUrl: string; whiteboardUrl: string; quizUrl: string; freeFirst: boolean;
};
const EMPTY: Draft = {
  title: "", desc: "", datetime: "", duration: "90", price: "", seats: "20",
  level: "", videoUrl: "", whiteboardUrl: "", quizUrl: "", freeFirst: false,
};

/* Storage that never throws: private mode, a full disk or a blocked origin all
   degrade to "no draft", never to a broken form. */
function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return { ...EMPTY, ...d };
  } catch {
    return null;
  }
}
function writeDraft(key: string, d: Draft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}
function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}
const isBlank = (d: Draft) =>
  !d.title && !d.desc && !d.datetime && !d.price && !d.videoUrl && !d.whiteboardUrl && !d.quizUrl;

export function NewClassForm() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();

  const [f, setF] = useState<Draft>(EMPTY);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((prev) => ({ ...prev, [k]: v }));

  /* The tutor's side of things: the free-first option (A18.6), the verification
     state (the blocker), the subject (shown, not edited), the levels (the chips),
     and the page address (the draft's key). null = not known yet. */
  const [ffOption, setFfOption] = useState<boolean | null>(null);
  const [status, setStatus] = useState<TutorVerifStatus | null>(null);
  const [subject, setSubject] = useState("");
  const [levels, setLevels] = useState<LevelCode[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<"none" | "saved" | "restored">("none");
  const [duplicatedFrom, setDuplicatedFrom] = useState<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const prefillFrom = useCallback(async (id: string) => {
    const k = await getClass(id).catch(() => null);
    if (!k) return;
    setF((prev) => ({
      ...prev,
      title: k.title,
      desc: k.description ?? "",
      duration: String(k.duration_min ?? 90),
      price: String(k.price_tnd),
      seats: String(k.seats || 20),
      level: k.level && isLevelCode(k.level) ? k.level : "",
      datetime: "",
    }));
    setDuplicatedFrom(k.title);
  }, []);

  /* espace prof v2 · pro (P7) — the page's own states: a skeleton until the tutor's
     side (subject, levels, verification, draft) is known, an error with a retry if it
     cannot be read — never a half-filled form that changes under the tutor's fingers. */
  const [loadState, setLoadState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const from = new URLSearchParams(window.location.search).get("from");
    getOnboardingState()
      .then((s) => {
        if (!alive) return;
        setLoadState("ready");
        setFfOption(Boolean(s?.offersFreeFirstSession));
        setStatus(s?.status ?? null);
        setSubject(s?.draft?.subject ?? "");
        setLevels(sortLevels(s?.levels ?? []));
        const key = `tnajem:new-class:${s?.draft?.slug || "me"}`;
        setDraftKey(key);
        // A copy (?from=) wins over a draft; otherwise, pick up where they left off.
        if (!from) {
          const d = readDraft(key);
          if (d && !isBlank(d)) {
            setF(d);
            setDraftState("restored");
            if (d.videoUrl || d.whiteboardUrl || d.quizUrl) setToolsOpen(true);
          }
        }
      })
      .catch(() => {
        if (!alive) return;
        setFfOption(false);
        setLoadState("failed");
      });
    if (from) void prefillFrom(from);
    return () => {
      alive = false;
    };
  }, [prefillFrom, reloadKey]);

  // Autosave, a beat after the last keystroke.
  useEffect(() => {
    if (!draftKey) return;
    if (isBlank(f)) return;
    const id = window.setTimeout(() => {
      if (writeDraft(draftKey, f)) setDraftState("saved");
    }, 600);
    return () => window.clearTimeout(id);
  }, [f, draftKey]);

  const ffDisabled = ffOption !== true;
  const [submitted, setSubmitted] = useState(false);
  const [demo, setDemo] = useState(false);
  const [planLimit, setPlanLimit] = useState<{ limit: number; plan: string } | null>(null);
  /* The class just published (espace prof v2 · growth P3 behaviour, kept): its id,
     title and wall time, for « Partager » — the share sheet opens on its own. */
  const [published, setPublished] = useState<{ id: string | null; title: string; wall: string } | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const shellSlug = useShell()?.shell?.slug ?? null;
  /* The tutor's promotions (phase 5): a PUBLIC one covering every class ("all")
     changes what a student pays for this new class — said under the price, and shown
     in the preview, with the same priceWithPromotion() the API books with. */
  const [promotions, setPromotions] = useState<TutorPromotionRow[]>([]);
  useEffect(() => {
    let alive = true;
    getMyPromotions()
      .then((r) => {
        if (alive && r && r.ok) setPromotions(r.promotions);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [fieldError, setFieldError] = useState<{ field: ClassField; message: string } | null>(null);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    date: useRef<HTMLInputElement>(null),
    duration: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
    seats: useRef<HTMLInputElement>(null),
    "meet-url": useRef<HTMLInputElement>(null),
    "whiteboard-url": useRef<HTMLInputElement>(null),
    "quiz-url": useRef<HTMLInputElement>(null),
    level: useRef<HTMLInputElement>(null),
  };
  const errorFor = (field: ClassField) => (fieldError?.field === field ? fieldError.message : undefined);
  const clearError = (field: ClassField) => {
    if (fieldError?.field === field) setFieldError(null);
  };
  function messageForField(field: ClassField, code: string): string {
    switch (field) {
      case "title": return c.errTitle;
      case "description": return c.errDescription;
      case "date": return code === "date-in-past" ? c.errDatePast : c.errDate;
      case "duration": return c.errDuration;
      case "price": return c.errPrice;
      case "seats": return c.errSeats;
      case "level": return c.errLevel;
      default: return c.errUrl;
    }
  }
  function refuse(field: ClassField, code: string) {
    setFieldError({ field, message: messageForField(field, code) });
    // A refusal inside the folded tools section unfolds it, or focus would land nowhere.
    if (TOOL_FIELDS.includes(field)) setToolsOpen(true);
    requestAnimationFrame(() => refs[field].current?.focus());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    if (!f.datetime) {
      refuse("date", "invalid-date");
      return;
    }
    const limits = checkClassLimits({
      title: f.title, description: f.desc, durationMin: Number(f.duration), seats: Number(f.seats), priceTnd: Number(f.price),
    });
    if (!limits.ok) {
      const field = fieldOf(limits.error);
      if (field) {
        refuse(field, limits.error);
        return;
      }
    }
    setSubmitted(true);
    const res = (await createClass({
      title: f.title, description: f.desc, scheduledAt: f.datetime,
      durationMin: Number(f.duration), priceTnd: Number(f.price), seats: Number(f.seats),
      isFreeFirst: f.freeFirst && !ffDisabled, meetUrl: f.videoUrl, whiteboardUrl: f.whiteboardUrl, quizUrl: f.quizUrl,
      level: f.level || null,
    })) as Awaited<ReturnType<typeof createClass>> & { id?: string };
    setSubmitted(false);
    if (res.ok) {
      setDemo(Boolean(res.demo));
      setPlanLimit(null);
      if (draftKey) clearDraft(draftKey);
      setDraftState("none");
      setPublished({ id: res.id ?? null, title: f.title, wall: f.datetime });
      setSheetOpen(true);
      showToast(res.demo ? `${t.extra.classPublished} · ${t.common.demoMode}` : t.extra.classPublished);
      window.scrollTo({ top: 0 });
      return;
    }
    if (res.error === "plan-limit-classes" && typeof res.limit === "number") {
      setPlanLimit({ limit: res.limit, plan: res.planCode ?? "" });
      return;
    }
    setPlanLimit(null);
    const field = fieldOf(res.error);
    if (field && res.error) {
      refuse(field, res.error);
      return;
    }
    showToast(
      res.error === "not-verified" ? NOT_VERIFIED_MSG[locale]
        : res.error === "contact-info-not-allowed" ? CONTACT_INFO_MSG[locale]
        : res.error === "free-first-off" ? c.ffOffErr
        : t.extra.error,
    );
  }

  function startOver() {
    if (draftKey) clearDraft(draftKey);
    setF(EMPTY);
    setDraftState("none");
    setDuplicatedFrom(null);
    setPublished(null);
    setFieldError(null);
  }

  /* Rule 4: the verification blocker at the TOP, before anything is filled in. */
  const blocker =
    status === "draft" || status === "rejected" ? (
      <Blocker title={c.bVerifyT} action={{ href: "/onboarding/verify", label: c.bVerifyCta }}>{c.bVerifyB}</Blocker>
    ) : status === "pending" ? (
      <Blocker title={c.bPendingT}>{c.bPendingB}</Blocker>
    ) : null;

  const durationChoices = DURATIONS.includes(Number(f.duration) as (typeof DURATIONS)[number]) || !f.duration
    ? [...DURATIONS]
    : [...DURATIONS, Number(f.duration)].sort((a, b) => a - b);
  const levelChoices: LevelCode[] = levels.length ? levels : [...LEVEL_CODES];
  // A class that does not exist yet can only be covered by an "all" promotion.
  const quote = priceWithPromotion({ kind: "class", id: "new", priceTnd: Number(f.price) || 0 }, promotions);

  if (published) {
    return (
      <AppPage title={c.title} width="narrow">
        <section className="u-card u-card-pad nc-done" aria-labelledby="nc-done-t" data-e2e="class-published">
          <span className="nc-done-ic" aria-hidden="true"><Check /></span>
          <h2 id="nc-done-t" className="aps-empty-t">{c.publishedT}</h2>
          <p className="hp-muted">{c.publishedB}</p>
          {published.id && (
            <div className="hp-linkbox mt-3" data-e2e="published-share">
              <span className="hp-linkbox-url" dir="ltr">{classUrl(published.id).replace(/^https?:\/\//, "")}</span>
              <ShareButton
                kind="class"
                classId={published.id}
                classTitle={published.title}
                startsAt={parseScheduleInput(published.wall)?.toISOString() ?? null}
                label={c.shareClass}
                variant="ghost"
              />
            </div>
          )}
          {/* Share right after publishing: the sheet opens on its own, once — the
              moment a tutor is most likely to tell their students. */}
          {shellSlug && sheetOpen && (
            <ShareSheet
              kind={published.id ? "class" : "profile"}
              slug={shellSlug}
              classId={published.id}
              classTitle={published.title}
              startsAt={parseScheduleInput(published.wall)?.toISOString() ?? null}
              open={sheetOpen}
              onClose={() => setSheetOpen(false)}
              onShared={() => void markLinkShared()}
            />
          )}
          {demo && <p className="hp-muted mt-2">{t.common.demoMode}</p>}
          <div className="cluster mt-4">
            <Link href="/dashboard/classes" className="btn btn-primary btn-sm">{c.seeClasses}</Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={startOver}>{c.another}</button>
          </div>
        </section>
        {toast}
      </AppPage>
    );
  }

  if (loadState !== "ready") {
    return (
      <AppPage title={c.title} width="wide">
        {loadState === "failed" ? (
          <ErrorState
            onRetry={() => {
              setLoadState("loading");
              setReloadKey((k) => k + 1);
            }}
          />
        ) : (
          <PageSkeleton rows={4} />
        )}
      </AppPage>
    );
  }

  return (
    <AppPage
      title={c.title}
      actions={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDupOpen(true)} data-e2e="duplicate-open">
          <CopyIcon />
          {c.duplicate}
        </button>
      }
      blockers={blocker}
      note={duplicatedFrom ? c.duplicated(duplicatedFrom) : undefined}
      width="wide"
    >
      <form onSubmit={handleSubmit} className="nc-form" noValidate={false}>
        <div className="nc-grid">
          <div className="nc-main">
            {planLimit && (
              <div role="alert" className="panel panel-pad mb-4" style={{ borderColor: "var(--ochre)", background: "var(--ochre-tint)" }}>
                <p className="text-[13.5px] leading-relaxed text-ink2 mb-3">{PLAN_LIMIT_MSG[locale](planLimit.limit, planLimit.plan)}</p>
                <Link href="/tarifs" className="btn btn-ghost btn-sm w-auto">{PLAN_LIMIT_CTA[locale]}</Link>
              </div>
            )}

            <FormSection n={1} title={c.s1} id="nc-s1">
              <Field label={t.createClass.name} error={errorFor("title")}>
                <div className="inp">
                  <input
                    type="text"
                    placeholder={t.createClass.namePh}
                    ref={refs.title}
                    value={f.title}
                    onChange={(e) => { set("title", e.target.value); clearError("title"); }}
                    required
                    maxLength={CLASS_LIMITS.titleMax}
                  />
                </div>
              </Field>

              <div className="nc-two">
                {subject && (
                  <div className="field">
                    <span className="field-label" id="nc-subject-l">{c.subject}</span>
                    <span className="nc-chip is-static" aria-labelledby="nc-subject-l" aria-describedby="nc-subject-h" data-e2e="class-subject">
                      {subjectLabel(subject, locale)}
                    </span>
                    <div id="nc-subject-h" className="help">{c.subjectHelp}</div>
                  </div>
                )}
                <fieldset className="field nc-fieldset">
                  <legend className="field-label">{c.level}</legend>
                  <div className="nc-chips" data-e2e="class-level">
                    <label className="nc-chip">
                      <input type="radio" name="level" value="" checked={f.level === ""} onChange={() => set("level", "")} className="sr-only" ref={refs.level} />
                      {c.levelAll}
                    </label>
                    {levelChoices.map((code) => (
                      <label key={code} className="nc-chip">
                        <input type="radio" name="level" value={code} checked={f.level === code} onChange={() => set("level", code)} className="sr-only" />
                        {LEVEL_LABELS[code][locale]}
                      </label>
                    ))}
                  </div>
                  {errorFor("level") && <div role="alert" className="help text-rose font-semibold">{errorFor("level")}</div>}
                </fieldset>
              </div>

              <Field label={t.createClass.desc} error={errorFor("description")}>
                <div className="inp items-start">
                  <textarea
                    rows={3}
                    placeholder={c.descPh}
                    ref={refs.description}
                    value={f.desc}
                    onChange={(e) => { set("desc", e.target.value); clearError("description"); }}
                    style={{ resize: "vertical", minHeight: 80 }}
                  />
                </div>
              </Field>
            </FormSection>

            <FormSection n={2} title={c.s2} id="nc-s2">
              <div className="nc-two nc-two-dt">
                <DateTimeField
                  value={f.datetime}
                  onChange={(w) => { set("datetime", w); clearError("date"); }}
                  error={errorFor("date")}
                  dateRef={refs.date}
                  required
                />
                <fieldset className="field nc-fieldset">
                  <legend className="field-label">{c.duration}</legend>
                  <div className="nc-chips" data-e2e="class-duration">
                    {durationChoices.map((n, i) => (
                      <label key={n} className="nc-chip">
                        <input
                          type="radio"
                          name="duration"
                          value={n}
                          checked={Number(f.duration) === n}
                          onChange={() => { set("duration", String(n)); clearError("duration"); }}
                          className="sr-only"
                          ref={i === 0 ? refs.duration : undefined}
                        />
                        {c.durationUnit(n)}
                      </label>
                    ))}
                  </div>
                  {errorFor("duration") && <div role="alert" className="help text-rose font-semibold">{errorFor("duration")}</div>}
                </fieldset>
              </div>

              <div className="nc-two">
                <Field label={c.pricePer} help={c.priceHelp} error={errorFor("price")}>
                  <div className="inp">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="15"
                      ref={refs.price}
                      value={f.price}
                      onChange={(e) => { set("price", e.target.value); clearError("price"); }}
                      required
                    />
                    <span className="pre">{t.common.tnd}</span>
                  </div>
                </Field>
                <Field label={c.seats} error={errorFor("seats")}>
                  <div className="inp">
                    <input
                      type="number"
                      min={CLASS_LIMITS.seatsMin}
                      max={CLASS_LIMITS.seatsMax}
                      ref={refs.seats}
                      value={f.seats}
                      onChange={(e) => { set("seats", e.target.value); clearError("seats"); }}
                      required
                      data-e2e="class-seats"
                    />
                  </div>
                </Field>
              </div>
              {quote.promotion && quote.endsAt && (
                <p className="nc-promo" data-e2e="promo-hint">
                  {c.promo(quote.percent, quote.finalTnd, quote.baseTnd, formatNumericDate(quote.endsAt))}
                </p>
              )}

              {/* « 1re séance offerte » — live-fixes-1 · D1. The tutor's own option
                  (Réglages › Vitrine) decides what is shown: OFF, one muted line with the
                  way to switch it on — not a disabled box that looks broken; ON, a real
                  toggle for this class. The API refuses a free-first class while the
                  option is off (free-first-off), whatever the page sends. */}
              {ffOption === true ? (
                <div className="nc-ff-row" data-e2e="free-first-row">
                  <div className="min-w-0 flex-1">
                    <div className="nc-ff-t">{t.createClass.freeFirst}</div>
                    <p id="nc-ff-help" className="nc-ff-h">{c.ffOnHelp}</p>
                  </div>
                  <Switch
                    checked={f.freeFirst}
                    onChange={(v) => set("freeFirst", v)}
                    label={t.createClass.freeFirst}
                    describedBy="nc-ff-help"
                    e2e="free-first-box"
                  />
                </div>
              ) : ffOption === false ? (
                <p className="nc-ff-off" data-e2e="free-first-off">
                  <span>{c.ffOffLine}</span>
                  <span aria-hidden="true"> · </span>
                  <Link href="/dashboard/settings?tab=vitrine#free-first" className="linklike nc-ff-off-a">{c.ffOffCta}</Link>
                </p>
              ) : null}
            </FormSection>

            {/* Folded: most tutors use the room Tnajem opens for them. */}
            <details className="aps-section nc-tools" open={toolsOpen} onToggle={(e) => setToolsOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="aps-section-t nc-tools-sum">
                <span className="aps-section-n" aria-hidden="true">3</span>
                {c.s3}
                <span className="nc-tools-hint">{c.s3Hint}</span>
              </summary>
              <div className="mt-3">
                <Field label={t.tools.videoUrl} error={errorFor("meet-url")}>
                  <div className="inp">
                    <Video />
                    <input type="url" inputMode="url" dir="ltr" placeholder="https://meet.jit.si/…" ref={refs["meet-url"]} value={f.videoUrl}
                      onChange={(e) => { set("videoUrl", e.target.value); clearError("meet-url"); }} />
                  </div>
                </Field>
                <Field label={t.tools.whiteboardUrl} error={errorFor("whiteboard-url")}>
                  <div className="inp">
                    <Board />
                    <input type="url" inputMode="url" dir="ltr" placeholder="https://bitpaper.io/…" ref={refs["whiteboard-url"]} value={f.whiteboardUrl}
                      onChange={(e) => { set("whiteboardUrl", e.target.value); clearError("whiteboard-url"); }} />
                  </div>
                </Field>
                <Field label={t.tools.quizUrl} help={t.tools.hint} error={errorFor("quiz-url")}>
                  <div className="inp">
                    <Quiz />
                    <input type="url" inputMode="url" dir="ltr" placeholder="https://wooclap.com/…" ref={refs["quiz-url"]} value={f.quizUrl}
                      onChange={(e) => { set("quizUrl", e.target.value); clearError("quiz-url"); }} />
                  </div>
                </Field>
              </div>
            </details>
          </div>

          <ClassPreview
            title={f.title}
            wall={f.datetime}
            duration={f.duration}
            price={f.price}
            seats={f.seats}
            level={f.level}
            subject={subject ? subjectLabel(subject, locale) : ""}
            free={f.freeFirst && !ffDisabled}
            promo={quote.promotion ? { finalTnd: quote.finalTnd, percent: quote.percent } : null}
          />
        </div>

        {/* Rule 5: the sticky action bar, INSIDE the form so its submit is the form's. */}
        <ActionBar
          status={
            draftState === "none" ? null : (
              <span className="nc-draft" data-e2e="draft-status">
                {draftState === "saved" ? c.draftSaved : c.draftRestored}
                <button type="button" className="linklike linklike-inline text-[13px]" onClick={startOver}>{c.draftClear}</button>
              </span>
            )
          }
        >
          <Link href="/dashboard/classes" className="btn btn-ghost btn-sm">{c.cancel}</Link>
          <Button type="submit" variant="primary" sm disabled={submitted}>
            {t.createClass.create}
          </Button>
        </ActionBar>
      </form>
      <DuplicateDialog open={dupOpen} onClose={() => setDupOpen(false)} onPick={(id) => void prefillFrom(id)} />
      {toast}
    </AppPage>
  );
}
