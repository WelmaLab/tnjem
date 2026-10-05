"use client";
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { ShareButton } from "@/components/share/ShareButton";
import { bilingual } from "@/lib/i18n";
import { getVitrineStats, type VitrineStats as Stats } from "@/app/actions-growth";

/* « Vues · Clics · Abonnés » — Espace prof v2 · Phase 3 (the ep2:stats-slot of Ma
   vitrine). The last 30 days, from GET /vitrine/stats: an aggregate per day and
   per source, nothing about any visitor (no IP, no user agent — the table cannot
   hold one).

     Vues      loads of the public page /{slug}
     Clics     arrivals through a link the tutor shared (WhatsApp, QR code…)
     Abonnés   students following the page right now (Phase 4)

   A zero is shown as a zero, greyed — never padded (truth rule) — and the empty
   state offers the one thing that changes it: sharing the link. */

const copy = bilingual({
  fr: {
    title: "Les 30 derniers jours",
    views: "Vues",
    clicks: "Clics",
    followers: "Suivent ta page", // student-space-v1 · D: « Abonnés » is the monthly subscription's word
    sources: "D'où viennent tes visites",
    srcViews: (n: number) => (n === 1 ? "1 vue" : `${n} vues`),
    srcClicks: (n: number) => (n === 1 ? "1 clic" : `${n} clics`),
    // live-fixes-1 · H: how the FIRST visit comes — by sharing — and the button that does it.
    emptyT: "Pas encore de visite",
    empty: "Ta première visite arrive quand tu partages ton lien : envoie-le dans le groupe WhatsApp de ta classe, mets-le dans ta bio Instagram, ou imprime ton QR code. Chaque visite et chaque clic s'affichent ici.",
    share: "Partager ma page",
    privacy: "Compté sans traceur : aucune adresse IP ni appareil n'est enregistré, seulement des totaux par jour.",
    source: {
      whatsapp: "WhatsApp", facebook: "Facebook", messenger: "Messenger", x: "X", telegram: "Telegram",
      linkedin: "LinkedIn", copy: "Lien copié", qr: "QR code", native: "Partage du téléphone",
      direct: "Visite directe", other: "Autre",
    } as Record<string, string>,
  },
  ar: {
    title: "آخر 30 يوم",
    views: "زيارات",
    clicks: "كليكات",
    followers: "متابعين",
    sources: "منين جاو الزيارات متاعك",
    srcViews: (n: number) => `${n} زيارة`,
    srcClicks: (n: number) => `${n} كليك`,
    emptyT: "ما فماش زيارات لتوّا",
    empty: "أوّل زيارة تجي كي تشارك اللينك متاعك : ابعثو في قروب الواتساب متاع القسم، حطّو في البيو متاع إنستغرام، ولا اطبع الـ QR code. كل زيارة وكل كليك يبانو هوني.",
    share: "شارك صفحتي",
    privacy: "يتحسبو بلا تراكور : حتى عنوان IP ولا جهاز ما يتسجّل، كان المجموع متاع كل نهار.",
    source: {
      whatsapp: "WhatsApp", facebook: "Facebook", messenger: "Messenger", x: "X", telegram: "Telegram",
      linkedin: "LinkedIn", copy: "لينك منسوخ", qr: "QR code", native: "مشاركة من التليفون",
      direct: "زيارة مباشرة", other: "أخرى",
    } as Record<string, string>,
  },
});

/** `primaryShare`: the empty state's Share is the page's ochre action — unless a blocker
    above already holds it (live-fixes-1 · H: one ochre button per view). */
export function VitrineStats({ primaryShare = true }: { primaryShare?: boolean } = {}) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [stats, setStats] = useState<Stats | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getVitrineStats(30).then(setStats).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  let body: React.ReactNode;
  if (failed || (stats && !stats.ok)) body = <ErrorState onRetry={load} />;
  else if (!stats) body = <PageSkeleton rows={1} />;
  else {
    const tiles = [
      { key: "views", label: c.views, value: stats.totals.views },
      { key: "clicks", label: c.clicks, value: stats.totals.clicks },
      // Only when the API counts them (followers exist from Phase 4).
      ...(stats.followers === null ? [] : [{ key: "followers", label: c.followers, value: stats.followers }]),
    ];
    const nothing = stats.totals.views === 0 && stats.totals.clicks === 0;
    body = (
      <>
        <dl className="hp-kpis vs-kpis" data-e2e="vitrine-stats">
          {tiles.map((t) => (
            <div key={t.key} className="hp-kpi">
              <dt className="hp-kpi-l">{t.label}</dt>
              <dd className={`hp-kpi-v${t.value === 0 ? " is-zero" : ""}`} data-e2e={`vitrine-${t.key}`}>
                <span className="hp-num">{t.value}</span>
              </dd>
            </div>
          ))}
        </dl>
        {nothing ? (
          <div className="vs-empty" data-e2e="vitrine-stats-empty">
            <h3 className="vs-empty-t">{c.emptyT}</h3>
            <p className="hp-muted">{c.empty}</p>
            <ShareButton kind="profile" label={c.share} variant={primaryShare ? "primary" : "outline"} />
          </div>
        ) : (
          <>
            <h3 className="vs-sub">{c.sources}</h3>
            <ul className="vs-sources" role="list">
              {stats.bySource.map((s) => (
                <li key={s.source} className="vs-source" data-e2e={`vitrine-source-${s.source}`}>
                  <span className="vs-source-n">{c.source[s.source] ?? s.source}</span>
                  <span className="vs-source-v">
                    {s.views > 0 && <span>{c.srcViews(s.views)}</span>}
                    {s.clicks > 0 && <span>{c.srcClicks(s.clicks)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="vs-privacy">{c.privacy}</p>
      </>
    );
  }

  return (
    <section className="u-card u-card-pad hp-card" aria-labelledby="vs-t" data-e2e="vitrine-stats-card">
      <h2 id="vs-t" className="hp-card-t vs-title">{c.title}</h2>
      {body}
      <style dangerouslySetInnerHTML={{ __html: VS_CSS }} />
    </section>
  );
}

const VS_CSS = `
  .vs-title{margin-block-end:12px}
  .vs-kpis{grid-template-columns:none!important;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)}
  .vs-sub{font-size:14px;font-weight:700;color:var(--ink);margin:4px 0 8px}
  .vs-sources{list-style:none;margin:0;padding:0;display:grid;gap:6px}
  .vs-source{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
    padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--paper);font-size:13.5px}
  .vs-source-n{font-weight:700;color:var(--ink)}
  .vs-source-v{display:flex;gap:12px;color:var(--ink2)}
  .vs-empty{display:grid;gap:8px;justify-items:start;margin-block-start:14px;padding:14px 16px;border:1px dashed var(--line);border-radius:14px;background:var(--paper)}
  .vs-empty-t{font-size:15px;font-weight:700;color:var(--ink);margin:0}
  .vs-empty .ep2-share-btn{margin-block-start:4px}
  .vs-privacy{font-size:13px;color:var(--muted);line-height:1.55;margin:12px 0 0}
`;
