"use client";
/* /student/welcome — the student half of onboarding.

   IT DID NOT EXIST. A student gave a phone number and a birth year and went
   straight into the product, so `profiles.full_name` was null for every student,
   forever — nothing else ever wrote it (createTutor was the only writer). Three
   surfaces lied as a direct result:

     • the tutor's booking list showed "Élève" plus a raw phone number as the ONLY
       handle they had on a child they were about to teach
     • the new_booking notification read "Un élève a réservé …", always
     • public reviews shipped with no author (publicName(null) → null)

   So this screen is not decoration for symmetry with the tutor flow. It is the
   step that makes the tutor's side of the product tell the truth.

   IT IS SKIPPABLE, deliberately. It sits between logging in and using the product,
   and a student who arrived here mid-booking (?next=/checkout?class=x) must never
   lose that booking to an onboarding screen. Skipping keeps ?next= and asks again
   on the next login (verifyOtp recomputes needsProfile every time). */
import { useRef, useState } from "react";
import { useLocalizedRouter } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { ProgressSteps } from "@/components/ProgressSteps";
import type { ProgressSeg } from "@/components/ProgressSteps";
import { useLocale } from "@/components/LocaleProvider";
import { User, Book, Phone } from "@/components/icons";
import { saveStudentProfile } from "@/app/actions";
import { SiteShell } from "@/components/SiteShell";
import { Select, SelectField } from "@/components/app/Select";
import { STUDENT_LEVELS } from "@tnajem/shared";
import { subjectLabel, normalizeSubjects, type SubjectCode } from "@tnajem/shared"; // phase-a lane L5 (A18.12)
import type { StudentLevel, StudentProfile } from "@tnajem/shared";

const COPY = {
  fr: {
    steps: ["Ton compte", "Ton profil", "Ta 1ʳᵉ séance"],
    progressLabel: "Progression de ton inscription",
    stepOf: (a: number, b: number) => `Étape ${a} sur ${b}`,

    title: "Bienvenue — dis-nous qui tu es",
    lead: "Deux champs. Ton prof voit ton nom quand tu réserves, et on te propose les bons profs.",

    name: "Ton prénom et ton nom",
    namePh: "ex. Amine Karoui",
    nameHelp: "Ton prof voit ton prénom quand tu réserves — rien d'autre. Ton numéro et ton email ne lui sont jamais montrés.",

    level: "Ton niveau",
    levelPh: "Choisir…",

    phone: "Ton numéro (optionnel)",
    phonePh: "+216 …",
    // phase-a A3: the number is Tnajem's, for reminders — never the tutor's way to reach you.
    phoneHelp: "Uniquement pour les rappels de Tnajem sur tes séances. Ton prof ne le voit jamais.",
    errPhone: "Ce numéro n'est pas valide.",

    subjects: "Les matières qui t'intéressent",
    subjectsHelp: "Optionnel. Choisis-en autant que tu veux.",

    save: "Continuer",
    saving: "Enregistrement…",
    skip: "Plus tard",

    errName: "Écris ton prénom et ton nom (2 caractères minimum).",
    errAuth: "Ta session a expiré. Reconnecte-toi.",
    errGeneric: "L'enregistrement n'a pas marché. Réessaie.",
  },
  ar: {
    steps: ["حسابك", "بروفايلك", "أول حصة"],
    progressLabel: "تقدّم التسجيل متاعك",
    stepOf: (a: number, b: number) => `مرحلة ${a} من ${b}`,

    title: "مرحبا — قلّنا شكون إنتي",
    lead: "زوز خانات. أستاذك يشوف اسمك كي تحجز، وأحنا نقترحولك الأساتذة اللي يلزموك.",

    name: "اسمك ولقبك",
    namePh: "مثال: أمين القروي",
    nameHelp: "أستاذك يشوف إسمك الأول كي تحجز — والو أكثر. نمرتك والإيميل متاعك عمرهم ما يتورّاولو.",

    level: "مستواك",
    levelPh: "اختر…",

    phone: "نمرتك (اختياري)",
    phonePh: "+216 …",
    phoneHelp: "نستعملوها كان باش Tnajem تفكّرك بحصصك. أستاذك عمرو ما يشوفها.",
    errPhone: "هذي النمرة موش صحيحة.",

    subjects: "المواد اللي تهمّك",
    subjectsHelp: "اختياري. اختار قدّ ما تحب.",

    save: "كمّل",
    saving: "قاعد يتسجّل…",
    skip: "من بعد",

    errName: "اكتب اسمك ولقبك (حرفين على الأقل).",
    errAuth: "الجلسة متاعك سالات. عاود ادخل.",
    errGeneric: "التسجيل ما مشاش. عاود حاول.",
  },
} as const;

