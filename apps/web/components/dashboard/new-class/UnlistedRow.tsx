"use client";
import { Switch } from "@/components/app/Switch";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";

/* december-sprint · E (D18) — « Non listé » in the new-class form.

   A class reachable only by its link or its QR code: a centre hands both to its own
   pupils. It is absent from the tutor's page, Explore, the sitemap and every
   follower feed, and bookable exactly like any other class. The API stores it
   (POST /classes, `unlisted`); « Mes classes » shows the tag and can flip it later.

   Its own file and copy, so the form only gains one import and one row. */

export const unlistedCopy = bilingual({
  fr: {
    label: "Non listé",
    help: "Seuls ceux qui ont le lien ou le QR code voient cette classe. Elle n'apparaît ni sur ta page ni dans Explorer.",
    published: "Elle est non listée : envoie son lien ou son QR code à tes élèves.",
  },
  ar: {
    label: "بالرابط برك",
    help: "كان اللي عندو الرابط ولا الـ ⁦QR code⁩ يشوف الحصة هاذي. ما تبانش في صفحتك ولا في « اكتشف ».",
    published: "الحصة هاذي بالرابط برك : ابعث الرابط متاعها ولا الـ ⁦QR code⁩ لتلامذتك.",
  },
});

export function UnlistedRow({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { locale } = useLocale();
  const c = unlistedCopy[locale];
  return (
    <div className="nc-ff-row" data-e2e="unlisted-row">
      <div className="min-w-0 flex-1">
        <div className="nc-ff-t">{c.label}</div>
        <p id="nc-unlisted-help" className="nc-ff-h">{c.help}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={c.label} describedBy="nc-unlisted-help" e2e="unlisted-box" />
    </div>
  );
}
