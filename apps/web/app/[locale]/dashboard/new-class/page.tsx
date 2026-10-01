"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Video, Board, Quiz } from "@/components/icons";
import { createClass, getClass, getOnboardingState } from "@/app/actions";
import { useToast } from "@/components/useToast";
import { AppPage, Blocker, ActionBar, FormSection } from "@/components/app/AppShell";
import { DateTimeField } from "@/components/app/DatePicker";
import { bilingual } from "@/lib/i18n";
import { LEVEL_CODES, LEVEL_LABELS, isLevelCode, type TutorVerifStatus } from "@tnajem/shared"; // phase-a lane L5 (A18.7)
/* phase-a lane L5 (A18.16): the SAME limits schema POST /classes enforces — the
   form used to say 80 / 240 / 200 while the server said 120 / 480 / 500. */
import { CLASS_LIMITS, checkClassLimits } from "@tnajem/shared/class-input";

/* A tutor must be verified before publishing (enforced server-side in createClass).
   Without a specific message this failure is opaque and unfixable-looking. */
const NOT_VERIFIED_MSG = {
  fr: "Ton profil doit d'abord être vérifié. Va dans « Vérification » pour envoyer tes documents.",
  ar: "لازم بروفايلك يتثبّت الأول. امشي لـ « التثبّت » وابعث وثائقك.",
} as const;

/* Step 8. A class title and description are PUBLIC storefront copy, so contact
   details in them are refused rather than masked — the tutor is on the form and
   can fix it now. The message names the cause; a generic "ça n'a pas marché"
   would leave them re-submitting the same text. */
const CONTACT_INFO_MSG = {
  fr: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées dans une séance. Tes élèves passent par Tnajem.",
  ar: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة في الحصة. تلامذتك يعدّو عبر Tnajem.",
} as const;

/* Step 16. The plan limit refusal NAMES THE NUMBER, because the API sends it
   back. "Tu as atteint la limite de ton offre" with no figure is a dead end for
   the person who would happily move up an offer if they knew what they had hit —
   and the limit counts UPCOMING classes, which is not guessable from the word
   "limite". Nobody sees this during the pilot: every tutor is on `pilot`, which
   has no class limit. */
const PLAN_LIMIT_MSG = {
  fr: (n: number, plan: string) =>
    // phase-a lane L3 (A25): séances (D3) — what the limit counts.
    `Ton offre ${plan} te permet ${n === 1 ? "1 séance publiée" : `${n} séances publiées`} à la fois. Annule une séance à venir, attends qu'elle ait lieu, ou passe à une offre supérieure.`,
  ar: (n: number, plan: string) =>
    `عرضك ${plan} يسمحلك بـ ${n === 1 ? "حصة وحدة منشورة" : `${n} حصص منشورة`} في نفس الوقت. ألغي حصة جاية، ولا استنّاها تكمّل، ولا اطلع لعرض أكبر.`,
} as const;

/* The link that message needs. It used to end with "passe à une offre
   supérieure" and offer no route — and it was shown in a TOAST, which
   useToast renders as a bare string and dismisses after 2800 ms. A tutor who has
   just hit the ceiling is the one person guaranteed to want the comparison, so
   this refusal is rendered inline, stays put, and links. */
const PLAN_LIMIT_CTA = { fr: "Voir les offres", ar: "شوف العروض" } as const;

