"use client";
import { Link } from "@/components/Link";
import { useLocale } from "@/components/LocaleProvider";
import { User, Book } from "@/components/icons";
import type { Role } from "@tnajem/shared";

/* Shown when a signed-in user opens a screen that belongs to the OTHER role.

   The state it replaces was worse than an error: a student who opened /dashboard
   got the full tutor shell with a "create your storefront" call to action, which
   walked them straight into the silent role conversion createTutor() used to
   perform. An empty tutor dashboard is not a neutral fallback — it is an
   invitation. So we say which account they are signed in as, send them to the
   screen that IS theirs, and offer the deliberate upgrade path as a secondary
   action rather than the primary one.

   Layout deliberately mirrors <SignedOut> in the dashboard so the two "you can't
   see this" states read as one family. */
const COPY = {
  fr: {
    title: "Tu es connecté comme élève",
    body: "Le tableau de bord est l'espace des profs. Tes cours réservés, tes fiches et tes avis sont dans ton espace élève.",
    cta: "Voir mes cours",
    upgradeLead: "Tu veux enseigner sur Tnajem ?",
    upgradeCta: "Devenir prof",
    genericTitle: "Cet espace n'est pas le tien",
    genericBody: "Ton compte n'a pas accès à cette page.",
    genericCta: "Retour à l'accueil",
  },
  ar: {
    title: "إنتي داخل كتلميذ",
    body: "لوحة التحكّم هي فضاء الأساتذة. الحصص اللي حجزتها، الملفات والتقييمات متاعك تلقاهم في الفضاء متاعك كتلميذ.",
    cta: "شوف حصصي",
    upgradeLead: "تحب تقرّي في تنجّم ؟",
    upgradeCta: "ولّي أستاذ",
    genericTitle: "هذا الفضاء موش متاعك",
    genericBody: "حسابك ما ينجّمش يدخل للصفحة هاذي.", // phase-a lane L6 (A18.derija-2)
    genericCta: "ارجع للرئيسية",
  },
} as const;

export function WrongRoleNotice({ role }: { role: Role }) {
  const { locale } = useLocale();
  const c = COPY[locale];
  const isStudent = role === "student";

  return (
    <div className="panel panel-pad text-center max-w-[560px] mx-auto">
      <div
        aria-hidden="true"
        className="w-[60px] h-[60px] rounded-[18px] bg-blue50 text-blue grid place-items-center mx-auto mb-[13px]"
      >
        {isStudent ? <User /> : <Book />}
      </div>

      <h2 className="font-display text-[18px] mb-[7px]">
        {isStudent ? c.title : c.genericTitle}
      </h2>
      <p className="text-[13px] text-muted leading-[1.6] mb-[18px]">
        {isStudent ? c.body : c.genericBody}
      </p>

      <Link href={isStudent ? "/student" : "/"} className="btn btn-primary max-w-[260px] mx-auto">
        {isStudent ? c.cta : c.genericCta}
      </Link>

      {/* Secondary, and only for students: the upgrade is a real path, but it is a
          deliberate decision — never the thing you land on by accident. */}
      {isStudent && (
        <p className="text-[13px] text-muted mt-[18px] leading-[1.6]">
          {c.upgradeLead}{" "}
          <Link href="/onboarding/upgrade" className="linklike">
            {c.upgradeCta}
          </Link>
        </p>
      )}
    </div>
  );
}
