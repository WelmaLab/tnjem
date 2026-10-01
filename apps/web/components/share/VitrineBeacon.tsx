"use client";
import { useEffect } from "react";
import { trackVitrineHit } from "@/app/actions-growth";

/* THE VITRINE BEACON — Espace prof v2 · Phase 3.

   /{slug} is ISR: one render is served to thousands of visitors, so a view can
   only be counted in the visitor's browser. This island renders nothing and posts
   ONE beacon per page load: the slug, the class id on a class page, and the
   link's utm_source (analytics only — the button the tutor pressed, never who
   opened it). Every rule that matters (dedupe, budget, owner excluded, nothing
   about the visitor stored) is enforced by POST /vitrine/hit; this only avoids
   asking pointlessly:

     • obvious bots and link-preview fetchers are skipped (most never run JS);
     • a prerendered or background tab is counted when it is actually shown;
     • a reload within the same tab session is not re-sent. */
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|lighthouse/i;

export function VitrineBeacon({ slug, classId }: { slug: string; classId?: string | null }) {
  useEffect(() => {
    if (typeof navigator === "undefined" || BOT_UA.test(navigator.userAgent)) return;
    const source = new URLSearchParams(window.location.search).get("utm_source");
    const key = `tnajem:vb:${slug}:${classId ?? "p"}:${source ?? ""}`;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* storage blocked — the API still deduplicates */
    }
    const send = () => {
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* see above */
      }
      void trackVitrineHit({ slug, classId: classId ?? null, source });
    };
    if (document.visibilityState === "visible") {
      send();
      return;
    }
    const onShow = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", onShow);
      send();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [slug, classId]);
  return null;
}
