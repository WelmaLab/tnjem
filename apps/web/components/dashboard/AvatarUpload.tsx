"use client";
import { useState, type ChangeEvent } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Avatar } from "@/components/ui";
import { uploadAvatar, deleteAvatar } from "@/app/actions";
import { bilingual } from "@/lib/i18n";

/* THE TUTOR'S PHOTO (Step 13).

   The copy does the work here, because three true things are counter-intuitive
   and a tutor who does not know them will read the product as broken:

     1. NOTHING APPEARS IMMEDIATELY. A human reviews it first, so between upload
        and approval their own page still shows the monogram. Without saying so,
        the obvious conclusion is "the upload failed" — and the obvious next
        action is to upload it four more times.
     2. THE PHOTO IS RE-ENCODED AND THE ORIGINAL IS DISCARDED. Worth stating
        plainly rather than burying: it is the part that protects them, because a
        phone photo carries the GPS of wherever it was taken.
     3. REPLACING AN APPROVED PHOTO SENDS IT BACK FOR REVIEW. Otherwise the
        review would be a one-time toll. */

const copy = bilingual({
  fr: {
    title: "Ta photo",
    body:
      "Une photo de toi rassure les élèves et leurs parents. Elle est vérifiée par une personne avant d'apparaître sur ta page.",
    privacy:
      "On redimensionne ta photo et on efface toutes ses données cachées — dont la localisation GPS que ton téléphone y ajoute. L'original n'est pas conservé.",
    choose: "Choisir une photo",
    replace: "Changer la photo",
    uploading: "Envoi…",
    remove: "Retirer",
    removing: "…",

    statusPending: "En attente de vérification. Ta page affiche encore tes initiales.",
    statusApproved: "Vérifiée et visible sur ta page.",
    statusRejected: "Cette photo a été refusée. Tu peux en envoyer une autre.",
    replaceWarn: "Une nouvelle photo repasse par la vérification.",

    errType: "Format refusé. PNG, JPEG, WEBP ou HEIC.",
    errSize: "Photo trop lourde (5 Mo max).",
    errSmall: "Photo trop petite. Il faut au moins 160 pixels de côté.",
    errBad: "On n'a pas pu lire cette image.",
    errMinor: "Les moins de 18 ans gardent leurs initiales, pas de photo.",
    errRate: "Trop d'essais. Réessaie dans un moment.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    okSent: "Photo envoyée. Elle apparaîtra une fois vérifiée.",
  },
  ar: {
    title: "تصويرتك",
    body:
      "تصويرة متاعك تطمّن التلامذة والأولياء. تتشاف من طرف إنسان قبل ما تظهر في صفحتك.",
    privacy:
      "نصغّرو التصويرة ونمسحو المعطيات المخبّية الكل — ومنها موقع الـGPS اللي يزيدو تليفونك. الأصل ما يتحفظش.",
    choose: "اختار تصويرة",
    replace: "بدّل التصويرة",
    uploading: "قاعد يبعث…",
    remove: "نحّي",
    removing: "…",

    statusPending: "تستنّى التثبّت. صفحتك ما زالت تورّي الحروف الأولى.",
    statusApproved: "متثبّت منها وظاهرة في صفحتك.",
    statusRejected: "التصويرة هاذي اترفضت. تنجّم تبعث وحدة أخرى.",
    replaceWarn: "أيّ تصويرة جديدة تعاود تعدّي على التثبّت.",

    errType: "الصيغة مرفوضة. PNG، JPEG، WEBP ولا HEIC.",
    errSize: "التصويرة ثقيلة برشا (5 ميڨا أقصى).",
    errSmall: "التصويرة صغيرة برشا. تلزم 160 بكسل على الأقلّ.",
    errBad: "ما نجّمناش نقراو التصويرة هاذي.",
    errMinor: "اللي عمرو أقلّ من 18 سنة يبقى بالحروف الأولى، بلا تصويرة.",
    errRate: "برشا محاولات. عاود بعد شويّة.",
    errGeneric: "ما مشاتش. عاود حاول.",
    okSent: "التصويرة تبعثت. تظهر كي تتثبّت.",
  },
});

export function AvatarUpload({
  slug,
  initials,
  status,
  onChanged,
  inStack = false,
}: {
  slug: string;
  initials: string;
  status: "pending" | "approved" | "rejected" | null;
  onChanged: () => void;
  /** espace prof v2 · phase 6: inside a gap-spaced stack (Réglages › Vitrine), no bottom margin of its own. */
  inStack?: boolean;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function messageFor(code: string | undefined): string {
    switch (code) {
      case "bad-file-type": return c.errType;
      case "file-too-large": return c.errSize;
      case "image-too-small": return c.errSmall;
      case "bad-image": return c.errBad;
      case "minor-no-photo": return c.errMinor;
      case "too-many-requests": return c.errRate;
      default: return c.errGeneric;
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file twice still fires
    if (!file || busy) return;

    setBusy(true);
    setMsg(null);
    const form = new FormData();
    form.set("photo", file);
    const res = await uploadAvatar(form).catch(() => null);
    setBusy(false);

    if (!res?.ok) { setMsg({ kind: "err", text: messageFor(res?.error) }); return; }
    setMsg({ kind: "ok", text: c.okSent });
    onChanged();
  }

  async function onRemove() {
    setRemoving(true);
    const res = await deleteAvatar().catch(() => null);
    setRemoving(false);
    if (!res?.ok) { setMsg({ kind: "err", text: c.errGeneric }); return; }
    setMsg(null);
    onChanged();
  }

  /* The OWNER may always see their own photo, whatever its state — that is what
     the API's owner branch is for. Everyone else gets the monogram until it is
     approved, which is why the preview here and the storefront can disagree. */
  const src = status ? `/api/avatar/${slug}/md` : null;

  return (
    <div className={inStack ? "panel panel-pad" : "panel panel-pad mb-[clamp(14px,2vw,22px)]"}>
      <h2 className="font-display text-[16px] font-bold mb-1">{c.title}</h2>
      <p className="text-[13px] text-muted leading-[1.6] mb-3">{c.body}</p>

      <div className="flex items-center gap-3.5 flex-wrap">
        <Avatar initials={initials} size={72} src={src} alt="" />

        <div className="min-w-0 flex-1">
          <label className="btn btn-ghost btn-sm inline-flex cursor-pointer">
            {busy ? c.uploading : status ? c.replace : c.choose}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              onChange={onPick}
              disabled={busy}
              className="sr-only"
            />
          </label>
          {status && (
            <button
              type="button"
              onClick={onRemove}
              disabled={removing}
              className="btn btn-ghost btn-sm ms-2"
            >
              {removing ? c.removing : c.remove}
            </button>
          )}

          {status && (
            <p
              className="text-[13px] mt-2 leading-[1.6]"
              style={{ color: status === "approved" ? "var(--green-ink)" : "var(--muted)" }}
            >
              {status === "pending" ? c.statusPending
                : status === "approved" ? `${c.statusApproved} ${c.replaceWarn}`
                : c.statusRejected}
            </p>
          )}
        </div>
      </div>

      {/* 13px, the floor this product ships. This paragraph is the one that tells
          a tutor their photo's GPS data is stripped and the original is not kept —
          the last text on the page to set below the readable minimum. */}
      <p className="text-[13px] text-muted leading-[1.6] mt-3">{c.privacy}</p>

      {msg && (
        <p
          role={msg.kind === "err" ? "alert" : "status"}
          className="text-[13px] mt-2 leading-[1.6]"
          style={{ color: msg.kind === "err" ? "var(--rose)" : "var(--ink2)" }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
