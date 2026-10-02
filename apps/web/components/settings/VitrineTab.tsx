"use client";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { Field } from "@/components/ui";
import { createTutor } from "@/app/actions";
import { AvatarUpload } from "@/components/dashboard/AvatarUpload";
import { FreeFirstToggle } from "@/components/account/FreeFirstToggle";
import { CopyLinkButton } from "@/components/app/CopyLinkButton";
import { ShareButton } from "@/components/share/ShareButton"; // espace prof v2 · growth (P3), contract C3
import { EmptyState } from "@/components/app/AppShell";
import { pageUrl, shownUrl } from "@/components/app/links";
import { Store } from "@/components/icons";
import { editableSubject, initials, LEVEL_CODES, LEVEL_LABELS, sortLevels, subjectToSave, type LevelCode } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import type { SettingsData } from "./SettingsView";

/* Réglages › Vitrine — the public page's own settings: its address, the photo, what
   the page says (name, subject, levels, presentation) and « 1re séance offerte »
   (spec §6; image 4 drew the free-session switch in Compte, the spec puts it here,
   beside the page it changes).

   THE ADDRESS IS FIXED. The slug is write-once on the server (POST /tutors): changing
   it would break every link already shared. So it is shown, copied, never edited.

   live-fixes-1 · F2 — NAME, SUBJECT AND LEVELS ARE EDITED HERE, in place: the link
   « Modifier le reste de ma page » sent the tutor back into onboarding for three
   fields. One form, saved through the SAME POST /tutors the onboarding page uses — its
   Zod shape and its validators (vText: name 2–80, subject 1–80, bio ≤ 1000; levels a
   closed set of codes; the contact-info rule) decide, the page only mirrors the two
   pre-checks onboarding makes (a name of 2 letters, a subject). Every other field goes
   back as it is now (the draft from GET /profile/onboarding): the slug, the phone — and
   a verified tutor's rename still waits for the team's review (pending_full_name), the
   page says so. */

const copy = bilingual({
  fr: {
    addressT: "Adresse de ta page",
    addressB: "Elle ne change pas : les liens que tu as déjà partagés restent valables.",
    copyLabel: "Copier le lien de ma page",
    share: "Partager ma page",
    pageT: "Ce que dit ta page",
    subject: "Ta matière",
    nameHelpVerified: "Ton profil est vérifié : un nouveau nom est relu par l'équipe avant d'apparaître sur ta page.",
    levels: "Les niveaux que tu enseignes",
    levelsHelp: "Choisis-en un ou plusieurs. Les élèves filtrent par niveau dans Explorer.",
    bioT: "Ta présentation",
    bioHelp: "Ta méthode, ton expérience, ce qui te rend différent. Sans numéro ni lien : tes élèves passent par Tnajem.",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Ta page est enregistrée.",
    savedReview: "Enregistré. Ton nouveau nom apparaîtra après la relecture de l'équipe.",
    errName: "Écris ton nom (2 caractères minimum).",
    errSubject: "Écris ta matière.",
    errTooLong: "C'est trop long — raccourcis un peu.",
    errLevel: "Ce niveau n'existe pas.",
    errContact: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées sur ta page.",
    errRate: "Trop de modifications d'un coup. Réessaie dans un moment.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    emptyT: "Tu n'as pas encore de page",
    emptyB: "Crée ta page de prof : ton nom, ta matière, ton lien.",
    emptyCta: "Créer ma page",
  },
  ar: {
    addressT: "عنوان صفحتك",
    addressB: "ما يتبدّلش: الروابط اللي شاركتها قبل تقعد تخدم.",
    copyLabel: "انسخ لينك صفحتي",
    share: "شارك صفحتي",
    pageT: "شنوّة تقول صفحتك",
    subject: "مادتك",
    nameHelpVerified: "بروفايلك متثبّت: الإسم الجديد يقراه الفريق قبل ما يبان في صفحتك.",
    levels: "المستويات اللي تقرّيها",
    levelsHelp: "اختار واحد ولا أكثر. التلامذة يفلترو بالمستوى في اكتشف.",
    bioT: "التقديم متاعك",
    bioHelp: "طريقتك، الخبرة متاعك، شنوّة يميّزك. بلا نمرة ولا رابط: تلامذتك يعدّو عبر Tnajem.",
    save: "سجّل",
    saving: "قاعد يتسجّل…",
    saved: "صفحتك تسجّلت.",
    savedReview: "تسجّل. الإسم الجديد يبان كي يقراه الفريق.",
    errName: "اكتب اسمك (حرفين على الأقل).",
    errSubject: "اكتب مادتك.",
    errTooLong: "طويل برشة — نقّصو شوية.",
    errLevel: "المستوى هذا موش موجود.",
    errContact: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة في صفحتك.",
    errRate: "برشا تبديلات في مرّة. عاود جرّب بعد شوية.",
    errGeneric: "ما مشاتش. عاود حاول.",
    emptyT: "ما عندكش صفحة لتوّا",
    emptyB: "اعمل صفحتك متاع أستاذ: إسمك، مادتك، اللينك متاعك.",
    emptyCta: "اعمل صفحتي",
  },
});