/* Labels for the closed level set in lib/types.ts (STUDENT_LEVELS). The Tunisian
   school ladder, in order — not alphabetical. */
const LEVEL_LABEL: Record<StudentLevel, { fr: string; ar: string }> = {
  primaire: { fr: "Primaire", ar: "ابتدائي" },
  college: { fr: "Collège", ar: "إعدادي" },
  lycee: { fr: "Lycée", ar: "ثانوي" },
  bac: { fr: "Bac", ar: "باكالوريا" },
  superieur: { fr: "Supérieur", ar: "جامعي" },
  autre: { fr: "Autre", ar: "أخرى" },
};

/* Suggestions only — saveStudentProfile accepts any bounded strings, so this list
   can grow without a migration. Kept short so it stays scannable on a 320px phone. */
/* phase-a lane L5 (A18.12): the chips carry CANONICAL CODES (@tnajem/shared
   subjects.ts) and only their label is translated. They used to store the label
   in the page's language, so one student's subjects read "Maths,فيزياء". */
const SUBJECTS: readonly SubjectCode[] = [
  "math", "physique", "svt", "francais", "anglais", "arabe", "histoire-geo", "philosophie", "informatique", "economie",
];

// saveStudentProfile caps the list at 8; stop the user at the same number rather
// than silently dropping their last choices on the server.
const MAX_SUBJECTS = 8;

