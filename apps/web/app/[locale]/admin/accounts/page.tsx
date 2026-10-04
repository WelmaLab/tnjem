"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@/components/Link";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { TutorPromotions } from "@/components/admin/TutorPromotions";
import { TutorOffers } from "@/components/admin/TutorOffers"; // espace prof v2 · pro (P7)
import { Button, Spinner } from "@/components/ui";
import { useLocale } from "@/components/LocaleProvider";
import { useToast } from "@/components/useToast";
import { SiteShell } from "@/components/SiteShell";
import { Shield } from "@/components/icons";
import { UserText } from "@/components/UserText";
import { findAccount, blockAccount, unblockAccount } from "@/app/actions";
import { formatInTunis, type AdminAccount } from "@tnajem/shared";
import { bilingual } from "@/lib/i18n";

/* /admin/accounts — find an account by email; block or unblock it.

   Everything a block DOES is decided server-side (apps/api/src/routes/
   admin-accounts.ts). This page exists to make the consequences visible BEFORE the
   click: how many upcoming classes and bookings the account holds, and that they
   will be cancelled — an admin must never find that out afterwards. The reason is
   required and is shown to admins only. */

const copy = bilingual({
  fr: {
    eyebrow: "ADMIN",
    title: "Comptes",
    lead: "Cherche un compte par son email pour le bloquer ou le débloquer.",
    emailLabel: "Email du compte",
    search: "Chercher",
    searching: "Recherche…",
    deniedTitle: "Accès réservé",
    deniedNote: "Cette page est réservée aux administrateurs.",
    signIn: "Se connecter",
    notFound: "Aucun compte avec cet email.",
    invalidEmail: "Cet email n'est pas valide.",
    role: "Rôle",
    storefront: "Page prof",
    suspended: "suspendue",
    none: "Aucune",
    upcoming: (classes: number, bookings: number) =>
      `${classes} cours à venir · ${bookings} réservation(s) à venir`,
    blockedSince: (when: string) => `Bloqué depuis le ${when}`,
    reasonShown: "Motif",
    isAdmin: "Compte administrateur : il se retire de ADMIN_EMAILS, pas d'ici.",
    reasonLabel: "Motif du blocage (visible par les admins uniquement)",
    reasonRequired: "Écris le motif du blocage (5 caractères minimum).",
    cancelUpcoming: (classes: number, bookings: number) =>
      `Annuler aussi ce qui est à venir : ${[classes ? `${classes} cours` : "", bookings ? `${bookings} réservation${bookings > 1 ? "s" : ""}` : ""].filter(Boolean).join(" et ")}. Chaque élève concerné est prévenu que la séance n'aura pas lieu et ne doit rien.`,
    mustCancel: "Ce compte a des cours ou des réservations à venir : coche la case pour les annuler avec le blocage.",
    block: "Bloquer le compte",
    unblock: "Débloquer",
    blocked: (classes: number, bookings: number) =>
      `Compte bloqué. ${classes} cours annulé(s), ${bookings} réservation(s) libérée(s).`,
    unblocked: "Compte débloqué. Les cours annulés restent annulés.",
    cannotSelf: "Tu ne peux pas bloquer ton propre compte.",
    cannotAdmin: "Un compte administrateur ne se bloque pas d'ici.",
    error: "Une erreur s'est produite. Réessaie.",
  },
  ar: {
    eyebrow: "أدمين",
    title: "الحسابات",
    lead: "لوّج على حساب بالإيميل متاعو باش تحظرو ولا تنحّي الحظر.",
    emailLabel: "إيميل الحساب",
    search: "لوّج",
    searching: "قاعد يلوّج…",
    deniedTitle: "الدخول محجوز",
    deniedNote: "الصفحة هاذي محجوزة للأدمين برك.",
    signIn: "ادخل",
    notFound: "ما فمّاش حساب بهذا الإيميل.",
    invalidEmail: "الإيميل هذا موش صحيح.",
    role: "الدور",
    storefront: "صفحة الأستاذ",
    suspended: "موقوفة",
    none: "ما فمّاش",
    upcoming: (classes: number, bookings: number) =>
      `${classes} حصص جاية · ${bookings} حجوزات جاية`,
    blockedSince: (when: string) => `محظور من ${when}`,
    reasonShown: "السبب",
    isAdmin: "حساب أدمين: يتنحّى من ADMIN_EMAILS، موش من هوني.",
    reasonLabel: "سبب الحظر (يشوفوه الأدمين برك)",
    reasonRequired: "اكتب سبب الحظر (5 حروف على الأقل).",
    cancelUpcoming: (classes: number, bookings: number) =>
      `ألغي زادة اللي جاي : ${[classes ? `${classes} حصة` : "", bookings ? `${bookings} حجز` : ""].filter(Boolean).join(" و ")}. كل تلميذ معني يتعلم اللي الحصة ما باش تصير وما عليه والو.`,
    mustCancel: "الحساب هذا عندو حصص ولا حجوزات جاية: علّم على الخانة باش يتلغاو مع الحظر.",
    block: "احظر الحساب",
    unblock: "نحّي الحظر",
    blocked: (classes: number, bookings: number) =>
      `الحساب تحظر. ${classes} حصص تلغات، ${bookings} حجوزات تسرّحت.`,
    unblocked: "الحظر تنحّى. الحصص اللي تلغات تبقى ملغية.",
    cannotSelf: "ما تنجّمش تحظر حسابك إنت.",
    cannotAdmin: "حساب الأدمين ما يتحظرش من هوني.",
    error: "صار مشكل. عاود.",
  },
});

