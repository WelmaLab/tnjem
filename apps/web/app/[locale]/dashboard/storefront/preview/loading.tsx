import { OwnerPreviewLoading } from "@/components/dashboard/storefront/OwnerPreviewFrame";

/* espace prof v2 · pro (P7): the owner preview is a dynamic server page that waits for
   the API — a skeleton inside the shell while it does, not a blank frame. */
export default function Loading() {
  return <OwnerPreviewLoading />;
}