export function StudentWelcomeInner({
  next,
  initial,
}: {
  next: string | null;
  initial: StudentProfile;
}) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const router = useLocalizedRouter();

  const [name, setName] = useState(initial.fullName ?? "");
  const [level, setLevel] = useState<string>(initial.level ?? "");
  const [subjects, setSubjects] = useState<string[]>(normalizeSubjects(initial.subjects)); // phase-a lane L5 (A18.12): legacy labels → codes
  /* Optional number. Signup is by email now, so this is where a student's phone is
     collected — for Tnajem's own reminders (SMS), and NEVER shown to the tutor:
     the zero-contact rule (Step 8) holds for students too (phase-a A3). */
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Where they go once this screen is done — the booking they were mid-way through,
  // or their own home. Already sanitised by safeNext() in the server shell.
  const done = next ?? "/student";

  function toggleSubject(s: string) {
    setSubjects((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= MAX_SUBJECTS ? cur : [...cur, s],
    );
  }

  /* A problem with one field goes ON that field (Field sets aria-invalid +
     aria-describedby) and focus moves to it; `error` is for everything else. */
  const [fieldError, setFieldError] = useState<{ field: "name" | "phone"; message: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  function invalid(field: "name" | "phone", message: string) {
    setError(null);
    setFieldError({ field, message });
    (field === "name" ? nameRef : phoneRef).current?.focus();
  }

  async function handleSave() {
    if (saving) return;
    if (name.trim().length < 2) { invalid("name", c.errName); return; }
    setSaving(true);
    setError(null);
    setFieldError(null);
    let res: Awaited<ReturnType<typeof saveStudentProfile>>;
    try {
      res = await saveStudentProfile({ fullName: name, level: level || null, subjects, phone: phone || null });
    } catch {
      // Network hiccup on 3G — never leave the button stuck on "Enregistrement…".
      setSaving(false);
      setError(c.errGeneric);
      return;
    }
    setSaving(false);
    if (res.ok) { router.push(done); return; }
    if (res.error === "not-authenticated") setError(c.errAuth);
    else if (res.error === "invalid-phone") invalid("phone", c.errPhone);
    else setError(c.errGeneric);
  }

  /* Step 1 (the account) is done — they are signed in and reading this. Step 3 is
     the first booking, which lives on /explore. */
  const segs: ProgressSeg[] = c.steps.map((short, i) => ({
    key: String(i),
    short,
    tone: i === 0 ? "done" : i === 1 ? "active" : "todo",
  }));

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow flex justify-center">
          <div className="panel panel-pad rise w-full max-w-[520px] min-w-0">
            <ProgressSteps
              label={c.progressLabel}
              segs={segs}
              current={2}
              valueText={`${c.stepOf(2, segs.length)} — ${c.steps[1]}`}
            />

            <h1 className="font-display text-[clamp(22px,_4vw,_28px)] tracking-[-0.6px] mb-1.5 text-ink">
              {c.title}
            </h1>
            <p className="text-[13.5px] text-muted mb-6 leading-[1.55]">{c.lead}</p>

            <Field label={c.name} help={c.nameHelp} error={fieldError?.field === "name" ? fieldError.message : undefined}>
              <div className="inp" style={name ? { borderColor: "var(--blue)" } : undefined}>
                <User className="" />
                <input
                  type="text"
                  placeholder={c.namePh}
                  ref={nameRef}
                  value={name}
                  onChange={(e) => { setName(e.target.value); if (fieldError?.field === "name") setFieldError(null); }}
                  autoComplete="name"
                  maxLength={80}
                  className="min-w-0"
                />
              </div>
            </Field>

            {/* live-fixes-2 · C: the shell's Select, not a native <select> (the browser's
                own list, in the system's language). Same state: "" (no level — still a
                choice, as it was) or a STUDENT_LEVELS code. */}
            <SelectField label={c.level} className="lf-mark-set">
              {({ labelId }) => (
                <Select
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: "", label: c.levelPh },
                    ...STUDENT_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l][locale] })),
                  ]}
                  labelledBy={labelId}
                  placeholder={c.levelPh}
                  icon={<Book />}
                  e2e="welcome-level"
                />
              )}
            </SelectField>

            <Field label={c.phone} help={c.phoneHelp} error={fieldError?.field === "phone" ? fieldError.message : undefined}>
              <div className="inp" style={phone ? { borderColor: "var(--blue)" } : undefined}>
                <Phone className="" />
                <input
                  type="tel"
                  dir="ltr"
                  placeholder={c.phonePh}
                  ref={phoneRef}
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); if (fieldError?.field === "phone") setFieldError(null); }}
                  inputMode="tel"
                  autoComplete="tel"
                  className="min-w-0"
                />
              </div>
            </Field>

            {/* Subjects — a real group, not a pile of buttons: screen readers get
                the label and the pressed state of each chip. */}
            <div className="field">
              <span className="field-label" id="sw-subjects-label">{c.subjects}</span>
              <div role="group" aria-labelledby="sw-subjects-label" className="flex flex-wrap gap-2 mt-1">
                {/* phase-a lane L5 (A18.12): the codes, plus any stored value that maps to
                    no code (kept, shown as typed, still removable). */}
                {[...SUBJECTS, ...subjects.filter((v) => !(SUBJECTS as readonly string[]).includes(v))].map((s) => {
                  const label = subjectLabel(s, locale);
                  const on = subjects.includes(s);
                  const full = !on && subjects.length >= MAX_SUBJECTS;
                  return (
                    <button
                      key={s}
                      type="button"
                      data-subject={s}
                      onClick={() => toggleSubject(s)}
                      aria-pressed={on}
                      disabled={full}
                      className={`min-h-[44px] px-3.5 rounded-[999px] text-[13.5px] font-semibold border transition-colors ${
                        on
                          ? "border-blue bg-blue50 text-blue"
                          : "border-line bg-paper text-ink2 hover:border-blue disabled:opacity-50 disabled:hover:border-line"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="help">{c.subjectsHelp}</div>
            </div>

            {error && (
              <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start">
                {error}
              </p>
            )}

            {/* Live, not disabled: handleSave() explains what is missing. */}
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? c.saving : c.save}
            </Button>

            {/* The escape hatch. A booking must never be lost to an onboarding
                screen — `done` carries ?next= either way. */}
            <div className="text-center mt-3.5">
              <button
                type="button"
                onClick={() => router.push(done)}
                className="linklike bg-transparent border-0 text-[13px] min-h-[44px] min-w-[44px] font-[inherit]"
              >
                {c.skip}
              </button>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
