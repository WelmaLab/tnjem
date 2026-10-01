"use client";
import { useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { Chain, Check } from "@/components/icons";
import { markLinkShared } from "@/app/actions-shell";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the plain « Copier le lien » control that sits in every
   {/* ep2:share-slot *\/} until growth's ShareButton replaces it (contract C3).

   A copy by the OWNER is a share (contract C2): it stamps link_shared_at through
   markLinkShared(), which is idempotent and never throws. The stamp is fire-and-
   forget: the tutor's copy must not wait on it, nor fail because of it. */

const copy = bilingual({
  fr: { copy: "Copier le lien", copied: "Lien copié", failed: "Copie impossible — sélectionne le lien" },
  ar: { copy: "انسخ اللينك", copied: "اللينك تنسخ", failed: "ما نجّمناش ننسخو — اختار اللينك بيدك" },
});

/* The Clipboard API first; the old selection copy when it is refused (an http
   origin, an in-app browser, a permission prompt that never shows). */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("copy refused");
  }
}

export function CopyLinkButton({
  url,
  label,
  compact,
  onCopied,
}: {
  /** Absolute URL to copy. */
  url: string;
  /** Accessible name when the visible label is not enough ("Copier le lien de « Intégrales »"). */
  label?: string;
  /** Icon-only button (rows). */
  compact?: boolean;
  onCopied?: () => void;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handle() {
    try {
      await copyText(url);
      setState("copied");
      onCopied?.();
      void markLinkShared();
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  }

  const text = state === "copied" ? c.copied : state === "failed" ? c.failed : c.copy;
  return (
    <>
      <button
        type="button"
        onClick={handle}
        className={`btn btn-ghost btn-sm aps-copy${compact ? " aps-copy-compact" : ""}`}
        aria-label={compact || label ? (state === "idle" ? label ?? c.copy : text) : undefined}
        data-e2e="copy-link"
        data-copied={state === "copied" ? "true" : undefined}
      >
        {state === "copied" ? <Check /> : <Chain />}
        {compact ? null : <span>{text}</span>}
      </button>
      {/* The result, for a screen reader: the button's own label changes too. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "idle" ? "" : text}
      </span>
    </>
  );
}
