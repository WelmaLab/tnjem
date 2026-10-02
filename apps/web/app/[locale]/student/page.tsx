"use client";
import { useCallback, useEffect, useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Avatar, Button, Chip, Spinner } from "@/components/ui";
import { Play, Video, Star, Clock, Calendar } from "@/components/icons";
import { getStudentDashboard, getMe, cancelBooking, createReview } from "@/app/actions";
import type { StudentClass, StudentDashboard } from "@tnajem/shared";
/* The 48h window and the 40% rate come from the ONE place that defines them.
   A component hardcoding 0.4 is a component that disagrees with the server the
   first time the rate moves — and this one renders the number to a student. */
import { CANCEL_FREE_WINDOW_MS, CANCEL_FREE_WINDOW_HOURS, LATE_CANCEL_RETAINED_PCT, monthLabel } from "@tnajem/shared";
import { SiteShell } from "@/components/SiteShell";
import { MessageBookingButton } from "@/components/MessageBookingButton";
import { UserText } from "@/components/UserText";
import { bilingual } from "@/lib/i18n";

/* Page-local copy (never lib/i18n.ts — that file is shared).
   Everything on this page comes from getStudentDashboard(): no demo class,
   no fake countdown. Signed out → we say so; no bookings → we say so. */
const copy = bilingual({
  fr: {
    upcoming: "Prochains cours",
    startsIn: "Commence dans",
    liveNow: "C'est en direct maintenant",
    at: "à",
    cancel: "Annuler ma place",
    cancelSure: "Annuler cette réservation ?",
    cancelYes: "Oui, annuler",
    cancelNo: "Garder ma place",
    cancelRule: `Annulation gratuite jusqu'à ${CANCEL_FREE_WINDOW_HOURS}h avant le cours.`,
    cancelLocked: "Le cours a commencé — l'annulation en ligne est fermée. Préviens ton prof, il s'arrangera avec toi.",
    /* Shown INSIDE the window, in the confirm box, BEFORE the student commits.
       The last sentence is not optional: nothing is charged today, and a bare
       percentage on screen reads as a debit. */
    cancelLateWarn: `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux quand même annuler, et ta place repart tout de suite — ${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} % du prix de la place est noté comme retenu pour ton prof. Aucun montant n'est prélevé pendant le pilote.`,
    /* phase-a lane L3 (A21): the REAL figure for this seat (GET /student/dashboard →
       lateCancelRetainedTnd). The flat "40 %" above stays only as the fallback for a
       payload without it. While payments are off this is the ledger outcome —
       noted, never taken. */
    cancelLateWarnAmount: (tnd: string) => `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux quand même annuler, et ta place repart tout de suite — ${tnd} TND (${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} % du prix de la place) seront notés comme retenus pour ton prof dans le registre des annulations. Aucun montant n'est prélevé pendant le pilote.`,
    cancelLateWarnNothing: `Le cours est dans moins de ${CANCEL_FREE_WINDOW_HOURS}h. Tu peux annuler, ta place repart tout de suite, et rien n'est retenu pour cette place.`,
    cancelledLateAmount: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont notés comme retenus pour ton prof dans le registre des annulations. Rien n'est prélevé pendant le pilote.`,
    cancelledLateCharged: (tnd: string) => `Réservation annulée, la place est de nouveau libre. C'était à moins de ${CANCEL_FREE_WINDOW_HOURS}h : ${tnd} TND sont retenus pour ton prof.`,
    cancelledNothing: "Réservation annulée, la place est de nouveau libre. Rien n'est retenu pour cette place.",
    alreadyStarted: "Le cours a déjà commencé, on ne peut plus l'annuler en ligne. Écris à ton prof.",
    cancelErr: "L'annulation n'a pas marché. Réessaie.",
    messageTutor: "Écrire à",
    addCalendar: "Ajouter au calendrier", // espace prof v2 · pro (P7)
    cancelled: "Réservation annulée. La place est de nouveau libre.",
    free: "Gratuit",
    rate: "Noter mon prof",
    rateWith: (n: string) => `Comment était le cours avec ${n} ?`,
    ratePh: "Un mot pour les autres élèves (optionnel)",
    send: "Envoyer mon avis",
    sending: "Envoi…",
    thanks: "Merci ! Ton avis aide les autres élèves à choisir.",
    /* Step 8: a review is MASKED, not refused — losing three paragraphs over one
       line is worse than publishing them without it. Saying so matters: seeing
       "[masqué]" on the storefront with no explanation reads as censorship of
       the opinion rather than of the phone number. */
    thanksMasked: "Merci ! Ton avis est publié — on a retiré les coordonnées (numéro, email ou lien), qui ne sont pas autorisées sur une page publique.",
    already: "Tu as déjà noté ce cours.",
    notBooked: "Tu n'étais pas inscrit à ce cours.",
    notStarted: "Ce cours n'a pas encore eu lieu.",
    notEnded: "Tu pourras noter ce cours une fois la séance terminée.", // phase-a lane L3 (A16)
    pickStars: "Choisis une note de 1 à 5 étoiles.",
    reviewErr: "L'avis n'est pas parti. Réessaie.",
    stars: (n: number) => `${n} étoile${n > 1 ? "s" : ""}`,
    emptyTitle: "Tu n'as pas encore de cours",
    emptyBody: "Trouve un prof et réserve ta première séance — le tarif est affiché sur sa page.",
    emptyCta: "Explorer les profs",
    outTitle: "Connecte-toi pour voir tes cours",
    outBody: "Tes réservations et tes replays apparaissent ici une fois connecté.",
    signIn: "Se connecter",
    noReplay: "Enregistrement pas encore disponible",
  },
  ar: {
    upcoming: "الحصص الجاية",
    startsIn: "تبدا في",
    liveNow: "الدايركت بدا توّا", // phase-a lane L6 (A18.derija-2)
    at: "على",
    cancel: "ألغي مكاني",
    cancelSure: "تحب تلغي هذا الحجز ؟",
    cancelYes: "إيه، ألغي",
    cancelNo: "نحافظ على مكاني",
    cancelRule: `الإلغاء مجاني حتى ${CANCEL_FREE_WINDOW_HOURS} ساعة قبل الحصة.`,
    cancelLocked: "الحصة بدات — الإلغاء أونلاين مسكّر. اعلم أستاذك وهو يتفاهم معاك.",
    cancelLateWarn: `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم برك تلغي، ومكانك يرجع متوفّر على طول — \u2066${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %\u2069 من ثمن البلاصة يتسجّل كمستحق لأستاذك. ما يتخصم حتى مليم في فترة التجربة.`,
    // phase-a lane L3 (A21)
    cancelLateWarnAmount: (tnd: string) => `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم برك تلغي، ومكانك يرجع متوفّر على طول — ${tnd} د.ت (\u2066${Math.round(LATE_CANCEL_RETAINED_PCT * 100)} %\u2069 من ثمن البلاصة) يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelLateWarnNothing: `الحصة في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة. تنجّم تلغي، ومكانك يرجع متوفّر على طول، وما يتحسب عليك حتى شي على هالبلاصة.`,
    cancelledLateAmount: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتسجّلو كمستحق لأستاذك في سجلّ الإلغاءات. ما يتخصم حتى مليم في فترة التجربة.`,
    cancelledLateCharged: (tnd: string) => `الحجز تلغى، والمكان ولّى متوفّر. كان في أقل من ${CANCEL_FREE_WINDOW_HOURS} ساعة: ${tnd} د.ت يتحسبو لأستاذك.`,
    cancelledNothing: "الحجز تلغى، والمكان ولّى متوفّر. ما يتحسب عليك حتى شي على هالبلاصة.",
    alreadyStarted: "الحصة بدات قبل، ما عادش تنجم تلغي أونلاين. اكتب لأستاذك.",
    cancelErr: "الإلغاء ما مشاش. عاود حاول.",
    messageTutor: "راسل",
    addCalendar: "زيدها للأجندة", // espace prof v2 · pro (P7)
    cancelled: "الحجز تلغى. المكان ولّى متوفّر.",
    free: "مجاني",
    rate: "نقّم أستاذي",
    rateWith: (n: string) => `كيفاش كانت الحصة مع ${n} ؟`,
    ratePh: "كلمة للتلاميذ الآخرين (اختياري)",
    send: "ابعث تقييمي",
    sending: "قاعد يتبعث…",
    thanks: "يعيشك ! تقييمك يعاون التلاميذ الآخرين.",
    thanksMasked: "يعيشك ! تقييمك تنشر — نحّينا معلومات الاتصال (النمرة، الإيميل ولا الرابط)، علاخاطر موش مسموحة في صفحة عمومية.",
    already: "قيّمت الحصة هاذي من قبل.", // phase-a lane L6 (A18.derija-2)
    notBooked: "ما كنتش محجوز في الحصة هاذي.", // phase-a lane L6 (A18.derija-2)
    notStarted: "الحصة هاذي ما زالت ما صارتش.", // phase-a lane L6 (A18.derija-2)
    notEnded: "تنجّم تنقّم الحصة كي توفى.", // phase-a lane L3 (A16)
    pickStars: "اختار تقييم من 1 إلى 5 نجوم.",
    reviewErr: "التقييم ما مشاش. عاود حاول.",
    stars: (n: number) => `${n} نجوم`,
    emptyTitle: "ما زال ما عندكش حصص",
    emptyBody: "لقّي أستاذ واحجز حصتك الأولى — الثمن يبان في صفحتو.",
    emptyCta: "اكتشف الأساتذة",
    outTitle: "تسجّل الدخول باش تشوف حصصك",
    outBody: "حجوزاتك والتسجيلات يظهرو هوني كي تسجّل الدخول.",
    signIn: "تسجيل الدخول",
    noReplay: "التسجيل ما زال ما هوش متوفّر",
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const initialsOf = (name: string) => {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "";
  return ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
};

/* Real countdown: ticks against the class's actual start timestamp. */
function StartsIn({ ts }: { ts: number }) {
  const { t } = useLocale();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, ts - now);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div style={{ display: "flex", gap: 9, margin: "14px 0" }}>
      {[
        { val: pad(h), label: t.student.hours },
        { val: pad(m), label: t.student.mins },
        { val: pad(s), label: t.student.secs },
      ].map(({ val, label }) => (
        <div key={label} style={{ background: "rgba(255,255,255,.12)", borderRadius: 12, padding: "9px 0", textAlign: "center", flex: 1, maxWidth: 90 }}>
          <b className="font-display text-[21px] block">{val}</b>
          <span className="text-[13px] text-on-dark-soft tracking-[.3px]">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- rate-your-tutor (writes a real review) ---------- */
function RateBox({ item, onDone }: { item: StudentClass; onDone: () => void }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function submit() {
    if (rating < 1) { setMsg({ kind: "err", text: c.pickStars }); return; }
    setBusy(true);
    /* phase-a lane L3 (A16): a server failure now rejects instead of coming back
       as "already-reviewed"; say it did not work rather than spin forever. */
    let res: Awaited<ReturnType<typeof createReview>>;
    try {
      res = await createReview({ classId: item.classId, rating, text: text.trim() || undefined });
    } catch {
      setBusy(false);
      setMsg({ kind: "err", text: c.reviewErr });
      return;
    }
    setBusy(false);
    if (res.ok) {
      setMsg({ kind: "ok", text: res.masked ? c.thanksMasked : c.thanks });
      setOpen(false);
      onDone();
      return;
    }
    const e = res.error;
    setMsg({
      kind: "err",
      text: e === "already-reviewed" ? c.already
        : e === "not-booked" ? c.notBooked
        : e === "class-not-started" ? c.notStarted
        : e === "class-not-ended" ? c.notEnded // phase-a lane L3 (A16)
        : e === "invalid-rating" ? c.pickStars
        : c.reviewErr,
    });
  }

  if (msg?.kind === "ok") {
    return <div className="text-[13px] text-green font-bold mt-2">{msg.text}</div>;
  }

  if (!open) {
    return (
      <div className="mt-2">
        <button
          onClick={() => { setOpen(true); setMsg(null); }}
          style={{
            border: 0, background: "var(--sand, var(--blue50))", color: "var(--ochre-ink)", fontWeight: 700,
            fontSize: 13, padding: "8px 13px", borderRadius: 999, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44,
          }}
        >
          <Star /> {c.rate}
        </button>
        {msg && <div className="text-[13px] text-rose mt-1.5">{msg.text}</div>}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 14, background: "var(--paper)", border: "1px solid var(--line)" }}>
      <div className="text-[13px] font-bold mb-2">{c.rateWith(item.tutorName)}</div>
      <div className="flex gap-1 mb-2.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => { setRating(n); setMsg(null); }}
            aria-label={c.stars(n)}
            aria-pressed={rating === n}
            style={{
              border: 0, background: "transparent", cursor: "pointer", padding: 4, minWidth: 44, minHeight: 44,
              display: "grid", placeItems: "center",
              color: n <= rating ? "var(--amber)" : "var(--lineCool)",
            }}
          >
            <Star className={n <= rating ? "fill" : ""} />
          </button>
        ))}
      </div>
      {/* aria-label, not just a placeholder: a placeholder disappears the moment
          you type and is not a label. This was the only unlabelled input left. */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label={c.ratePh}
        placeholder={c.ratePh}
        maxLength={1000}
        rows={3}
        style={{
          width: "100%", borderRadius: 12, border: "1px solid var(--line)", padding: "10px 12px",
          fontSize: 13, fontFamily: "inherit", resize: "vertical", background: "var(--cream, #fff)", color: "var(--ink)",
        }}
      />
      {msg?.kind === "err" && <div className="text-[13px] text-rose mt-1.5">{msg.text}</div>}
      <div className="flex gap-2 mt-2.5 flex-wrap">
        <Button variant="primary" sm onClick={submit} disabled={busy} className="w-auto py-2.5 px-4 min-h-11">
          {busy ? c.sending : c.send}
        </Button>
        <Button variant="ghost" sm onClick={() => setOpen(false)} className="w-auto py-2.5 px-4 min-h-11">
          {c.cancelNo}
        </Button>
      </div>
    </div>
  );
}

/* ---------- one upcoming booking ---------- */
/* onChanged carries WHETHER IT WAS LATE, so the flash message can be specific
   rather than a single vague "cancelled" toast. A student who has just had 40%
   recorded against them should be told so on the same screen — and told, in the
   same breath, that nothing is taken during the pilot. */
/* phase-a lane L3 (A21): what the server says was retained, not a flat "40 %". */
type CancelOutcome = { late: boolean; retainedTnd: number; paymentsEnabled: boolean };
const tndLabel = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function UpcomingCard({ item, hero, onChanged }: { item: StudentClass; hero: boolean; onChanged: (outcome: CancelOutcome) => void }) {
  const { t, locale } = useLocale();
  const c = copy[locale];
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const startsIn = item.ts - now;
  const live = startsIn <= 0;
  /* DAY_MS is a COUNTDOWN threshold ("starting soon"), not the cancellation
     policy. They used to be the same 24 hours and were easy to confuse; they are
     deliberately separate now. Do not re-merge them. */
  const withinDay = startsIn < DAY_MS;

  /* CANCELLABLE UNTIL IT STARTS. This used to be `startsIn >= DAY_MS`, so the
     button vanished 24h out and the student's only option was to message their
     tutor — leaving the seat locked to someone who was not coming, which the
     tutor could not resell. Under the 48h/40% rule a late cancellation is
     allowed; what changes inside the window is the warning below, not access. */
  const cancellable = startsIn > 0;
  const lateCancel = cancellable && startsIn < CANCEL_FREE_WINDOW_MS;

  async function doCancel() {
    setBusy(true);
    setErr(null);
    const res = await cancelBooking({ bookingId: item.bookingId });
    setBusy(false);
    setConfirming(false);
    /* The SERVER decides whether it was late — its clock is the one that counts,
       and by the time this resolves the browser's `now` may have drifted past a
       boundary the server evaluated differently. Fall back to the local guess
       only if the field is missing. */
    if (res.ok) {
      onChanged({ late: res.late ?? lateCancel, retainedTnd: res.retainedTnd ?? 0, paymentsEnabled: res.paymentsEnabled ?? false });
      return;
    }
    setErr(res.error === "already-started" ? c.alreadyStarted : c.cancelErr);
  }

  return (
    <div
      className="zellige"
      style={{
        padding: hero ? "clamp(20px, 3vw, 36px)" : "clamp(16px, 2.2vw, 22px)",
        borderRadius: "var(--r-xl)",
        background: "linear-gradient(155deg,var(--ink800),var(--ink900))",
        color: "#fff",
        position: "relative",
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: live ? "var(--rose)" : "rgba(255,255,255,.14)", color: "#fff", fontWeight: 700, fontSize: 13, padding: "5px 11px", borderRadius: 999, flexShrink: 0 }}>
          {live && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "blink 1.1s infinite", flexShrink: 0 }} />}
          {live ? c.liveNow : t.student.soon}
        </span>
        <span style={{ color: "var(--on-dark-soft)", fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t.student.with} <UserText>{item.tutorName}</UserText>
        </span>
      </div>

      {/* h3: the section above already owns the h2 ("Prochains cours") */}
      <UserText as="h3" style={{ fontFamily: "var(--fd)", fontSize: hero ? "clamp(19px, 2.8vw, 28px)" : "clamp(16px, 2vw, 19px)", lineHeight: 1.25, marginBottom: 8 }}>
        {item.title}
      </UserText>

      <div className="flex items-center gap-2.5 flex-wrap text-on-dark text-[13px] font-semibold">
        <span className="inline-flex items-center gap-1.5">
          <Clock /> <time dateTime={new Date(item.ts).toISOString()}>{item.day} {monthLabel(item.month, locale)} · {item.time}</time>
        </span>
        {item.isFree && <Chip kind="free">{c.free}</Chip>}
      </div>

      {!live && withinDay && <StartsIn ts={item.ts} />}

      <div className="flex gap-2.5 flex-wrap mt-3.5 items-center">
        <Link href={`/live/${item.classId}`} className="block flex-[1_1_200px] max-w-[320px]">
          <Button variant="primary">
            <Video /> {t.student.join}
          </Button>
        </Link>

        {/* Step 8b. The student's side of the same channel: the tutor's phone
            number was never shown to them either, and a question before a class
            has to go somewhere. Same visual weight as Cancel — secondary to
            Join, which is what this card is for. */}
        <MessageBookingButton
          bookingId={item.bookingId}
          style={{
            border: "1px solid rgba(255,255,255,.28)", background: "transparent", color: "var(--on-dark)",
            fontWeight: 700, fontSize: 13, padding: "12px 16px", borderRadius: 999, cursor: "pointer", minHeight: 44,
          }}
          ariaLabel={`${c.messageTutor} ${item.tutorName}`}
        />

        {/* espace prof v2 · pro (P7): the same .ics the confirmation email attaches. A
            plain <a>, not <Link>: /api/calendar is not a localized page. */}
        <a
          href={`/api/calendar/${encodeURIComponent(item.bookingId)}?l=${locale}`}
          download
          data-e2e="add-to-calendar"
          className="inline-flex items-center gap-1.5"
          style={{
            border: "1px solid rgba(255,255,255,.28)", background: "transparent", color: "var(--on-dark)",
            fontWeight: 700, fontSize: 13, padding: "12px 16px", borderRadius: 999, minHeight: 44,
          }}
        >
          <Calendar /> {c.addCalendar}
        </a>

        {cancellable && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            style={{
              border: "1px solid rgba(255,255,255,.28)", background: "transparent", color: "var(--on-dark)",
              fontWeight: 700, fontSize: 13, padding: "12px 16px", borderRadius: 999, cursor: "pointer", minHeight: 44,
            }}
          >
            {c.cancel}
          </button>
        )}
      </div>

      {confirming && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 14, background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.14)" }}>
          <div className="text-[13px] font-bold mb-1">{c.cancelSure}</div>
          <div className="text-[13px] text-on-dark mb-2.5 leading-[1.5]">
            {/* phase-a lane L3 (A21): the figure THIS seat would retain; 0 → "rien n'est retenu". */}
            {!lateCancel
              ? c.cancelRule
              : item.lateCancelRetainedTnd === undefined
                ? (item.isFree ? c.cancelLateWarnNothing : c.cancelLateWarn)
                : item.lateCancelRetainedTnd > 0
                  ? c.cancelLateWarnAmount(tndLabel(item.lateCancelRetainedTnd))
                  : c.cancelLateWarnNothing}
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={doCancel}
              disabled={busy}
              className="border-0 bg-rose text-white font-bold text-[13px] py-3 px-4 rounded-[999px] cursor-pointer min-h-11"
            >
              {busy ? "…" : c.cancelYes}
            </button>
            <button
              onClick={() => setConfirming(false)}
              style={{ border: "1px solid rgba(255,255,255,.28)", background: "transparent", color: "#fff", fontWeight: 700, fontSize: 13, padding: "12px 16px", borderRadius: 999, cursor: "pointer", minHeight: 44 }}
            >
              {c.cancelNo}
            </button>
          </div>
        </div>
      )}

      {!cancellable && !live && (
        <div className="mt-3 text-[13px] text-on-dark-soft leading-[1.5]">{c.cancelLocked}</div>
      )}

      {err && (
        <div role="alert" style={{ marginTop: 12, background: "rgba(226,72,61,.16)", border: "1px solid rgba(226,72,61,.4)", color: "var(--rose200)", borderRadius: 12, padding: "10px 12px", fontSize: 13, lineHeight: 1.5 }}>
          {err}
        </div>
      )}
    </div>
  );
}

