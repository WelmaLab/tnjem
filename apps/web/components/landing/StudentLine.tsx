import { Link } from "@/components/Link";
import { Forward } from "@/components/icons";
import { bilingual } from "@/lib/i18n";
import type { AppLocale } from "@/lib/locale";
import "./profs-sections.css";

/* profs-v2 · C — the small last line, for a student who landed on the tutors' page. */

const copy = bilingual({
  fr: { label: "Tu es élève ? Trouve ton prof" },
  ar: { label: "إنتي تلميذ ؟ لقا أستاذك" },
});

export function StudentLine({ locale }: { locale: AppLocale }) {
  return (
    <section className="ps-student" data-e2e="profs-student-line">
      <Link href="/" className="ps-cross">
        {copy[locale].label}
        <Forward className="ps-cross-arrow" />
      </Link>
    </section>
  );
}
