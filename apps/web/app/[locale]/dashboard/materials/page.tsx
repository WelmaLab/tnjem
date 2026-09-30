"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Button, Spinner } from "@/components/ui";
import { SiteShell } from "@/components/SiteShell";
import { Book, Video, Forward } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { getMyMaterials, createMaterial, deleteMaterial } from "@/app/actions";
import { getDashboard } from "@/app/actions"; // phase-a lane L5 (A18.9)
import type { MaterialItem } from "@tnajem/shared";
import { monthLabel, type DashboardClass } from "@tnajem/shared"; // phase-a lane L5 (A18.9)
import { bilingual } from "@/lib/i18n";

/* THE TUTOR'S LIBRARY (Step 10).

   Two ways to add something and they are mutually exclusive on purpose: a file
   OR a YouTube link, never both, because a material is one thing and a row that
   is both has no sensible "open" behaviour. The API refuses the combination too
   (`one-source-only`); this form just makes it hard to get there.

   VISIBILITY DEFAULTS TO "students", matching the column default. A tutor
   uploading a worksheet almost certainly means "for the people in my class", and
   the safe default is the one that cannot surprise them — a mis-set "public" puts
   their corrected exam paper on the open internet. */

const copy = bilingual({
  fr: {
    eyebrow: "MES DOCUMENTS",
    title: "Documents et vidéos",
    sub: "Partage tes fiches, tes corrigés et tes vidéos avec tes élèves.",
    back: "Retour au tableau de bord",

    addTitle: "Ajouter",
    fTitle: "Titre",
    fTitlePh: "Fiche de révision — Intégrales",
    fDesc: "Description (optionnel)",
    fDescPh: "Ce qu'il y a dedans, en une ligne.",
    fFile: "Fichier (PDF ou image, 8 Mo max)",
    fOr: "…ou une vidéo YouTube",
    fYoutube: "Lien YouTube",
    fYoutubePh: "https://www.youtube.com/watch?v=…",
    fYoutubeHelp: "On n'enregistre que l'identifiant de la vidéo, et on l'affiche sans cookie de suivi.",
    fVis: "Qui peut le voir",
    visPublic: "Tout le monde",
    visStudents: "Tous mes élèves", // phase-a lane L5 (A18.9): labelled exactly that
    visThisClass: "Élèves de cette séance", // phase-a lane L5 (A18.9)
    visPrivate: "Moi seulement",
    visHelp: "Par défaut, seuls tes élèves inscrits y ont accès. Rattaché à une séance : seulement les élèves inscrits à cette séance.", // phase-a lane L5 (A18.9)
    // phase-a lane L5 (A18.9): attach to a class
    fClass: "Séance (optionnel)",
    fClassNone: "Aucune séance en particulier",
    submit: "Ajouter",
    submitting: "Envoi…",

    listTitle: "Ta bibliothèque",
    empty: "Rien pour l'instant.",
    remove: "Retirer",
    removing: "…",
    open: "Ouvrir",
    loading: "Chargement…",

    okAdded: "Ajouté. C'est visible selon le réglage choisi.",
    errTitle: "Donne un titre (3 caractères au moins).",
    errSource: "Choisis un fichier OU un lien YouTube.",
    errBoth: "Un fichier ou une vidéo, pas les deux.",
    errYoutube: "Ce lien n'est pas une vidéo YouTube.",
    errType: "Format refusé. PDF, PNG, JPEG ou WEBP.",
    errSize: "Fichier trop lourd (8 Mo max).",
    errNotVerified: "Ton profil doit d'abord être vérifié.",
    errContact: "Enlève le numéro, l'email ou le lien : les coordonnées ne sont pas autorisées.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
  },
  ar: {
    eyebrow: "وثائقي",
    title: "وثائق وفيديوهات",
    sub: "شارك ملخّصاتك، إصلاحاتك وفيديوهاتك مع تلامذتك.",
    back: "ارجع للوحة",

    addTitle: "زيد",
    fTitle: "العنوان",
    fTitlePh: "ملخّص — التكامل",
    fDesc: "الوصف (اختياري)",
    fDescPh: "شنوّة فيه، في سطر.",
    fFile: "ملف (PDF ولا صورة، 8 ميڨا أقصى)",
    fOr: "…ولا فيديو يوتيوب",
    fYoutube: "رابط يوتيوب",
    fYoutubePh: "https://www.youtube.com/watch?v=…",
    fYoutubeHelp: "نسجّلو برك معرّف الفيديو، ونعرضوه بلا كوكي تتبّع.",
    fVis: "شكون ينجّم يشوفو",
    visPublic: "الكلّ",
    visStudents: "تلامذتي الكل", // phase-a lane L5 (A18.9)
    visThisClass: "تلامذة الحصة هاذي", // phase-a lane L5 (A18.9)
    visPrivate: "أنا برك",
    visHelp: "بالافتراض، تلامذتك المسجّلين برك يوصلولو. كان تربطو بحصة: كان التلامذة اللي حاجزين في الحصة هاذي.", // phase-a lane L5 (A18.9)
    // phase-a lane L5 (A18.9)
    fClass: "الحصة (اختياري)",
    fClassNone: "موش مربوطة بحصة",
    submit: "زيد",
    submitting: "قاعد يبعث…",

    listTitle: "مكتبتك",
    empty: "ما فمّاش حاجة لتوّا.",
    remove: "نحّي",
    removing: "…",
    open: "حلّ",
    loading: "قاعد يحمّل…",

    okAdded: "تزاد. يبان حسب الإعداد اللي اخترت.",
    errTitle: "أعطي عنوان (3 حروف على الأقلّ).",
    errSource: "اختار ملف ولا رابط يوتيوب.",
    errBoth: "ملف ولا فيديو، موش الزوز.",
    errYoutube: "الرابط هذا موش فيديو يوتيوب.",
    errType: "الصيغة مرفوضة. PDF، PNG، JPEG ولا WEBP.",
    errSize: "الملف ثقيل برشا (8 ميڨا أقصى).",
    errNotVerified: "لازم بروفايلك يتثبّت الأول.",
    errContact: "نحّي النمرة، الإيميل ولا الرابط: معلومات الاتصال موش مسموحة.",
    errGeneric: "ما مشاتش. عاود حاول.",
  },
});

