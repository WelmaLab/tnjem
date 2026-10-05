"use client";
import { useState, type ReactNode } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { sizeLabel } from "@/components/dashboard/FileDrop";
import { youTubeEmbedUrl, type StudentFiche } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { FicheType } from "./FicheType";

/* One fiche in the student space (Mes cours › Fiches de la séance, Mes fiches).

   « Ouvrir » opens the file through /api/material/<id> — the access-checked
   pass-through, never a static URL (a static file cannot be revoked when a booking is
   cancelled or a takedown upheld). « Regarder » shows the video right here, from
   youtube-nocookie, through the one helper that builds that address — and only once
   asked, so no third-party request is made before. */

const copy = bilingual({
  fr: {
    open: "Ouvrir",
    watch: "Regarder",
    hide: "Fermer la vidéo",
    openAria: (t: string) => `Ouvrir « ${t} »`,
    watchAria: (t: string) => `Regarder « ${t} »`,
    type: { pdf: "PDF", image: "Image", youtube: "Vidéo YouTube", file: "Fichier" } as Record<StudentFiche["type"], string>,
    isNew: "Nouveau",
  },
  ar: {
    open: "حلّ",
    watch: "شوف",
    hide: "سكّر الفيديو",
    openAria: (t: string) => `حلّ « ${t} »`,
    watchAria: (t: string) => `شوف « ${t} »`,
    type: { pdf: "PDF", image: "تصويرة", youtube: "فيديو يوتيوب", file: "ملف" } as Record<StudentFiche["type"], string>,
    isNew: "جديد",
  },
});

export function FicheItem({ f, meta, tag }: { f: StudentFiche; meta?: ReactNode; tag?: ReactNode }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [playing, setPlaying] = useState(false);
  const size = f.sizeBytes ? sizeLabel(f.sizeBytes, locale) : "";
  return (
    <li className="ssv-fiche" data-e2e="fiche" data-fiche-id={f.id} data-new={f.isNew ? "true" : "false"}>
      <div className="ssv-row">
        <FicheType type={f.type} />
        <div className="ssv-row-main">
          <span className="ssv-fiche-t">
            {f.isNew ? <span className="ssv-new-dot" role="img" aria-label={c.isNew} data-e2e="fiche-new" /> : null}
            <UserText as="span" className="ssv-row-t">{f.title}</UserText>
          </span>
          <span className="ssv-row-m">
            {c.type[f.type]}
            {size ? <> · <span className="hp-num">{size}</span></> : null}
            {meta ? <> · {meta}</> : null}
          </span>
        </div>
        {tag}
        {f.type === "youtube" && f.youtubeId ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm ssv-fiche-btn"
            aria-expanded={playing}
            aria-label={playing ? c.hide : c.watchAria(f.title)}
            onClick={() => setPlaying((v) => !v)}
            data-e2e="fiche-watch"
          >
            {playing ? c.hide : c.watch}
          </button>
        ) : (
          <a
            href={`/api/material/${f.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm ssv-fiche-btn"
            aria-label={c.openAria(f.title)}
            data-e2e="fiche-open"
          >
            {c.open}
          </a>
        )}
      </div>
      {playing && f.youtubeId ? (
        <div className="ssv-video">
          <iframe
            src={youTubeEmbedUrl(f.youtubeId)}
            title={f.title}
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
    </li>
  );
}