export default function StudentPage() {
  const { t, locale } = useLocale();
  const c = copy[locale];

  // undefined = loading · null = no session / no data
  const [data, setData] = useState<StudentDashboard | null | undefined>(undefined);
  const [me, setMe] = useState<{ name: string | null } | null | undefined>(undefined);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    getStudentDashboard().then(setData).catch(() => setData(null));
  }, []);

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe(null));
    load();
  }, [load]);

  const loading = data === undefined || me === undefined;
  const upcoming = data?.upcoming ?? [];
  const past = data?.past ?? [];
  const nothing = upcoming.length === 0 && past.length === 0;
  const initials = me?.name ? initialsOf(me.name) : "";

  return (
    <SiteShell>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes blink { 50% { opacity: .25; } }` }} />

      {/* Page header */}
      <section className="web-section tight !pb-0">
        <div className="container">
          <div className="flex items-center justify-between gap-3 mb-[clamp(18px,_3vw,_32px)]">
            <div>
              <p className="web-eyebrow mb-1.5">{t.nav.classes}</p>
              <h1 className="web-h2">{t.student.title}</h1>
            </div>
            {initials && <Avatar initials={initials} size={46} square />}
          </div>
        </div>
      </section>

      {/* phase-a/integrate (A21): the outcome message sits OUTSIDE the list branches.
          Inside them, cancelling your only booking swapped in the empty state and the
          message — the one place that says what was retained — never showed. */}
      {flash && me && (
        <section className="web-section tight !py-0">
          <div className="container">
            <div role="status" style={{ background: "var(--green50)", border: "1px solid rgba(27,156,111,.3)", color: "var(--green-ink)", borderRadius: 12, padding: "11px 13px", fontSize: 13, marginBottom: 14 }}>
              {flash}
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <section className="web-section tight">
          <div className="container grid place-items-center min-h-[200px]">
            <Spinner />
          </div>
        </section>
      ) : !me ? (
        /* Signed out (middleware normally catches this first) */
        <section className="web-section tight">
          <div className="container">
            <div className="panel panel-pad" style={{ textAlign: "center", padding: "clamp(28px,5vw,52px)" }}>
              <h2 className="web-h2 text-[clamp(17px,2.2vw,22px)] mb-2">{c.outTitle}</h2>
              <p className="muted text-[13.5px] mb-[18px]">{c.outBody}</p>
              <Link href="/auth?next=/student" className="btn btn-primary max-w-[260px] mx-auto">
                {c.signIn}
              </Link>
            </div>
          </div>
        </section>
      ) : nothing ? (
        /* Signed in, no bookings at all */
        <section className="web-section tight">
          <div className="container">
            <div className="panel panel-pad" style={{ textAlign: "center", padding: "clamp(28px,5vw,52px)" }}>
              <h2 className="web-h2 text-[clamp(17px,2.2vw,22px)] mb-2">{c.emptyTitle}</h2>
              <p className="muted text-[13.5px] mb-[18px]">{c.emptyBody}</p>
              <Link href="/explore" className="btn btn-primary max-w-[260px] mx-auto">
                {c.emptyCta}
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Upcoming — every card is a real booking */}
          {upcoming.length > 0 && (
            <section className="web-section tight">
              <div className="container">
                <h2 className="web-h2 text-[clamp(16px,_2vw,_20px)] mb-[clamp(14px,_2vw,_20px)]">
                  {c.upcoming}
                </h2>
                {upcoming.map((item, i) => (
                  <UpcomingCard
                    key={item.bookingId}
                    item={item}
                    hero={i === 0}
                    onChanged={(o) => {
                      // phase-a lane L3 (A21): the actual retained amount, as the ledger outcome while payments are off.
                      setFlash(
                        !o.late
                          ? c.cancelled
                          : o.retainedTnd > 0
                            ? (o.paymentsEnabled ? c.cancelledLateCharged : c.cancelledLateAmount)(tndLabel(o.retainedTnd))
                            : c.cancelledNothing,
                      );
                      load();
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Past sessions: replay + rate your tutor */}
          {past.length > 0 && (
            <section className="web-section tight">
              <div className="container">
                <h2 className="web-h2 text-[clamp(16px,_2vw,_20px)] mb-[clamp(14px,_2vw,_20px)]">
                  {t.student.past}
                </h2>
                <div className="panel">
                  {past.map((item, i) => (
                    <div
                      key={item.bookingId}
                      style={{
                        padding: "clamp(12px, 1.6vw, 16px) clamp(14px, 2vw, 20px)",
                        borderBottom: i < past.length - 1 ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <div className="flex gap-3 items-center">
                        <div className="w-11 h-11 min-w-11 rounded-[12px] bg-blue text-white grid place-items-center shrink-0">
                          <Play />
                        </div>
                        <div className="flex-1 min-w-0">
                          <UserText as="div" style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</UserText>
                          <div className="muted text-[13px] mt-0.5">
                            <time dateTime={new Date(item.ts).toISOString()}>{item.day} {monthLabel(item.month, locale)} · {item.time}</time> · {t.student.with} <UserText>{item.tutorName}</UserText>
                          </div>
                        </div>
                        {item.replayUrl ? (
                          <button
                            onClick={() => window.open(item.replayUrl, "_blank", "noopener,noreferrer")}
                            className="shrink-0 border-0 bg-blue50 text-blue font-bold text-[13px] py-2 px-[13px] rounded-[999px] cursor-pointer inline-flex items-center gap-1.5 min-h-11"
                            aria-label={`${t.student.replay} — ${item.title}`}
                          >
                            <Play /> {t.student.replay}
                          </button>
                        ) : (
                          <span className="muted text-[13px] shrink-0 max-w-[120px] text-end leading-[1.35]">
                            {c.noReplay}
                          </span>
                        )}
                      </div>

                      {/* Real reviews come from here */}
                      <RateBox item={item} onDone={() => undefined} />
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </SiteShell>
  );
}
