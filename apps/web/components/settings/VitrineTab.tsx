"use client";
import { useState } from "react";
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
import { initials } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import type { SettingsData } from "./SettingsView";

/* Réglages › Vitrine — the public page's own settings: its address, the photo, the
   bio and « 1re séance offerte » (spec §6; image 4 drew the free-session switch in
   Compte, the spec puts it here, beside the page it changes).

   THE ADDRESS IS FIXED. The slug is write-once on the server (POST /tutors): changing
   it would break every link already shared. So it is shown, copied, never edited.

   THE BIO is saved through the same POST /tutors the page editor uses, with every
   other field as it is now (the draft from GET /profile/onboarding) — so a pending,
   under-review rename is carried along untouched, never withdrawn by a bio edit. */

const copy = bilingual({
  fr: {
    addressT: "Adresse de ta page",
    addressB: "Elle ne change pas : les liens que tu as déjà partagés restent valables.",
    copyLabel: "Copier le lien de ma page",
    share: "Partager ma page",
    bioT: "Ta présentation",
    bioHelp: "Ta méthode, ton expérience, ce qui te rend différent. Sans numéro ni lien : tes élèves passent par Tnajem.",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Présentation enregistrée.",
    errContact: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées sur ta page.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    more: "Modifier le reste de ma page (nom, matière, niveaux)",
    emptyT: "Tu n'as pas encore de page",
    emptyB: "Crée ta page de prof : ton nom, ta matière, ton lien.",
    emptyCta: "Créer ma page",
  },
  ar: {
    addressT: "عنوان صفحتك",
    addressB: "ما يتبدّلش: الروابط اللي شاركتها قبل تقعد تخدم.",
    copyLabel: "انسخ لينك صفحتي",
    share: "شارك صفحتي",
    bioT: "التقديم متاعك",
    bioHelp: "طريقتك، الخبرة متاعك، شنوّة يميّزك. بلا نمرة ولا رابط: تلامذتك يعدّو عبر Tnajem.",
    save: "سجّل",
    saving: "قاعد يتسجّل…",
    saved: "التقديم تسجّل.",
    errContact: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة في صفحتك.",
    errGeneric: "ما مشاتش. عاود حاول.",
    more: "بدّل الباقي متاع صفحتي (الإسم، المادة، المستويات)",
    emptyT: "ما عندكش صفحة لتوّا",
    emptyB: "اعمل صفحتك متاع أستاذ: إسمك، مادتك، اللينك متاعك.",
    emptyCta: "اعمل صفحتي",
  },
});

export function VitrineTab({ data, onChanged }: { data: SettingsData; onChanged: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
  const draft = data.state?.draft ?? null;
  const [bio, setBio] = useState(draft?.bio ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>(undefined);

  if (!data.dash?.has_storefront || !data.dash.slug || !draft) {
    return (
      <EmptyState icon={<Store />} title={c.emptyT} action={<Link href="/onboarding" className="btn btn-primary btn-sm">{c.emptyCta}</Link>}>
        {c.emptyB}
      </EmptyState>
    );
  }
  const slug = data.dash.slug;
  const url = pageUrl(slug);

  async function saveBio() {
    if (busy || !draft) return;
    setBusy(true);
    setErr(undefined);
    const res = await createTutor({
      name: draft.fullName,
      subject: draft.subject,
      bio,
      slug: draft.slug,
      phone: draft.phone || null,
      levels: data.state?.levels,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setErr(res?.error === "contact-info-not-allowed" ? c.errContact : c.errGeneric);
      return;
    }
    showToast(c.saved);
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

      <section className="u-card st-card">
        <Field label={c.bioT} help={c.bioHelp} error={err}>
          <div className="inp">
            <textarea
              rows={5}
              maxLength={1000}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setErr(undefined);
              }}
              style={{ resize: "vertical", minHeight: 110 }}
              data-e2e="settings-bio"
            />
          </div>
        </Field>
        <div className="flex justify-end">
          <button type="button" className="btn btn-primary btn-sm" onClick={saveBio} disabled={busy || bio === (draft.bio ?? "")}>
            {busy ? c.saving : c.save}
          </button>
        </div>
      </section>

      <section className="u-card st-card">
        <FreeFirstToggle initial={data.dash.offersFreeFirstSession} />
      </section>

      <p>
        <Link href="/onboarding" className="linklike text-[13.5px]">{c.more}</Link>
      </p>
      {toast}
    </div>
  );
}
