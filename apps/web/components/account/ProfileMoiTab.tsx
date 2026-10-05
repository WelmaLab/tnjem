"use client";
import { useRef, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Field } from "@/components/ui";
import { Phone, User } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { saveMyProfile } from "@/app/actions-student";
import {
  STUDENT_LEVELS, SUBJECT_CODES, formatPhone, normalizeSubjects, subjectLabel,
  type StudentLevel,
} from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* Profil › MOI — student-space-v1 · F (mockup 4a).

   First name, last name, level (one choice), the subjects that interest the student
   (several, the same subject codes as the profs'), the phone — saved through the SAME
   endpoint and validator as the welcome screen (POST /profile/student,
   parseStudentProfile): the name is « Prénom Nom » in profiles.full_name, the level a
   STUDENT_LEVELS code, the subjects canonical codes, the phone normalised and checked.
   The phone is shown grouped the way it is said (+216 97 029 699). Saving says so in a
   toast that sits above any bar (useToast). Level and subjects feed Accueil's
   suggestions. The photo: initials only — the student profile has no photo (a
   moderated photo exists for profs only). */

const copy = bilingual({
  fr: {
    first: "Prénom",
    last: "Nom",
    nameHelp: "Ton prof voit ton prénom seulement, jamais ton nom ni tes coordonnées.",
    level: "Mon niveau",
    subjects: "Matières qui m'intéressent",
    subjectsHelp: "Choisis-en jusqu'à 8.",
    phone: "Téléphone (pour les rappels)",
    phonePh: "+216 …",
    phoneHelp: "Uniquement pour les rappels de Tnajem sur tes séances. Ton prof ne le voit jamais.",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Ton profil est enregistré.",
    errName: "Écris ton prénom (et ton nom) : 2 caractères minimum.",
    errPhone: "Ce numéro n'est pas valide.",
    errPhoneTaken: "Ce numéro est déjà utilisé par un autre compte.",
    errAuth: "Ta session a expiré. Reconnecte-toi.",
    errGeneric: "L'enregistrement n'a pas marché. Réessaie.",
    photo: "Ta photo : tes initiales pour l'instant.",
    feeds: "Ton niveau et tes matières servent à te proposer des profs dans « Accueil ».",
    levels: { primaire: "Primaire", college: "Collège", lycee: "Lycée", bac: "Bac", superieur: "Université", autre: "Autre" } as Record<StudentLevel, string>,
  },
  ar: {
    first: "الإسم",
    last: "اللقب",
    nameHelp: "أستاذك يشوف إسمك الأول برك، عمرو ما يشوف لقبك ولا معلومات الاتصال متاعك.",
    level: "مستوايا",
    subjects: "المواد اللي تهمّني",
    subjectsHelp: "اختار حتى 8.",
    phone: "التليفون (للتذكيرات)",
    phonePh: "+216 …",
    phoneHelp: "نستعملوه كان باش Tnajem تفكّرك بحصصك. أستاذك عمرو ما يشوفو.",
    save: "سجّل",
    saving: "قاعد يتسجّل…",
    saved: "البروفايل متاعك تسجّل.",
    errName: "اكتب إسمك (ولقبك) : حرفين على الأقل.",
    errPhone: "هذي النمرة موش صحيحة.",
    errPhoneTaken: "النمرة هاذي مستعملة في حساب آخر.",
    errAuth: "الجلسة متاعك سالات. عاود ادخل.",
    errGeneric: "التسجيل ما مشاش. عاود حاول.",
    photo: "تصويرتك : الحروف الأولى من إسمك لتوّا.",
    feeds: "مستواك والمواد متاعك يعاونونا باش نقترحولك أساتذة في « الرئيسية ».",
    levels: { primaire: "ابتدائي", college: "إعدادي", lycee: "ثانوي", bac: "باكالوريا", superieur: "جامعة", autre: "أخرى" } as Record<StudentLevel, string>,
  },
});

const MAX_SUBJECTS = 8;

export type MoiInitial = { fullName: string | null; level: string | null; subjects: string | null; phone: string | null };

/** « Amine Ben Ali » → first « Amine », last « Ben Ali ». */
function splitName(full: string | null): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function ProfileMoiTab({ initial, onSaved }: { initial: MoiInitial; onSaved: (fullName: string) => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
  const start = splitName(initial.fullName);
  const [first, setFirst] = useState(start.first);
  const [last, setLast] = useState(start.last);
  const [level, setLevel] = useState<string>(initial.level ?? "");
  const [subjects, setSubjects] = useState<string[]>(normalizeSubjects((initial.subjects ?? "").split(",")));
  const [phone, setPhone] = useState(formatPhone(initial.phone));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<{ field: "name" | "phone" | null; text: string } | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);

  const all = [...SUBJECT_CODES, ...subjects.filter((s) => !(SUBJECT_CODES as readonly string[]).includes(s))];

  function toggle(s: string) {
    setSubjects((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : cur.length >= MAX_SUBJECTS ? cur : [...cur, s]));
  }

  function invalid(field: "name" | "phone", text: string) {
    setErr({ field, text });
    (field === "name" ? firstRef : phoneRef).current?.focus();
  }

  async function save() {
    if (saving) return;
    const fullName = `${first.trim()} ${last.trim()}`.trim();
    if (fullName.length < 2 || !first.trim()) return invalid("name", c.errName);
    setSaving(true);
    setErr(null);
    let res: Awaited<ReturnType<typeof saveMyProfile>>;
    try {
      res = await saveMyProfile({ fullName, level: level || null, subjects, phone: phone.trim() || null });
    } catch {
      setSaving(false);
      setErr({ field: null, text: c.errGeneric });
      return;
    }
    setSaving(false);
    if (res.ok) {
      setPhone(formatPhone(phone.trim()));
      showToast(c.saved);
      onSaved(fullName);
      return;
    }
    if (res.error === "invalid-phone") invalid("phone", c.errPhone);
    else if (res.error === "phone-unavailable") invalid("phone", c.errPhoneTaken);
    else if (res.error === "not-authenticated") setErr({ field: null, text: c.errAuth });
    else if (res.error && /name/.test(res.error)) invalid("name", c.errName);
    else setErr({ field: null, text: c.errGeneric });
  }

  return (
    <section className="u-card st-card ssv-moi" data-e2e="profile-moi">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <div className="ssv-moi-names">
          <Field label={c.first} error={err?.field === "name" ? err.text : undefined}>
            <div className="inp">
              <User />
              <input ref={firstRef} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" maxLength={40} data-e2e="moi-first" />
            </div>
          </Field>
          <Field label={c.last}>
            <div className="inp">
              <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" maxLength={40} data-e2e="moi-last" />
            </div>
          </Field>
        </div>
        <p className="help ssv-moi-help">{c.nameHelp}</p>

        <div className="field">
          <span className="field-label" id="moi-level-label">{c.level}</span>
          <div role="group" aria-labelledby="moi-level-label" className="ssv-pills" data-e2e="moi-levels">
            {STUDENT_LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={level === l}
                className={level === l ? "ssv-pill is-on" : "ssv-pill"}
                onClick={() => setLevel(level === l ? "" : l)}
                data-level={l}
              >
                {c.levels[l]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label" id="moi-subjects-label">{c.subjects}</span>
          <div role="group" aria-labelledby="moi-subjects-label" aria-describedby="moi-subjects-help" className="ssv-pills" data-e2e="moi-subjects">
            {all.map((s) => {
              const on = subjects.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && subjects.length >= MAX_SUBJECTS}
                  className={on ? "ssv-pill is-on" : "ssv-pill"}
                  onClick={() => toggle(s)}
                  data-subject={s}
                >
                  {subjectLabel(s, locale)}
                </button>
              );
            })}
          </div>
          <div className="help" id="moi-subjects-help">{c.subjectsHelp}</div>
        </div>

        <Field label={c.phone} help={c.phoneHelp} error={err?.field === "phone" ? err.text : undefined}>
          <div className="inp">
            <Phone />
            <input
              ref={phoneRef}
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              placeholder={c.phonePh}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhone((p) => formatPhone(p))}
              data-e2e="moi-phone"
            />
          </div>
        </Field>

        {err && !err.field ? <p role="alert" className="ssv-err">{err.text}</p> : null}
        <div className="ssv-moi-actions">
          <p className="ssv-muted">{c.photo}</p>
          <button type="submit" className="btn btn-primary btn-sm" disabled={saving} data-e2e="moi-save">
            {saving ? c.saving : c.save}
          </button>
        </div>
      </form>
      <p className="ssv-muted ssv-moi-feeds">{c.feeds}</p>
      {toast}
    </section>
  );
}
