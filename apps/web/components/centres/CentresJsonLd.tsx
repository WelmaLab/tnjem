import { JsonLd } from "@/components/JsonLd";
import type { AppLocale } from "@/lib/locale";
import { SITE_URL } from "@/lib/metadata";
import { pageCopy } from "./centres-copy";
import { centresJsonLd } from "./centres-offer";

/* december-sprint · B (D12) — /pour-les-centres structured data (Service + breadcrumb).
   No price while SHOW_PACK_PRICES is off: centresJsonLd() decides, and is tested. */
export function CentresJsonLd({ locale }: { locale: AppLocale }) {
  const c = pageCopy[locale];
  return <JsonLd data={centresJsonLd(locale, SITE_URL, { crumb: c.crumb, name: c.metaTitle, description: c.metaDescription })} />;
}
