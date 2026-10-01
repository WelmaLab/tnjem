"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { Button, Field } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Bulb } from "@/components/icons";
import { useToast } from "@/components/useToast";
import { AppPage, Blocker, ActionBar } from "@/components/app/AppShell";
import { createPack, getOnboardingState } from "@/app/actions";
import type { TutorVerifStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* Page-local copy (never edit lib/i18n.ts from here). FR + Derija, RTL-safe. */
const copy = bilingual({
  fr: {
    hintBody: "Décris ton pack, fixe ton prix. Tes élèves le voient sur ta vitrine.",
    /* phase-a A4: tutors never see a student's phone or e-mail, so "send it
       yourself" was an instruction nobody could follow — and Mes documents does
       upload. Files go there; questions go through Tnajem's messages. */
    deliveryTitle: "Tes fichiers passent par « Mes fiches »", // espace prof v2: the library's name in the shell
    deliveryBody:
      "Publie ici la description et le prix de ton pack. Le fichier lui-même, ajoute-le dans « Mes fiches » : tes élèves inscrits le retrouvent sur ta page. Une question d'un élève ? Réponds-lui dans les messages Tnajem.",
    deliveryCta: "Ouvrir Mes fiches",
    metaHelp: "ex. 42 pages · 6 vidéos · 3 exercices corrigés",
    // Publishing requires a verified profile (enforced server-side in createPack).
    notVerified: "Ton profil doit d'abord être vérifié. Va dans « Vérification » pour envoyer tes documents.",
    titlePh: "ex. Pack révision : Dérivées & Limites",
    metaPh: "42 pages · 6 vidéos",
    verifNote: "tu pourras publier ton pack dès que ton compte est vérifié.",
    verifCta: "Vérifier mon compte",
    verifT: "Fais-toi vérifier", // espace prof v2 · shell: the blocker at the top
    pendingT: "Vérification en cours",
    pendingB: "tu pourras publier ton pack dès qu'elle est validée, en général sous 24–48 h.",
    cancel: "Annuler",
    // Field refusals from createPack (apps/api/src/routes/classes.ts validators).
    errTitle: "Le titre doit faire au moins 3 caractères.",
    errMeta: "Ce détail ne peut pas dépasser 200 caractères.",
    errPrice: "Le prix doit être entre 0 et 5000 TND.",
  },
  ar: {
    hintBody: "وصّف الپاك متاعك، وحطّ السوم. تلاميذك يشوفوه في واجهتك.",
    deliveryTitle: "ملفّاتك تتعدّى من « ملخّصاتي »",
    deliveryBody:
      "انشر هوني الوصف والسوم متاع الپاك. أمّا الملف في حدّ ذاتو، زيدو في « ملخّصاتي »: تلاميذك المسجّلين يلقاوه في صفحتك. تلميذ عندو سؤال؟ جاوبو في الرسائل متاع Tnajem.",
    deliveryCta: "حلّ « ملخّصاتي »",
    metaHelp: "مثال: 42 صفحة · 6 فيديوهات · 3 تمارين مصحّحة",
    notVerified: "لازم بروفايلك يتثبّت الأول. امشي لـ « التثبّت » وابعث وثائقك.", // phase-a lane L6 (A18.derija-2)
    titlePh: "مثال: پاك مراجعة : المشتقات والنهايات",
    metaPh: "42 صفحة · 6 فيديوهات",
    verifNote: "تنجّم تنشر الپاك متاعك أوّل ما حسابك يتثبّت.",
    verifCta: "ثبّت حسابي",
    verifT: "تثبّت من هويتك",
    pendingT: "التثبّت في الطريق",
    pendingB: "تنجّم تنشر الپاك أوّل ما يتقبل، عادةً في 24–48 ساعة.",
    cancel: "ارجع",
    errTitle: "العنوان لازم يكون فيه 3 حروف على الأقل.",
    errMeta: "التفاصيل ما تنجّمش تفوت 200 حرف.",
    errPrice: "السوم لازم يكون بين 0 و 5000 د.ت.",
  },
});

/* The fields createPack validates, by the name its error codes use
   ("invalid-title", "price-too-high"…). */
const PACK_FIELDS = ["title", "meta", "price"] as const;
type PackField = (typeof PACK_FIELDS)[number];

function fieldOf(code: string | undefined): PackField | null {
  if (!code) return null;
  const name = code.replace(/^(invalid|negative)-/, "").replace(/-(too-long|too-high)$/, "");
  return (PACK_FIELDS as readonly string[]).includes(name) ? (name as PackField) : null;
}

export default function NewPackPage() {
  const { t, locale } = useLocale();
  const c = copy[locale];

  const [title, setTitle] = useState("");
  const [meta, setMeta] = useState("");
  const [price, setPrice] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Only ever true when the server action itself reports demo mode (no DB).
  const [demo, setDemo] = useState(false);
  /* A refusal about one field is shown ON it, with focus moved there — not in a
     toast that points at nothing. See new-class/page.tsx. */
  const [fieldError, setFieldError] = useState<{ field: PackField; message: string } | null>(null);
  const refs = {
    title: useRef<HTMLInputElement>(null),
    meta: useRef<HTMLInputElement>(null),
    price: useRef<HTMLInputElement>(null),
  };
  const errorFor = (field: PackField) => (fieldError?.field === field ? fieldError.message : undefined);
  const clearError = (field: PackField) => { if (fieldError?.field === field) setFieldError(null); };

  const { toast, showToast } = useToast();

  // espace prof v2 · shell: the verification state, for the blocker at the top (rule 4).
  const [status, setStatus] = useState<TutorVerifStatus | null>(null);
  useEffect(() => {
    let alive = true;
    getOnboardingState().then((s) => { if (alive) setStatus(s?.status ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    setFieldError(null);
    const res = await createPack({ title, meta, priceTnd: Number(price) || 0 });
    if (res.ok) {
      setDemo(Boolean(res.demo));
      showToast(res.demo ? `${t.extra.packPublished} · ${t.common.demoMode}` : t.extra.packPublished);
    } else {
      // Server-side validation (empty title, negative price…) — let them fix it.
      setSubmitted(false);
      const field = fieldOf(res.error);
      if (field) {
        setFieldError({ field, message: field === "title" ? c.errTitle : field === "meta" ? c.errMeta : c.errPrice });
        refs[field].current?.focus();
        return;
      }
      showToast(res.error === "not-verified" ? c.notVerified : t.extra.error);
    }
  }

  const blocker =
    status === "draft" || status === "rejected" ? (
      <Blocker title={c.verifT} action={{ href: "/onboarding/verify", label: c.verifCta }}>{c.verifNote}</Blocker>
    ) : status === "pending" ? (
      <Blocker title={c.pendingT}>{c.pendingB}</Blocker>
    ) : null;

  return (
    <AppPage title={t.createPack.title} blockers={blocker} note={c.hintBody} width="narrow">
      <form onSubmit={handleSubmit} className="u-card u-card-pad">
        {/* Title */}
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

        {/* Meta */}
        <Field
          label={t.createPack.meta}
          help={c.metaHelp}
          error={errorFor("meta")}
        >
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

        {/* Price */}
        <Field label={t.createPack.price} error={errorFor("price")}>
          <div className="inp">
            <input
              type="number"
              min={0}
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

        {/* Honest note — no dropzone HERE: files live in Mes fiches
            (/dashboard/materials, Step 10), which does upload. phase-a A4.
            Phase 6 brings the upload onto this form. */}
        <div style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-start",
          padding: "14px 16px",
          borderRadius: 14,
          background: "var(--cream)",
          border: "1px solid var(--line)",
          marginBottom: 4,
        }}>
          <span className="text-ochre inline-flex shrink-0 mt-[1px]">
            <Bulb className="w-[18px] h-[18px]" />
          </span>
          <div>
            <div className="text-[13px] font-bold mb-[3px]">
              {c.deliveryTitle}
            </div>
            <div className="text-[13px] text-muted leading-[1.6]">
              {c.deliveryBody}
            </div>
            <Link href="/dashboard/materials" className="linklike text-[13px] mt-1.5 inline-block">
              {c.deliveryCta}
            </Link>
          </div>
        </div>

        {/* Rule 5: the sticky action bar, inside the form so its submit is the form's. */}
        <ActionBar status={demo ? t.common.demoMode : null}>
          <Link href="/dashboard/materials" className="btn btn-ghost btn-sm">{c.cancel}</Link>
          <Button type="submit" variant="primary" sm disabled={submitted}>
            {t.createPack.create}
          </Button>
        </ActionBar>
      </form>
      {toast}
    </AppPage>
  );
}