/* Page-local copy (lib/i18n.ts is shared/read-only). */
const copy = bilingual({
  fr: {
    lead: "Un titre, une date, ton prix. Ta classe apparaît sur ta page, et les élèves réservent en un clic.",
    priceHelp: "Tu fixes ton prix. Tu gardes 100 % pendant le pilote : Tnajem ne prend rien.", // phase-a lane L3 (A22)
    descPh: "ex. Méthodes + annales. On fait 3 exercices types ensemble.",
    // Field refusals from createClass (apps/api/src/routes/classes.ts validators).
    errTitle: "Le titre doit faire au moins 3 caractères.",
    errDescription: "La description ne peut pas dépasser 1000 caractères.",
    errDate: "Choisis une date et une heure valides.",
    errDatePast: "Choisis une date à venir.",
    errDuration: `Choisis une durée entre ${CLASS_LIMITS.durationMin} et ${CLASS_LIMITS.durationMax} minutes.`, // phase-a lane L5 (A18.16)
    errPrice: "Le prix doit être entre 0 et 5000 TND.",
    errSeats: `Choisis entre ${CLASS_LIMITS.seatsMin} et ${CLASS_LIMITS.seatsMax} places.`, // phase-a lane L5 (A18.16)
    errUrl: "Ce lien n'est pas valide : il doit commencer par https://",
    // phase-a lane L5 (A18.6)
    ffOff: "Active d'abord l'option dans tes réglages",
    ffOffErr: "La 1ʳᵉ séance offerte est désactivée dans tes réglages. Active-la d'abord, ou décoche la case.",
    // phase-a lane L5 (A18.7)
    level: "Niveau (optionnel)",
    levelNone: "Tous niveaux",
    errLevel: "Choisis un niveau de la liste.",
    // espace prof v2 · shell — sections, blocker, action bar, duplicate
    s1: "L'essentiel",
    s2: "Date, durée, prix",
    s3: "Outils de la séance",
    bVerifyT: "Fais-toi vérifier",
    bVerifyB: "tu pourras publier ta classe dès que ton compte est vérifié.",
    bVerifyCta: "Vérifier mon compte",
    bPendingT: "Vérification en cours",
    bPendingB: "tu pourras publier ta classe dès qu'elle est validée, en général sous 24–48 h.",
    cancel: "Annuler",
    duplicated: (t: string) => `Copie de « ${t} » : choisis la date de la nouvelle séance.`,
  },
  ar: {
    lead: "عنوان، وقت، وثمنك. الحصة تبان في صفحتك، والتلامذة يحجزو بكليكة.",
    priceHelp: "إنتي تحدّد ثمنك. تحتفظ بـ 100 % في فترة التجربة : Tnajem ما تاخذ والو.", // phase-a lane L3 (A22)
    descPh: "مثال: مناهج + امتحانات. نعملو 3 تمارين نموذجية مع بعضنا.",
    errTitle: "العنوان لازم يكون فيه 3 حروف على الأقل.",
    errDescription: "الوصف ما ينجّمش يفوت 1000 حرف.",
    errDate: "اختار تاريخ ووقت صحاح.",
    errDatePast: "اختار تاريخ جاي.",
    errDuration: `اختار مدّة بين ${CLASS_LIMITS.durationMin} و ${CLASS_LIMITS.durationMax} دقيقة.`, // phase-a lane L5 (A18.16)
    errPrice: "الثمن لازم يكون بين 0 و 5000 د.ت.",
    errSeats: `اختار بين ${CLASS_LIMITS.seatsMin} و ${CLASS_LIMITS.seatsMax} بلاصة.`, // phase-a lane L5 (A18.16)
    errUrl: "الرابط هذا موش صحيح : لازم يبدا بـ https://",
    // phase-a lane L5 (A18.6)
    ffOff: "فعّل الخيار الأول في الإعدادات متاعك",
    ffOffErr: "الحصة الأولى فابور مطفية في الإعدادات متاعك. فعّلها الأول، ولا نحّي العلامة.",
    // phase-a lane L5 (A18.7)
    level: "المستوى (اختياري)",
    levelNone: "المستويات الكل",
    errLevel: "اختار مستوى من الليستة.",
    // espace prof v2 · shell
    s1: "الأساسي",
    s2: "الوقت، المدّة، الثمن",
    s3: "أدوات الحصة",
    bVerifyT: "تثبّت من هويتك",
    bVerifyB: "تنجّم تنشر حصتك أوّل ما حسابك يتثبّت.",
    bVerifyCta: "ثبّت حسابي",
    bPendingT: "التثبّت في الطريق",
    bPendingB: "تنجّم تنشر حصتك أوّل ما يتقبل، عادةً في 24–48 ساعة.",
    cancel: "ارجع",
    duplicated: (t: string) => `نسخة من « ${t} »: اختار وقت الحصة الجديدة.`,
  },
});

/* The fields createClass validates, by the name its error codes use:
   "invalid-price", "price-too-high", "date-in-past", "invalid-meet-url"… */
