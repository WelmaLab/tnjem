"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Book, Check, Lock } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { AppPage, Blocker, ActionBar, FormSection } from "@/components/app/AppShell";
import { UserText } from "@/components/UserText";
import { FileDrop } from "@/components/dashboard/FileDrop"; // live-fixes-1 · B: the one upload field
import { createMaterial, createPack, getOnboardingState } from "@/app/actions";
import type { TutorVerifStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ══════════════════════════════════════════════════════════════════════════════
   espace prof v2 · phase 6 — NOUVELLE FICHE (a pack: title, detail, file, price).

   Same pattern as « Nouvelle classe »: the verification blocker on top, numbered
   sections, the student's view on the side, « Publier » in the sticky bar.

   THE FILE IS UPLOADED HERE, through the SAME pipeline as « Mes fiches »
   (createMaterial → POST /materials: sniffed type, 8 MB, PDF/PNG/JPEG/WEBP), with
   visibility "students" — the tutor and students with a live booking, never the
   public. It is optional: a pack can be published first and its file added in
   Mes fiches later, as before.

   ORDER: the file goes up first, then the pack. A refused file stops everything
   (nothing half-published); a refused pack after an accepted file keeps the
   uploaded id, so « Publier » again does not upload the same file twice.

   live-fixes-3 · D2 — the SAME GATE as « Nouvelle classe »: a draft / pending /
   rejected prof cannot publish (POST /packs and POST /materials answer not-verified).
   Their primary button reads « Enregistrer le brouillon » and keeps the title, the
   detail and the price in this browser (localStorage, every access in try/catch),
   restored on return and cleared once the fiche is published. The FILE is not kept —
   a browser cannot store it — and the confirmation says so.
   ══════════════════════════════════════════════════════════════════════════════ */

const copy = bilingual({
  fr: {
    title: "Nouvelle fiche",
    hintBody: "Décris ta fiche, ajoute le fichier, fixe ton prix. Tes élèves la voient sur ta page.",
    s1: "Ta fiche",
    s2: "Le fichier",
    s3: "Le prix",
    metaHelp: "ex. 42 pages · 6 vidéos · 3 exercices corrigés",
    titlePh: "ex. Pack révision : Dérivées & Limites",
    metaPh: "42 pages · 6 vidéos",
    onlyStudents: "Partagé seulement avec tes élèves inscrits : jamais public.",
    later: "Pas de fichier pour l'instant ? Tu pourras l'ajouter plus tard dans",
    laterCta: "Mes fiches",
    priceHelp: "Affiché sur ta page. Rien ne s'achète sur Tnajem pour l'instant.",
    notVerified: "Ton profil doit d'abord être vérifié. Va dans « Vérification » pour envoyer tes documents.",
    verifNote: "prépare ta fiche maintenant : tu pourras la publier dès que ton compte est vérifié.",
    verifCta: "Vérifier mon compte",
    verifT: "Fais-toi vérifier",
    pendingT: "Vérification en cours",
    pendingB: "tu pourras publier ta fiche dès qu'elle est validée, en général sous 24–48 h.",
    cancel: "Annuler",
    uploading: "Envoi du fichier…",
    errTitle: "Le titre doit faire au moins 3 caractères.",
    errMeta: "Ce détail ne peut pas dépasser 200 caractères.",
    errPrice: "Le prix doit être entre 0 et 5000 TND.",
    errType: "Format refusé. PDF, PNG, JPEG ou WEBP.",
    errSize: "Fichier trop lourd (8 Mo max).",
    errQuota: "Ton espace de fichiers est plein. Retire un ancien fichier dans Mes fiches.",
    errContact: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées.",
    errUpload: "Le fichier n'a pas pu être envoyé. Réessaie.",
    preview: "Aperçu élève",
    untitled: "Titre de ta fiche",
    priceLabel: "Prix du prof",
    free: "Gratuit",
    fileLine: "Fichier pour tes élèves inscrits",
    doneT: "Ta fiche est publiée",
    doneB: "Elle apparaît sur ta page.",
    doneFile: "Le fichier est dans Mes fiches, réservé à tes élèves inscrits.",
    seeLibrary: "Voir Mes fiches",
    another: "Créer une autre fiche",
    // live-fixes-3 · D2
    saveDraft: "Enregistrer le brouillon",
    draftSavedToast: (withFile: boolean): string =>
      withFile
        ? "Brouillon enregistré sur cet appareil, sans le fichier : tu l'ajouteras au moment de publier, dès que ton compte est vérifié."
        : "Brouillon enregistré sur cet appareil. Tu pourras publier ta fiche dès que ton compte est vérifié.",
    draftEmpty: "Rien à enregistrer pour l'instant : commence par le titre.",
    draftFailed: "Le brouillon n'a pas pu être enregistré sur cet appareil.",
    draftSaved: "Brouillon enregistré",
    draftRestored: "Brouillon repris",
  },
  ar: {
    title: "ملف جديد",
    hintBody: "وصّف الملف، زيد الملف، وحطّ السوم. تلامذتك يشوفوه في صفحتك.",
    s1: "الملف متاعك",
    s2: "الملف",
    s3: "السوم",
    metaHelp: "مثال: 42 صفحة · 6 فيديوهات · 3 تمارين مصحّحة",
    titlePh: "مثال: پاك مراجعة : المشتقات والنهايات",
    metaPh: "42 صفحة · 6 فيديوهات",
    onlyStudents: "يتشارك كان مع تلامذتك المسجّلين: عمرو ما يكون عمومي.",
    later: "ما عندكش ملف توّا؟ تنجّم تزيدو من بعد في",
    laterCta: "ملفاتي",
    priceHelp: "يبان في صفحتك. ما فمّا شي يتشرى على Tnajem لتوّا.",
    notVerified: "لازم بروفايلك يتثبّت الأول. امشي لـ « التثبّت » وابعث وثائقك.",
    verifNote: "حضّر الملف توّا: تنجّم تنشرو أوّل ما حسابك يتثبّت.",
    verifCta: "ثبّت حسابي",
    verifT: "تثبّت من هويتك",
    pendingT: "التثبّت في الطريق",
    pendingB: "تنجّم تنشر الملف أوّل ما يتقبل، عادةً في 24–48 ساعة.",
    cancel: "ارجع",
    uploading: "قاعد يبعث في الملف…",
    errTitle: "العنوان لازم يكون فيه 3 حروف على الأقل.",
    errMeta: "التفاصيل ما تنجّمش تفوت 200 حرف.",
    errPrice: "السوم لازم يكون بين 0 و 5000 د.ت.",
    errType: "الصيغة مرفوضة. PDF، PNG، JPEG ولا WEBP.",
    errSize: "الملف ثقيل برشا (8 ميڨا أقصى).",
    errQuota: "البلاصة متاع ملفاتك تعبّات. نحّي ملف قديم من ملفاتي.",
    errContact: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة.",
    errUpload: "الملف ما تبعثش. عاود جرّب.",
    preview: "شنوّة يشوف التلميذ",
    untitled: "عنوان الملف متاعك",
    priceLabel: "ثمن الأستاذ",
    free: "فابور",
    fileLine: "ملف لتلامذتك المسجّلين",
    doneT: "الملف متاعك تنشر",
    doneB: "يبان في صفحتك.",
    doneFile: "الملف في ملفاتي، كان لتلامذتك المسجّلين.",
    seeLibrary: "شوف ملفاتي",
    another: "اعمل ملف آخر",
    saveDraft: "سجّل المسودة",
    draftSavedToast: (withFile: boolean): string =>
      withFile
        ? "المسودة تسجّلت في الجهاز هذا، بلاش الملف : تزيدو وقت النشر، أوّل ما حسابك يتثبّت."
        : "المسودة تسجّلت في الجهاز هذا. تنجّم تنشر الملف أوّل ما حسابك يتثبّت.",
    draftEmpty: "ما فما شي باش يتسجّل توّا : ابدا بالعنوان.",
    draftFailed: "المسودة ما تسجّلتش في الجهاز هذا.",
    draftSaved: "المسودة تسجّلت",
    draftRestored: "رجّعنا المسودة",
  },
});

/* The fields createPack validates, by the name its error codes use
   ("invalid-title", "price-too-high"…). */
const PACK_FIELDS = ["title", "meta", "price"] as const;
type PackField = (typeof PACK_FIELDS)[number] | "file";

function fieldOf(code: string | undefined): PackField | null {
  if (!code) return null;
  const name = code.replace(/^(invalid|negative)-/, "").replace(/-(too-long|too-high|too-short)$/, "");
  return (PACK_FIELDS as readonly string[]).includes(name) ? (name as PackField) : null;
}

/* live-fixes-3 · D2: the local draft. Storage that never throws — private mode, a full
   disk or a blocked origin degrade to "no draft", never to a broken form. */
type PackDraft = { title: string; meta: string; price: string };
function readPackDraft(key: string): PackDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PackDraft>;
    return { title: String(d.title ?? ""), meta: String(d.meta ?? ""), price: String(d.price ?? "") };
  } catch {
    return null;
  }
}
function writePackDraft(key: string, d: PackDraft): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}
function clearPackDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

