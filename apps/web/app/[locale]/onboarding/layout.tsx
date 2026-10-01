import { pageGuard } from "@/lib/page-guard";
import { TutorShellLayout } from "@/components/app/TutorShellLayout";

/* espace prof v2 · shell — /onboarding (« Modifier ma page ») and /onboarding/verify
   (« Vérification ») are prof pages: a tutor sees them inside the AppShell.
   /onboarding/upgrade, the student → tutor conversion, is only ever shown to a
   STUDENT (its page sends a tutor on to /onboarding), so it keeps the public frame —
   the shell is a tutor's space, and the person on that screen is not one yet.
   Each page keeps its own guard; this layout only chooses the frame. */
export const dynamic = "force-dynamic";

export default async function OnboardingLayout(props: { children: React.ReactNode }) {
  return <TutorShellLayout guard={await pageGuard()}>{props.children}</TutorShellLayout>;
}
