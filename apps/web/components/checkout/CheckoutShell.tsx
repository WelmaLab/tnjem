"use client";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { SiteShell } from "@/components/SiteShell";
import { useLocale } from "@/components/LocaleProvider";
import CheckoutInner from "@/components/checkout/CheckoutInner";

/* Shell only. Everything about the reservation — copy, states, layout — lives in
   CheckoutInner, which needs useSearchParams and therefore a Suspense boundary.
   (live-fixes-3 · A4: this was app/[locale]/checkout/page.tsx; the page is now a
   server component, so it can send the class's own tutor to /live/<id> first.) */
export function CheckoutShell() {
  const { t } = useLocale();
  return (
    <SiteShell>
      <section className="web-section tight">
        <div className="container container-narrow">
          <Suspense
            fallback={
              /* A bare spinner tells the user nothing. Label it, and announce it so
                 a screen reader isn't left on a silent screen. */
              <div
                role="status"
                aria-live="polite"
                className="grid place-items-center min-h-[240px] text-center"
              >
                <div>
                  <Spinner />
                  <p className="text-muted text-[13.5px]">{t.common.loading}</p>
                </div>
              </div>
            }
          >
            <CheckoutInner />
          </Suspense>
        </div>
      </section>
    </SiteShell>
  );
}
