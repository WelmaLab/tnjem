"use client";
/* /onboarding/upgrade — the deliberate student → tutor conversion.

   THIS SCREEN IS THE FIX. Becoming a tutor used to be an invisible side effect:
   createTutor() wrote `role = 'tutor'` for whoever was signed in, so any student
   who reached /onboarding — a link the header offered them directly — came out the
   other side as a tutor without ever being asked. Nothing told them their account
   had changed, and nothing checked they were old enough to teach children.

   So the conversion now has a page of its own, and that page says what changes
   before it changes. becomeTutor() is the only writer of the role in the codebase,
   it refuses without `confirm`, and it refuses a minor. */
import { useRef, useState } from "react";
import { useLocalizedRouter, Link } from "@/components/Link";
import { Button } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { Check, Shield, Calendar } from "@/components/icons";
import { becomeTutor } from "@/app/actions";
import { SiteShell } from "@/components/SiteShell";
import { Select, SelectField } from "@/components/app/Select";

const COPY = {
  fr: {
    title: "Passer en compte prof",
    lead: "Ton compte élève devient un compte prof. C'est le même numéro et la même connexion — mais l'espace change.",

    changesTitle: "Ce qui change",
    changes: [
      "Tu obtiens une page publique, des classes et un tableau de bord",
      "« Mes cours » laisse la place au tableau de bord prof",
      "Tu devras envoyer ta pièce d'identité pour être vérifié",
    ],
    keepsTitle: "Ce que tu gardes",
    keeps: [
      "Ton numéro, ta connexion et ton historique",
      "Tes séances déjà réservées restent réservées",
    ],

    byLabel: "Ton année de naissance",
    byPh: "Choisir…",
    byNote: "On la demande parce qu'un prof enseigne à des mineurs : il faut être majeur. Elle n'est jamais publique.",

    cta: "Oui, passer en compte prof",
    working: "Un instant…",
    back: "Non, rester élève",

    errMinor: "Il faut avoir 18 ans ou plus pour enseigner sur Tnajem. Tu peux continuer à réserver des cours comme élève.",
    errAge: "Choisis ton année de naissance pour continuer.",
    errRate: "Trop de tentatives. Réessaie dans une heure.",
    errAuth: "Ta session a expiré. Reconnecte-toi.",
    errGeneric: "Ça n'a pas marché. Réessaie.",
    // phase-a lane L2 (A14) — the birth month, asked only when none is on file
    bmLabel: "Ton mois de naissance",
    bmPh: "Choisir…",
    bmMonths: ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"],
    errMonth: "Choisis ton mois de naissance pour continuer.",
    // end phase-a lane L2
  },
  ar: {
    title: "ولّي حساب أستاذ",
    lead: "حسابك متاع تلميذ يولّي حساب أستاذ. نفس النمرة ونفس الدخول — أما الفضاء يتبدّل.",

    changesTitle: "شنوّة يتبدّل",
    changes: [
      "تاخذ صفحة عمومية، وحصص، ولوحة تحكّم",
      "«حصصي» تتبدّل بلوحة الأستاذ",
      "لازمك تبعث بطاقة تعريفك باش تتثبّت",
    ],
    keepsTitle: "شنوّة يبقى كيما هو",
    keeps: [
      "نمرتك، دخولك، وتاريخك",
      "الحصص اللي حجزتهم يبقاو محجوزين",
    ],

    byLabel: "سنة ولادتك",
    byPh: "اختر…",
    byNote: "نسألو عليها خاطر الأستاذ يقرّي قاصرين : لازمك تكون راشد. ما تظهر لحتّى حد.",

    cta: "إيه، نولّي أستاذ",
    working: "لحظة…",
    back: "لا، نبقى تلميذ",

    errMinor: "لازمك 18 سنة ولا أكثر باش تقرّي في تنجّم. تنجم تكمّل تحجز حصص كتلميذ.",
    errAge: "اختار سنة ولادتك باش تكمّل.",
    errRate: "محاولات برشة. عاود بعد ساعة.",
    errAuth: "الجلسة متاعك سالات. عاود ادخل.",
    errGeneric: "ما مشاتش. عاود حاول.",
    // phase-a lane L2 (A14) — the birth month, asked only when none is on file
    bmLabel: "شهر ولادتك",
    bmPh: "اختار…",
    bmMonths: ["جانفي", "فيفري", "مارس", "أفريل", "ماي", "جوان", "جويلية", "أوت", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
    errMonth: "اختار شهر ولادتك باش تكمّل.",
    // end phase-a lane L2
  },
} as const;

export function UpgradeInner({
  needsBirthYear,
  needsBirthMonth = false,
}: {
  needsBirthYear: boolean;
  /** phase-a lane L2 (A14): no month on file → ask for it; the API needs both. */
  needsBirthMonth?: boolean;
}) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const router = useLocalizedRouter();

  const [birthYear, setBirthYear] = useState("");
  // phase-a lane L2 (A14)
  const [birthMonth, setBirthMonth] = useState("");
  const [monthError, setMonthError] = useState<string | null>(null);
  const birthMonthRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* The birth year is the one field here. Its problems go ON it, with focus moved
     there (SelectField sets aria-invalid + aria-describedby); `error` is for the rest. */
  const [ageError, setAgeError] = useState<string | null>(null);
  const birthYearRef = useRef<HTMLButtonElement>(null);
  function invalidAge(message: string) {
    setError(null);
    setAgeError(message);
    birthYearRef.current?.focus();
  }

  // Only offered when we have no age on file. A student who already told us their
  // birth year cannot restate it here — the server prefers the stored value, so a
  // minor could not claim to be older to get the role.
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 83 }, (_, i) => currentYear - 18 - i);

  async function handleConfirm() {
    if (busy) return;
    if (needsBirthYear && !birthYear) { invalidAge(c.errAge); return; }
    // phase-a lane L2 (A14)
    if (needsBirthMonth && !birthMonth) {
      setError(null);
      setMonthError(c.errMonth);
      birthMonthRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setAgeError(null);
    setMonthError(null);
    let res: Awaited<ReturnType<typeof becomeTutor>>;
    try {
      res = await becomeTutor({
        confirm: true,
        birthYear: birthYear ? Number(birthYear) : undefined,
        birthMonth: birthMonth ? Number(birthMonth) : undefined, // phase-a lane L2 (A14)
      });
    } catch {
      setBusy(false);
      setError(c.errGeneric);
      return;
    }
    setBusy(false);
    if (res.ok) {
      /* Hard navigation, not router.push: becomeTutor rewrote the role-hint cookie
         and <SiteHeader> reads it once, post-hydration. A client-side push would
         leave the header showing student navigation on the tutor's first screen. */
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/${locale}/onboarding`;
      return;
    }
    if (res.error === "minor-cannot-teach") setError(c.errMinor);
    else if (res.error === "age-required" && needsBirthYear) invalidAge(c.errAge);
    else if (res.error === "age-required" && needsBirthMonth) setMonthError(c.errMonth); // phase-a lane L2 (A14)
    else if (res.error === "age-required") setError(c.errAge);
    else if (res.error === "too-many-requests") setError(c.errRate);
    else if (res.error === "not-authenticated") setError(c.errAuth);
    else setError(c.errGeneric);
  }

  const list = (title: string, items: readonly string[], tone: "blue" | "green") => (
    <div className="mb-5">
      <div className="text-[13px] font-bold uppercase tracking-[0.4px] text-muted mb-2">{title}</div>
      <ul className="list-none flex flex-col gap-2">
        {items.map((x) => (
          <li key={x} className="flex items-start gap-[9px] text-[13.5px] text-ink2 leading-[1.5]">
            <Check className={`w-4 h-4 flex-none mt-0.5 ${tone === "blue" ? "text-blue" : "text-green-ink"}`} />
            <span className="min-w-0">{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <SiteShell>
      <section className="web-section">
        <div className="container container-narrow flex justify-center">
          <div className="panel panel-pad rise w-full max-w-[520px] min-w-0">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-blue inline-flex flex-none mt-0.5" aria-hidden="true">
                <Shield />
              </span>
              <div className="min-w-0">
                <h1 className="font-display text-[clamp(20px,_3.6vw,_26px)] tracking-[-0.5px] text-ink mb-1.5">
                  {c.title}
                </h1>
                <p className="text-[13.5px] text-muted leading-[1.55]">{c.lead}</p>
              </div>
            </div>

            {list(c.changesTitle, c.changes, "blue")}
            {list(c.keepsTitle, c.keeps, "green")}

            {/* live-fixes-2 · C: the shell's Select, not native <select>s (the browser's
                own list, in the system's language). Same state, same checks
                (handleConfirm), focus moved to the field on a refusal. */}
            {needsBirthYear && (
              <SelectField label={c.byLabel} error={ageError ?? undefined} className="lf-mark-set">
                {({ labelId, describedBy, invalid }) => (
                  <>
                    <Select
                      value={birthYear}
                      onChange={(v) => { setBirthYear(v); setAgeError(null); }}
                      options={years.map((y) => ({ value: String(y), label: String(y) }))}
                      labelledBy={labelId}
                      placeholder={c.byPh}
                      icon={<Calendar />}
                      describedBy={describedBy}
                      invalid={invalid}
                      required
                      buttonRef={birthYearRef}
                      e2e="upgrade-birth-year"
                    />
                    <p className="text-[13px] text-muted mt-1.5 leading-[1.5]">{c.byNote}</p>
                  </>
                )}
              </SelectField>
            )}

            {/* phase-a lane L2 (A14): the month, only when none is on file. */}
            {needsBirthMonth && (
              <SelectField label={c.bmLabel} error={monthError ?? undefined} className="lf-mark-set">
                {({ labelId, describedBy, invalid }) => (
                  <>
                    <Select
                      value={birthMonth}
                      onChange={(v) => { setBirthMonth(v); setMonthError(null); }}
                      options={c.bmMonths.map((m, i) => ({ value: String(i + 1), label: m }))}
                      labelledBy={labelId}
                      placeholder={c.bmPh}
                      icon={<Calendar />}
                      describedBy={describedBy}
                      invalid={invalid}
                      required
                      buttonRef={birthMonthRef}
                      e2e="upgrade-birth-month"
                    />
                    {!needsBirthYear && <p className="text-[13px] text-muted mt-1.5 leading-[1.5]">{c.byNote}</p>}
                  </>
                )}
              </SelectField>
            )}

            {error && (
              <p role="alert" className="text-rose text-[13px] font-semibold leading-[1.5] mb-3 text-start">
                {error}
              </p>
            )}

            {/* Live, not disabled: handleConfirm() explains what is missing. */}
            <Button variant="primary" onClick={handleConfirm} disabled={busy}>
              {busy ? c.working : c.cta}
            </Button>

            <div className="text-center mt-3.5">
              <Link
                href="/student"
                className="linklike text-[13px] inline-flex items-center justify-center min-h-[44px] min-w-[44px]"
              >
                {c.back}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
