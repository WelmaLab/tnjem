"use client";

import { useEffect, useState } from "react";
import type { AppLocale } from "@/lib/locale";
import { PILOT_AGE } from "@/lib/pilot-age-copy";

/* december-sprint · D (D16) — « Pendant le pilote, Tnajem est ouvert aux élèves de
   18 ans et plus… » on the home page.

   The home page is prerendered, so — exactly like <PilotTag> — the line is TRUE
   only once the running server says the pilot is adults-only (GET /api/pilot,
   which reads ALLOW_MINORS per request, never the build's value). Until then, and
   for good when minors are allowed, the sentence keeps its box (no layout shift
   when it appears) but is invisible, so out of the accessibility tree, and carries
   no data-e2e. */
export function PilotAgeLine({ locale, className }: { locale: AppLocale; className?: string }) {
  const [adultsOnly, setAdultsOnly] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/pilot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { adultsOnly?: boolean } | null) => {
        if (live) setAdultsOnly(j?.adultsOnly === true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!adultsOnly) {
    return (
      <p className={className} style={{ visibility: "hidden" }} aria-hidden="true">
        {PILOT_AGE[locale].open}
      </p>
    );
  }
  return (
    <p className={className} data-e2e="home-age">
      {PILOT_AGE[locale].open}
    </p>
  );
}
