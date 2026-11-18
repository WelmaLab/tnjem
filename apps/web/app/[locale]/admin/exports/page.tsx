"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { SiteShell } from "@/components/SiteShell";
import { Shield } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { previewBookingsExport, type BookingExportPreview } from "@/app/actions-exports";
import { tunisWallTime } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* /admin/exports — the centre export (december-sprint · F, D19).

   A centre is a list of tutors for now: the admin pastes their slugs or account
   e-mails, picks a range of class dates, sees the counts, then downloads the CSV.
   Bookings and their status only — no attendance is recorded anywhere, and the page
   says so. The file is made on request and never sent anywhere automatically.

   This page decides nothing: who may see it, what a valid query is and which tutors
   exist are the API's answers (routes/bookings-export.ts, behind requireAdmin), the
   download is a pass-through (app/api/admin/bookings-export-csv/route.ts), and every
   preview and export is written to the admin audit log by the API. */

const STATUS_KEYS = ["reserved", "cancelled", "paid", "attended"] as const;
/* Gate 4: nothing records payment or attendance, so « Payé » and « Présent » only
   appear if a row ever carries them — never as a « 0 » that implies they are tracked. */
const ALWAYS_SHOWN = new Set<string>(["reserved", "cancelled"]);

type Limits = { maxTutors: number; maxDays: number };

const copy = bilingual({
  fr: {
    eyebrow: "ADMIN",
    title: "Exports",
    lead: "Les réservations d'un centre : la liste de ses profs, sur une période. Le fichier n'est envoyé à personne automatiquement.",
    help: "Le statut indique réservé ou annulé. La présence n'est pas enregistrée.",
    tutorsLabel: "Profs du centre",
    tutorsHint: (n: number) => `Leur lien Tnajem (slug) ou l'e-mail de leur compte, séparés par des virgules ou un par ligne. ${n} au maximum.`,
    fromLabel: "Du",
    toLabel: "Au",
    rangeHint: (n: number) => `Date des cours, à l'heure de Tunis. ${n} jours au maximum.`,
    preview: "Voir le résumé",
    previewing: "Calcul…",
    csv: "Télécharger le CSV",
    deniedTitle: "Accès réservé",
    deniedNote: "Cette page est réservée aux administrateurs.",
    signIn: "Se connecter",
    total: (n: number) => (n === 1 ? "1 réservation" : `${n} réservations`),
    statuses: { reserved: "Réservé", cancelled: "Annulé", paid: "Payé", attended: "Présent" },
    perTutor: "Par prof",
    unknownTitle: "Profs introuvables",
    unknownNote: "Corrige ou retire ces lignes pour télécharger le fichier :",
    tooMany: (n: number) => `Plus de ${n} réservations : réduis la période pour télécharger le fichier.`,
    sampleTitle: (n: number) => `Les ${n} premières lignes`,
    empty: "Aucune réservation pour ces profs sur cette période.",
    studentFirstName: "Élève (prénom) :",
    errors: {
      "missing-tutors": "Indique au moins un prof.",
      "too-many-tutors": (l: Limits) => `Trop de profs : ${l.maxTutors} au maximum.`,
      "invalid-tutors": "La liste des profs n'est pas lisible.",
      "invalid-from": "La date de début n'est pas valide.",
      "invalid-to": "La date de fin n'est pas valide.",
      "range-reversed": "La date de début est après la date de fin.",
      "range-too-long": (l: Limits) => `La période dépasse ${l.maxDays} jours.`,
      generic: "Une erreur s'est produite. Réessaie.",
    } as Record<string, string | ((l: Limits) => string)>,
  },
  ar: {
    eyebrow: "أدمين",
    title: "التصدير",
    lead: "حجوزات مركز: ليستة الأساتذة متاعو، على مدّة. الملف ما يتبعث لحتى حد وحدو.",
    help: "الحالة تقول محجوز ولا ملغي. الحضور ما يتسجّلش.",
    tutorsLabel: "أساتذة المركز",
    tutorsHint: (n: number) => `الرابط متاعهم في Tnajem (slug) ولا الإيميل متاع الحساب، بفاصل ولا واحد في كل سطر. ${n} على الأكثر.`,
    fromLabel: "من",
    toLabel: "حتى",
    rangeHint: (n: number) => `تاريخ الحصص، بوقت تونس. ${n} يوم على الأكثر.`,
    preview: "شوف الملخّص",
    previewing: "قاعد نحسب…",
    csv: "نزّل CSV",
    deniedTitle: "الدخول محجوز",
    deniedNote: "الصفحة هاذي محجوزة للأدمين برك.",
    signIn: "ادخل",
    total: (n: number) => `${n} حجز`,
    statuses: { reserved: "محجوز", cancelled: "ملغي", paid: "خالص", attended: "حاضر" },
    perTutor: "حسب الأستاذ",
    unknownTitle: "أساتذة ما لقيناهمش",
    unknownNote: "صلّح ولا نحّي السطور هاذم باش تنزّل الملف:",
    tooMany: (n: number) => `أكثر من ${n} حجز: قصّر المدّة باش تنزّل الملف.`,
    sampleTitle: (n: number) => `أوّل ${n} سطر`,
    empty: "ما فمّا حتى حجز للأساتذة هاذم في المدّة هاذي.",
    studentFirstName: "التلميذ (الاسم الأوّل):",
    errors: {
      "missing-tutors": "حطّ أستاذ واحد على الأقل.",
      "too-many-tutors": (l: Limits) => `برشا أساتذة: ${l.maxTutors} على الأكثر.`,
      "invalid-tutors": "ليستة الأساتذة ما تتقراش.",
      "invalid-from": "تاريخ البداية موش صحيح.",
      "invalid-to": "تاريخ النهاية موش صحيح.",
      "range-reversed": "تاريخ البداية بعد تاريخ النهاية.",
      "range-too-long": (l: Limits) => `المدّة فايتة ${l.maxDays} يوم.`,
      generic: "صار مشكل. عاود.",
    } as Record<string, string | ((l: Limits) => string)>,
  },
});

