import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* phase-a lane L6 (A18.derija-2) — the MSA lane L5 found in OTHER lanes' files.

   Lane L5 fixed the shared dictionary and its own files, and left a to-do table
   (phase-a-logs/l5.md, "MSA still present in OTHER lanes' files"): the MSA
   demonstrative "هذه" (Tunisian: "هاذي", after the noun), "المباشر" for a live class
   (Tunisian: "دايركت", TNAJEM_DERIJA.md), "رمز" for the login code (Tunisian: "كود",
   as the login button now says "ابعث الكود"), "تم الحجز", "لقد", "نفاذ", and the
   non-Tunisian imperative "أمشي". Each pair below is [MSA, the Derija that replaces
   it], per file; the lane log lists every change. consent.body is out of scope
   (consent wording, LEGAL-REVIEW). */

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "../../web");

const SWEEP: [file: string, pairs: [msa: string, derija: string][]][] = [
  // espace prof v2 · growth (P3): the class page's client body moved to ClassDetail.tsx (page.tsx is now the server route + share card).
  ["app/[locale]/class/[id]/ClassDetail.tsx", [
    ["هذه الحصة كاملة", "الحصة هاذي كاملة"],
    ["هذه الحصة ما عادش مفتوحة للحجز", "الحصة هاذي ما عادش تتحجز"],
    ['free: "مجانية"', 'free: "فابور"'],
    ["الحصة الأولى مجانية ·", "أول حصة فابور ·"],
  ]],
  ["components/checkout/CheckoutInner.tsx", [
    ["تم الحجز !", "حجزت بلاصتك!"],
    ["هذه الحصة ما عادش متوفّرة.", "الحصة هاذي ما عادش موجودة."],
    ["هذه الحصة كاملة", "الحصة هاذي كاملة"],
    ["هذه الحصة ما عادش مفتوحة للحجز", "الحصة هاذي ما عادش تتحجز"],
    ["`هذه الحصة بـ ${p} د.ت.`", "`الحصة هاذي بـ ${p} د.ت.`"],
  ]],
  ["app/[locale]/live/[id]/page.tsx", [
    ["هذه الحصة مخصّصة للتلاميذ المحجوزين", "الحصة هاذي للتلامذة اللي حاجزين برك"],
    ["إنت الأستاذ متاع هذه الحصة.", "إنت الأستاذ متاع الحصة هاذي."],
    ["هذه الحصة تلغات", "الحصة هاذي تلغات"],
  ]],
  // student-space-v1 · B: the old /student page is gone; its live badge is Accueil's hero now.
  ["components/student/NextClassHero.tsx", [
    ["المباشر بدا توّا", "الدايركت بدا توّا"],
  ]],
  // espace prof v2 · phase 6: the new-pack form moved into its own component.
  ["components/dashboard/new-pack/NewPackForm.tsx", [["أمشي لـ « التثبّت »", "امشي لـ « التثبّت »"]]],
  ["components/WrongRoleNotice.tsx", [["حسابك ما عندوش نفاذ لهذه الصفحة.", "حسابك ما ينجّمش يدخل للصفحة هاذي."]]],
  ["app/[locale]/layout.tsx", [["لقّي أستاذ في المباشر،", "لقّي أستاذ دايركت،"]]],
  ["app/[locale]/page.tsx", [["من أول كليك للدرس المباشر،", "من أول كليك للحصة الدايركت،"]]],
  ["app/[locale]/signup/eleve/page.tsx", [["في الدروس المباشرة متاع", "في الحصص الدايركت متاع"]]],
  ["app/[locale]/student/layout.tsx", [["دروسك المباشرة الجاية", "حصصك الدايركت الجاية"]]],
  ["app/[locale]/privacy/page.tsx", [
    ["منّك برمز وحيد", "منّك بكود وحيد"],
    // espace prof v2 · pro (P7): the provider now sends more than the login code — same Derija ("كود", not "رمز").
    ["يبعثلك رمز الدخول", "الإيمايلات متاعنا — كود الدخول"],
    ["الإيميل متاعك والرمز، وخلاص", "الإيميل متاعك ومحتوى الإيمايلات هاذي، وخلاص"],
    ["رموز الدخول (محفوظين", "كودات الدخول (محفوظين"],
    ["السجلاّت، الرموز المشفّرة", "السجلاّت، الكودات المشفّرة"],
    ["\"رموز الدخول: مشفّرة", "\"كودات الدخول: مشفّرة"],
    ["رموز الدخول ورموز الجلسة", "كودات الدخول ورموز الجلسة"],
    ["بعد ما تعمّر رمز الدخول", "بعد ما تعمّر كود الدخول"],
  ]],
  ["app/[locale]/terms/page.tsx", [
    ["الإيميل ورمز الدخول", "الإيميل وكود الدخول"],
    ["وبرمز وحيد", "وبكود وحيد"],
    ["الرمز هذا شخصي", "الكود هذا شخصي"],
    ["منّك الرمز بالتليفون", "منّك الكود بالتليفون"],
    ["ولا إعادة بثّ حصة", "حصة، ولا تعاود تنشرها،"],
    ["11. الحصص المباشرة", "11. الحصص الدايركت"],
    ["\"الحصص المباشرة تنجّم", "\"الحصص الدايركت تنجّم"],
  ]],
];

describe("Derija sweep of other lanes' files (A18.derija-2)", () => {
  for (const [file, pairs] of SWEEP) {
    test(file, () => {
      const src = readFileSync(resolve(WEB, file), "utf8");
      const left = pairs.filter(([msa]) => src.includes(msa)).map(([msa]) => `still MSA: ${msa}`);
      const missing = pairs.filter(([, derija]) => !src.includes(derija)).map(([, derija]) => `missing: ${derija}`);
      assert.deepEqual([...left, ...missing], []);
    });
  }
});
