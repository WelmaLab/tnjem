/* espace prof v2 · shell — « Ce prof arrive bientôt »: what /{slug} shows for a tutor
   who EXISTS but is not public yet (draft or under review), instead of a bare 404.

   SERVER component on the ISR route, so it is the same HTML for everyone and reads
   no session. It says NOTHING about the tutor — no name, no subject, no bio, no
   photo: before verification none of that is public, and the page keeps it that
   way (the slug in the URL is all a visitor has, exactly as before). noindex comes
   from generateMetadata in app/[locale]/[slug]/page.tsx.

   Two islands: the follow slot (growth's « Suivre », phase 4), and <OwnerCheck>,
   which sends the page's OWNER to their private preview — client-side, so the
   cached HTML never depends on who is looking. */
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import { SiteShell } from "@/components/SiteShell";
import { Search, Home, Clock } from "@/components/icons";
import { OwnerCheck } from "./OwnerCheck";

const copy = bilingual({
  fr: {
    title: "Ce prof arrive bientôt",
    body: "Sa page n'est pas encore en ligne : chaque prof est vérifié par l'équipe Tnajem avant de pouvoir donner cours. Repasse dans quelques jours.",
    explore: "Voir les profs déjà en ligne",
    home: "Accueil",
  },
  ar: {
    title: "الأستاذ هذا جاي قريب",
    body: "صفحتو موش على الخط لتوّا: كل أستاذ يتثبّت منّو فريق Tnajem قبل ما يقرّي. ارجع بعد كم نهار.",
    explore: "شوف الأساتذة اللي على الخط",
    home: "الرئيسية",
  },
});

export function ComingSoonScreen({ locale, slug }: { locale: AppLocale; slug: string }) {
  const c = copy[locale];
  return (
    <SiteShell>
      <OwnerCheck slug={slug} />
      <section className="web-section">
        <div className="container container-narrow">
          <div className="panel panel-pad rise text-center" data-e2e="coming-soon">
            <div className="cs-badge" aria-hidden="true">
              <Clock />
            </div>
            <h1 className="web-h2 mb-3">{c.title}</h1>
            <p className="web-lead mb-6">{c.body}</p>
            {/* ep2:follow-slot — growth (phase 4) puts <FollowButton slug={slug} /> here (« Suivre »). */}
            <div className="cluster justify-center">
              <a href={`/${locale}/explore`} className="btn btn-primary btn-sm">
                <Search className="ic" />
                {c.explore}
              </a>
              <a href={`/${locale}`} className="btn btn-ghost btn-sm">
                <Home className="ic" />
                {c.home}
              </a>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
