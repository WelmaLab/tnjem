"use client";
import { HomeView } from "@/components/dashboard/home/HomeView";

/* /dashboard — « Accueil » of the prof space (espace prof v2, image 1). The page
   used to be 1 250 lines; it is now components/dashboard/home/*, and the panels it
   carried live on their own pages (see the header of HomeView.tsx). The AppShell
   around it comes from app/[locale]/dashboard/layout.tsx. */
export default function DashboardPage() {
  return <HomeView />;
}