const CLASS_FIELDS = ["title", "description", "date", "duration", "price", "seats", "meet-url", "whiteboard-url", "quiz-url", "level"] as const; // phase-a lane L5 (A18.7): + level
type ClassField = (typeof CLASS_FIELDS)[number];

/** The field a createClass refusal names, or null when it is not about one field. */
function fieldOf(code: string | undefined): ClassField | null {
  if (!code) return null;
  const name = code.replace(/^(invalid|negative)-/, "").replace(/-(too-long|too-high|in-past)$/, "");
  return (CLASS_FIELDS as readonly string[]).includes(name) ? (name as ClassField) : null;
}

export default function NewClassPage() {
  const { t, locale } = useLocale();
  const c = copy[locale];

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  /* espace prof v2 · shell (rule 6): the wall time from <DateTimeField> — DD/MM/YYYY
     and 24 h on screen, "2026-10-08T18:00" here, read as Tunis time by the API. */
  const [datetime, setDatetime] = useState("");
  const [duration, setDuration] = useState("90");
  const [price, setPrice] = useState("");
  const [seats, setSeats] = useState("20");
  const [level, setLevel] = useState(""); // phase-a lane L5 (A18.7): "" = no level (optional)
  const [videoUrl, setVideoUrl] = useState("");
  const [whiteboardUrl, setWhiteboardUrl] = useState("");
  const [quizUrl, setQuizUrl] = useState("");
  const [freeFirst, setFreeFirst] = useState(false);
  /* phase-a lane L5 (A18.6): the tutor's own free-first option. The per-class box
     only means something while it is on (isEffectivelyFreeFirst), so it is
     disabled — and points at the setting — until it is. null = not known yet. */
  const [ffOption, setFfOption] = useState<boolean | null>(null);
  // espace prof v2 · shell: the verification state, for the blocker at the top (rule 4).
  const [status, setStatus] = useState<TutorVerifStatus | null>(null);
  useEffect(() => {
    let alive = true;
    getOnboardingState()
      .then((s) => {
        if (!alive) return;
        setFfOption(Boolean(s?.offersFreeFirstSession));
        setStatus(s?.status ?? null);
      })
      .catch(() => { if (alive) setFfOption(false); });
    return () => { alive = false; };
  }, []);

  /* espace prof v2 · shell — « Dupliquer » from Mes classes: ?from=<classId> opens
     this form prefilled with that class's title, text, level, duration, price and
     seats. Never its date (the point is a NEW session) and never its room links
     (the copy gets its own room). */
  const [duplicatedFrom, setDuplicatedFrom] = useState<string | null>(null);
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("from");
    if (!from) return;
    let alive = true;
    getClass(from)
      .then((k) => {
        if (!alive || !k) return;
        setTitle(k.title);
        setDesc(k.description ?? "");
        setDuration(String(k.duration_min ?? 90));
        setPrice(String(k.price_tnd));
        setSeats(String(k.seats || 20));
        setLevel(k.level && isLevelCode(k.level) ? k.level : "");
        setDuplicatedFrom(k.title);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const ffDisabled = ffOption !== true;
  const toggleFreeFirst = () => { if (!ffDisabled) setFreeFirst((v) => !v); };
  const [submitted, setSubmitted] = useState(false);
  // Only ever true when the server action itself reports demo mode (no DB).
  const [demo, setDemo] = useState(false);
  /* Not a toast: this one has to persist and carry a link. */
  const [planLimit, setPlanLimit] = useState<{ limit: number; plan: string } | null>(null);
  /* A refusal about ONE field is shown on that field (Field sets aria-invalid +
     aria-describedby) and focus moves to it. It used to be a toast reading "une
     erreur s'est produite", gone in three seconds and pointing at nothing. Empty
     required fields never get this far: the browser's own validation stops them. */
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
    level: useRef<HTMLSelectElement>(null), // phase-a lane L5 (A18.7)
  };
  const errorFor = (field: ClassField) => (fieldError?.field === field ? fieldError.message : undefined);
  const clearError = (field: ClassField) => { if (fieldError?.field === field) setFieldError(null); };
  function messageForField(field: ClassField, code: string): string {
    switch (field) {
      case "title": return c.errTitle;
      case "description": return c.errDescription;
      case "date": return code === "date-in-past" ? c.errDatePast : c.errDate;
      case "duration": return c.errDuration;
      case "price": return c.errPrice;
      case "seats": return c.errSeats;
      case "level": return c.errLevel; // phase-a lane L5 (A18.7)
      default: return c.errUrl;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    /* The custom date field has no native "required": an incomplete date/time is
       refused here, on the field, like any other. */
    if (!datetime) {
      setFieldError({ field: "date", message: c.errDate });
      refs.date.current?.focus();
      return;
    }
    /* phase-a lane L5 (A18.16): the shared schema first — a refusal lands on its
       field before any round trip, with the same code the server would send. */
    const limits = checkClassLimits({
      title, description: desc, durationMin: Number(duration), seats: Number(seats), priceTnd: Number(price),
    });
    if (!limits.ok) {
      const field = fieldOf(limits.error);
      if (field) {
        setFieldError({ field, message: messageForField(field, limits.error) });
        refs[field].current?.focus();
        return;
      }
    }
    setSubmitted(true);
    const res = await createClass({
      title, description: desc, scheduledAt: datetime,
      durationMin: Number(duration), priceTnd: Number(price), seats: Number(seats),
      isFreeFirst: freeFirst && !ffDisabled, meetUrl: videoUrl, whiteboardUrl, quizUrl,
      level: level || null, // phase-a lane L5 (A18.7)
    });
    if (res.ok) {
      setDemo(Boolean(res.demo));
      setPlanLimit(null);
      showToast(res.demo ? `${t.extra.classPublished} · ${t.common.demoMode}` : t.extra.classPublished);
    } else {
      // Server-side validation (past date, negative price, bad URL…) — let them fix it.
      setSubmitted(false);
      if (res.error === "plan-limit-classes" && typeof res.limit === "number") {
        /* The server sends planCode back and the UI used to throw it away. Naming
           the offer is what turns "you hit a limit" into "you hit THIS limit". */
        setPlanLimit({ limit: res.limit, plan: res.planCode ?? "" });
        return;
      }
      setPlanLimit(null);
      const field = fieldOf(res.error);
      if (field && res.error) {
        setFieldError({ field, message: messageForField(field, res.error) });
        refs[field].current?.focus();
        return;
      }
      showToast(
        res.error === "not-verified" ? NOT_VERIFIED_MSG[locale]
          : res.error === "contact-info-not-allowed" ? CONTACT_INFO_MSG[locale]
          : res.error === "free-first-off" ? c.ffOffErr // phase-a lane L5 (A18.6)
          : t.extra.error,
      );
    }
  }
  const { toast, showToast } = useToast();

  /* Rule 4: the verification blocker at the TOP, before the tutor fills anything in
     (it used to be a line under the submit button). */
  const blocker =
    status === "draft" || status === "rejected" ? (
      <Blocker title={c.bVerifyT} action={{ href: "/onboarding/verify", label: c.bVerifyCta }}>{c.bVerifyB}</Blocker>
    ) : status === "pending" ? (
      <Blocker title={c.bPendingT}>{c.bPendingB}</Blocker>
    ) : null;

  return (
    <AppPage
      title={t.createClass.title}
      subtitle={c.lead}
      blockers={blocker}
      note={duplicatedFrom ? c.duplicated(duplicatedFrom) : undefined}
      width="narrow"
    >
      <form onSubmit={handleSubmit} className="nc-form">
        {planLimit && (
          <div
            role="alert"
            className="panel panel-pad mb-4"
            style={{ borderColor: "var(--ochre)", background: "var(--ochre-tint)" }}
          >
            <p className="text-[13.5px] leading-relaxed text-ink2 mb-3">
              {PLAN_LIMIT_MSG[locale](planLimit.limit, planLimit.plan)}
            </p>
            <Link href="/tarifs" className="btn btn-ghost btn-sm w-auto">
              {PLAN_LIMIT_CTA[locale]}
            </Link>
          </div>
        )}

        <FormSection n={1} title={c.s1} id="nc-s1">
          {/* Title */}
          <Field label={t.createClass.name} error={errorFor("title")}>
            <div className="inp">
              <input
                type="text"
                placeholder={t.createClass.namePh}
                ref={refs.title}
                value={title}
                onChange={(e) => { setTitle(e.target.value); clearError("title"); }}
                required
                maxLength={CLASS_LIMITS.titleMax} /* phase-a lane L5 (A18.16) */
              />
            </div>
          </Field>

          {/* Description */}
          <Field label={t.createClass.desc} error={errorFor("description")}>
            <div className="inp items-start">
              <textarea
                rows={3}
                placeholder={c.descPh}
                ref={refs.description}
                value={desc}
                onChange={(e) => { setDesc(e.target.value); clearError("description"); }}
                style={{ resize: "vertical", minHeight: 80 }}
              />
            </div>
          </Field>

          {/* phase-a lane L5 (A18.7): an optional level for this class, as a code. */}
          <Field label={c.level} error={errorFor("level")}>
            <div className="inp">
              <select
                ref={refs.level}
                value={level}
                onChange={(e) => { setLevel(e.target.value); clearError("level"); }}
                data-e2e="class-level"
                className="min-w-0 flex-1 bg-transparent"
              >
                <option value="">{c.levelNone}</option>
                {LEVEL_CODES.map((code) => (
                  <option key={code} value={code}>{LEVEL_LABELS[code][locale]}</option>
                ))}
              </select>
            </div>
          </Field>
        </FormSection>

        <FormSection n={2} title={c.s2} id="nc-s2">
          {/* espace prof v2 · shell (rule 6): DD/MM/YYYY + 24 h, never the native picker. */}
          <div className="mb-3.5">
            <DateTimeField
              value={datetime}
              onChange={(w) => { setDatetime(w); clearError("date"); }}
              error={errorFor("date")}
              dateRef={refs.date}
              required
            />
          </div>

          {/* Duration + Price — stack on mobile, side-by-side ≥480px */}
          <div className="flex flex-wrap gap-2.5">
            <div className="flex-[1_1_140px] min-w-0">
              <Field label={t.createClass.duration} error={errorFor("duration")}>
                <div className="inp">
                  <input
                    type="number"
                    min={CLASS_LIMITS.durationMin}
                    max={CLASS_LIMITS.durationMax} /* phase-a lane L5 (A18.16) */
                    step={15}
                    ref={refs.duration}
                    value={duration}
                    onChange={(e) => { setDuration(e.target.value); clearError("duration"); }}
                    required
                  />
                  <span className="pre">{t.common.min}</span>
                </div>
              </Field>
            </div>
            <div className="flex-[1_1_140px] min-w-0">
              <Field label={t.createClass.price} help={c.priceHelp} error={errorFor("price")}>
                <div className="inp">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    placeholder="15"
                    ref={refs.price}
                    value={price}
                    onChange={(e) => { setPrice(e.target.value); clearError("price"); }}
                    required
                  />
                  <span className="pre">{t.common.tnd}</span>
                </div>
              </Field>
            </div>
          </div>

          {/* Seats */}
          <Field label={t.createClass.seats} error={errorFor("seats")}>
            <div className="inp">
              <input
                type="number"
                min={CLASS_LIMITS.seatsMin}
                max={CLASS_LIMITS.seatsMax} /* phase-a lane L5 (A18.16) */
                ref={refs.seats}
                value={seats}
                onChange={(e) => { setSeats(e.target.value); clearError("seats"); }}
                required
              />
            </div>
          </Field>

          {/* Free-first checkbox — phase-a lane L5 (A18.6): disabled while the
              tutor's own option is off, with the way to switch it on. */}
          <div
            className="card"
            role="checkbox"
            aria-checked={freeFirst && !ffDisabled}
            aria-disabled={ffDisabled}
            aria-label={t.createClass.freeFirst}
            aria-describedby={ffDisabled && ffOption !== null ? "ff-off-note" : undefined}
            data-e2e="free-first-box"
            tabIndex={ffDisabled ? -1 : 0}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggleFreeFirst();
              }
            }}
            onClick={toggleFreeFirst}
            style={{
              padding: "14px 16px",
              marginBottom: ffDisabled ? 8 : 4,
              display: "flex",
              alignItems: "center",
              gap: 14,
              cursor: ffDisabled ? "not-allowed" : "pointer",
              opacity: ffDisabled ? 0.6 : 1,
              border: freeFirst && !ffDisabled ? "2px solid var(--blue)" : "1px solid var(--line)", // Phase A+ (U1): a selected state is cobalt
              background: freeFirst && !ffDisabled ? "var(--blue50)" : "var(--paper)",
              transition: ".15s",
            }}
          >
            {/* Custom checkbox tick */}
            <div
              style={{
                width: 22,
                height: 22,
                minWidth: 22,
                borderRadius: 7,
                border: freeFirst && !ffDisabled ? "none" : "2px solid var(--line)",
                background: freeFirst && !ffDisabled ? "var(--blue)" : "transparent",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                transition: ".15s",
              }}
            >
              {freeFirst && !ffDisabled && (
                <svg viewBox="0 0 24 24" width="14" height="14" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="5 13 10 18 19 7" />
                </svg>
              )}
            </div>
            <div>
              <div className="text-[14px] font-semibold">{t.createClass.freeFirst}</div>
              <div className="text-[13px] text-muted mt-0.5">
                {t.common.free1st}
              </div>
            </div>
          </div>
          {/* phase-a lane L5 (A18.6): where to switch the option on — /account
              since espace prof v2 (Réglages › Vitrine in phase 6). */}
          {ffDisabled && ffOption !== null && (
            <p id="ff-off-note" data-e2e="free-first-off" className="text-[13px] text-muted leading-[1.5]">
              <Link href="/account#free-first" className="linklike text-[13px]">{c.ffOff}</Link>
            </p>
          )}
        </FormSection>

        <FormSection n={3} title={c.s3} id="nc-s3">
          <div className="flex items-center gap-2 mb-3.5 text-ink2 font-bold text-[13px]">
            <Video className="w-4 h-4 text-blue" />
            {t.tools.setLinks}
          </div>

          <Field label={t.tools.videoUrl} error={errorFor("meet-url")}>
            <div className="inp">
              {/* Size, colour, flex:none and centring come from `.inp > .ic` (globals.css). */}
              <Video />
              <input
                type="url"
                inputMode="url"
                /* dir="ltr" — a Latin URL in an RTL field renders mirrored. */
                dir="ltr"
                placeholder="https://meet.jit.si/…"
                ref={refs["meet-url"]}
                value={videoUrl}
                onChange={(e) => { setVideoUrl(e.target.value); clearError("meet-url"); }}
              />
            </div>
          </Field>

          <Field label={t.tools.whiteboardUrl} error={errorFor("whiteboard-url")}>
            <div className="inp">
              <Board />
              <input
                type="url"
                inputMode="url"
                /* dir="ltr" — a Latin URL in an RTL field renders mirrored. */
                dir="ltr"
                placeholder="https://bitpaper.io/…"
                ref={refs["whiteboard-url"]}
                value={whiteboardUrl}
                onChange={(e) => { setWhiteboardUrl(e.target.value); clearError("whiteboard-url"); }}
              />
            </div>
          </Field>

          <Field label={t.tools.quizUrl} help={t.tools.hint} error={errorFor("quiz-url")}>
            <div className="inp">
              <Quiz />
              <input
                type="url"
                inputMode="url"
                /* dir="ltr" — a Latin URL in an RTL field renders mirrored. */
                dir="ltr"
                placeholder="https://wooclap.com/…"
                ref={refs["quiz-url"]}
                value={quizUrl}
                onChange={(e) => { setQuizUrl(e.target.value); clearError("quiz-url"); }}
              />
            </div>
          </Field>
        </FormSection>

        {/* Rule 5: the sticky action bar, INSIDE the form so its submit is the form's. */}
        <ActionBar status={demo ? t.common.demoMode : null}>
          <Link href="/dashboard/classes" className="btn btn-ghost btn-sm">{c.cancel}</Link>
          <Button type="submit" variant="primary" sm disabled={submitted}>
            {t.createClass.create}
          </Button>
        </ActionBar>
      </form>
      {toast}
    </AppPage>
  );
}
