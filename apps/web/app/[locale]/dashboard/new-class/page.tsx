"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Back, Video, Board, Quiz, Shield } from "@/components/icons";
import { createClass, getOnboardingState } from "@/app/actions";
import { useToast } from "@/components/useToast";
import { SiteShell } from "@/components/SiteShell";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { bilingual } from "@/lib/i18n";
import { LEVEL_CODES, LEVEL_LABELS } from "@tnajem/shared"; // phase-a lane L5 (A18.7)
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
    // The API reads the typed time as Tunis time, wherever the tutor is (packages/shared/src/time.ts).
    dateHelp: "Heure de Tunisie.",
    verifNote: "Ta classe se publie une fois ton compte vérifié.",
    verifCta: "Vérifier mon compte",
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
  },
  ar: {
    lead: "عنوان، وقت، وثمنك. الحصة تبان في صفحتك، والتلامذة يحجزو بكليكة.",
    priceHelp: "إنتي تحدّد ثمنك. تحتفظ بـ 100 % في فترة التجربة : Tnajem ما تاخذ والو.", // phase-a lane L3 (A22)
    dateHelp: "بتوقيت تونس.",
    verifNote: "الحصة تتنشر كي يتثبّت حسابك.",
    verifCta: "ثبّت حسابي",
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
  useEffect(() => {
    let alive = true;
    getOnboardingState()
      .then((s) => { if (alive) setFfOption(Boolean(s?.offersFreeFirstSession)); })
      .catch(() => { if (alive) setFfOption(false); });
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

  return (
    <SiteShell>
      <section className="web-section tight">
        <div className="container">
          <div className="app-layout">
            {/* This page does not fetch getDashboard(), so the flag is not in scope.
                Hardcoded false is correct while payments are off; when PAYMENTS_ENABLED
                ships, thread the real flag here (grep: DashboardSidebar paymentsEnabled={false}). */}
            <DashboardSidebar paymentsEnabled={false} />

            {/* Main content column */}
            <div className="min-w-0">
              {/* Page header */}
              <div className="flex items-center gap-3 mb-[clamp(18px,3vw,28px)]">
                <Link href="/dashboard" className="iconbtn flex-none" aria-label={t.common.back}>
                  <Back />
                </Link>
                <h1 className="font-display text-[clamp(20px,2.6vw,28px)] tracking-[-0.6px] text-ink min-w-0">
                  {t.createClass.title}
                </h1>
              </div>

              {/* Form card — max-width centers comfortably at 1280px */}
              <div className="panel panel-pad max-w-[620px] w-full">
                <p className="text-[13.5px] text-ink2 leading-[1.6] mb-4">
                  {c.lead}
                </p>
                <form onSubmit={handleSubmit}>
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

                  {/* Date & time */}
                  <Field label={t.createClass.date} help={c.dateHelp} error={errorFor("date")}>
                    <div className="inp">
                      <input
                        type="datetime-local"
                        ref={refs.date}
                        value={datetime}
                        onChange={(e) => { setDatetime(e.target.value); clearError("date"); }}
                        required
                        style={{ colorScheme: "light" }}
                      />
                    </div>
                  </Field>

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

                  {/* Teaching tools section */}
                  <div style={{
                    borderTop: "1px solid var(--line)",
                    marginTop: 6,
                    marginBottom: 18,
                    paddingTop: 18,
                  }}>
                    <div className="flex items-center gap-2 mb-3.5 text-ink2 font-bold text-[13px] uppercase tracking-[0.5px]">
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
                  </div>

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
                      marginBottom: ffDisabled ? 8 : 20,
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
                  {/* phase-a lane L5 (A18.6): where to switch the option on. */}
                  {ffDisabled && ffOption !== null && (
                    <p id="ff-off-note" data-e2e="free-first-off" className="text-[13px] text-muted mb-5 leading-[1.5]">
                      <Link href="/dashboard#free-first" className="linklike text-[13px]">{c.ffOff}</Link>
                    </p>
                  )}

                  {/* Submit */}
                  <Button type="submit" variant="primary" disabled={submitted}>
                    {t.createClass.create}
                  </Button>

                  {/* Publishing needs a verified profile (server-side rule) — say it
                      BEFORE they submit instead of only failing afterwards. */}
                  <p className="flex items-center justify-center gap-1.5 flex-wrap text-[13px] text-muted mt-3 leading-[1.5]">
                    <Shield className="w-3.5 h-3.5 flex-none" />
                    {c.verifNote}
                    <Link href="/onboarding/verify" className="linklike text-[13px]">
                      {c.verifCta}
                    </Link>
                  </p>

                  {/* Shown ONLY when the server action reports demo mode (no DB connected). */}
                  {demo && (
                    <p className="text-center text-[13px] text-muted mt-3 leading-[1.5]">
                      {t.common.demoMode}
                    </p>
                  )}
                </form>
              </div>
            </div>
            {/* end main column */}
          </div>
        </div>
      </section>
      {toast}
    </SiteShell>
  );
}
