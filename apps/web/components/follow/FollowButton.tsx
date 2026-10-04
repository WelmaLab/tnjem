"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Check, Plus } from "@/components/icons";
import { Link, useLocalizedRouter } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { bilingual } from "@/lib/i18n";
import { followTutor, getFollowStatus, unfollowTutor, type FollowStatus } from "@/app/actions-growth";
import { Toast } from "@/components/useToast"; // live-fixes-3 · D1: above the sticky « Réserver » bars

/* SUIVRE / ABONNÉ ✓ — Espace prof v2 · Phase 4 · contract C4.

   On the profile, the class pages and the "Ce prof arrive bientôt" page:

     <FollowButton slug={slug} />                    plain (blue outline)
     <FollowButton slug={slug} variant="hero" />     on the blue storefront hero

   A CLIENT island: the follow state is the viewer's, and the pages it sits on are
   ISR-cached HTML (no cookies() there, ever). It asks GET /follows/status after
   paint and renders "Suivre" meanwhile — the right answer for every visitor who
   is not signed in.

   SIGNED OUT → /auth?next=<this page>?suivre=1. /auth carries next= into sign-up,
   consent and the welcome screen, so whichever way the visitor gets an account
   they land back here, where `suivre=1` APPLIES the follow and is removed from the
   address bar. Every rule (students only, the minors/consent rule, never your own
   page) is the API's; this renders its answers. A tutor, a guardian or the owner
   sees no button at all. Blue, never ochre: the page's one main action is
   booking, and following is a state. */

const copy = bilingual({
  fr: {
    follow: "Suivre",
    following: "Abonné",
    followAria: (n: string) => `Suivre ${n}`,
    followingAria: (n: string) => `Ne plus suivre ${n}`,
    followed: "C'est noté : tu seras prévenu de ses nouvelles séances et fiches.",
    unfollowed: "Tu ne suis plus ce prof.",
    needsConsent: "Pour suivre un prof, il faut d'abord l'accord de ton parent ou tuteur.",
    consentCta: "Donner l'accord",
    adultsOnly: "Le pilote est réservé aux 18 ans et plus : ce compte ne peut pas suivre de prof pour l'instant.",
    failed: "Ça n'a pas marché. Réessaie dans un instant.",
    thisTutor: "ce prof",
  },
  ar: {
    follow: "تابِع",
    following: "متابِع",
    followAria: (n: string) => `تابِع ${n}`,
    followingAria: (n: string) => `ما عادش تتابع ${n}`,
    followed: "مريڨل : توصلك الحصص والفيشات الجديدة متاعو.",
    unfollowed: "ما عادش تتابع هالأستاذ.",
    needsConsent: "باش تتابع أستاذ، لازم موافقة وليّك قبل.",
    consentCta: "أعطي الموافقة",
    adultsOnly: "فترة التجربة كان للي عندهم 18 سنة ولا أكثر : الحساب هذا ما ينجّمش يتابع أستاذ توّا.",
    failed: "ما مشاتش. عاود حاول بعد شويّة.",
    thisTutor: "هالأستاذ",
  },
});

export function FollowButton({
  slug,
  tutorName,
  variant = "default",
  className,
}: {
  slug: string;
  /** For the accessible name ("Suivre Mohamed B."). */
  tutorName?: string;
  variant?: "default" | "hero";
  className?: string;
}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const router = useLocalizedRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<FollowStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<null | { text: string; consent?: boolean }>(null);
  const [toast, setToast] = useState<string | null>(null);
  const autoApplied = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const toLogin = useCallback(() => {
    const here = `${pathname}${window.location.search}`;
    const url = new URL(here, window.location.origin);
    url.searchParams.set("suivre", "1");
    router.push(`/auth?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }, [pathname, router]);

  const apply = useCallback(async (want: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const res = want ? await followTutor(slug) : await unfollowTutor(slug);
      if (res.ok) {
        setStatus((s) => ({ ...(s ?? { signedIn: true, canFollow: true }), following: Boolean(res.following) }));
        say(want ? c.followed : c.unfollowed);
      } else if (res.error === "not-authenticated") toLogin();
      else if (res.error === "needs-consent") setNote({ text: c.needsConsent, consent: true });
      else if (res.error === "adults-only") setNote({ text: c.adultsOnly });
      else if (res.error === "own-page" || res.error === "students-only") setStatus((s) => s && { ...s, canFollow: false, reason: res.error });
      else say(c.failed);
    } catch {
      say(c.failed);
    } finally {
      setBusy(false);
    }
  }, [slug, say, toLogin, c]);

  useEffect(() => {
    let alive = true;
    getFollowStatus(slug)
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus({ signedIn: false, following: false, canFollow: true }));
    return () => {
      alive = false;
    };
  }, [slug]);

  /* Back from /auth with ?suivre=1: apply the follow once, then drop the flag. */
  useEffect(() => {
    if (!status || autoApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("suivre") !== "1") return;
    autoApplied.current = true;
    params.delete("suivre");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    if (status.signedIn && status.canFollow && !status.following) void apply(true);
  }, [status, apply]);

  if (status && !status.canFollow) return null;
  const following = Boolean(status?.following);
  const name = tutorName ?? c.thisTutor;

  return (
    <div className={`fb-wrap fb-wrap-${variant}${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className={`fb-btn fb-${variant}${following ? " is-on" : ""}`}
        aria-pressed={following}
        aria-label={following ? c.followingAria(name) : c.followAria(name)}
        aria-busy={busy || !status}
        disabled={busy}
        onClick={() => {
          if (status && !status.signedIn) return toLogin();
          void apply(!following);
        }}
        data-e2e="follow-button"
        data-following={following ? "true" : "false"}
      >
        {following ? <Check /> : <Plus />}
        <span>{following ? c.following : c.follow}</span>
      </button>
      {note && (
        <p className="fb-note" role="alert">
          {note.text}{" "}
          {note.consent && <Link href={`/auth/consent?next=${encodeURIComponent(pathname)}`}>{c.consentCta}</Link>}
        </p>
      )}
      {toast && <Toast>{toast}</Toast>}
      <style dangerouslySetInnerHTML={{ __html: FB_CSS }} />
    </div>
  );
}

const FB_CSS = `
  /* position + z-index: on the storefront hero the zellige band's decorative ::before
     (absolute, inset:0) is painted over un-positioned content and swallowed the click. */
  .fb-wrap{position:relative;z-index:1;display:inline-flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
  .fb-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:44px;padding-inline:16px;
    border-radius:999px;font-weight:700;font-size:14px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
  .fb-btn .ic{width:16px;height:16px;flex:none}
  .fb-btn:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
  .fb-btn:disabled{cursor:progress;opacity:.8}
  .fb-default{border:1.5px solid var(--blue);background:var(--paper);color:var(--blue)}
  .fb-default:hover{background:var(--blue50)}
  .fb-default.is-on{background:var(--blue50);color:var(--blue700);border-color:var(--blue700)}
  .fb-hero{border:1.5px solid var(--on-blue-rule);background:var(--on-blue-fill);color:#fff}
  .fb-hero:hover{background:rgba(255,255,255,.18)}
  .fb-hero.is-on{background:#fff;color:var(--blue700);border-color:#fff}
  .fb-hero:focus-visible{outline-color:#fff}
  .fb-note{font-size:13px;line-height:1.5;color:var(--ink2);max-width:320px;margin:0}
  .fb-note a{color:var(--blue700);font-weight:700;text-decoration:underline}
  .fb-wrap-hero .fb-note{color:var(--on-blue)}
  .fb-wrap-hero .fb-note a{color:#fff}
`;