export function NewPackForm() {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();

  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [price, setPrice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "uploading" | "publishing">("idle");
  const [demo, setDemo] = useState(false);
  const [done, setDone] = useState<{ withFile: boolean } | null>(null);
  const [fieldError, setFieldError] = useState<{ field: PackField; message: string } | null>(null);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    meta: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
    file: useRef<HTMLInputElement>(null),
  };
  const errorFor = (field: PackField) => (fieldError?.field === field ? fieldError.message : undefined);
  const clearError = (field: PackField) => {
    if (fieldError?.field === field) setFieldError(null);
  };
  function refuse(field: PackField, message: string) {
    setFieldError({ field, message });
    requestAnimationFrame(() => refs[field].current?.focus());
  }

  // The verification state, for the blocker at the top (rule 4).
  const [status, setStatus] = useState<TutorVerifStatus | null>(null);
  // live-fixes-3 · D2: the local draft's key (per page address) and what the bar says about it.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<"saved" | "restored" | null>(null);
  useEffect(() => {
    let alive = true;
    getOnboardingState()
      .then((s) => {
        if (!alive) return;
        setStatus(s?.status ?? null);
        const key = `tnajem:new-pack:${s?.draft?.slug || "me"}`;
        setDraftKey(key);
        const d = readPackDraft(key);
        if (d && (d.title || d.meta || d.price)) {
          setTitle((v) => v || d.title);
          setMeta((v) => v || d.meta);
          setPrice((v) => v || d.price);
          setDraftNote("restored");
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /* FileDrop has already checked the type and the size (the API checks again). */
  function pick(next: File) {
    clearError("file");
    setFile(next);
    setUploadedId(null);
  }
  function removeFile() {
    setFile(null);
    setUploadedId(null);
    if (refs.file.current) refs.file.current.value = "";
  }

  function uploadMessage(code: string | undefined): string {
    switch (code) {
      case "bad-file-type": return c.errType;
      case "file-too-large": return c.errSize;
      case "storage-quota-reached": return c.errQuota;
      case "contact-info-not-allowed": return c.errContact;
      case "not-verified": return c.notVerified;
      default: return c.errUpload;
    }
  }

  // live-fixes-3 · D2 — see the header: an unverified prof saves, never uploads or publishes.
  const unverified = status === "draft" || status === "pending" || status === "rejected";
  function saveDraftNow() {
    const d = { title, meta, price };
    if (!d.title.trim() && !d.meta.trim() && !d.price) {
      showToast(c.draftEmpty);
      return;
    }
    if (draftKey && writePackDraft(draftKey, d)) {
      setDraftNote("saved");
      showToast(c.draftSavedToast(Boolean(file)));
    } else showToast(c.draftFailed);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (phase !== "idle") return;
    setFieldError(null);
    if (unverified) {
      saveDraftNow();
      return;
    }
    if (title.trim().length < 3) {
      refuse("title", c.errTitle);
      return;
    }
    const priceN = Number(price);
    if (!Number.isFinite(priceN) || priceN < 0 || priceN > 5000) {
      refuse("price", c.errPrice);
      return;
    }

    // 1. The file, through Mes fiches' own pipeline — for enrolled students only.
    let materialId = uploadedId;
    if (file && !materialId) {
      setPhase("uploading");
      const form = new FormData();
      form.set("title", title.trim());
      if (meta.trim()) form.set("description", meta.trim());
      form.set("file", file);
      form.set("visibility", "students");
      const up = await createMaterial(form).catch(() => null);
      if (!up?.ok) {
        setPhase("idle");
        if (up?.error === "contact-info-not-allowed") refuse("title", c.errContact);
        else if (up?.error === "not-verified") showToast(c.notVerified);
        else refuse("file", uploadMessage(up?.error));
        return;
      }
      materialId = up.id ?? "demo";
      setUploadedId(materialId);
    }

    /* 2. The pack — tied to its file (live-fixes-1 · B, 0041), so Mes fiches lists ONE
       fiche with its price and its file, not two rows. */
    setPhase("publishing");
    const res = await createPack({
      title, meta, priceTnd: priceN || 0,
      ...(file && materialId && materialId !== "demo" ? { materialId } : {}),
    }).catch(() => null);
    setPhase("idle");
    if (res?.ok) {
      setDemo(Boolean(res.demo));
      if (draftKey) clearPackDraft(draftKey); // live-fixes-3 · D2: published — the draft is done
      setDraftNote(null);
      setDone({ withFile: Boolean(file) });
      showToast(res.demo ? `${t.extra.packPublished} · ${t.common.demoMode}` : t.extra.packPublished);
      window.scrollTo({ top: 0 });
      return;
    }
    const field = fieldOf(res?.error);
    if (field) {
      refuse(field, field === "title" ? c.errTitle : field === "meta" ? c.errMeta : c.errPrice);
      return;
    }
    showToast(res?.error === "not-verified" ? c.notVerified : t.extra.error);
  }

  function startOver() {
    setTitle("");
    setMeta("");
    setPrice("");
    removeFile();
    setDone(null);
    setDemo(false);
  }

  const blocker =
    status === "draft" || status === "rejected" ? (
      <Blocker title={c.verifT} action={{ href: "/onboarding/verify", label: c.verifCta }}>{c.verifNote}</Blocker>
    ) : status === "pending" ? (
      <Blocker title={c.pendingT}>{c.pendingB}</Blocker>
    ) : null;

  if (done) {
    return (
      <AppPage title={c.title} width="narrow">
        <section className="u-card u-card-pad nc-done" aria-labelledby="np-done-t" data-e2e="pack-published">
          <span className="nc-done-ic" aria-hidden="true"><Check /></span>
          <h2 id="np-done-t" className="aps-empty-t">{c.doneT}</h2>
          <p className="hp-muted">{c.doneB}</p>
          {done.withFile && <p className="hp-muted">{c.doneFile}</p>}
          {demo && <p className="hp-muted">{t.common.demoMode}</p>}
          <div className="cluster mt-4">
            <Link href="/dashboard/materials" className="btn btn-primary btn-sm">{c.seeLibrary}</Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={startOver}>{c.another}</button>
          </div>
        </section>
        {toast}
      </AppPage>
    );
  }

  const priceN = Number(price);
  return (
    <AppPage title={c.title} subtitle={c.hintBody} blockers={blocker}>
      <form onSubmit={handleSubmit} className="nc-form">
        <div className="nc-grid">
          <div className="nc-main">
            <FormSection n={1} title={c.s1} id="np-s1">
              <Field label={t.createPack.name} error={errorFor("title")}>
                <div className="inp">
                  <input
                    type="text"
                    placeholder={c.titlePh}
                    ref={refs.title}
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); clearError("title"); }}
                    required
                    maxLength={80}
                  />
                </div>
              </Field>
              <Field label={t.createPack.meta} help={c.metaHelp} error={errorFor("meta")}>
                <div className="inp">
                  <input
                    type="text"
                    placeholder={c.metaPh}
                    ref={refs.meta}
                    value={meta}
                    onChange={(e) => { setMeta(e.target.value); clearError("meta"); }}
                    maxLength={80}
                  />
                </div>
              </Field>
            </FormSection>

            <FormSection n={2} title={c.s2} id="np-s2">
              <FileDrop
                file={file}
                onPick={pick}
                onRemove={removeFile}
                error={errorFor("file")}
                inputRef={refs.file}
                e2e={{ drop: "pack-drop", input: "pack-file-input", file: "pack-file" }}
              />
              <p className="np-note">
                <Lock />
                <span>{c.onlyStudents}</span>
              </p>
              {!file && (
                <p className="np-later">
                  {c.later}{" "}
                  <Link href="/dashboard/materials" className="linklike linklike-inline">{c.laterCta}</Link>.
                </p>
              )}
            </FormSection>

            <FormSection n={3} title={c.s3} id="np-s3">
              <Field label={t.createPack.price} help={c.priceHelp} error={errorFor("price")}>
                <div className="inp">
                  <input
                    type="number"
                    min={0}
                    max={5000}
                    step={0.5}
                    placeholder="8"
                    ref={refs.price}
                    value={price}
                    onChange={(e) => { setPrice(e.target.value); clearError("price"); }}
                    required
                  />
                  <span className="pre">{t.common.tnd}</span>
                </div>
              </Field>
            </FormSection>
          </div>

          {/* The student's view: the pack as it reads on the tutor's page. Inert. */}
          <aside className="nc-preview" aria-label={c.preview} data-e2e="pack-preview">
            <p className="nc-preview-t" aria-hidden="true">{c.preview}</p>
            <div className="u-card nc-preview-card">
              <div className="np-pv">
                <span className="np-pv-ic" aria-hidden="true"><Book /></span>
                <div className="min-w-0 flex-1">
                  <UserText as="div" className="nc-preview-title">{title.trim() || c.untitled}</UserText>
                  {meta.trim() && <UserText as="div" className="nc-preview-meta">{meta}</UserText>}
                </div>
                <div className="np-pv-price">
                  <b className="hp-num">{price === "" ? "—" : priceN > 0 ? `${price} ${t.common.tnd}` : c.free}</b>
                  <span>{c.priceLabel}</span>
                </div>
              </div>
              {file && (
                <div className="nc-preview-foot np-pv-file">
                  <Lock />
                  {c.fileLine}
                </div>
              )}
            </div>
          </aside>
        </div>

        <ActionBar
          status={
            phase === "uploading" ? <span role="status">{c.uploading}</span>
              : draftNote ? <span className="nc-draft" data-e2e="draft-status">{draftNote === "saved" ? c.draftSaved : c.draftRestored}</span>
              : null
          }
        >
          <Link href="/dashboard/materials" className="btn btn-ghost btn-sm">{c.cancel}</Link>
          {unverified ? (
            /* live-fixes-3 · D2: formNoValidate — a half-filled draft is still worth keeping. */
            <button type="submit" formNoValidate className="btn btn-primary btn-sm" data-e2e="save-draft">
              {c.saveDraft}
            </button>
          ) : (
            <Button type="submit" variant="primary" sm disabled={phase !== "idle"}>
              {t.createPack.create}
            </Button>
          )}
        </ActionBar>
      </form>
      {toast}
    </AppPage>
  );
}
