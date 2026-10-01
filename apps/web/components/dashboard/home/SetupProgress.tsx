"use client";
import { useState } from "react";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { Check, Clock } from "@/components/icons";
import { STEP_COPY, currentStepNumber, type OnboardingStep, type StepState } from "@/lib/onboarding-steps";
import { bilingual } from "@/lib/i18n";

/* espace prof v2 · shell — the home's SLIM progress banner, shown while setup is
   incomplete: one line ("Étape 2 sur 5 · encore 4 étapes"), a five-segment bar, and
   the five steps folded behind « Voir les étapes ». It used to be a full-height
   checklist panel; the steps are the same ladder (lib/onboarding-steps.ts).

   NO DUPLICATE CTAs. A step whose action is already on the page — the blocker's
   « Envoyer mes documents », the header's « Nouvelle classe », the « Ma vitrine »
   card's copy button — shows its state here, not a second button. */

const copy = bilingual({
  fr: {
    summary: (n: number, total: number, left: number) =>
      left === 1 ? `Étape ${n} sur ${total} · encore 1 étape pour être prêt` : `Étape ${n} sur ${total} · encore ${left} étapes pour être prêt`,
    show: "Voir les étapes",
    hide: "Masquer les étapes",
  },
  ar: {
    summary: (n: number, total: number, left: number) => `مرحلة ${n} من ${total} · باقي ${left} باش تكون جاهز`,
    show: "شوف المراحل",
    hide: "خبّي المراحل",
  },
});

/** The keys whose action already lives elsewhere on the home page. */
const ACTION_ELSEWHERE = new Set<OnboardingStep["key"]>(["store", "verify", "class", "share"]);

/* LITERAL class names, never `hp-mark-${state}`: Tailwind purges @layer components
   rules whose class it cannot find as text in the source (see BTN_VARIANT in ui.tsx). */
const MARK: Record<StepState, string> = {
  done: "hp-mark hp-mark-done",
  waiting: "hp-mark hp-mark-waiting",
  current: "hp-mark hp-mark-current",
  todo: "hp-mark hp-mark-todo",
};
const SEG: Record<StepState, string> = {
  done: "hp-seg hp-seg-done",
  waiting: "hp-seg hp-seg-waiting",
  current: "hp-seg hp-seg-current",
  todo: "hp-seg",
};

function Mark({ state, n }: { state: StepState; n: number }) {
  return (
    <span className={MARK[state]} aria-hidden="true">
      {state === "done" ? <Check /> : state === "waiting" ? <Clock /> : n}
    </span>
  );
}

export function SetupProgress({ steps }: { steps: OnboardingStep[] }) {
  const { locale } = useLocale();
  const c = copy[locale];
  const sc = STEP_COPY[locale];
  const [open, setOpen] = useState(false);
  const now = currentStepNumber(steps);
  const left = steps.filter((s) => s.state !== "done").length;

  return (
    <section className="hp-setup" aria-label={sc.progressLabel} data-e2e="setup-progress">
      <div className="hp-setup-row">
        <p className="hp-setup-txt" data-e2e="setup-summary">{c.summary(now, steps.length, left)}</p>
        <button
          type="button"
          className="linklike text-[13px]"
          aria-expanded={open}
          aria-controls="hp-setup-steps"
          onClick={() => setOpen((v) => !v)}
          data-e2e="setup-toggle"
        >
          {open ? c.hide : c.show}
        </button>
      </div>
      <ol className="hp-bar" aria-hidden="true">
        {/* One ochre segment: the step the tutor is ON. Other open steps stay neutral. */}
        {steps.map((s, i) => (
          <li key={s.key} className={SEG[s.state === "current" && i + 1 !== now ? "todo" : s.state]} />
        ))}
      </ol>
      {open && (
        <ol id="hp-setup-steps" className="hp-steps">
          {steps.map((s, i) => (
            <li key={s.key} className="hp-step" data-e2e={`setup-step-${s.key}`} data-state={s.state}>
              <Mark state={s.state} n={i + 1} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="hp-step-t">{s.title}</span>
                  {s.state === "done" && <span className="tag tag-success">{sc.done}</span>}
                  {s.state === "waiting" && <span className="tag tag-neutral">{sc.inProgress}</span>}
                </div>
                <p className="hp-step-b">{s.body}</p>
              </div>
              {s.cta && !ACTION_ELSEWHERE.has(s.key) && (
                <Link href={s.cta.href} className="btn btn-ghost btn-sm flex-none">
                  {s.cta.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