export default function AdminAccountsPage() {
  const { locale } = useLocale();
  const c = copy[locale];
  const { toast, showToast } = useToast();

  const [checking, setChecking] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [reason, setReason] = useState("");
  const [cancelUpcoming, setCancelUpcoming] = useState(false);
  const [busy, setBusy] = useState(false);

  /* Who may see this page is the API's decision: an empty lookup answers
     "forbidden" to anyone off the allowlist, "invalid-email" to an admin. */
  useEffect(() => {
    let alive = true;
    findAccount("")
      .then((res) => { if (alive) setAdmin(res.error !== "forbidden"); })
      .catch(() => { if (alive) setAdmin(false); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, []);

  async function load(address: string) {
    setSearching(true);
    try {
      const res = await findAccount(address.trim());
      if (res.error === "invalid-email") { showToast(c.invalidEmail); return; }
      if (!res.ok) { showToast(c.error); return; }
      setAccount(res.account ?? null);
      setSearched(true);
      setReason("");
      setCancelUpcoming(false);
    } catch {
      showToast(c.error);
    } finally {
      setSearching(false);
    }
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!searching) void load(email);
  }

  /* phase-a lane L5 (A18.14): the moderation queue links a signed-in reporter here
     as ?email=… — the search field arrives filled in (the lookup stays the API's,
     admins only). */
  useEffect(() => {
    const prefill = new URLSearchParams(window.location.search).get("email");
    if (prefill) setEmail(prefill);
  }, []);

  async function onBlock() {
    if (!account || busy) return;
    if (reason.trim().length < 5) { showToast(c.reasonRequired); return; }
    const pending = account.upcomingClasses + account.upcomingBookings > 0;
    if (pending && !cancelUpcoming) { showToast(c.mustCancel); return; }
    setBusy(true);
    try {
      const res = await blockAccount({ profileId: account.id, reason: reason.trim(), cancelUpcoming });
      if (res.ok) {
        showToast(c.blocked(res.cancelledClasses ?? 0, res.cancelledBookings ?? 0));
        await load(account.email ?? email);
        return;
      }
      switch (res.error) {
        case "reason-required": showToast(c.reasonRequired); break;
        case "has-upcoming": showToast(c.mustCancel); await load(account.email ?? email); break;
        case "cannot-block-self": showToast(c.cannotSelf); break;
        case "cannot-block-admin": showToast(c.cannotAdmin); break;
        default: showToast(c.error);
      }
    } catch {
      showToast(c.error);
    } finally {
      setBusy(false);
    }
  }

  async function onUnblock() {
    if (!account || busy) return;
    setBusy(true);
    try {
      const res = await unblockAccount({ profileId: account.id });
      if (res.ok) {
        showToast(c.unblocked);
        await load(account.email ?? email);
      } else {
        showToast(c.error);
      }
    } catch {
      showToast(c.error);
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = account ? account.upcomingClasses + account.upcomingBookings : 0;

  return (
    <SiteShell>
      <section className="web-section tight">
        <div className="container container-narrow">
          <div className="mb-6">
            <span className="web-eyebrow inline-flex items-center gap-1.5 mb-2">
              <Shield className="w-4 h-4" />
              {c.eyebrow}
            </span>
            <h1 className="web-h2">{c.title}</h1>
            {!checking && admin && (
              <>
                <p className="muted mt-2 leading-[1.6]">{c.lead}</p>
                <AdminTabs current="accounts" /> {/* UI Option A (A9) */}
              </>
            )}
          </div>

          {checking && (
            <div className="panel panel-pad grid place-items-center gap-3 text-center">
              <Spinner />
            </div>
          )}

          {!checking && !admin && (
            <div className="panel panel-pad grid place-items-center gap-3 text-center">
              <h2 className="font-display text-[22px]">{c.deniedTitle}</h2>
              <p className="muted leading-[1.6]">{c.deniedNote}</p>
              <Link href="/auth" className="btn btn-primary btn-sm">{c.signIn}</Link>{/* live-fixes-3 · H: one link, not a <button> in an <a> */}
            </div>
          )}

          {!checking && admin && (
            <>
              <form onSubmit={onSearch} className="panel panel-pad flex flex-wrap gap-2.5 items-end">
                <label className="flex-[1_1_240px] min-w-0">
                  <span className="field-label block mb-1.5">{c.emailLabel}</span>
                  <span className="inp block">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="off"
                      data-e2e="account-email"
                    />
                  </span>
                </label>
                <Button variant="primary" type="submit" disabled={searching}>
                  {searching ? c.searching : c.search}
                </Button>
              </form>

              {searched && !account && (
                <p role="status" className="panel panel-pad mt-4 muted">{c.notFound}</p>
              )}

              {account && (
                <article className="panel panel-pad mt-4 flex flex-col gap-4" data-e2e="account-card">
                  <div>
                    <UserText as="div" className="font-display text-[18px]">{account.name ?? account.email ?? ""}</UserText>
                    <div className="muted text-[13px] mt-1" dir="ltr">{account.email}</div>
                  </div>

                  <dl className="grid gap-2 text-[14px]">
                    <div className="flex gap-2 flex-wrap"><dt className="font-bold">{c.role}</dt><dd>{account.role}</dd></div>
                    <div className="flex gap-2 flex-wrap">
                      <dt className="font-bold">{c.storefront}</dt>
                      <dd dir="ltr">
                        {account.tutor
                          ? `/${account.tutor.slug} · ${account.tutor.status}${account.tutor.suspended ? ` · ${c.suspended}` : ""}`
                          : c.none}
                      </dd>
                    </div>
                    <div className="muted">{c.upcoming(account.upcomingClasses, account.upcomingBookings)}</div>
                  </dl>

                  {account.tutor && <TutorPromotions key={account.tutor.id} tutorId={account.tutor.id} />}
                  {/* espace prof v2 · pro (P7): offers + subscriptions, read-only, audited like the promotions above. */}
                  {account.tutor && <TutorOffers key={`offers-${account.tutor.id}`} tutorId={account.tutor.id} />}

                  {account.blockedAt ? (
                    <div className="flex flex-col gap-3" data-e2e="account-blocked">
                      <p role="status" className="font-bold text-rose">
                        {c.blockedSince(formatInTunis(account.blockedAt, locale, { day: "numeric", month: "long", year: "numeric" }))}
                      </p>
                      {account.blockedReason && (
                        <p className="text-[14px] leading-[1.6]">
                          <b>{c.reasonShown} :</b> <UserText>{account.blockedReason}</UserText>
                        </p>
                      )}
                      <div>
                        <Button variant="ghost" onClick={onUnblock} disabled={busy}>{c.unblock}</Button>
                      </div>
                    </div>
                  ) : account.isAdmin ? (
                    <p className="muted leading-[1.6]">{c.isAdmin}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <label>
                        <span className="field-label block mb-1.5">{c.reasonLabel}</span>
                        <span className="inp block">
                          <textarea
                            rows={3}
                            required
                            minLength={5}
                            maxLength={500}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            data-e2e="block-reason"
                          />
                        </span>
                      </label>
                      {pendingCount > 0 && (
                        <label className="flex gap-2.5 items-start text-[14px] leading-[1.6] min-h-11">
                          <input
                            type="checkbox"
                            className="mt-1 w-5 h-5 flex-none"
                            checked={cancelUpcoming}
                            onChange={(e) => setCancelUpcoming(e.target.checked)}
                            data-e2e="block-cancel-upcoming"
                          />
                          <span>{c.cancelUpcoming(account.upcomingClasses, account.upcomingBookings)}</span>
                        </label>
                      )}
                      <div>
                        <button
                          type="button"
                          onClick={onBlock}
                          disabled={busy}
                          className="border-0 bg-rose text-white font-bold text-[14px] py-3 px-5 rounded-[999px] cursor-pointer min-h-11"
                        >
                          {c.block}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              )}
            </>
          )}
        </div>
      </section>
      {toast}
    </SiteShell>
  );
}
