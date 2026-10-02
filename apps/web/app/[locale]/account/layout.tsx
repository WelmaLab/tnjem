import { redirect } from "next/navigation";
import { pageGuard, localeOf, localePath } from "@/lib/page-guard";

/* /account is the STUDENT's (and the parent's) profile page. A tutor's settings are
   « Réglages » in the prof space, /dashboard/settings (espace prof v2 · phase 6), so
   a tutor who follows an old link or bookmark lands there instead — the URL keeps
   working, it just takes them to the right place. REQUEST-TIME ONLY: the choice
   depends on who is asking (the proxy already requires a session here). */
export const dynamic = "force-dynamic";

export default async function AccountLayout(props: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const guard = await pageGuard();
  if (guard.kind === "user" && guard.profile.role === "tutor") {
    redirect(localePath(localeOf((await props.params).locale), "/dashboard/settings"));
  }
  return <>{props.children}</>;
}
