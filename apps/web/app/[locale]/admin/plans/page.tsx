"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { Button, Spinner, Tag } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { SiteShell } from "@/components/SiteShell";
import { Select } from "@/components/app/Select";
import { Shield, Users, Info } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { getAdminPlans, grantPlan, revokePlan, type AdminPlanRow } from "@/app/actions";
import { PLANS, classLimitLabel, tnd, formatInTunis } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* ADMIN — PLANS AND GRANTS (Step 16).

   EVERY GRANT HERE IS FREE, and the page says so twice: payments are off, there
   is no checkout, and nothing on this screen bills anybody or creates a debt.
   An admin surface that looks like a billing tool while no billing exists is how
   somebody ends up telling a tutor they have been charged.

   Read-only for the plan DEFINITIONS. What each offer gives you lives in
   packages/shared/src/plans.ts and ships with the deploy — see its header. This
   page grants and revokes, nothing else. */

const copy = bilingual({
  fr: {
    eyebrow: "ADMIN",
    title: "Offres des profs",
    // phase-a lane L5 (A18.15): admin nav
    count: (n: number) => (n === 1 ? "1 prof" : `${n} profs`),
    loading: "Chargement…",
    deniedTitle: "Accès réservé",
    deniedNote:
      "Cette page est réservée aux administrateurs. Si tu penses que c'est une erreur, contacte l'équipe.",
    signIn: "Se connecter",
    empty: "Aucun prof pour l'instant",
    emptyNote: "Les offres apparaîtront ici dès qu'un prof aura créé sa page.",

    pilotBanner:
      "Les paiements sont désactivés. Aucune offre attribuée ici n'est facturée et aucun prof ne doit quoi que ce soit — c'est une attribution de droits, pas une vente.",
    liveBanner:
      "Les paiements sont actifs. Une offre attribuée ici donne les droits correspondants ; la facturation, elle, ne passe pas par cette page.",

    catalogue: "Le catalogue",
    catalogueNote:
      "Ce que donne chaque offre est défini dans le code et déployé avec l'application — ça ne se modifie pas ici.",
    perMonth: "/ mois",
    boost: "Mis en avant dans Explorer",

    onPilot: "Pilote (par défaut)",
    granted: "Attribuée",
    openClasses: (n: number) => (n === 1 ? "1 séance à venir" : `${n} séances à venir`), // phase-a lane L3 (A25)
    limitOf: (max: number) => `sur ${max}`,
    unlimited: "illimités",
    until: (d: string) => `jusqu'au ${d}`,
    noExpiry: "sans date de fin",

    grant: "Attribuer",
    planField: "Offre",
    /* The verification state, shown because it changes the decision: granting
       Prestige to a tutor we have not verified — or have rejected — puts a paid
       placement behind a page that is not public. The row already carried
       `status` and nothing rendered it. */
    statusLabels: { draft: "Brouillon", pending: "En attente", verified: "Vérifié", rejected: "Refusé" } as Record<string, string>,
    revoke: "Retirer",
    months: "Mois (vide = sans fin)",
    /* The currency reads in the reader's script. TND is the ISO code and is
       correct everywhere, but the rest of the Arabic UI says دينار, and an admin
       screen is not the place to start mixing. */
    priceUnit: (n: number) => `${n} TND`,
    notePh: "Motif (optionnel)",
    ok: "Offre mise à jour ✓",
    removed: "Offre retirée",
    error: "Ça n'a pas marché. Réessaie.",
    // phase-a lane L3 (A25): the API refuses a pilot grant that would LOWER a tutor's limits.
    lowersPilot: "Refusé : pendant le pilote, chaque prof a déjà des séances illimitées. Gratuit ou Essentiel réduirait ses limites — attribue Pro ou Prestige.",
    profile: "Voir la page",
  },
  ar: {
    eyebrow: "أدمين",
    title: "عروض الأساتذة",
    // phase-a lane L5 (A18.15)
    count: (n: number) => (n === 1 ? "أستاذ واحد" : `${n} أساتذة`),
    loading: "قاعد يحمّل…",
    deniedTitle: "الدخول محجوز",
    deniedNote: "الصفحة هاذي محجوزة للأدمين برك. كان تحسب فمّا غلطة، اتصل بالفريق.",
    signIn: "ادخل",
    empty: "ما فمّاش أساتذة توّا",
    emptyNote: "العروض تبان هوني كي أستاذ يعمل صفحتو.",

    pilotBanner:
      "الخلاص مطفي. حتى عرض تعطيه من هوني ما يتفوترش وحتى أستاذ ما يوفّي شي — هاذي إعطاء حقوق، موش بيعة.",
    liveBanner:
      "الخلاص خدّام. العرض اللي تعطيه من هوني يعطي الحقوق متاعو ؛ أمّا الفاتورة ما تعدّيش من الصفحة هاذي.",

    catalogue: "الكاتالوڨ",
    catalogueNote: "شنوّة يعطي كل عرض محدّد في الكود ويتنشر مع التطبيق — ما يتبدّلش من هوني.",
    perMonth: "/ في الشهر",
    boost: "يتقدّم في «اكتشف»",

    onPilot: "تجربة (الافتراضي)",
    granted: "معطى",
    openClasses: (n: number) => (n === 1 ? "حصة جاية وحدة" : `${n} حصص جايّة`), // phase-a lane L3 (A25)
    limitOf: (max: number) => `من ${max}`,
    unlimited: "بلا حدّ",
    until: (d: string) => `حتى ${d}`,
    noExpiry: "بلا تاريخ نهاية",

    grant: "أعطي",
    planField: "العرض",
    statusLabels: { draft: "مسوّدة", pending: "تستنّى", verified: "مؤكّد", rejected: "مرفوض" } as Record<string, string>,
    revoke: "نحّي",
    months: "شهور (فارغ = بلا نهاية)",
    priceUnit: (n: number) => `${n} دينار`,
    notePh: "السبب (اختياري)",
    ok: "العرض تبدّل ✓",
    removed: "العرض تنحّى",
    error: "ما مشاتش. عاود حاول.",
    lowersPilot: "مرفوض : في فترة التجربة، كل أستاذ عندو حصص بلا حدّ. Gratuit ولا Essentiel ينقّصولو — اعطيه Pro ولا Prestige.", // phase-a lane L3 (A25)
    profile: "شوف الصفحة",
  },
});

