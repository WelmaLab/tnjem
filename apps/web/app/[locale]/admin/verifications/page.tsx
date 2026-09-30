"use client";
import { useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { Button, Avatar, Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { SiteShell } from "@/components/SiteShell";
import { Shield, Check, Eye, Users, Forward } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { getPendingVerifications, approveTutor, rejectTutor } from "@/app/actions";
import { formatInTunis, type PendingTutor } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* Self-contained bilingual copy (FR + Tunisian Derija). Does NOT touch lib/i18n.ts. */
const copy = bilingual({
  fr: {
    eyebrow: "ADMIN",
    title: "Vérifications en attente",
    count: (n: number) => (n === 1 ? "1 demande" : `${n} demandes`),
    loading: "Chargement des demandes…",
    deniedTitle: "Accès réservé",
    deniedNote:
      "Cette page est réservée aux administrateurs. Si tu penses que c'est une erreur, contacte l'équipe.",
    signIn: "Se connecter",
    empty: "Aucune demande en attente ✓",
    emptyNote: "Toutes les candidatures ont été traitées.",
    submitted: "Soumis le",
    noDate: "Date inconnue",
    experience: "Expérience",
    years: (n: number) => `${n} ${n === 1 ? "an" : "ans"}`,
    institution: "Établissement",
    declaration: "Décret 2015-1619",
    declared: (d: string, v: string) => `Déclare ne pas enseigner dans le public (le ${d}, texte ${v}). Vérifie que l'établissement indiqué n'est pas une école publique où la personne enseigne.`,
    notDeclared: "Aucune déclaration (dossier antérieur) : ne pas valider avant de l'avoir obtenue.",
    languages: "Langues",
    pitch: "Présentation",
    notProvided: "Non renseigné",
    documents: "Documents",
    idRequired: "« Identité » est obligatoire.",
    links: "Liens",
    openDoc: "Ouvrir",
    approve: "Approuver",
    reject: "Refuser",
    notePlaceholder: "Motif du refus — le prof le lira",
    noteRequired: "Écris le motif du refus (5 caractères minimum) : le prof doit savoir quoi corriger.",
    noteTooLong: "Le motif ne peut pas dépasser 500 caractères.",
    notPending: "Cette demande a déjà été traitée.",
    changedSinceReview: "Le dossier a changé depuis que tu l'as ouvert. Recharge la page et revois-le avant de valider.",
    selfDecision: "Tu ne peux pas décider de ton propre dossier.",
    approved: "Tuteur approuvé ✓",
    rejected: "Demande refusée",
    error: "Une erreur s'est produite. Réessaie.",
    // phase-a lane L4 (A10)
    currentRound: (d: string) => `Envoyés le ${d}`,
    previousRounds: "Soumissions précédentes",
    previousRound: (d: string) => `Soumission du ${d}`,
    previousNote: "Pour comparaison seulement : la décision porte sur les documents ci-dessus.",
    // phase-a lane L4 (A15)
    declarationMissing: "Impossible de valider : ce dossier n'a pas la déclaration du décret 2015-1619. Refuse-le avec ce motif pour que le prof la fasse.",
    // phase-a lane L4 (A26)
    reReview: "Déjà vérifié · reste en ligne pendant cette revue",
    reReviewNote: "Tu valides ou refuses la modification. Un refus ne retire pas la vérification : pour ça, bloque le compte.",
    renameTo: "Nouveau nom demandé",
  },
  ar: {
    eyebrow: "أدمين",
    title: "الطلبات اللي تستنّى",
    count: (n: number) => (n === 1 ? "طلب واحد" : `${n} طلبات`),
    loading: "قاعدين نحمّلو الطلبات…",
    deniedTitle: "الدخول محجوز",
    deniedNote:
      "الصفحة هاذي محجوزة للأدمين برك. كان تحسب فمّا غلطة، اتصل بالفريق.",
    signIn: "ادخل",
    empty: "ما فمّاش طلبات تستنّى ✓",
    emptyNote: "الطلبات الكل تعالجو.",
    submitted: "تبعث في",
    noDate: "التاريخ موش معروف",
    experience: "الخبرة",
    years: (n: number) => `${n} ${n === 1 ? "عام" : "أعوام"}`,
    institution: "المؤسسة",
    declaration: "الأمر 2015-1619",
    declared: (d: string, v: string) => `يصرّح إنو ما يقرّيش في العمومي (نهار ${d}، نص ${v}). ثبّت اللي المؤسسة المذكورة موش مدرسة عمومية يقرّي فيها.`,
    notDeclared: "ما فمّاش تصريح (ملف قديم): ما تقبلوش قبل ما تتحصّل عليه.",
    languages: "اللغات",
    pitch: "التقديم",
    notProvided: "موش متعمّر",
    documents: "الوثائق",
    idRequired: "« الهوية » إجبارية.",
    links: "الروابط",
    openDoc: "حلّ",
    approve: "اقبل",
    reject: "ارفض",
    notePlaceholder: "سبب الرفض — المعلّم باش يقراه",
    noteRequired: "اكتب سبب الرفض (5 حروف على الأقل) : المعلّم لازم يعرف شنوّة يصلّح.",
    noteTooLong: "السبب ما ينجّمش يفوت 500 حرف.",
    notPending: "الطلب هذا تعالج قبل.",
    changedSinceReview: "الملف تبدّل من وقت ما حليتو. عاود حمّل الصفحة وثبّت فيه قبل ما تقبلو.",
    selfDecision: "ما تنجّمش تقرّر في ملفّك إنت.",
    approved: "المعلّم تقبل ✓",
    rejected: "الطلب تنرفض",
    error: "صار مشكل. عاود.",
    // phase-a lane L4 (A10)
    currentRound: (d: string) => `تبعثو نهار ${d}`,
    previousRounds: "الملفات اللي تبعثو قبل",
    previousRound: (d: string) => `ملف نهار ${d}`,
    previousNote: "للمقارنة برك: القرار يخص الوثائق اللي الفوق.",
    // phase-a lane L4 (A15)
    declarationMissing: "ما تنجّمش تقبلو: الملف هذا ما فيهش تصريح الأمر 2015-1619. ارفضو بالسبب هذا باش المعلّم يعمل التصريح.",
    // phase-a lane L4 (A26)
    reReview: "متأكّد من قبل · صفحتو تبقى ظاهرة وقت المراجعة هاذي",
    reReviewNote: "إنت تقبل ولا ترفض التبديل برك. الرفض ما ينحّيش التأكيد: كان تحب تنحّيه، احظر الحساب.",
    renameTo: "الاسم الجديد اللي طلبو",
  },
});

/* Friendly bilingual names for each document kind. */
const docNames: Record<string, { fr: string; ar: string }> = {
  id_front: { fr: "Identité (recto)", ar: "الهوية (وجه)" },
  id_back: { fr: "Identité (verso)", ar: "الهوية (ظهر)" },
  selfie: { fr: "Selfie + pièce", ar: "صورة + بطاقة" },
  diploma: { fr: "Diplôme", ar: "الشهادة" },
  certificate: { fr: "Certificat", ar: "شهادة" },
  role_proof: { fr: "Justificatif de rôle", ar: "إثبات الدور" },
};

const linkLabels: Record<string, string> = {
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  website: "Site web",
  introVideo: "Vidéo",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(iso: string | null, locale: "fr" | "ar"): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return formatInTunis(iso, locale, { day: "numeric", month: "long", year: "numeric" });
}

/* phase-a lane L4 (A10): a round's date WITH the time — two rounds can share a day. */
function formatRoundDate(iso: string | null, locale: "fr" | "ar"): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return formatInTunis(iso, locale, {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

type DocLinkItem = PendingTutor["docs"][number];

/** One document button. The same control on the card and in earlier rounds. */
function DocButton({ d, locale }: { d: DocLinkItem; locale: "fr" | "ar" }) {
  const nm = docNames[d.kind];
  const label = nm ? nm[locale] : d.kind;
  const required = d.kind === "id_front" || d.kind === "id_back";
  return (
    <a
      href={d.url}
      /* No new tab: the document downloads (Content-Disposition:
         attachment), and a tab would open empty. */
      title={d.fileName}
      className={`av-doc${required ? " av-doc-req" : ""}`}
    >
      <Eye className="w-[15px] h-[15px]" />
      {label}
      <Forward className="w-[13px] h-[13px] opacity-[0.6]" />
    </a>
  );
}

export default function AdminVerificationsPage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [items, setItems] = useState<PendingTutor[]>([]);
  /* tutorId currently being processed → "approve" | "reject" (disables that card's buttons) */
  const [busy, setBusy] = useState<Record<string, "approve" | "reject">>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getPendingVerifications();
        if (!alive) return;
        setAdmin(res.ok && res.admin);
        setItems(res.items ?? []);
      } catch {
        if (alive) setAdmin(false);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleApprove(tutorId: string, submittedAt: string | null, pendingName: string | null) {
    setBusy((b) => ({ ...b, [tutorId]: "approve" }));
    // The version on screen: the API refuses to approve a dossier that changed since.
    // phase-a lane L4 (A26): the requested name on screen is bound the same way.
    const res = await approveTutor({ tutorId, submittedAt, pendingName });
    if (res.ok) {
      setItems((list) => list.filter((t) => t.tutorId !== tutorId));
      showToast(c.approved);
    } else {
      showToast(refusalMessage(res.error));
      setBusy((b) => {
        const next = { ...b };
        delete next[tutorId];
        return next;
      });
    }
  }

  /* The server's refusal, in words an admin can act on. A generic "error" used to
     cover "already decided by someone else" and "you forgot the reason" alike. */
  function refusalMessage(code: string | undefined): string {
    switch (code) {
      case "note-required": return c.noteRequired;
      case "note-too-long": return c.noteTooLong;
      case "not-pending": return c.notPending;
      case "changed-since-review": return c.changedSinceReview;
      case "self-approval-forbidden": return c.selfDecision;
      case "declaration-missing": return c.declarationMissing; // phase-a lane L4 (A15)
      default: return c.error;
    }
  }

  async function handleReject(tutorId: string) {
    const note = notes[tutorId]?.trim() ?? "";
    if (note.length < 5) {
      showToast(c.noteRequired);
      return;
    }
    setBusy((b) => ({ ...b, [tutorId]: "reject" }));
    const res = await rejectTutor({ tutorId, note });
    if (res.ok) {
      setItems((list) => list.filter((t) => t.tutorId !== tutorId));
      showToast(c.rejected);
    } else {
      showToast(refusalMessage(res.error));
      setBusy((b) => {
        const next = { ...b };
        delete next[tutorId];
        return next;
      });
    }
  }

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      <section className="web-section tight">
        <div className="container container-narrow">
          {/* Header */}
          <div className="av-head">
            <span className="web-eyebrow av-eyebrow">
              <Shield className="w-4 h-4" />
              {c.eyebrow}
            </span>
            <h1 className="web-h2">{c.title}</h1>
            {!loading && admin && (
              <div className="av-count">
                <Users className="w-[15px] h-[15px]" />
                {c.count(items.length)}
              </div>
            )}
            {!loading && admin && <AdminTabs current="verifications" /> /* UI Option A (A9) */}
          </div>

          {/* Loading */}
          {loading && (
            <div className="panel panel-pad av-center">
              <Spinner />
              <p className="muted mt-1">{c.loading}</p>
            </div>
          )}

          {/* Access denied (not admin / signed out / demo) */}
          {!loading && !admin && (
            <div className="panel panel-pad av-center rise">
              <div className="av-deny-icon">
                <Shield className="w-[30px] h-[30px]" />
              </div>
              <h2 className="font-display text-[22px] tracking-[-0.5px]">
                {c.deniedTitle}
              </h2>
              <p className="muted max-w-[420px] leading-[1.6]">
                {c.deniedNote}
              </p>
              <Link href="/auth" className="w-auto">
                <Button variant="primary" sm>{c.signIn}</Button>
              </Link>
            </div>
          )}

          {/* Empty state */}
          {!loading && admin && items.length === 0 && (
            <div className="panel panel-pad av-center rise">
              <div className="av-empty-icon">
                <Check className="w-[30px] h-[30px]" />
              </div>
              <h2 className="font-display text-[20px] tracking-[-0.5px]">
                {c.empty}
              </h2>
              <p className="muted">{c.emptyNote}</p>
            </div>
          )}

          {/* Application list */}
          {!loading && admin && items.length > 0 && (
            <div className="av-list">
              {items.map((t) => {
                const state = busy[t.tutorId];
                const disabled = !!state;
                const dateStr = formatDate(t.submittedAt, locale);
                const presentKinds = new Set(t.docs.map((d) => d.kind));
                const hasId = presentKinds.has("id_front") || presentKinds.has("id_back");
                const activeLinks = Object.entries(t.links).filter(
                  ([, v]) => typeof v === "string" && v.trim().length > 0
                ) as [string, string][];

                return (
                  <article key={t.tutorId} className="panel panel-pad av-card rise">
                    {/* Card header */}
                    <header className="av-card-head">
                      <Avatar initials={initials(t.name)} size={56} square />
                      <div className="min-w-0">
                        {/* h2, not h3. The two h2s above belong to the EMPTY and
                            DENIED states, which never render at the same time as
                            this list — so in the DOM a screen reader actually
                            walks, this jumped h1 -> h3 and every applicant name
                            was announced at a level with no parent. */}
                        <UserText as="h2" className="av-name">{t.name}</UserText>
                        <div className="av-sub">
                          <UserText className="chip chip-soft">{t.subject}</UserText>
                          <span className="av-slug">tnajem.com/{t.slug}</span>
                        </div>
                      </div>
                      <div className="av-date">
                        {c.submitted}{" "}
                        <b>{dateStr ?? c.noDate}</b>
                      </div>
                    </header>

                    {/* phase-a lane L4 (A26): a verified tutor's re-review — what changes. */}
                    {t.reReview && (
                      <div className="av-block" data-e2e="re-review">
                        <span className="chip chip-soft">{c.reReview}</span>
                        {t.pendingName && (
                          <p className="text-[14px]">
                            <span className="av-label">{c.renameTo} · </span>
                            <UserText as="b">{t.pendingName}</UserText>
                          </p>
                        )}
                        <p className="muted text-[13px]">{c.reReviewNote}</p>
                      </div>
                    )}

                    {/* Details grid */}
                    <div className="av-grid">
                      <div className="av-field">
                        <span className="av-label">{c.experience}</span>
                        <span className="av-value">
                          {t.experienceYears != null ? c.years(t.experienceYears) : c.notProvided}
                        </span>
                      </div>
                      <div className="av-field">
                        <span className="av-label">{c.institution}</span>
                        <span className="av-value">{t.institution ? <UserText>{t.institution}</UserText> : c.notProvided}</span>
                      </div>
                      <div className="av-field">
                        <span className="av-label">{c.languages}</span>
                        <span className="av-value">{t.languages ? <UserText>{t.languages}</UserText> : c.notProvided}</span>
                      </div>
                    </div>

                    {/* Décret 2015-1619: the declaration, read against the institution above. */}
                    <p className="text-[13px] leading-[1.6] my-3" data-e2e="decree-line">
                      <span className="av-label">{c.declaration} · </span>
                      {t.publicTeacherDeclaration
                        ? c.declared(formatInTunis(t.publicTeacherDeclaration.declaredAt, locale, { day: "numeric", month: "long", year: "numeric" }), t.publicTeacherDeclaration.version)
                        : <b className="text-rose">{c.notDeclared}</b>}
                    </p>

                    {/* Pitch */}
                    {t.pitch && (
                      <blockquote className="av-pitch">
                        <span className="av-label">{c.pitch}</span>
                        <UserText as="p">{t.pitch}</UserText>
                      </blockquote>
                    )}

                    {/* Documents */}
                    <div className="av-block">
                      <div className="av-block-head">
                        <span className="av-label">{c.documents}</span>
                        {!hasId && <span className="chip chip-rose">{c.idRequired}</span>}
                      </div>
                      {/* phase-a lane L4 (A10): the CURRENT round only, dated. */}
                      {t.docsSubmittedAt && formatRoundDate(t.docsSubmittedAt, locale) && (
                        <p className="muted text-[13px]" data-e2e="current-round">
                          {c.currentRound(formatRoundDate(t.docsSubmittedAt, locale) ?? "")}
                        </p>
                      )}
                      {t.docs.length > 0 ? (
                        <div className="av-docs" data-e2e="current-docs">
                          {t.docs.map((d) => <DocButton key={d.id} d={d} locale={locale} />)}
                        </div>
                      ) : (
                        <p className="muted text-[13px]">{c.notProvided}</p>
                      )}
                    </div>

                    {/* phase-a lane L4 (A10): earlier rounds, collapsed, grouped and dated —
                        never mixed into the documents the decision is about. */}
                    {(t.previousRounds ?? []).length > 0 && (
                      <details className="av-prev" data-e2e="previous-rounds">
                        <summary className="av-label">{c.previousRounds} ({t.previousRounds.length})</summary>
                        <p className="muted text-[13px] mt-2">{c.previousNote}</p>
                        {t.previousRounds.map((r) => (
                          <div key={r.submittedAt} className="av-block mt-3">
                            <span className="text-[13px] font-bold">
                              {c.previousRound(formatRoundDate(r.submittedAt, locale) ?? c.noDate)}
                            </span>
                            <div className="av-docs">
                              {r.docs.map((d) => <DocButton key={d.id} d={d} locale={locale} />)}
                            </div>
                          </div>
                        ))}
                      </details>
                    )}

                    {/* Links */}
                    {activeLinks.length > 0 && (
                      <div className="av-block">
                        <span className="av-label">{c.links}</span>
                        <div className="av-links">
                          {activeLinks.map(([key, url]) => (
                            <a
                              key={key}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="av-link"
                            >
                              {linkLabels[key] ?? key}
                              <Forward className="w-3 h-3 opacity-[0.6]" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="av-actions">
                      <div className="av-approve">
                        <Button
                          variant="primary" /* Phase A+ (U3): the card's main action is ochre */
                          onClick={() => handleApprove(t.tutorId, t.submittedAt, t.pendingName ?? null)}
                          disabled={disabled}
                        >
                          {state === "approve" ? (
                            <span className="av-btn-spin" aria-hidden="true" />
                          ) : (
                            <Check className="w-[18px] h-[18px]" />
                          )}
                          {c.approve}
                        </Button>
                      </div>
                      <div className="av-reject">
                        <label className="inp av-note">
                          <input
                            type="text"
                            value={notes[t.tutorId] ?? ""}
                            onChange={(e) =>
                              setNotes((n) => ({ ...n, [t.tutorId]: e.target.value }))
                            }
                            placeholder={c.notePlaceholder}
                            aria-label={c.notePlaceholder}
                            required
                            minLength={5}
                            maxLength={500}
                            disabled={disabled}
                          />
                        </label>
                        <Button
                          variant="ghost"
                          onClick={() => handleReject(t.tutorId)}
                          disabled={disabled}
                        >
                          {state === "reject" ? (
                            <span className="av-btn-spin dark" aria-hidden="true" />
                          ) : null}
                          {c.reject}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
      {toast}
    </SiteShell>
  );
}

const PAGE_CSS = `
.av-head{margin-bottom:clamp(20px,3vw,30px)}
.av-eyebrow{display:inline-flex;align-items:center;gap:6px;margin-bottom:8px}
.av-count{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-size:13.5px;font-weight:700;color:var(--ink2);background:var(--blue50);color:var(--blue);padding:5px 12px;border-radius:999px}
.av-center{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding-block:clamp(28px,5vw,44px)}
.av-deny-icon{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:var(--blue50);color:var(--blue)}
.av-empty-icon{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:var(--green50);color:var(--green)}
.av-list{display:flex;flex-direction:column;gap:clamp(16px,2.4vw,22px)}
.av-card{display:flex;flex-direction:column;gap:16px}
.av-card-head{display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap}
.av-name{font-family:var(--fd);font-size:18px;letter-spacing:-0.4px;line-height:1.2}
.av-sub{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}
.av-slug{font-family:var(--fd);font-size:13px;color:var(--muted)}
.av-date{font-size:13px;color:var(--muted);margin-inline-start:auto;text-align:end;line-height:1.5}
.av-date b{display:block;color:var(--ink2);font-weight:700}
.av-grid{display:grid;grid-template-columns:1fr;gap:12px;padding:14px 0;border-block:1px solid var(--line)}
@media (min-width:540px){.av-grid{grid-template-columns:repeat(3,1fr)}}
.av-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.av-label{font-size:13px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}
.av-value{font-size:14px;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.av-pitch{background:var(--cream);border-inline-start:3px solid var(--ochre);border-radius:0 var(--r-s) var(--r-s) 0;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
html[dir="rtl"] .av-pitch{border-radius:var(--r-s) 0 0 var(--r-s)}
.av-pitch p{font-size:14px;line-height:1.6;color:var(--ink2);font-style:italic}
.av-block{display:flex;flex-direction:column;gap:8px}
.av-block-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.av-docs{display:flex;flex-wrap:wrap;gap:8px}
/* min-height 44px: 8px of padding around 13px text gave a 34px target, and this
     is the control that opens somebody's ID document — the one thing on this page
     an admin must not mis-tap. */
  .av-doc{display:inline-flex;align-items:center;gap:7px;min-height:44px;font-size:13px;font-weight:700;padding:8px 12px;border-radius:11px;background:var(--blue50);color:var(--blue);border:1px solid transparent;transition:.15s}
.av-doc:hover{border-color:var(--blue)}
.av-doc-req{background:var(--sand);color:var(--ink2)}
/* phase-a lane L4 (A10): earlier rounds, collapsed under the current documents. */
.av-prev{border-top:1px dashed var(--line);padding-top:8px}
.av-prev summary{cursor:pointer;min-height:44px;display:flex;align-items:center}
.av-links{display:flex;flex-wrap:wrap;gap:8px}
.av-link{display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;padding:6px 11px;border-radius:999px;border:1.5px solid var(--line);color:var(--ink2);transition:.15s}
.av-link:hover{border-color:var(--blue);color:var(--blue)}
.av-actions{display:grid;grid-template-columns:1fr;gap:12px;padding-top:4px;border-top:1px solid var(--line);margin-top:2px;padding-block-start:16px}
@media (min-width:680px){.av-actions{grid-template-columns:auto 1fr;align-items:start}}
.av-approve .btn{width:100%}
@media (min-width:680px){.av-approve .btn{width:auto}}
.av-reject{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}
/* No vertical padding: .inp puts it on the INPUT now (globals.css), and 11px more
   on this wrapper made the note field ~69px tall next to a 48px button row. */
.av-note{flex:1;min-width:160px;margin:0}
.av-reject .btn{width:auto;flex:none}
.av-btn-spin{width:16px;height:16px;border:2.5px solid rgba(255,255,255,.45);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite}
.av-btn-spin.dark{border-color:rgba(16,31,51,.25);border-top-color:var(--ink)}
`;
