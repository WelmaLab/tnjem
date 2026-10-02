import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteShell } from "@/components/SiteShell";
import { Link } from "@/components/Link";
import { Info } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import { isLocale, DEFAULT_LOCALE, type AppLocale } from "@/lib/locale";
import { confirmUnsubscribe, lookupUnsubscribe } from "@/app/actions-growth";
import { pageGuard } from "@/lib/page-guard";

/* THE UNSUBSCRIBE CONFIRM PAGE — Espace prof v2 · Phase 4 · contract C5.

   The e-mail footer link lands here (via /api/email/unsubscribe, which picks the
   person's language). One button, one kind switched off. A GET here changes
   nothing — a mail scanner opening the link must not unsubscribe anybody; the
   button is a server-action form, so it also works with JavaScript off.
   Per-request (the token is in the query) and never indexed. */

export const metadata: Metadata = { robots: { index: false, follow: false } };

const copy = bilingual({
  fr: {
    title: "Tes e-mails Tnajem",
    kinds: { followers: "les nouveautés des profs que tu suis", bookings: "tes réservations", messages: "tes nouveaux messages", reminders: "les rappels" } as Record<string, string>,
    ask: (k: string) => `Tu ne recevras plus d'e-mail pour ${k}.`,
    inApp: "Les notifications dans l'application ne changent pas.",
    cta: "Me désabonner",
    done: "C'est fait : tu ne recevras plus ces e-mails.",
    already: "Tu ne reçois déjà plus ces e-mails.",
    invalid: "Ce lien ne fonctionne pas — il a peut-être été copié à moitié.",
    manage: "Tes autres e-mails ne changent pas.",
    account: "Mon compte",
    home: "Retour à l'accueil",
    // espace prof v2 · phase 6: only a signed-in TUTOR has the e-mail switches (Réglages › Notifications).
    tutorPrefs: "Tous tes e-mails se règlent dans",
    tutorPrefsLink: "Réglages › Notifications",
  },
  ar: {
    title: "الإيمايلات متاعك من Tnajem",
    kinds: { followers: "جديد الأساتذة اللي تتابعهم", bookings: "الحجوزات متاعك", messages: "الميساجات الجديدة", reminders: "التذكيرات" } as Record<string, string>,
    ask: (k: string) => `ما عادش يوصلك إيمايل على ${k}.`,
    inApp: "التنبيهات في التطبيقة ما تتبدّلش.",
    cta: "ما عادش نحب نوصلهم",
    done: "تعمل : ما عادش توصلك الإيمايلات هاذي.",
    already: "الإيمايلات هاذي ما عادش توصلك من قبل.",
    invalid: "الرابط هذا ما يخدمش — يمكن تنسخ موش كامل.",
    manage: "الإيمايلات الأخرى متاعك ما تتبدّلش.",
    account: "حسابي",
    home: "ارجع للصفحة الرئيسية",
    tutorPrefs: "الإيمايلات الكل متاعك تتبدّل من",
    tutorPrefsLink: "الإعدادات › الإشعارات",
  },
});

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string; done?: string }>;
};

export default async function UnsubscribePage(props: Props) {
  const { locale: raw } = await props.params;
  const { token = "", done } = await props.searchParams;
  const locale: AppLocale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const c = copy[locale];

  async function unsubscribe(form: FormData) {
    "use server";
    const t = String(form.get("token") ?? "");
    const res = await confirmUnsubscribe(t);
    redirect(`/${locale}/email/unsubscribe?${res.ok ? "done=1" : `token=${encodeURIComponent(t)}`}`);
  }

  /* A student or a guest has no settings screen for e-mails, so the line below is
     shown to a signed-in tutor only — the page never promises what it cannot keep. */
  const guard = await pageGuard().catch(() => null);
  const isTutor = guard?.kind === "user" && guard.profile.role === "tutor";

  const state = done === "1" ? { kind: "done" as const } : token ? await lookupUnsubscribe(token).catch(() => ({ ok: false as const, error: "unavailable" })) : { ok: false as const, error: "invalid-token" };

  let body;
  if ("kind" in state && state.kind === "done") {
    body = <p className="eu-lead" role="status">{c.done}</p>;
  } else if (!("ok" in state) || !state.ok) {
    body = <p className="eu-lead">{c.invalid}</p>;
  } else if (state.already) {
    body = <p className="eu-lead">{c.already}</p>;
  } else {
    body = (
      <form action={unsubscribe} className="eu-form">
        <input type="hidden" name="token" value={token} />
        <p className="eu-lead">{c.ask(c.kinds[state.kind] ?? state.kind)}</p>
        <div className="note-info">
          <Info />
          <p>{c.inApp}</p>
        </div>
        <button type="submit" className="btn btn-primary eu-cta" data-e2e="unsubscribe-confirm">{c.cta}</button>
      </form>
    );
  }

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container eu-wrap">
          <div className="u-card u-card-pad eu-card">
            <h1 className="web-h2 eu-title">{c.title}</h1>
            {body}
            <p className="eu-manage">
              {c.manage} <Link href="/account">{c.account}</Link> · <Link href="/">{c.home}</Link>
            </p>
            {isTutor && (
              <p className="eu-manage" data-e2e="unsubscribe-tutor-prefs">
                {c.tutorPrefs} <Link href="/dashboard/settings?tab=notifications">{c.tutorPrefsLink}</Link>.
              </p>
            )}
          </div>
        </div>
      </section>
      <style dangerouslySetInnerHTML={{ __html: `
        .eu-wrap{max-width:560px;margin-inline:auto}
        .eu-card{gap:14px}
        .eu-title{margin:0}
        .eu-lead{font-size:15px;line-height:1.6;color:var(--ink2);margin:0}
        .eu-form{display:grid;gap:14px}
        .eu-cta{min-height:50px}
        .eu-manage{font-size:13.5px;color:var(--muted);line-height:1.6;margin:0}
        .eu-manage a{color:var(--blue700);font-weight:700}
      ` }} />
    </SiteShell>
  );
}
