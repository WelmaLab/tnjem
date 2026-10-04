"use client";
import { useEffect, useState, type CSSProperties, use } from "react";
import { useLocalizedRouter } from "@/components/Link";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { SiteShell } from "@/components/SiteShell";
import { Avatar, Button, Spinner } from "@/components/ui";
import { Back, Video, Bulb, Clock } from "@/components/icons";
import { ClassTools } from "@/components/teaching/ClassTools";
import { UserText } from "@/components/UserText";
import { canJoinClass, getClass, getStudentDashboard, getDashboard } from "@/app/actions";
import { monthLabel, type ClassItem } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";
import { classEndMs } from "@tnajem/shared/live"; // phase-a lane L3 (A16)
import { isPublicJitsi } from "@tnajem/shared/live"; // live-fixes-3 · B3
import { formatInTunis, tunisClock, publicTutorName } from "@tnajem/shared"; // live-fixes-3 · B5, E

/* Page-local copy (lib/i18n.ts is shared — don't touch it). */
const copy = bilingual({
  fr: {
    liveNow: "EN DIRECT",
    // live-fixes-3 · B5: never a dangling « Démarre le » — the date and the time come with it.
    startsAt: (when: string) => `Démarre le ${when}`,
    upcoming: "À venir",
    // live-fixes-3 · B3: meet.jit.si wants one signed-in moderator before anyone gets in.
    moderatorNote: "Pour ouvrir la salle, connecte-toi une fois avec Google (ou Microsoft/Facebook) quand Jitsi le demande. Tes élèves entrent ensuite directement.",
    lockedTitle: "Cette séance est réservée aux élèves inscrits",
    lockedBody: "Réserve ta place sur la page du cours et le lien s'ouvrira ici.",
    lockedCta: "Voir le cours & réserver",
    myClasses: "Mes cours",
    tipTitle: "Connexion lente ?",
    tip: "Coupe ta caméra une fois dans la salle : tu peux suivre en silence et écrire dans le chat. Caméra et micro se règlent dans la salle.",
    tutorNote: "Tu es le prof de cette séance.",
    // phase-a lane L3 (A16)
    ended: "TERMINÉE",
    cancelledTitle: "Cette séance a été annulée",
    cancelledBody: "Il n'y a pas de salle à rejoindre. Tes autres cours sont dans « Mes cours ».",
  },
  ar: {
    liveNow: "مباشر",
    startsAt: (when: string) => `تبدا يوم ${when}`, // live-fixes-3 · B5
    upcoming: "جاية",
    moderatorNote: "باش تحلّ القاعة، ادخل مرّة وحدة بـ Google (ولا Microsoft/Facebook) كي Jitsi يطلب منك. التلامذة متاعك يدخلو مباشرة من بعد.", // live-fixes-3 · B3
    lockedTitle: "الحصة هاذي للتلامذة اللي حاجزين برك", // phase-a lane L6 (A18.derija-2)
    lockedBody: "احجز مكانك من صفحة الحصة والرابط يتفتحلك هوني.",
    lockedCta: "شوف الحصة و احجز",
    myClasses: "حصصي",
    tipTitle: "الأنترنت بطيء ؟",
    tip: "طفّي الكاميرا كي تدخل للقاعة : تنجم تتابع بصمت وتكتب في الدردشة. الكاميرا والميكرو يتحكم فيهم من داخل القاعة.",
    tutorNote: "إنت الأستاذ متاع الحصة هاذي.", // phase-a lane L6 (A18.derija-2)
    // phase-a lane L3 (A16)
    ended: "وفات",
    cancelledTitle: "الحصة هاذي تلغات", // phase-a lane L6 (A18.derija-2)
    cancelledBody: "ما فماش قاعة باش تدخلها. حصصك الأخرى تلقاهم في « حصصي ».",
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** live-fixes-3 · B5: « 5 oct · 18:00 » / « 5 أكتوبر · 18:00 » — Tunis time, 24 h. */
function startLabel(ms: number, locale: "fr" | "ar"): string {
  return `${formatInTunis(ms, locale, { day: "numeric", month: "short" }).replace(/\.$/, "")} · ${tunisClock(ms)}`;
}

type Gate = { canJoin: boolean; role?: "tutor" | "student"; meetUrl?: string; reason?: string };
type Props = { params: Promise<{ id: string }> };

/* Real countdown against the class's actual start timestamp — no hardcoded 2 min. */
function LiveCountdown({ ts }: { ts: number }) {
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
    <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "22px 0" }}>
      {[
        { val: pad(h), label: t.student.hours },
        { val: pad(m), label: t.student.mins },
        { val: pad(s), label: t.student.secs },
      ].map(({ val, label }) => (
        <div key={label} style={{ background: "rgba(255,255,255,.10)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 16, width: 66, padding: "12px 0", textAlign: "center" }}>
          <b className="font-display text-[26px] block leading-[1]">{val}</b>
          <span className="text-[13px] text-on-dark-soft">{label}</span>
        </div>
      ))}
    </div>
  );
}

export default function LiveLobbyPage(props: Props) {
  const params = use(props.params);
  const { t, locale } = useLocale();
  const c = copy[locale];
  const router = useLocalizedRouter();

  const [gate, setGate] = useState<Gate | undefined>(undefined);
  const [cls, setCls] = useState<ClassItem | null | undefined>(undefined);
  const [ts, setTs] = useState<number | null>(null); // real start time, when we can source it
  const [now, setNow] = useState(() => Date.now());  // so the badge flips to LIVE on its own

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // 1) Access check first — the URL alone must not open the room.
  useEffect(() => {
    canJoinClass(params.id)
      .then(setGate)
      .catch(() => setGate({ canJoin: false, reason: "not-found" }));
  }, [params.id]);

  // 2) Only load the class once access is granted.
  useEffect(() => {
    if (!gate?.canJoin) return;
    getClass(params.id).then(setCls).catch(() => setCls(null));

    // The exact start timestamp lives on the booking payloads (ClassItem only
    // carries display strings), so pull it from whichever dashboard applies.
    if (gate.role === "tutor") {
      getDashboard()
        .then((d) => {
          // canJoinClass already established gate.role === "tutor", so getDashboard
          // cannot answer {wrongRole} here — narrow rather than assert.
          if (!d || "wrongRole" in d) return;
          const b = d.bookings.find((x) => x.classId === params.id);
          if (b) setTs(b.classTs);
        })
        .catch(() => undefined);
    } else {
      getStudentDashboard()
        .then((d) => {
          const item = [...(d?.upcoming ?? []), ...(d?.past ?? [])].find((x) => x.classId === params.id);
          if (item) setTs(item.ts);
        })
        .catch(() => undefined);
    }
  }, [gate, params.id]);

  // 3) Not signed in → straight to /auth (middleware also guards this route).
  useEffect(() => {
    if (gate && !gate.canJoin && gate.reason === "not-authenticated") {
      router.replace(`/auth?next=/live/${params.id}`);
    }
  }, [gate, params.id, router]);

  // Loading, or bouncing an anonymous visitor to /auth.
  if (gate === undefined || gate.reason === "not-authenticated" || (gate.canJoin && cls === undefined)) {
    return (
      <SiteShell footer={false}>
        <section className="web-section">
          <div className="container grid place-items-center min-h-[280px]">
            <Spinner />
          </div>
        </section>
      </SiteShell>
    );
  }

  // Not booked → explain, and point at the class page so they can reserve.
  if (!gate.canJoin && gate.reason === "not-booked") {
    return (
      <SiteShell footer={false}>
        <section className="web-section">
          <div className="container max-w-[520px] mx-auto">
            <div className="panel panel-pad" style={{ textAlign: "center", padding: "clamp(24px,5vw,40px)" }}>
              <h1 className="web-h2 text-[clamp(17px,2.4vw,22px)] mb-2.5">{c.lockedTitle}</h1>
              <p className="muted text-[13.5px] leading-[1.6] mb-5">{c.lockedBody}</p>
              <Link href={`/class/${params.id}`} className="btn btn-primary max-w-[280px] mx-auto">
                {c.lockedCta}
              </Link>
              <Link href="/student" className="inline-block mt-3.5 text-blue text-[13px] font-bold">
                {c.myClasses}
              </Link>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }

  /* phase-a lane L3 (A16): a CANCELLED class has no room (the join gate refuses it
     — reason "cancelled"). It used to fall through to "Aucun prof trouvé". */
  if ((!gate.canJoin && gate.reason === "cancelled") || cls?.status === "cancelled") {
    return (
      <SiteShell footer={false}>
        <section className="web-section">
          <div className="container max-w-[520px] mx-auto">
            <div className="panel panel-pad" style={{ textAlign: "center", padding: "clamp(24px,5vw,40px)" }}>
              <h1 className="web-h2 text-[clamp(17px,2.4vw,22px)] mb-2.5">{c.cancelledTitle}</h1>
              <p className="muted text-[13.5px] leading-[1.6] mb-5">{c.cancelledBody}</p>
              <Link href="/student" className="btn btn-primary max-w-[280px] mx-auto">
                {c.myClasses}
              </Link>
            </div>
          </div>
        </section>
      </SiteShell>
    );
  }

  // Missing class (or any other refusal).
  if (!gate.canJoin || !cls) {
    return (
      <SiteShell footer={false}>
        <section className="web-section">
          <div className="container" style={{ textAlign: "center", padding: "clamp(28px,6vw,60px)" }}>
            <h1 className="web-h2 mb-3">{t.extra.noResults}</h1>
            <Link href="/student" className="btn btn-primary max-w-[240px] mx-auto">{t.nav.classes}</Link>
          </div>
        </section>
      </SiteShell>
    );
  }

  // The room is always resolvable (lib/live.ts) — canJoinClass returns it.
  const meetUrl = gate.meetUrl ?? cls.meet_url;
  const handleJoin = () => {
    if (meetUrl) window.open(meetUrl, "_blank", "noopener,noreferrer");
  };

  const initials = cls.tutor_name
    ? cls.tutor_name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase()
    : "";

  /* phase-a lane L3 (A16): the REAL start and end, read off the class itself
     (starts_at + duration_min). "Live" used to be `startsIn <= 0`, true for ever
     after the start — a class from last month still said "EN DIRECT". */
  const parsedStart = Date.parse(cls.starts_at);
  const startMs = Number.isFinite(parsedStart) ? parsedStart : ts;
  const endMs = startMs !== null ? classEndMs({ scheduledAt: startMs, durationMin: cls.duration_min }) : null;
  const startsIn = startMs !== null ? startMs - now : null;
  const isLive = startsIn !== null && startsIn <= 0 && endMs !== null && now < endMs;
  const ended = endMs !== null && now >= endMs;
  const showCountdown = startsIn !== null && startsIn > 0 && startsIn < DAY_MS;

  return (
    <SiteShell footer={false}>
      <section className="web-section">
        <div className="container flex justify-center">
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              minWidth: 0,
              borderRadius: "var(--r-xl)",
              background: "radial-gradient(120% 80% at 50% 0%,var(--ink800),var(--ink900))",
              color: "#fff",
              boxShadow: "var(--sh-l)",
              padding: "clamp(18px,4vw,30px)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Top row: back + status tag */}
            <div className="flex justify-between items-center gap-2.5">
              <Link href="/student" className="iconbtn" aria-label={t.common.back} style={{ background: "rgba(255,255,255,.12)", color: "#fff" }}>
                <Back />
              </Link>
              {/* Phase A+ (U3): the shared live pill (paper, ink, a rose dot) while live;
                  a neutral tag for the other states. */}
              <span className={isLive ? "tag tag-live" : "tag tag-neutral"}>
                {isLive ? c.liveNow : ended ? c.ended : showCountdown ? t.live.tag
                  : startMs !== null ? c.startsAt(startLabel(startMs, locale)) : c.upcoming /* live-fixes-3 · B5 */}
              </span>
            </div>

            {/* Stage */}
            <div style={{ textAlign: "center", margin: "clamp(20px,4vw,32px) 0 8px" }}>
              {/* live-fixes-3 · I: centred like the rest of the stage (.avatar is a grid box: text-align never moved it). */}
              {initials && <div className="flex justify-center"><Avatar initials={initials} size={92} /></div>}
              <UserText as="h1" className="font-display text-[clamp(18px,4vw,22px)] mt-4">{cls.title}</UserText>
              {cls.tutor_name && (
                <div className="text-on-dark-soft text-[13px] mt-[5px]">
                  {t.live.with} <UserText>{publicTutorName(cls.tutor_name)}</UserText>{/* live-fixes-3 · E: « Walid T. » */}
                </div>
              )}

              {showCountdown ? (
                <LiveCountdown ts={startMs as number} />
              ) : (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--on-dark)", fontSize: 13.5, fontWeight: 600, margin: "18px 0 6px" }}>
                  <Clock /> <time dateTime={cls.starts_at}>{cls.day} {monthLabel(cls.month, locale)} · {cls.time}</time> · {cls.duration_min} {t.common.min}
                </div>
              )}

              {gate.role === "tutor" && (
                <div className="text-on-dark-soft text-[13px] mb-2.5">{c.tutorNote}</div>
              )}
            </div>

            {/* Honest tip — camera/mic are controlled inside the room, not here */}
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", background: "rgba(255,255,255,.07)", borderRadius: 13, padding: "12px 13px", fontSize: 13, color: "var(--on-dark)", lineHeight: 1.5, marginBottom: 14 }}>
              <Bulb style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1, width: 17, height: 17 } as CSSProperties} />
              <div>
                <div className="font-semibold mb-[3px]">{c.tipTitle}</div>
                <div>{c.tip}</div>
              </div>
            </div>

            {/* Teaching tools — one-tap launchers (whiteboard / quiz) */}
            <ClassTools cls={cls} dark />

            {/* live-fixes-3 · B3: the tutor only, and only on meet.jit.si (one line above the button). */}
            {gate.role === "tutor" && isPublicJitsi(meetUrl) && (
              <p className="lf3-mod-note" data-e2e="live-moderator-note">{c.moderatorNote}</p>
            )}

            <div className="mt-4">
              <Button variant="primary" onClick={handleJoin} disabled={!meetUrl}>
                <Video /> {t.live.join}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <style dangerouslySetInnerHTML={{ __html: `@keyframes blink { 50% { opacity: .25; } }` }} />
    </SiteShell>
  );
}
