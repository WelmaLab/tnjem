"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { UserText } from "@/components/UserText";
import { Verified } from "@/components/ui";
import { Plus, Search, Users } from "@/components/icons";
import { AppPage, EmptyState, ErrorState, PageSkeleton } from "@/components/app/AppShell";
import { WrongRoleNotice } from "@/components/WrongRoleNotice";
import { FollowButton } from "@/components/follow/FollowButton";
import { getStudentProfs, type StudentProfsResult } from "@/app/actions-student";
import { levelsLabel, formatInTunis, type StudentProfCard, type StudentSubscriptionRow } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { MessageLink } from "./MessageLink";
import { ProfAvatar } from "./ProfAvatar";
import { subjectOf, whenLabel } from "./format";

/* MES PROFS (/student/profs) — student-space-v1 · D (mockup 2b).

   The union of the profs the student follows (tutor_follows — GET /follows/mine had no
   page until now) and the profs they had a class with. Each card: the monogram, the
   name (« Walid T. »), Vérifié, the subject and levels, the next class, the classes
   taken, the fiches available and « n nouvelle(s) »; Réserver · Message · « Suivi ✓ »
   (unfollowing asks first). Last, a dashed « Un autre prof ? » card → Explore.
   « Abonnements mensuels » only when the student has a student_subscriptions row.
   « séances passées », never « suivies »: we do not track attendance. */

const copy = bilingual({
  fr: {
    title: "Mes profs",
    sub: "Les profs que tu suis et ceux avec qui tu as eu cours : tu es prévenu de leurs nouvelles séances et fiches.",
    find: "Trouver un prof",
    verified: "Vérifié",
    verifiedAria: "Prof vérifié",
    next: "Prochaine :",
    booked: "tu es inscrit",
    noNext: "Pas de séance prévue pour l'instant",
    taken: (n: number) => (n === 0 ? "aucune séance passée" : n === 1 ? "1 séance passée" : `${n} séances passées`),
    fiches: (n: number) => (n === 0 ? "aucune fiche" : n === 1 ? "1 fiche" : `${n} fiches`),
    isNew: (n: number) => (n === 1 ? "1 nouvelle" : `${n} nouvelles`),
    book: "Réserver",
    bookAria: (n: string) => `Réserver une séance avec ${n}`,
    otherT: "Un autre prof ?",
    otherB: "Cherche par matière, niveau ou nom.",
    explore: "Explorer",
    emptyT: "Pas encore de prof",
    emptyB: "Suis un prof depuis sa page, ou réserve une séance : il apparaît ici, avec ses prochaines séances et ses fiches.",
    subsT: "Abonnements mensuels",
    subLine: (n: number) => `${n} séance${n > 1 ? "s" : ""} / mois`,
    left: (n: number) => (n === 1 ? "1 restante" : `${n} restantes`),
    renews: (d: string) => `renouvellement le ${d}`,
    status: { requested: "Demandé", active: "Actif", paused: "En pause", cancelled: "Annulé", expired: "Terminé" } as Record<StudentSubscriptionRow["status"], string>,
  },
  ar: {
    title: "أساتذتي",
    sub: "الأساتذة اللي تتابعهم واللي قريت معاهم : يوصلك خبر بحصصهم وملفاتهم الجديدة.",
    find: "لقّى أستاذ",
    verified: "متثبّت منّو",
    verifiedAria: "أستاذ متثبّت منّو",
    next: "الجاية :",
    booked: "إنتي مسجّل",
    noNext: "ما فمّا حتى حصة مبرمجة لتوّا",
    taken: (n: number) => (n === 0 ? "حتى حصة ما فاتت" : n === 1 ? "حصة فاتت" : `${n} حصص فاتو`),
    fiches: (n: number) => (n === 0 ? "حتى ملف" : n === 1 ? "ملف" : `${n} ملفات`),
    isNew: (n: number) => (n === 1 ? "واحد جديد" : `${n} جدد`),
    book: "احجز",
    bookAria: (n: string) => `احجز حصة مع ${n}`,
    otherT: "أستاذ آخر ؟",
    otherB: "لوّج بالمادة، المستوى ولا الإسم.",
    explore: "اكتشف",
    emptyT: "ما زال ما عندكش أستاذ",
    emptyB: "تابع أستاذ من صفحتو، ولا احجز حصة : يبان هوني، بحصصو الجاية وملفاتو.",
    subsT: "الاشتراكات الشهرية",
    subLine: (n: number) => `${n} حصص / الشهر`,
    left: (n: number) => `${n} باقين`,
    renews: (d: string) => `التجديد نهار ${d}`,
    status: { requested: "مطلوب", active: "خدّام", paused: "موقوف", cancelled: "ملغي", expired: "وفى" } as Record<StudentSubscriptionRow["status"], string>,
  },
});

type Copy = (typeof copy)["fr"] | (typeof copy)["ar"];
type Locale = "fr" | "ar";

const STATUS_CLS: Record<StudentSubscriptionRow["status"], string> = {
  requested: "tag tag-soon ssv-tag-plain",
  active: "tag tag-success",
  paused: "chip chip-sand",
  cancelled: "chip chip-rose",
  expired: "chip chip-sand",
};