const pad = (n: number) => String(n).padStart(2, "0");
/** This month in Tunis: its first day and its last day. */
function thisMonth(): { from: string; to: string } {
  const w = tunisWallTime(new Date());
  const last = new Date(Date.UTC(w.year, w.month, 0)).getUTCDate();
  return { from: `${w.year}-${pad(w.month)}-01`, to: `${w.year}-${pad(w.month)}-${pad(last)}` };
}

export default function AdminExportsPage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const [checking, setChecking] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [tutors, setTutors] = useState("");
  const [{ from, to }, setRange] = useState(thisMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingExportPreview | null>(null);
  const [limits, setLimits] = useState({ maxTutors: 50, maxDays: 366 });

  /* Who may see this page is the API's decision. An empty query reads nothing: the
     API answers "forbidden" to anyone off the allowlist, "missing-tutors" to an admin. */
  useEffect(() => {
    let alive = true;
    previewBookingsExport({ tutors: "", from: "", to: "" })
      .then((res) => {
        if (!alive) return;
        setAdmin(res.error !== "forbidden");
        if (res.maxTutors && res.maxDays) setLimits({ maxTutors: res.maxTutors, maxDays: res.maxDays });
      })
      .catch(() => { if (alive) setAdmin(false); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  async function onPreview(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await previewBookingsExport({ tutors, from, to });
      if (res.ok) setResult(res);
      else {
        setResult(null);
        if (res.error === "forbidden") setAdmin(false);
        else {
          const msg = c.errors[res.error ?? ""] ?? c.errors.generic;
          setError(typeof msg === "function" ? msg(limits) : msg);
        }
      }
    } catch {
      setResult(null);
      setError(c.errors.generic as string);
    } finally {
      setBusy(false);
    }
  }

  // The file is the SAME query the summary was computed for, not whatever is typed now.
  const downloadable = result?.ok && (result.unknown?.length ?? 0) === 0 && (result.total ?? 0) <= (result.rowLimit ?? Infinity);
  const href = result?.ok
    ? `/api/admin/bookings-export-csv?${new URLSearchParams({ tutors: (result.tutors ?? []).map((t) => t.slug).join(","), from: result.from ?? "", to: result.to ?? "" }).toString()}`
    : "";

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
                <p className="mt-2 leading-[1.6] font-bold" data-e2e="exports-help">{c.help}</p>
                <AdminTabs current="exports" />
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
              <form onSubmit={onPreview} className="panel panel-pad flex flex-col gap-4" data-e2e="exports-form" noValidate>
                <label className="block">
                  <span className="field-label block mb-1.5">{c.tutorsLabel}</span>
                  <span className="inp block">
                    <textarea
                      rows={4}
                      value={tutors}
                      onChange={(e) => setTutors(e.target.value)}
                      maxLength={8000}
                      autoComplete="off"
                      spellCheck={false}
                      dir="ltr"
                      aria-describedby="exports-tutors-hint"
                      data-e2e="exports-tutors"
                    />
                  </span>
                  <span id="exports-tutors-hint" className="muted block mt-1.5 text-[13px] leading-[1.5]">{c.tutorsHint(limits.maxTutors)}</span>
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex-[1_1_160px] min-w-0">
                    <span className="field-label block mb-1.5">{c.fromLabel}</span>
                    <span className="inp block">
                      <input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-describedby="exports-range-hint" data-e2e="exports-from" />
                    </span>
                  </label>
                  <label className="flex-[1_1_160px] min-w-0">
                    <span className="field-label block mb-1.5">{c.toLabel}</span>
                    <span className="inp block">
                      <input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-describedby="exports-range-hint" data-e2e="exports-to" />
                    </span>
                  </label>
                </div>
                <p id="exports-range-hint" className="muted text-[13px] leading-[1.5] -mt-2">{c.rangeHint(limits.maxDays)}</p>
                {error && <p role="alert" className="text-[14px] font-bold" data-e2e="exports-error">{error}</p>}
                <div>
                  <button type="submit" className="btn btn-primary" disabled={busy} data-e2e="exports-preview">
                    {busy ? c.previewing : c.preview}
                  </button>
                </div>
              </form>

              {result?.ok && (
                <section className="panel panel-pad mt-4 flex flex-col gap-4" aria-live="polite" data-e2e="exports-result">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-display text-[20px]" data-e2e="exports-total">{c.total(result.total ?? 0)}</p>
                    {downloadable && (
                      /* A plain download link: the route handler forwards the session to the API. */
                      <a href={href} className="btn btn-outline btn-sm w-auto" download data-e2e="exports-csv">{c.csv}</a>
                    )}
                  </div>

                  <ul className="flex flex-wrap gap-2" data-e2e="exports-by-status">
                    {STATUS_KEYS.filter((s) => ALWAYS_SHOWN.has(s) || (result.byStatus?.[s] ?? 0) > 0).map((s) => (
                      <li key={s} className="inline-flex items-center rounded-full border border-solid border-line px-3 py-1 text-[14px]" data-status={s}>
                        {c.statuses[s]} · {result.byStatus?.[s] ?? 0}
                      </li>
                    ))}
                  </ul>

                  {(result.unknown?.length ?? 0) > 0 && (
                    <div role="alert" className="flex flex-col gap-1.5" data-e2e="exports-unknown">
                      <p className="font-bold">{c.unknownTitle}</p>
                      <p className="muted text-[14px]">{c.unknownNote}</p>
                      <ul className="flex flex-wrap gap-2 text-[14px] list-none p-0">
                        {result.unknown!.map((u) => <li key={u} dir="ltr"><UserText>{u}</UserText></li>)}
                      </ul>
                    </div>
                  )}

                  {(result.total ?? 0) > (result.rowLimit ?? Infinity) && (
                    <p role="alert" className="font-bold text-[14px]">{c.tooMany(result.rowLimit ?? 0)}</p>
                  )}

                  {(result.tutors?.length ?? 0) > 0 && (
                    <div>
                      <h2 className="font-bold text-[16px] mb-1.5">{c.perTutor}</h2>
                      <ul className="grid gap-1 text-[14px]" data-e2e="exports-tutors-found">
                        {result.tutors!.map((t) => (
                          <li key={t.slug} className="flex flex-wrap gap-x-2">
                            <UserText>{t.name}</UserText>
                            <span className="muted" dir="ltr">{t.slug}</span>
                            <span>· {c.total(t.bookings)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(result.sample?.length ?? 0) === 0 ? (
                    <p role="status" className="muted">{c.empty}</p>
                  ) : (
                    <div>
                      <h2 className="font-bold text-[16px] mb-1.5">{c.sampleTitle(result.sample!.length)}</h2>
                      <ul className="flex flex-col gap-2" data-e2e="exports-sample">
                        {result.sample!.map((r, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14px] border-b border-solid border-line pb-2" data-e2e="exports-row">
                            <span dir="ltr" className="font-bold">{r.classAt}</span>
                            <UserText>{r.classTitle}</UserText>
                            <span className="muted"><UserText>{r.tutorName}</UserText></span>
                            <span>{c.studentFirstName} <UserText>{r.studentName ?? "—"}</UserText></span>
                            <span data-status={r.status ?? ""}>{r.status ? (c.statuses[r.status as (typeof STATUS_KEYS)[number]] ?? r.status) : "—"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </section>
    </SiteShell>
  );
}
