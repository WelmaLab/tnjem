import { test, expect } from "@playwright/test";
import {
  DELETION_GRACE_DAYS, ID_DOCUMENT_RETENTION_DAYS, INACTIVE_ACCOUNT_RETENTION_DAYS, SESSION_DAYS, SESSION_IDLE_DAYS,
} from "@tnajem/shared/legal";

/* /privacy AND /terms DESCRIBE WHAT IS IMPLEMENTED (production readiness Stage 5).

   Each assertion names a sentence that used to promise something the code did not
   do — deletion by e-mail, a phone allow-list, one cookie, notice by SMS — or a
   value that must follow @tnajem/shared/legal. If the code changes, the page has to
   change with it, and this is where that shows. */

const text = async (page: import("@playwright/test").Page, path: string) => {
  await page.goto(path);
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
};

test.describe("privacy: the published documents match the code", () => {
  test("/fr/privacy quotes the enforced periods and describes deletion, access and cookies as built", async ({ page }) => {
    const t = await text(page, "/fr/privacy");
    // espace prof v2 · auth: PRIVACY_POLICY_VERSION moved to 2026-10-01 with passwords (was 2026-09-24, Phase A).
    expect(t).toContain("Version du 01 octobre 2026");
    expect(t).toContain(`${ID_DOCUMENT_RETENTION_DAYS} jours après la décision`);
    expect(t).toContain(`Nous te laissons ${DELETION_GRACE_DAYS} jours pour changer d'avis`);
    expect(t).toContain("ton compte est anonymisé");
    expect(t).toContain("effacés du stockage");
    expect(t).toContain(`Un compte inutilisé pendant ${Math.round(INACTIVE_ACCOUNT_RETENTION_DAYS / 365)} ans est supprimé`);
    expect(t).toContain(`${SESSION_DAYS} jours après la connexion, après ${SESSION_IDLE_DAYS} jours sans utilisation`);
    expect(t).toContain("liste restreinte d'adresses e-mail");
    expect(t).toContain("les documents d'identité sont chiffrés");
    expect(t).toContain("Nous utilisons trois cookies");
    expect(t).toContain("retirer son accord depuis son espace parent");
    expect(t).toContain("décret n° 2015-1619");
    expect(t, "the allow-list is e-mail addresses, not phone numbers").not.toContain("liste restreinte de numéros");
    expect(t, "bookings and messages are no longer deleted with the account").not.toContain("tes réservations, tes messages et tes informations sont supprimés définitivement");
    expect(t, "the language is a cookie, not local storage").not.toContain("mémoire locale de ton navigateur");
  });

  test("/ar/privacy carries the same periods", async ({ page }) => {
    const t = await text(page, "/ar/privacy");
    expect(t).toContain(`${ID_DOCUMENT_RETENTION_DAYS} يوم بعد القرار`);
    expect(t).toContain(`نخلّيولك ${DELETION_GRACE_DAYS} يوم`);
    expect(t).toContain("ثلاثة كوكيز");
    expect(t).not.toContain("قائمة محدودة من الأرقام");
  });

  /* phase-a lane L6 (A19): a page, a class or a document is reported signed out; a MESSAGE
     needs a participant's account (e2e/legal-truth.spec.ts checks that sentence). */
  test("/terms: deletion is self-service, nothing is promised by SMS, and reporting a page needs no account", async ({ page }) => {
    const fr = await text(page, "/fr/terms");
    expect(fr).toContain("Tu peux supprimer ton compte à tout moment depuis « Mon compte »");
    expect(fr).toContain(`La suppression a lieu ${DELETION_GRACE_DAYS} jours plus tard`);
    expect(fr).toContain("avec le bouton « Signaler »");
    expect(fr).toContain("décret n° 2015-1619");
    expect(fr).not.toContain("Tu peux fermer ton compte à tout moment en nous écrivant");
    expect(fr).not.toContain("par SMS");
    expect(fr, "an admin cannot delete an account, only suspend it").not.toContain("suspendre ou supprimer un compte");

    const ar = await text(page, "/ar/terms");
    expect(ar).toContain("من « حسابي »");
    expect(ar).not.toContain("بـSMS");
  });
});
