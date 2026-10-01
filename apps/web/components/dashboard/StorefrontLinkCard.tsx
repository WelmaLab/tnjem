"use client";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Share, Eye } from "@/components/icons";
import { CopyLinkButton } from "@/components/app/CopyLinkButton";
import { pageUrl, shownUrl } from "@/components/app/links";
import type { TutorVerifStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the « Ma vitrine » card: the tutor's link, whether the
   page is online, and the owner preview. On the home (image 1) and at the top of
   « Ma vitrine ».

   « Aperçu privé » ALWAYS opens the owner preview (/dashboard/storefront/preview),
   online or not (rule 8): it is the one place a tutor sees exactly their own page,
   pending photo included, without being counted as a visitor. */

const copy = bilingual({
  fr: {
    title: "Ma vitrine",
    online: "En ligne",
    offline: "Pas encore en ligne",
    preview: "Aperçu privé",
    noPage: "Ta page n'existe pas encore : crée-la pour obtenir ton lien.",
    copyLabel: "Copier le lien de ma page",
  },
  ar: {
    title: "واجهتي",
    online: "على الخط",
    offline: "موش على الخط لتوّا",
    preview: "معاينة خاصة",
    noPage: "صفحتك ما زالت ما تعملتش: اعملها باش يكون عندك لينك.",
    copyLabel: "انسخ لينك صفحتي",
  },
});

export function StorefrontLinkCard({
  slug,
  status,
  hasStorefront,
  headingId = "hp-store-t",
}: {
  slug: string | null;
  status: TutorVerifStatus;
  hasStorefront: boolean;
  headingId?: string;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const online = status === "verified";
  const url = slug ? pageUrl(slug) : null;

  return (
    <section id="share" className="u-card u-card-pad hp-card" aria-labelledby={headingId} data-e2e="storefront-card">
      <div className="hp-card-head">
        <h2 id={headingId} className="hp-card-t">{c.title}</h2>
      </div>
      {!hasStorefront || !url ? (
        <p className="hp-muted">{c.noPage}</p>
      ) : (
        <>
          <div className="hp-linkbox">
            <Share className="hp-linkbox-ic" />
            <span className="hp-linkbox-url" dir="ltr" data-e2e="storefront-url">{shownUrl(url)}</span>
            {/* ep2:share-slot — growth (phase 3) replaces this control with <ShareButton kind="profile" slug={slug} />. */}
            <CopyLinkButton url={url} label={c.copyLabel} />
          </div>
          <p className="hp-status">
            <span className={online ? "tag tag-success" : "tag tag-soon"} data-e2e="storefront-status">
              {online ? c.online : c.offline}
            </span>
            <Link href="/dashboard/storefront/preview" className="linklike text-[13px]" data-e2e="storefront-preview-link">
              <Eye className="w-4 h-4" />
              {c.preview}
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
