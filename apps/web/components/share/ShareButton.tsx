"use client";
import { useState, type CSSProperties } from "react";
import { Share } from "@/components/icons";
import { useLocale } from "@/components/LocaleProvider";
import { useShell } from "@/components/app/ShellContext";
import { markLinkShared } from "@/app/actions-shell";
import { bilingual } from "@/lib/i18n";
import { ShareSheet, type ShareSheetProps } from "./ShareSheet";

/* The trigger for the share sheet — Espace prof v2 · contract C3.

   In the `{/* ep2:share-slot *\/}` places the shell left — the home "Ma vitrine"
   card, Ma vitrine, each Mes classes row — and on Promotions, Abonnements and
   right after a class is published:

     <ShareButton kind="profile" />                                  the tutor's page
     <ShareButton kind="class" classId={id} classTitle={title} startsAt={iso} variant="icon" />
     <ShareButton kind="offer" sessionsPerMonth={4} priceTnd={120} />
     <ShareButton kind="promo" promoCode="RENTREE" percent={15} endsAt={iso} />

   INSIDE THE APPSHELL the sharer is the owner, so two things come from the shell
   unless given: `slug` (the tutor's own) and `onShared`, which records the
   "lien partagé" setup step (contract C2, markLinkShared — idempotent, never
   throws). The sheet mounts only once opened, so a list of twenty classes ships
   twenty buttons, not twenty dialogs. Not to be confused with
   components/storefront/ShareButton.tsx — the visitor's native-share icon. */

const copy = bilingual({
  fr: { share: "Partager", shareAria: "Partager le lien" },
  ar: { share: "شارك", shareAria: "شارك الرابط" },
});

export function ShareButton({
  label,
  variant = "ghost",
  sm = true,
  className,
  style,
  slug,
  onShared,
  ...sheet
}: Omit<ShareSheetProps, "slug"> & {
  /** Defaults to the signed-in tutor's own slug inside the AppShell. */
  slug?: string | null;
  label?: string;
  /** "icon" = a 44px icon button (rows, cards); the others are the Button variants. */
  variant?: "primary" | "ghost" | "outline" | "icon";
  sm?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const shell = useShell();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const theSlug = slug ?? shell?.shell?.slug ?? null;
  // The owner shared their own link: the setup step (C2). Fire-and-forget.
  const shared = onShared ?? (shell ? () => void markLinkShared() : undefined);

  if (!theSlug) return null;
  const cls =
    variant === "icon"
      ? "iconbtn"
      : `btn ${variant === "primary" ? "btn-primary" : variant === "outline" ? "btn-outline" : "btn-ghost"}${sm ? " btn-sm" : ""}`;

  return (
    <>
      <button
        type="button"
        className={`${cls} ep2-share-btn${className ? ` ${className}` : ""}`}
        style={style}
        aria-haspopup="dialog"
        aria-label={variant === "icon" ? (label ?? c.shareAria) : undefined}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        data-e2e={`share-open-${sheet.kind}`}
      >
        <Share />
        {variant !== "icon" && <span>{label ?? c.share}</span>}
      </button>
      {mounted && <ShareSheet {...sheet} slug={theSlug} onShared={shared} open={open} onClose={() => setOpen(false)} />}
      <style dangerouslySetInnerHTML={{ __html: ".ep2-share-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px}.ep2-share-btn .ic{width:16px;height:16px;flex:none}" }} />
    </>
  );
}
