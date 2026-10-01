"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Users, ChevronDown } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { MessageBookingButton } from "@/components/MessageBookingButton";
import { getMyStudents } from "@/app/actions-shell";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { formatNumericDate, tunisClock, type TutorStudent, type TutorStudentRelation, type TutorStudentStatus } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — « Mes élèves » (/dashboard/students): everyone who booked
   one of the tutor's classes, one row each, FIRST NAME ONLY (Step 8 — no phone, no
   e-mail, no surname: GET /tutor/students never selects them). Each row opens on
   that student's history with this tutor, and every booking keeps its « Message »
   button — the one channel there is.

   The rows are built to grow: growth adds followers (phase 4) and subscribers
   (phase 5) as more `relations` on the same TutorStudent, so a follower who never
   booked is a row with an empty history. */

const copy = bilingual({
  fr: {
    title: "Mes élèves",
    sub: "Ceux qui ont réservé une séance avec toi, suivent ta page ou sont abonnés.", // espace prof v2 · growth (P4, P5): followers and subscribers too
    note: "Tu vois le prénom de tes élèves, jamais leurs coordonnées : vous échangez par la messagerie de chaque séance.",
    count: (n: number) => (n === 1 ? "1 élève" : `${n} élèves`),
    emptyTitle: "Personne n'a encore réservé",
    emptyBody: "Partage ton lien : dès qu'un élève réserve une séance, il apparaît ici, avec son prénom et ses séances.",
    emptyCta: "Voir ma vitrine",
    since: (d: string) => `depuis le ${d}`,
    history: "Historique",
    anon: "Élève",
    rel: { booked: "A réservé", follower: "Suit ta page", subscriber: "Abonné" } as Record<TutorStudentRelation, string>,
    st: { upcoming: "Séance à venir", past: "Ancien élève", cancelled: "Réservation annulée", none: "Pas de séance" } as Record<TutorStudentStatus, string>,
    bk: { reserved: "Réservé", paid: "Payé", attended: "Présent", cancelled: "Annulé" } as Record<string, string>,
    free: "1ʳᵉ séance offerte",
    messageTo: (n: string) => `Écrire à ${n}`,
  },
  ar: {
    title: "تلامذتي",
    sub: "اللي حجزو حصة معاك، يتبّعو صفحتك ولا مشتركين.",
    note: "تشوف الاسم الأول متاع تلامذتك، عمرك ما تشوف معلومات الاتصال: تتراسلو عبر رسائل كل حصة.",
    count: (n: number) => `${n} تلميذ`,
    emptyTitle: "ما زال حتّى حد ما حجز",
    emptyBody: "شارك اللينك متاعك: أوّل ما تلميذ يحجز حصة، يبان هوني، بإسمو وحصصو.",
    emptyCta: "شوف واجهتي",
    since: (d: string) => `من ${d}`,
    history: "التاريخ",
    anon: "تلميذ",
    rel: { booked: "حجز", follower: "يتبّع صفحتك", subscriber: "مشترك" } as Record<TutorStudentRelation, string>,
    st: { upcoming: "عندو حصة جاية", past: "تلميذ قديم", cancelled: "الحجز تلغى", none: "ما عندو حتى حصة" } as Record<TutorStudentStatus, string>,
    bk: { reserved: "محجوز", paid: "خالص", attended: "حاضر", cancelled: "ملغي" } as Record<string, string>,
    free: "الحصة الأولى فابور",
    messageTo: (n: string) => `راسل ${n}`,
  },
});

const STATUS_CLASS: Record<TutorStudentStatus, string> = {
  upcoming: "chip chip-soft",
  past: "chip chip-sand",
  cancelled: "chip chip-rose",
  none: "chip chip-sand",
};

export function StudentsView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const [rows, setRows] = useState<TutorStudent[] | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getMyStudents()
      .then((r) => setRows(r ?? []))
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (rows === undefined) body = <PageSkeleton rows={4} />;
  else if (!rows || rows.length === 0) {
    body = (
      <EmptyState icon={<Users />} title={c.emptyTitle} action={<Link href="/dashboard/storefront" className="btn btn-ghost btn-sm">{c.emptyCta}</Link>}>
        {c.emptyBody}
      </EmptyState>
    );
  } else {
    body = (
      <section className="u-card u-card-pad" aria-labelledby="ms-t">
        <h2 id="ms-t" className="hp-card-t mb-2">{c.count(rows.length)}</h2>
        <ul className="ms-list" data-e2e="students-list">
          {rows.map((s) => {
            const name = s.name ?? c.anon;
            return (
              <li key={s.key} className="ms-row" data-e2e="student-row">
                <details className="ms-details">
                  <summary className="ms-sum">
                    <span className="avatar sq ms-av" aria-hidden="true">{s.initials}</span>
                    <span className="min-w-0 flex-1">
                      <UserText as="span" className="ms-name" data-e2e="student-name">{name}</UserText>
                      <span className="ms-meta">
                        <span className={STATUS_CLASS[s.status]} data-e2e="student-status">{c.st[s.status]}</span>
                        {s.relations.map((r) => (
                          <span key={r} className="tag tag-neutral">{c.rel[r]}</span>
                        ))}
                        <span>{c.since(formatNumericDate(s.since))}</span>
                      </span>
                    </span>
                    {s.bookings.length > 0 && <ChevronDown className="ms-chev" />}
                  </summary>
                  {s.bookings.length > 0 && (
                    <div className="ms-history">
                      <h3 className="ms-history-t">{c.history}</h3>
                      <ul>
                        {s.bookings.map((b) => (
                          <li key={b.bookingId} className="ms-bk">
                            <div className="min-w-0 flex-1">
                              <Link href={`/class/${b.classId}`} className="ms-bk-t">
                                <UserText>{b.classTitle}</UserText>
                              </Link>
                              <div className="ms-bk-m">
                                <time dateTime={new Date(b.classTs).toISOString()}>
                                  {formatNumericDate(b.classTs)} · {tunisClock(b.classTs)}
                                </time>
                                <span>{c.bk[b.status] ?? b.status}</span>
                                {b.isFree && <span>{c.free}</span>}
                              </div>
                            </div>
                            {b.status !== "cancelled" && (
                              <MessageBookingButton bookingId={b.bookingId} ariaLabel={c.messageTo(name)} />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  return (
    <AppPage title={c.title} subtitle={c.sub} note={c.note}>
      {body}
    </AppPage>
  );
}