export default function MaterialsPage() {
  const { locale } = useLocale();
  const c = copy[locale];

  const [items, setItems] = useState<MaterialItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const load = useCallback(async () => {
    const m = await getMyMaterials().catch(() => []);
    setItems(m ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  /* phase-a lane L5 (A18.9): ATTACH TO A CLASS. The API always accepted classId;
     there was no way to set it. A material attached to a class is for "Élèves de
     cette séance" — the students booked in THAT class (enforced by canRead). */
  const [classes, setClasses] = useState<DashboardClass[]>([]);
  const [classId, setClassId] = useState("");
  useEffect(() => {
    let alive = true;
    getDashboard()
      .then((d) => {
        if (!alive || !d || "wrongRole" in d) return;
        setClasses(d.classes.filter((k) => k.status !== "cancelled"));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const classTitle = (id: string | undefined) => classes.find((k) => k.id === id)?.title;

  function messageFor(code: string | undefined): string {
    switch (code) {
      case "one-source-only": return c.errBoth;
      case "invalid-youtube-url": return c.errYoutube;
      case "file-required": return c.errSource;
      case "bad-file-type": return c.errType;
      case "file-too-large": return c.errSize;
      case "not-verified": return c.errNotVerified;
      case "contact-info-not-allowed": return c.errContact;
      case "invalid-title":
      case "title-too-short":
      case "title-too-long": return c.errTitle;
      default: return c.errGeneric;
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);

    /* Client-side pre-checks for the two cases the SERVER also refuses. Not a
       substitute for it — the API is the authority and is what a crafted request
       meets — but a round trip to be told "pick one" is a bad way to learn it. */
    const file = form.get("file");
    const hasFile = file instanceof File && file.size > 0;
    const yt = String(form.get("youtubeUrl") ?? "").trim();
    if (hasFile && yt) { setFlash({ kind: "err", text: c.errBoth }); return; }
    if (!hasFile && !yt) { setFlash({ kind: "err", text: c.errSource }); return; }
    if (!hasFile) form.delete("file");

    setBusy(true);
    setFlash(null);
    const res = await createMaterial(form).catch(() => null);
    setBusy(false);

    if (!res?.ok) { setFlash({ kind: "err", text: messageFor(res?.error) }); return; }
    setFlash({ kind: "ok", text: c.okAdded });
    formRef.current?.reset();
    setClassId(""); // phase-a lane L5 (A18.9)
    await load();
  }

  async function handleRemove(id: string) {
    setRemoving(id);
    const res = await deleteMaterial({ id }).catch(() => null);
    setRemoving(null);
    if (!res?.ok) { setFlash({ kind: "err", text: c.errGeneric }); return; }
    await load();
  }

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow max-w-[760px]">
          {/* min-h-11 (44px): the label is 16px tall, so without it the whole
              back-navigation target on this page was a 16px strip. */}
          <Link href="/dashboard" className="text-[13px] text-muted inline-flex items-center gap-1.5 mb-3 min-h-11">
            <Forward className="w-3 h-3 rotate-180" aria-hidden="true" />
            {c.back}
          </Link>

          <div className="mb-[clamp(20px,3vw,36px)]">
            <div className="text-[13px] font-bold text-muted uppercase tracking-[.5px] mb-1.5">
              {c.eyebrow}
            </div>
            <h1 className="web-h1">{c.title}</h1>
            <p className="text-[14px] text-muted mt-1.5">{c.sub}</p>
          </div>

          {flash && (
            <div
              role={flash.kind === "err" ? "alert" : "status"}
              className="panel panel-pad mb-3 text-[13px] leading-[1.6]"
              style={{ color: flash.kind === "err" ? "var(--rose)" : "var(--ink2)" }}
            >
              {flash.text}
            </div>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="panel panel-pad mb-[clamp(14px,2vw,22px)]">
            <h2 className="font-display text-[16px] font-bold mb-3">{c.addTitle}</h2>

            <label htmlFor="m-title" className="block text-[13px] font-semibold mb-1">{c.fTitle}</label>
            <input
              id="m-title" name="title" required minLength={3} maxLength={120}
              placeholder={c.fTitlePh}
              className="w-full text-[14px] rounded-[12px] p-3 mb-3 min-h-[48px]"
              style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
            />

            <label htmlFor="m-desc" className="block text-[13px] font-semibold mb-1">{c.fDesc}</label>
            <input
              id="m-desc" name="description" maxLength={1000}
              placeholder={c.fDescPh}
              className="w-full text-[14px] rounded-[12px] p-3 mb-3 min-h-[48px]"
              style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
            />

            <label htmlFor="m-file" className="block text-[13px] font-semibold mb-1">{c.fFile}</label>
            <input
              id="m-file" name="file" type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              /* A native file input is ~21px tall on its own. The 48px matches
                 .inp so this form has one field height, and gives the control a
                 real hit box on a phone. */
              className="w-full text-[13px] mb-3 min-h-[48px] py-2.5"
            />

            <div className="text-[13px] text-muted mb-1">{c.fOr}</div>
            <label htmlFor="m-yt" className="block text-[13px] font-semibold mb-1">{c.fYoutube}</label>
            <input
              id="m-yt" name="youtubeUrl" type="url" inputMode="url"
              /* dir="ltr": a Latin URL inside an RTL field renders with its
                 punctuation mirrored — the placeholder read
                 "…=v?https://www.youtube.com/watch" on the Arabic page. Same rule
                 the phone, e-mail and OTP fields already follow. */
              dir="ltr"
              placeholder={c.fYoutubePh}
              className="w-full text-[14px] rounded-[12px] p-3 min-h-[48px]"
              style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
            />
            <p className="text-[13px] text-muted mt-1 mb-3 leading-[1.6]">{c.fYoutubeHelp}</p>

            {/* phase-a lane L5 (A18.9): attach to one of the tutor's classes. */}
            <label htmlFor="m-class" className="block text-[13px] font-semibold mb-1">{c.fClass}</label>
            <select
              id="m-class" name="classId" value={classId}
              onChange={(e) => setClassId(e.target.value)}
              data-e2e="material-class"
              className="w-full text-[14px] rounded-[12px] p-3 mb-3 min-h-[48px]"
              style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
            >
              <option value="">{c.fClassNone}</option>
              {classes.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.title} · {k.day} {monthLabel(k.month, locale)} · {k.time}
                </option>
              ))}
            </select>

            <label htmlFor="m-vis" className="block text-[13px] font-semibold mb-1">{c.fVis}</label>
            <select
              id="m-vis" name="visibility" defaultValue="students"
              data-e2e="material-visibility"
              className="w-full text-[14px] rounded-[12px] p-3 min-h-[48px]"
              style={{ border: "1px solid var(--line)", background: "var(--paper)" }}
            >
              {/* phase-a lane L5 (A18.9): the label says exactly who — this class, or all my students. */}
              <option value="students">{classId ? c.visThisClass : c.visStudents}</option>
              <option value="public">{c.visPublic}</option>
              <option value="private">{c.visPrivate}</option>
            </select>
            <p className="text-[13px] text-muted mt-1 mb-3.5 leading-[1.6]">{c.visHelp}</p>

            <Button type="submit" disabled={busy}>{busy ? c.submitting : c.submit}</Button>
          </form>

          <div className="panel panel-pad">
            <h2 className="font-display text-[16px] font-bold mb-3">{c.listTitle}</h2>
            {!items ? (
              <div className="grid place-items-center min-h-[120px]">
                <Spinner />
                <span className="sr-only">{c.loading}</span>
              </div>
            ) : items.length === 0 ? (
              <p className="text-[13px] text-muted">{c.empty}</p>
            ) : (
              <ul className="flex flex-col" role="list">
                {items.map((m) => (
                  <li key={m.id} className="flex items-start gap-3 py-3 border-b border-line last:border-b-0">
                    <span
                      aria-hidden="true"
                      className="w-9 h-9 rounded-[11px] grid place-items-center flex-none bg-blue50 text-blue"
                    >
                      {m.kind === "youtube" ? <Video /> : <Book />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <UserText as="div" className="text-[14px] font-semibold">{m.title}</UserText>
                      <div className="text-[12px] text-muted mt-0.5">
                        {m.visibility === "public" ? c.visPublic
                          : m.visibility === "students"
                            /* phase-a lane L5 (A18.9): attached → "Élèves de cette séance · <titre>". */
                            ? (m.classId ? `${c.visThisClass}${classTitle(m.classId) ? ` · ${classTitle(m.classId)}` : ""}` : c.visStudents)
                          : c.visPrivate}
                      </div>
                    </div>
                    <div className="flex-none flex items-center gap-2">
                      {m.kind === "file" && (
                        <a
                          href={`/api/material/${m.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-ghost btn-sm"
                        >
                          {c.open}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemove(m.id)}
                        disabled={removing === m.id}
                        className="btn btn-ghost btn-sm"
                      >
                        {removing === m.id ? c.removing : c.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