type FieldName = "name" | "subject" | "levels" | "bio";

export function VitrineTab({ data, onChanged }: { data: SettingsData; onChanged: () => void }) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
  const draft = data.state?.draft ?? null;
  const [name, setName] = useState(draft?.fullName ?? "");
  // C2: a stored code (« math ») is shown as its label; saved untouched, the code goes back.
  const shownSubject = editableSubject(draft?.subject, locale);
  const [subject, setSubject] = useState(shownSubject);
  const [levels, setLevels] = useState<LevelCode[]>(data.state?.levels ?? []);
  const [bio, setBio] = useState(draft?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: FieldName | "form"; text: string } | null>(null);
  const refs = {
    name: useRef<HTMLInputElement>(null),
    subject: useRef<HTMLInputElement>(null),
    levels: useRef<HTMLButtonElement>(null),
    bio: useRef<HTMLTextAreaElement>(null),
  };

  if (!data.dash?.has_storefront || !data.dash.slug || !draft) {
    return (
      <EmptyState level={2} icon={<Store />} title={c.emptyT} action={<Link href="/onboarding" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}>
        {c.emptyB}
      </EmptyState>
    );
  }
  const slug = data.dash.slug;
  const url = pageUrl(slug);
  const verified = data.state?.status === "verified";
  const savedLevels = sortLevels(data.state?.levels ?? []);
  const dirty =
    name !== (draft.fullName ?? "") ||
    subject !== shownSubject ||
    bio !== (draft.bio ?? "") ||
    levels.join(",") !== savedLevels.join(",");

  const errorFor = (f: FieldName) => (err?.field === f ? err.text : undefined);
  function refuse(field: FieldName | "form", text: string) {
    setErr({ field, text });
    if (field !== "form") requestAnimationFrame(() => refs[field].current?.focus());
  }
  const toggleLevel = (code: LevelCode) =>
    setLevels((cur) => (cur.includes(code) ? cur.filter((x) => x !== code) : sortLevels([...cur, code])));

  /** Which field a POST /tutors refusal is about — the codes onboarding maps the same way. */
  function fieldFor(code: string | undefined): FieldName | null {
    switch (code) {
      case "invalid-name": case "name-too-long": return "name";
      case "invalid-subject": case "subject-too-long": return "subject";
      case "bio-too-long": return "bio";
      case "invalid-level": return "levels";
      default: return null;
    }
  }
  function messageFor(code: string | undefined): string {
    switch (code) {
      case "invalid-name": return c.errName;
      case "invalid-subject": return c.errSubject;
      case "name-too-long": case "subject-too-long": case "bio-too-long": return c.errTooLong;
      case "invalid-level": return c.errLevel;
      case "contact-info-not-allowed": return c.errContact;
      case "too-many-requests": return c.errRate;
      default: return c.errGeneric;
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !draft) return;
    setErr(null);
    // The two checks onboarding makes before sending; the API makes them again, and the rest.
    if (name.trim().length < 2) return refuse("name", c.errName);
    if (!subject.trim()) return refuse("subject", c.errSubject);
    setBusy(true);
    const res = await createTutor({
      name,
      subject: subjectToSave(subject, draft.subject, locale),
      bio,
      slug: draft.slug,
      phone: draft.phone || null,
      levels,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const field = fieldFor(res?.error);
      refuse(field ?? "form", messageFor(res?.error));
      return;
    }
    showToast((res as { nameUnderReview?: boolean }).nameUnderReview ? c.savedReview : c.saved);
    onChanged();
  }

  return (
    <div className="st-stack" data-e2e="settings-vitrine">
      <section className="u-card st-card" aria-labelledby="st-addr">
        <div className="st-row st-row-top">
          <div className="min-w-0 flex-1">
            <h2 id="st-addr" className="st-row-t">{c.addressT}</h2>
            <p className="st-row-b">{c.addressB}</p>
          </div>
        </div>
        <div className="hp-linkbox">
          <span className="hp-linkbox-url" dir="ltr" data-e2e="settings-slug">{shownUrl(url)}</span>
          {/* One-tap copy stays; the share sheet (WhatsApp, Messenger, QR…) beside it. */}
          <CopyLinkButton url={url} label={c.copyLabel} />
        </div>
        <div className="hp-share">
          <ShareButton kind="profile" slug={slug} label={c.share} variant="outline" />
        </div>
      </section>

      <div id="photo" style={{ scrollMarginTop: 84 }}>
        <AvatarUpload slug={slug} initials={initials(data.dash.name ?? "")} status={data.dash.avatarStatus} onChanged={onChanged} inStack />
      </div>

      {/* F2 — what the page says, edited in place. */}
      <form className="u-card st-card st-page-form" aria-labelledby="st-page-t" onSubmit={save} noValidate data-e2e="settings-page-form">
        <h2 id="st-page-t" className="st-row-t st-form-t">{c.pageT}</h2>
        <Field label={t.onboarding.name} help={verified ? c.nameHelpVerified : undefined} error={errorFor("name")}>
          <div className="inp">
            <input
              ref={refs.name}
              type="text"
              value={name}
              placeholder={t.onboarding.namePh}
              maxLength={80}
              autoComplete="name"
              dir={name.trim() ? "auto" : undefined}
              onChange={(e) => { setName(e.target.value); if (err?.field === "name") setErr(null); }}
              data-e2e="settings-name"
            />
          </div>
        </Field>
        <Field label={c.subject} error={errorFor("subject")}>
          <div className="inp">
            <input
              ref={refs.subject}
              type="text"
              value={subject}
              placeholder={t.onboarding.subjectPh}
              maxLength={80}
              dir={subject.trim() ? "auto" : undefined}
              onChange={(e) => { setSubject(e.target.value); if (err?.field === "subject") setErr(null); }}
              data-e2e="settings-subject"
            />
          </div>
        </Field>
        <div className="field">
          <span className="field-label" id="st-levels-l">{c.levels}</span>
          <div role="group" aria-labelledby="st-levels-l" aria-describedby="st-levels-h" className="st-levels" data-e2e="settings-levels">
            {LEVEL_CODES.map((code, i) => {
              const on = levels.includes(code);
              return (
                <button
                  key={code}
                  ref={i === 0 ? refs.levels : undefined}
                  type="button"
                  aria-pressed={on}
                  data-level={code}
                  onClick={() => { toggleLevel(code); if (err?.field === "levels") setErr(null); }}
                  className={`st-level${on ? " is-on" : ""}`}
                >
                  {LEVEL_LABELS[code][locale]}
                </button>
              );
            })}
          </div>
          {errorFor("levels") && <div role="alert" className="help text-rose font-semibold">{errorFor("levels")}</div>}
          <div id="st-levels-h" className="help">{c.levelsHelp}</div>
        </div>
        <Field label={c.bioT} help={c.bioHelp} error={errorFor("bio")}>
          <div className="inp">
            <textarea
              ref={refs.bio}
              rows={5}
              maxLength={1000}
              /* The bio is written in French OR Arabic, whatever the UI language: take
                 the direction from the text, as the public page does (UserText). Empty,
                 it keeps the page's (dir="auto" would left-align an Arabic placeholder). */
              dir={bio.trim() ? "auto" : undefined}
              value={bio}
              onChange={(e) => { setBio(e.target.value); if (err?.field === "bio") setErr(null); }}
              style={{ resize: "vertical", minHeight: 110 }}
              data-e2e="settings-bio"
            />
          </div>
        </Field>
        {err?.field === "form" && <p role="alert" className="help text-rose font-semibold" data-e2e="settings-page-error">{err.text}</p>}
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !dirty} data-e2e="settings-page-save">
            {busy ? c.saving : c.save}
          </button>
        </div>
      </form>

      <section className="u-card st-card">
        <FreeFirstToggle initial={data.dash.offersFreeFirstSession} />
      </section>
      {toast}
    </div>
  );
}
