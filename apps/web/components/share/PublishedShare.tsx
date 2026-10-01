"use client";
import { useState } from "react";
import { Check } from "@/components/icons";
import { useLocale } from "@/components/LocaleProvider";
import { useShell } from "@/components/app/ShellContext";
import { markLinkShared } from "@/app/actions-shell";
import { bilingual } from "@/lib/i18n";
import { parseScheduleInput } from "@tnajem/shared";
import { ShareSheet } from "./ShareSheet";
import { ShareButton } from "./ShareButton";

/* "Share right after publishing" — Espace prof v2 · Phase 3.

   Mounted by /dashboard/new-class once POST /classes succeeds: the share sheet
   opens on its own (the moment a tutor is most likely to tell their students),
   and a line with a "Partager" button stays on the page in case they close it.
   Self-contained on purpose: the new-class form itself is the shell's. The class
   id comes back from POST /classes; without it (demo mode) the tutor's page is
   shared instead. */

const copy = bilingual({
  fr: { done: "Ta séance est publiée.", share: "Partager cette séance" },
  ar: { done: "الحصة متاعك تنشرت.", share: "شارك الحصة هاذي" },
});

export function PublishedShare({ classId, title, wallTime }: { classId?: string | null; title: string; wallTime: string }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const shell = useShell();
  const [open, setOpen] = useState(true);
  const slug = shell?.shell?.slug ?? null;
  if (!slug) return null;
  const startsAt = parseScheduleInput(wallTime)?.toISOString() ?? null;
  const kind = classId ? "class" : "profile";
  return (
    <div className="u-card u-card-pad pub-share" role="status" data-e2e="published-share">
      {/* A real success: green is allowed here (palette rules). */}
      <span className="tag tag-success"><Check />{c.done}</span>
      <ShareButton kind={kind} classId={classId} classTitle={title} startsAt={startsAt} label={c.share} variant="outline" />
      <ShareSheet
        kind={kind}
        slug={slug}
        classId={classId}
        classTitle={title}
        startsAt={startsAt}
        open={open}
        onClose={() => setOpen(false)}
        onShared={() => void markLinkShared()}
      />
      <style dangerouslySetInnerHTML={{ __html: ".pub-share{flex-direction:row;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-block-start:14px}" }} />
    </div>
  );
}
