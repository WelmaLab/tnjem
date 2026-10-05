import { Play } from "@/components/icons";
import type { StudentFiche } from "@tnajem/shared";

/* The small square that says what a fiche is: « PDF », « IMG », ▶ (a video), or a
   plain file. Decorative — the row's text names the type for a screen reader. */
/* Literal class names: the CSS build keeps only classes it finds written out in the source. */
const CLS = { pdf: "ssv-ft ssv-ft-pdf", image: "ssv-ft ssv-ft-image", youtube: "ssv-ft ssv-ft-youtube", file: "ssv-ft ssv-ft-file" } as const;

export function FicheType({ type }: { type: StudentFiche["type"] }) {
  return (
    <span className={CLS[type]} aria-hidden="true">
      {type === "youtube" ? <Play /> : type === "pdf" ? "PDF" : type === "image" ? "IMG" : "DOC"}
    </span>
  );
}
