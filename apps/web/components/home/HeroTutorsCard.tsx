import Image from "next/image";
import type { HomeTutor } from "@tnajem/shared";
import type { AppLocale } from "@/lib/locale";
import { bilingual } from "@/lib/i18n";
import { Link } from "@/components/Link";
import { Verified } from "@/components/ui";
import { Forward, Search, Star } from "@/components/icons";
import { Doodle } from "@/components/home/Doodle";
import { heroRows } from "@/components/home/hero-rows";
import { SubjectIcon } from "@/components/home/SubjectIcon";

/* home v2 · B — the hero's right side: a search pill, three rows, « Voir tous les
   profs », and the handwritten note. SERVER component: the rows arrive with the
   HTML (lib/home-tutors.ts), so nothing moves when the page hydrates and the H1
   stays the largest paint.

   HONESTY (HOME_V2 rules 1 and 2): the rows are REAL tutors from GET /tutors/home,
   then neutral subject rows (hero-rows.ts). A price shows only when the payload has
   one, a rating only from 3 reviews, a photo only when it was approved. The note
   says « vérifiés à la main », not « bien notés ».

   ONE CONTROL PER ROW (guardrail 9): each row is a single link — avatar, title,
   badge, levels, price, chevron all inside, nothing clickable nested. */

const copy = bilingual({
  fr: {
    search: "Maths · Bac",
    searchSr: "Chercher un prof : ",
    listLabel: "Des profs vérifiés sur Tnajem",
    verified: "Vérifié",
    seeAll: "Voir tous les profs",
    note: "Des profs vérifiés à la main",
    ratingSr: "Note moyenne",
  },
  ar: {
    search: "رياضيات · باك",
    searchSr: "لوّج على أستاذ: ",
    listLabel: "أساتذة متثبّت منهم على Tnajem",
    verified: "متثبّت منّو",
    seeAll: "شوف الأساتذة الكل",
    note: "أساتذة متثبّت منهم بيدينا",
    ratingSr: "المعدّل",
  },
});

export function HeroTutorsCard({ locale, tutors }: { locale: AppLocale; tutors: HomeTutor[] }) {
  const c = copy[locale];
  const rows = heroRows(tutors, locale);
  const real = rows.filter((r) => r.kind === "tutor").length;

  return (
    <div className="hv-stage">
      <Doodle kind="blob" tone="blue" className="hv-blob hv-blob-a" />
      <Doodle kind="blob" tone="ochre" className="hv-blob hv-blob-b" />
      <Doodle kind="rays" tone="ochre" className="hv-rays" />

      <div className="hv-card" data-e2e="hero-tutors-card" data-real-tutors={real}>
        <Link href="/explore?subject=maths&level=bac" className="hv-search" data-e2e="hero-search">
          <Search className="hv-search-ic" />
          <span className="hv-search-txt">
            <span className="sr-only">{c.searchSr}</span>
            {c.search}
          </span>
          <span className="hv-search-go" aria-hidden="true">
            <Forward />
          </span>
        </Link>

        <ul className="hv-rows" aria-label={c.listLabel}>
          {rows.map((r) => (
            <li key={r.key}>
              <Link href={r.href} className="hv-row" data-e2e="hero-tutor-row" data-kind={r.kind}>
                {r.kind === "tutor" && r.avatarUrl ? (
                  <Image
                    src={r.avatarUrl}
                    alt=""
                    width={44}
                    height={44}
                    sizes="44px"
                    loading="lazy"
                    unoptimized
                    className="hv-av"
                  />
                ) : r.kind === "tutor" ? (
                  <span className="hv-av hv-av-ini" aria-hidden="true">{r.initials}</span>
                ) : (
                  <span className="hv-av hv-av-ini hv-av-icon" aria-hidden="true">
                    <SubjectIcon subject={r.icon} />
                  </span>
                )}

                <span className="hv-row-main">
                  {r.kind === "tutor" && <span className="sr-only">{r.name}, </span>}
                  <span className="hv-row-title">
                    <span className="hv-row-title-txt">{r.title}</span>
                    {r.kind === "tutor" && <Verified label={c.verified} />}
                  </span>
                  <span className="hv-row-meta">{r.meta}</span>
                  {r.kind === "tutor" && r.rating && (
                    <span className="hv-row-rating" data-e2e="hero-rating">
                      <Star className="hv-star" />
                      <span className="sr-only">{c.ratingSr} </span>
                      <b>{r.rating.value}</b> {r.rating.count}
                    </span>
                  )}
                </span>

                {r.kind === "tutor" ? (
                  r.price && (
                    <span className="hv-price" data-e2e="hero-price">
                      <b>
                        {r.price.amount} {r.price.currency}
                      </b>
                      <span>{r.price.unit}</span>
                    </span>
                  )
                ) : (
                  <span className="hv-row-cta">{r.cta}</span>
                )}
                <Forward className="hv-chev" />
              </Link>
            </li>
          ))}
        </ul>

        <Link href="/explore" className="hv-all">
          {c.seeAll} <Forward className="hv-all-ic" />
        </Link>
      </div>

      <p className="hv-note">
        <span className="hv-note-txt">{c.note}</span>
        <Doodle kind="arrow-curl" tone="blue" className="hv-note-arrow" />
      </p>
    </div>
  );
}