function ProfCard({ p, c, locale, onFollowChange }: { p: StudentProfCard; c: Copy; locale: Locale; onFollowChange: () => void }) {
  const subject = subjectOf(p.tutor.subject, locale);
  const levels = levelsLabel(p.tutor.levels, locale);
  const bookHref = p.nextClass && !p.nextClassBooked ? `/checkout?class=${encodeURIComponent(p.nextClass.classId)}` : `/${p.tutor.slug}`;
  return (
    <li className="u-card ssv-pcard" data-e2e="prof-card" data-tutor-id={p.tutor.id}>
      <div className="ssv-pcard-head">
        <ProfAvatar tutor={p.tutor} size={44} />
        <div className="min-w-0">
          <div className="ssv-sug-name">
            <Link href={`/${p.tutor.slug}`} className="ssv-row-link"><UserText>{p.tutor.name}</UserText></Link>
            {p.tutor.verified ? <span className="ssv-pill-ok"><Verified label={c.verifiedAria} /> {c.verified}</span> : null}
          </div>
          <div className="ssv-row-m">{[subject, levels].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="ssv-pcard-box">
        <p>
          {p.nextClass ? (
            <>
              {c.next} <b><time dateTime={p.nextClass.startsAt}>{whenLabel(p.nextClass.startsAt, locale)}</time></b>
              {p.nextClassBooked ? <> · {c.booked}</> : null}
            </>
          ) : (
            c.noNext
          )}
        </p>
        <p className="ssv-row-m" data-e2e="prof-counts">
          <span className="hp-num">{c.taken(p.taken)}</span> · <span className="hp-num">{c.fiches(p.fiches)}</span>
          {p.newFiches > 0 ? <> · <b className="ssv-new-txt">{c.isNew(p.newFiches)}</b></> : null}
        </p>
      </div>
      <div className="ssv-pcard-actions">
        <Link href={bookHref} className="btn btn-primary btn-sm" aria-label={c.bookAria(p.tutor.name)} data-e2e="prof-book">{c.book}</Link>
        <MessageLink tutorId={p.tutor.id} tutorName={p.tutor.name} />
        <FollowButton slug={p.tutor.slug} tutorName={p.tutor.name} confirmUnfollow onChange={onFollowChange} />
      </div>
    </li>
  );
}

function SubscriptionRow({ s, c, locale }: { s: StudentSubscriptionRow; c: Copy; locale: Locale }) {
  const parts = [c.subLine(s.sessionsPerMonth)];
  if (s.seatsLeft !== null) parts.push(c.left(s.seatsLeft));
  if (s.renewsAt) parts.push(c.renews(formatInTunis(s.renewsAt, locale, { day: "numeric", month: "short" })));
  return (
    <li className="ssv-row" data-e2e="subscription-row">
      <ProfAvatar tutor={s.tutor} />
      <div className="ssv-row-main">
        <span className="ssv-row-t"><UserText>{s.tutor.name}</UserText> — <UserText>{s.offerTitle}</UserText></span>
        <span className="ssv-row-m">{parts.join(" · ")}</span>
      </div>
      <span className={STATUS_CLS[s.status]} data-e2e="subscription-status">{c.status[s.status]}</span>
    </li>
  );
}

export function MesProfsView() {
  const { locale } = useLocale();
  const c = copy[locale];
  const [data, setData] = useState<StudentProfsResult | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    setFailed(false);
    getStudentProfs()
      .then(setData)
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const ok = data && data.ok ? data : null;
  const empty = Boolean(ok && ok.profs.length === 0);

  let body: React.ReactNode;
  if (failed) body = <ErrorState onRetry={load} />;
  else if (data === undefined) body = <PageSkeleton rows={3} />;
  else if (!data.ok) body = <WrongRoleNotice role="guardian" />;
  else if (empty) {
    body = (
      <EmptyState level={2} icon={<Users />} title={c.emptyT} action={<Link href="/explore" className="btn btn-primary btn-sm">{c.find}</Link>}>
        {c.emptyB}
      </EmptyState>
    );
  } else if (ok) {
    body = (
      <div className="ssv-stack">
        <ul className="ssv-pgrid">
          {ok.profs.map((p) => <ProfCard key={p.tutor.id} p={p} c={c} locale={locale} onFollowChange={load} />)}
          <li className="ssv-pcard-other" data-e2e="prof-other">
            <span className="ssv-other-ic" aria-hidden="true"><Search /></span>
            <p className="ssv-other-t">{c.otherT}</p>
            <p className="ssv-row-m">{c.otherB}</p>
            <Link href="/explore" className="btn btn-ghost btn-sm">{c.explore}</Link>
          </li>
        </ul>
        {ok.subscriptions.length > 0 ? (
          <section className="u-card u-card-pad ssv-card" aria-labelledby="ssv-subs-t" data-e2e="subscriptions">
            <h2 id="ssv-subs-t" className="hp-card-t ssv-card-head">{c.subsT}</h2>
            <ul className="ssv-list">{ok.subscriptions.map((s) => <SubscriptionRow key={s.id} s={s} c={c} locale={locale} />)}</ul>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <AppPage
      title={c.title}
      subtitle={c.sub}
      actions={ok && !empty ? <Link href="/explore" className="btn btn-primary btn-sm" data-e2e="profs-find"><Plus /> {c.find}</Link> : undefined}
    >
      {body}
    </AppPage>
  );
}
