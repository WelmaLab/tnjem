"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { SiteShell } from "@/components/SiteShell";
import { Shield } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { listCentreLeads, setCentreLeadStatus, type AdminCentreLead } from "@/app/actions-centres";
import { CENTRE_LEAD_STATUSES, formatInTunis, levelsLabel, type CentreLeadStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* /admin/leads — the centre leads from /pour-les-centres (december-sprint · B, D13).

   Leads are personal data (gate amendment 9): the list, the status change and the
   CSV are served by the API behind requireAdmin. This page decides nothing: who may
   see it is the API's answer ("forbidden" to anyone off the allowlist), the CSV link
   is a pass-through (app/api/admin/centre-leads-csv/route.ts), and every read and
   change is written to the admin audit log by the API. Newest first. */

const copy = bilingual({
  fr: {
    eyebrow: "ADMIN",
    title: "Centres",
    lead: "Les demandes de démo envoyées depuis la page Pour les centres, les plus récentes d'abord.",
    csv: "Exporter en CSV",
    capped: (n: number) => `Seules les ${n} demandes les plus récentes sont affichées. L'export CSV les contient toutes.`,
    deniedTitle: "Accès réservé",
    deniedNote: "Cette page est réservée aux administrateurs.",
    signIn: "Se connecter",
    empty: "Aucune demande pour l'instant.",
    phone: "Téléphone",
    contact: "Contact",
    teachers: "Profs",
    levels: "Niveaux",
    source: "Source",
    direct: "directe",
    message: "Message",
    status: "Statut",
    statuses: { new: "Nouveau", contacted: "Contacté", won: "Gagné", lost: "Perdu" },
    saved: "Statut enregistré.",
    error: "Une erreur s'est produite. Réessaie.",
  },
  ar: {
    eyebrow: "أدمين",
    title: "المراكز",
    lead: "طلبات الديمو اللي جات من صفحة للمراكز، الجداد هوما الأوّلين.",
    csv: "صدّر CSV",
    capped: (n: number) => `ظاهرين كان آخر ${n} طلب. ملف CSV فيه الطلبات الكل.`,
    deniedTitle: "الدخول محجوز",
    deniedNote: "الصفحة هاذي محجوزة للأدمين برك.",
    signIn: "ادخل",
    empty: "ما فمّا حتى طلب للوقت هذا.",
    phone: "التليفون",
    contact: "الشخص والمدينة",
    teachers: "الأساتذة",
    levels: "المستويات",
    source: "المصدر",
    direct: "مباشر",
    message: "الميساج",
    status: "الحالة",
    statuses: { new: "جديد", contacted: "تكلّمنا معاه", won: "ربحناه", lost: "خسرناه" },
    saved: "الحالة تسجّلت.",
    error: "صار مشكل. عاود.",
  },
});

export default function AdminLeadsPage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();
  const [checking, setChecking] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [leads, setLeads] = useState<AdminCentreLead[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [capped, setCapped] = useState<number | null>(null);

  /* Who may see this page is the API's decision: "forbidden" to anyone off the allowlist. */
  useEffect(() => {
    let alive = true;
    listCentreLeads()
      .then((res) => {
        if (!alive) return;
        setAdmin(res.ok);
        setLeads(res.leads ?? []);
        setCapped(res.capped && res.limit ? res.limit : null);
      })
      .catch(() => { if (alive) setAdmin(false); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  async function onStatus(id: string, status: CentreLeadStatus) {
    if (busy) return;
    setBusy(id);
    try {
      const res = await setCentreLeadStatus(id, status);
      if (res.ok && res.lead) {
        const next = res.lead;
        setLeads((cur) => cur.map((l) => (l.id === id ? next : l)));
        showToast(c.saved);
      } else {
        showToast(c.error);
      }
    } catch {
      showToast(c.error);
    } finally {
      setBusy(null);
    }
  }

  const when = (iso: string) =>
    formatInTunis(iso, locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <SiteShell>
      <section className="web-section tight">
        <div className="container container-narrow">
          <div className="mb-6">
            <span className="web-eyebrow inline-flex items-center gap-1.5 mb-2">
              <Shield className="w-4 h-4" />
              {c.eyebrow}
            </span>
            <h1 className="web-h2">{c.title}</h1>
            {!checking && admin && (
              <>
                <p className="muted mt-2 leading-[1.6]">{c.lead}</p>
                <AdminTabs current="leads" />
              </>
            )}
          </div>

          {checking && (
            <div className="panel panel-pad grid place-items-center gap-3 text-center">
              <Spinner />
            </div>
          )}

          {!checking && !admin && (
            <div className="panel panel-pad grid place-items-center gap-3 text-center">
              <h2 className="font-display text-[22px]">{c.deniedTitle}</h2>
              <p className="muted leading-[1.6]">{c.deniedNote}</p>
              <Link href="/auth" className="btn btn-primary btn-sm">{c.signIn}</Link>
            </div>
          )}

          {!checking && admin && (
            <>
              <div className="flex flex-wrap items-center justify-end gap-3 mb-4">
                {/* A plain download link: the route handler forwards the session to the API. */}
                <a href="/api/admin/centre-leads-csv" className="btn btn-outline btn-sm w-auto" download data-e2e="leads-csv">
                  {c.csv}
                </a>
              </div>

              {leads.length === 0 && <p role="status" className="panel panel-pad muted">{c.empty}</p>}
              {capped !== null && <p className="muted text-[14px] mb-3" data-e2e="leads-capped">{c.capped(capped)}</p>}

              <ul className="flex flex-col gap-4" data-e2e="leads-list">
                {leads.map((l) => {
                  const source = [l.utmSource, l.utmMedium, l.utmCampaign].filter(Boolean).join(" / ");
                  return (
                    <li key={l.id} className="panel panel-pad flex flex-col gap-3" data-e2e="lead-row" data-lead={l.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <UserText as="div" className="font-display text-[18px]">{l.centreName}</UserText>
                        <span className="muted text-[13px]">{when(l.createdAt)}</span>
                      </div>
                      <dl className="grid gap-1.5 text-[14px]">
                        <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.contact}</dt><dd><UserText>{l.name}</UserText> · <UserText>{l.city}</UserText></dd></div>
                        <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.phone}</dt><dd dir="ltr">{l.phone}</dd></div>
                        {l.teachersCount !== null && (
                          <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.teachers}</dt><dd>{l.teachersCount}</dd></div>
                        )}
                        {l.levels.length > 0 && (
                          <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.levels}</dt><dd>{levelsLabel(l.levels, locale)}</dd></div>
                        )}
                        <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.source}</dt><dd dir="ltr">{source || c.direct}</dd></div>
                        {l.message && (
                          <div className="flex flex-col gap-1"><dt className="font-bold">{c.message}</dt><dd className="leading-[1.6]"><UserText>{l.message}</UserText></dd></div>
                        )}
                      </dl>
                      <div role="group" aria-label={`${c.status} · ${l.centreName}`} className="flex flex-wrap gap-2" data-e2e="lead-status">
                        {CENTRE_LEAD_STATUSES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={l.status === s}
                            disabled={busy === l.id}
                            onClick={() => { if (l.status !== s) void onStatus(l.id, s); }}
                            className="adm-tab"
                            data-status={s}
                          >
                            {c.statuses[s]}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </section>
      {toast}
    </SiteShell>
  );
}
