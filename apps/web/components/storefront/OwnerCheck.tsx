"use client";
import { useEffect } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { isMyPage } from "@/app/actions-shell";

/* espace prof v2 · shell — on the public « Ce prof arrive bientôt » page, the OWNER is
   sent to their private preview (/dashboard/storefront/preview): « the logged-in
   owner sees an owner preview of their own page ».

   Client-side, after paint, because the page around it is ISR — reading the session
   on the server would bake one visitor's answer into everybody's HTML. Cheap for
   everyone else: nothing is asked unless the readable role hint says "tutor" (a
   display hint only — the real check is isMyPage(), which asks the API who the
   session is and compares slugs). Renders nothing. */
function roleHint(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)tnajem_role=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function OwnerCheck({ slug }: { slug: string }) {
  const { locale } = useLocale();
  useEffect(() => {
    if (roleHint() !== "tutor") return;
    let alive = true;
    isMyPage(slug)
      .then((mine) => {
        if (alive && mine) window.location.replace(`/${locale}/dashboard/storefront/preview`);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, locale]);
  return null;
}