/* Only what an admin can actually hand out. `pilot` is the default everybody is
   already on, and the API refuses to grant it explicitly — see the note in
   routes/subscriptions.ts. */
const GRANTABLE = PLANS.filter((p) => p.listed);

function formatDate(iso: string | null, locale: "fr" | "ar"): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return formatInTunis(iso, locale, { day: "numeric", month: "long", year: "numeric" });
}

export default function AdminPlansPage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [paymentsOn, setPaymentsOn] = useState(false);
  const [items, setItems] = useState<AdminPlanRow[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [months, setMonths] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function load() {
    try {
      const res = await getAdminPlans();
      setAdmin(res.ok && res.admin);
      setPaymentsOn(Boolean(res.paymentsEnabled));
      setItems(res.items ?? []);
    } catch {
      setAdmin(false);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function handleGrant(row: AdminPlanRow) {
    const planCode = choice[row.tutorId] ?? "";
    if (!planCode) return;
    setBusy((b) => ({ ...b, [row.tutorId]: true }));
    const raw = (months[row.tutorId] ?? "").trim();
    const res = await grantPlan({
      tutorId: row.tutorId,
      planCode,
      months: raw ? Number(raw) : undefined,
      note: notes[row.tutorId]?.trim() || undefined,
    });
    setBusy((b) => ({ ...b, [row.tutorId]: false }));
    if (!res.ok) {
      // phase-a lane L3 (A25): a refusal with a reason is a warning, not "réessaie".
      showToast(res.error === "lowers-pilot-limits" ? c.lowersPilot : c.error);
      return;
    }
    showToast(c.ok);
    /* Reload rather than patch the row in place: the effective plan is resolved
       server-side (a grant can supersede another, and an expiry can already have
       passed), so re-reading is the only way this list stays true. */
    await load();
  }

  async function handleRevoke(row: AdminPlanRow) {
    setBusy((b) => ({ ...b, [row.tutorId]: true }));
    const res = await revokePlan({
      tutorId: row.tutorId,
      note: notes[row.tutorId]?.trim() || undefined,
    });
    setBusy((b) => ({ ...b, [row.tutorId]: false }));
    if (!res.ok) {
      showToast(c.error);
      return;
    }
    showToast(c.removed);
    await load();
  }

  return (
    <SiteShell>
      <section className="web-section tight">
        <div className="container container-narrow">
          <div className="mb-5">
            <span className="web-eyebrow flex items-center gap-1.5 mb-2">
              <Shield className="w-4 h-4" />
              {c.eyebrow}
            </span>
            <h1 className="web-h2">{c.title}</h1>
            {!loading && admin && (
              <div className="flex items-center gap-1.5 text-[13px] text-muted mt-1.5">
                <Users className="w-[15px] h-[15px]" />
                {c.count(items.length)}
              </div>
            )}
            {/* phase-a lane L5 (A18.15): the admin nav, both ways — this page was reachable from nowhere. */}
            {!loading && admin && <AdminTabs current="plans" /> /* UI Option A (A9) */}
          </div>

          {loading && (
            <div className="panel panel-pad grid place-items-center min-h-[140px]">
              <Spinner />
              <p className="text-[13px] text-muted mt-1">{c.loading}</p>
            </div>
          )}

          {!loading && !admin && (
            <div className="panel panel-pad text-center">
              <h2 className="font-display text-[20px] mb-2">{c.deniedTitle}</h2>
              <p className="text-[13px] text-muted leading-[1.6] mb-4">{c.deniedNote}</p>
              <Link href="/auth" className="w-auto">
                <Button variant="primary" sm>
                  {c.signIn}
                </Button>
              </Link>
            </div>
          )}

          {!loading && admin && (
            <>
              {/* THE BANNER, driven by the real switch — the same flag /tarifs
                  reads, so this page cannot claim billing is off after it is on. */}
              <div className="note-info mb-5">{/* Phase A+ (U1) */}
                <Info />
                <p>{paymentsOn ? c.liveBanner : c.pilotBanner}</p>
              </div>

              {/* The catalogue, read-only. */}
              <div className="panel panel-pad mb-5">
                <h2 className="font-display text-[16px] font-bold mb-1">{c.catalogue}</h2>
                <p className="text-[13px] text-muted leading-[1.6] mb-3">{c.catalogueNote}</p>
                <ul className="flex flex-col gap-2">
                  {GRANTABLE.map((p) => (
                    <li key={p.code} className="flex items-baseline gap-2 flex-wrap text-[13px]">
                      <b className="font-display">{p.code}</b>
                      <span className="text-muted">
                        {c.priceUnit(tnd(p.monthlyMillimes))} {c.perMonth}
                      </span>
                      <span className="text-muted">· {classLimitLabel(p.maxClasses, locale)}</span>
                      {p.exploreBoost > 0 && <Tag kind="neutral">{c.boost}</Tag>}
                    </li>
                  ))}
                </ul>
              </div>

              {items.length === 0 ? (
                <div className="panel panel-pad text-center">
                  <h2 className="font-display text-[18px] mb-1">{c.empty}</h2>
                  <p className="text-[13px] text-muted">{c.emptyNote}</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {items.map((row) => {
                    const until = formatDate(row.expiresAt, locale);
                    const working = Boolean(busy[row.tutorId]);
                    return (
                      <div key={row.tutorId} className="panel panel-pad" data-e2e="plan-row" data-tutor={row.tutorId}>
                        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <UserText as="b" className="font-display text-[15px]">{row.fullName}</UserText>
                              <Tag kind="neutral">
                                {row.granted ? row.planCode : c.onPilot}
                              </Tag>
                              <Tag kind={row.status === "verified" ? "success" : "neutral"}>
                                {c.statusLabels[row.status] ?? row.status}
                              </Tag>
                            </div>
                            <p className="text-[13px] text-muted mt-1">
                              {c.openClasses(row.openClasses)}{" "}
                              {row.maxClasses === null ? `(${c.unlimited})` : `(${c.limitOf(row.maxClasses)})`}
                              {row.granted ? ` · ${until ? c.until(until) : c.noExpiry}` : ""}
                            </p>
                          </div>
                          <Link href={`/${row.slug}`} className="btn btn-ghost btn-sm flex-none">
                            {c.profile}
                          </Link>
                        </div>

                        <div className="flex gap-2 flex-wrap items-end">
                          {/* No sr-only twin: the select already carries
                              aria-label, and the hidden span only existed to
                              name a control that was already named. Its 12px
                              (inherited from the wrapper) also tripped the text
                              floor for a string nobody can see. */}
                          {/* A VISIBLE label, not just aria-label. The control
                              rendered as a bare "—" dropdown with nothing next
                              to it, and the "Mois" label beside it read as if
                              it belonged to this one.
                              live-fixes-2 · C: the shell's Select, not a native
                              <select> — a <div>, not a <label>, around it (see
                              Select.tsx). Same state: "" (nothing chosen, Attribuer
                              stays disabled) or a GRANTABLE code. */}
                          <div className="flex flex-col gap-1 text-[13px] text-muted min-w-[150px]">
                            <span id={`plan-l-${row.tutorId}`}>{c.planField}</span>
                            <Select
                              value={choice[row.tutorId] ?? ""}
                              onChange={(next) => setChoice((v) => ({ ...v, [row.tutorId]: next }))}
                              options={[
                                { value: "", label: "—" },
                                ...GRANTABLE.map((p) => ({ value: p.code, label: p.code })),
                              ]}
                              labelledBy={`plan-l-${row.tutorId}`}
                              e2e="plan-choice"
                            />
                          </div>
                          {/* 13px is the floor the harness enforces and the
                              smallest size this product ships — a form label on
                              a 320px screen is exactly where it matters. */}
                          <label className="flex flex-col gap-1 text-[13px] text-muted">
                            {c.months}
                            <input
                              className="inp"
                              inputMode="numeric"
                              value={months[row.tutorId] ?? ""}
                              onChange={(e) =>
                                setMonths((v) => ({ ...v, [row.tutorId]: e.target.value }))
                              }
                            />
                          </label>
                          <input
                            className="inp flex-1 min-w-[160px]"
                            placeholder={c.notePh}
                            value={notes[row.tutorId] ?? ""}
                            onChange={(e) =>
                              setNotes((v) => ({ ...v, [row.tutorId]: e.target.value }))
                            }
                          />
                          <Button
                            sm
                            variant="primary"
                            onClick={() => handleGrant(row)}
                            disabled={working || !(choice[row.tutorId] ?? "")}
                          >
                            {c.grant}
                          </Button>
                          {row.granted && (
                            <Button sm variant="ghost" onClick={() => handleRevoke(row)} disabled={working}>
                              {c.revoke}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      {toast}
    </SiteShell>
  );
}
