"use client";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Book, Calendar, Lock, Pencil, Trash, Video } from "@/components/icons";
import { ShareButton } from "@/components/share/ShareButton";
import { formatNumericDate, type FicheClassOption, type TutorFiche } from "@tnajem/shared";
import { sizeLabel } from "@/components/dashboard/FileDrop";
import { fichesCopy } from "./copy";

/* live-fixes-1 · B — one row of Mes fiches: the title and the price, then the facts
   (the file or the video, the class it belongs to, where it shows), then three icon
   actions — Partager, Modifier, Retirer. Every icon button carries the fiche's
   title in its name, so a screen reader hears « Retirer « Pack Bac » », not three
   anonymous « Retirer ». */

export function FicheRow({
  f,
  classes,
  verified,
  onEdit,
  onRemove,
  busy,
}: {
  f: TutorFiche;
  classes: FicheClassOption[];
  verified: boolean;
  onEdit: (f: TutorFiche) => void;
  onRemove: (f: TutorFiche) => void;
  busy: boolean;
}) {
  const { t, locale } = useLocale();
  const c = fichesCopy[locale];
  const klass = f.classId ? classes.find((k) => k.id === f.classId) : undefined;
  const isPack = f.packId !== null;

  const status = isPack
    ? { text: verified ? c.onPage : c.notOnline, cls: verified ? "chip chip-soft" : "chip chip-sand" }
    : f.visibility === "public"
      ? { text: c.visPublic, cls: "chip chip-soft" }
      : f.visibility === "private"
        ? { text: c.visPrivate, cls: "chip chip-sand" }
        : { text: f.classId ? c.visThisClass : c.visStudents, cls: "chip chip-sand" };

  return (
    <li className="fx-row" data-e2e="fiche-row" data-kind={isPack ? "pack" : "material"} data-fiche={f.key}>
      <span className="fx-ic" aria-hidden="true">{f.source === "youtube" ? <Video /> : <Book />}</span>
      <div className="fx-main">
        <div className="fx-head">
          <UserText as="h3" className="fx-title">{f.title}</UserText>
          {f.priceTnd === null ? (
            <span className="fx-price is-none" data-e2e="fiche-price">
              <span aria-hidden="true">—</span>
              <span className="sr-only">{c.noPrice}</span>
            </span>
          ) : (
            <span className="fx-price hp-num" data-e2e="fiche-price">
              <span className="sr-only">{c.priceLabel} </span>
              {f.priceTnd > 0 ? `${f.priceTnd} ${t.common.tnd}` : c.free}
            </span>
          )}
        </div>
        {f.detail ? <UserText as="p" className="fx-detail">{f.detail}</UserText> : null}
        <ul className="fx-facts" role="list">
          <li className="fx-fact" data-e2e="fiche-source">
            {f.source === "file" && f.materialId ? (
              <a href={`/api/material/${f.materialId}`} target="_blank" rel="noopener noreferrer" className="fx-link">
                <Lock />
                <span dir="auto" className="fx-file">{f.fileName ?? c.open}</span>
                {f.sizeBytes ? <span className="fx-muted">· {sizeLabel(f.sizeBytes, locale)}</span> : null}
              </a>
            ) : f.source === "youtube" && f.youtubeId ? (
              <a
                href={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(f.youtubeId)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="fx-link"
              >
                <Video />
                {c.video}
              </a>
            ) : (
              <span className="fx-muted">{c.noSource}</span>
            )}
            {isPack && f.source ? <span className="fx-muted">· {c.forStudents}</span> : null}
          </li>
          {f.classId ? (
            <li className="fx-fact" data-e2e="fiche-class">
              <Calendar />
              {/* The class title is the tutor's own text, in either script: isolated
                  (UserText, dir=auto) so it never reorders the label around it. */}
              <span className="min-w-0">
                {c.classLabel}{" "}
                {klass ? (
                  <>
                    <UserText>{klass.title}</UserText>
                    {" · "}
                    <span className="hp-num">{formatNumericDate(klass.startsAt)}</span>
                    {klass.cancelled ? ` (${c.classCancelled})` : null}
                  </>
                ) : (
                  "—"
                )}
              </span>
            </li>
          ) : null}
          <li className="fx-fact">
            <span className={status.cls} data-e2e="fiche-status">{status.text}</span>
          </li>
        </ul>
      </div>
      <div className="fx-actions">
        {f.visibility !== "private" ? (
          <ShareButton kind="pack" ficheTitle={f.title} variant="icon" label={c.shareAria(f.title)} />
        ) : null}
        <button type="button" className="iconbtn" aria-label={c.editAria(f.title)} onClick={() => onEdit(f)} data-e2e="fiche-edit">
          <Pencil />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label={c.removeAria(f.title)}
          onClick={() => onRemove(f)}
          disabled={busy}
          data-e2e={isPack ? "pack-remove" : "material-remove"}
        >
          <Trash />
        </button>
      </div>
    </li>
  );
}
